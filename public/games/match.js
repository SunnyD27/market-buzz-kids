/* public/games/match.js
 *
 * Game 5 — Match the Company.
 *
 * 4 company name tiles on the left, 4 shuffled "how it makes money"
 * descriptions on the right. Tap a company → tap its description → they
 * pair (color-matched border). Repeat for all 4. Check → reveal.
 *
 * Tap-then-tap (not drag) because drag-drop on iPad fights with page scroll
 * and is hard to land precisely with a finger.
 *
 * XP per spec: +25 all 4 correct, +15 for 3/4, +10 for attempting.
 * Reveal ties to Principle 4 (understand what you own).
 *
 * Data shape:
 *   { companies: [
 *       { ticker, name, emoji, shortModel, surprise, principle }, x4
 *   ] }
 */
(function () {
  'use strict';
  const SHARED = window.MBGames.shared;

  // Pair-color palette — when a kid pairs a company with a description,
  // both tiles get the matching ring so they can see what's connected.
  const PAIR_COLORS = [
    { ring: '#bc8cff', glow: 'rgba(188,140,255,0.18)' },  // purple
    { ring: '#58a6ff', glow: 'rgba(88,166,255,0.18)' },   // blue
    { ring: '#f0c040', glow: 'rgba(240,192,64,0.18)' },   // yellow
    { ring: '#3fb950', glow: 'rgba(63,185,80,0.18)' },    // green
  ];

  function render(host, data, opts) {
    opts = opts || {};
    const companies = data.companies.slice(0, 4);
    if (companies.length !== 4) {
      host.innerHTML = `<div class="mbg-card"><div class="mbg-title">Match the Company needs 4 entries (got ${companies.length}).</div></div>`;
      return;
    }
    const shuffledDescs = SHARED.shuffle(companies.map((c, i) => ({ ...c, originalIndex: i })));

    host.innerHTML = `
      <div class="mbg-card" id="mt-card">
        <div class="mbg-label">🎯 Daily Challenge · Match the Company</div>
        <div class="mbg-title">How does each company actually make money?</div>
        <div class="mbg-prompt">Tap a company, then tap the way it makes money. Pair all 4.</div>

        <div class="mbg-match-instr" id="mt-instr">Pick a company →</div>

        <div class="mbg-match-grid" id="mt-companies"></div>
        <div class="mbg-match-grid" id="mt-descs" style="margin-top: 10px;"></div>

        <button type="button" class="mbg-btn mbg-btn-primary" id="mt-check" disabled style="margin-top: 10px;">
          Check my answers
        </button>

        <div class="mbg-reveal" id="mt-reveal"></div>
      </div>
    `;

    const companiesHost = host.querySelector('#mt-companies');
    const descsHost     = host.querySelector('#mt-descs');
    const checkBtn      = host.querySelector('#mt-check');
    const instr         = host.querySelector('#mt-instr');

    // Build company tiles (originalIndex used as the answer key).
    companies.forEach((c, i) => {
      const tile = document.createElement('div');
      tile.className = 'mbg-match-tile';
      tile.dataset.role = 'company';
      tile.dataset.idx = String(i);
      tile.innerHTML = `
        <div>
          <div style="font-size: 28px; margin-bottom: 4px;">${SHARED.escapeHTML(c.emoji || '🏢')}</div>
          <div class="mbg-match-company-name">${SHARED.escapeHTML(c.name)}</div>
        </div>
      `;
      tile.addEventListener('click', () => onTileTap(tile));
      companiesHost.appendChild(tile);
    });

    // Build description tiles, shuffled. The data-idx points back to the
    // company's original index — that's the correctness check.
    shuffledDescs.forEach(d => {
      const tile = document.createElement('div');
      tile.className = 'mbg-match-tile';
      tile.dataset.role = 'desc';
      tile.dataset.idx = String(d.originalIndex);
      tile.innerHTML = `<div class="mbg-match-revenue">${SHARED.escapeHTML(d.shortModel)}</div>`;
      tile.addEventListener('click', () => onTileTap(tile));
      descsHost.appendChild(tile);
    });

    // Pairings — indexed by the company tile's data-idx → matched description's data-idx.
    // null means "not yet paired."
    const pairings = new Array(4).fill(null);
    let selectedCompany = null;
    let selectedDesc = null;
    let pairColorCursor = 0;
    let completed = false;

    function onTileTap(tile) {
      if (completed) return;
      const role = tile.dataset.role;

      // If this tile is already part of a pairing, tapping it should let the
      // kid un-pair and re-do that match.
      if (tile.dataset.paired === '1') {
        unpair(tile);
        updateUI();
        return;
      }

      if (role === 'company') {
        // Clear any prior company selection.
        if (selectedCompany && selectedCompany !== tile) selectedCompany.classList.remove('selected');
        selectedCompany = (selectedCompany === tile) ? null : tile;
        if (selectedCompany) selectedCompany.classList.add('selected');
        else tile.classList.remove('selected');
      } else {
        if (selectedDesc && selectedDesc !== tile) selectedDesc.classList.remove('selected');
        selectedDesc = (selectedDesc === tile) ? null : tile;
        if (selectedDesc) selectedDesc.classList.add('selected');
        else tile.classList.remove('selected');
      }

      // If one of each is selected → form a pair.
      if (selectedCompany && selectedDesc) {
        formPair(selectedCompany, selectedDesc);
        selectedCompany.classList.remove('selected');
        selectedDesc.classList.remove('selected');
        selectedCompany = null;
        selectedDesc = null;
      }

      updateUI();
    }

    function formPair(companyTile, descTile) {
      const cIdx = parseInt(companyTile.dataset.idx, 10);
      // If the company was already paired with a different desc, undo the old one.
      const prevDescIdx = pairings[cIdx];
      if (prevDescIdx != null) {
        const prevDesc = descsHost.querySelector(`[data-paired-with="${cIdx}"]`);
        if (prevDesc) {
          prevDesc.removeAttribute('data-paired');
          prevDesc.removeAttribute('data-paired-with');
          prevDesc.style.borderColor = '';
          prevDesc.style.background = '';
        }
      }
      // Also: if the desc was already paired with a different company, undo that.
      if (descTile.dataset.paired === '1') {
        const prevCIdx = parseInt(descTile.dataset.pairedWith, 10);
        pairings[prevCIdx] = null;
        const prevCompany = companiesHost.querySelector(`[data-idx="${prevCIdx}"]`);
        if (prevCompany) {
          prevCompany.removeAttribute('data-paired');
          prevCompany.style.borderColor = '';
          prevCompany.style.background = '';
        }
      }

      const color = PAIR_COLORS[pairColorCursor % PAIR_COLORS.length];
      pairColorCursor++;
      pairings[cIdx] = parseInt(descTile.dataset.idx, 10);

      companyTile.dataset.paired = '1';
      companyTile.style.borderColor = color.ring;
      companyTile.style.background = color.glow;

      descTile.dataset.paired = '1';
      descTile.dataset.pairedWith = String(cIdx);
      descTile.style.borderColor = color.ring;
      descTile.style.background = color.glow;
    }

    function unpair(tile) {
      if (tile.dataset.role === 'company') {
        const cIdx = parseInt(tile.dataset.idx, 10);
        pairings[cIdx] = null;
        tile.removeAttribute('data-paired');
        tile.style.borderColor = '';
        tile.style.background = '';
        const desc = descsHost.querySelector(`[data-paired-with="${cIdx}"]`);
        if (desc) {
          desc.removeAttribute('data-paired');
          desc.removeAttribute('data-paired-with');
          desc.style.borderColor = '';
          desc.style.background = '';
        }
      } else {
        const cIdx = parseInt(tile.dataset.pairedWith, 10);
        pairings[cIdx] = null;
        const company = companiesHost.querySelector(`[data-idx="${cIdx}"]`);
        if (company) {
          company.removeAttribute('data-paired');
          company.style.borderColor = '';
          company.style.background = '';
        }
        tile.removeAttribute('data-paired');
        tile.removeAttribute('data-paired-with');
        tile.style.borderColor = '';
        tile.style.background = '';
      }
    }

    function updateUI() {
      const paired = pairings.filter(x => x != null).length;
      checkBtn.disabled = paired < 4;
      if (paired === 4) {
        instr.textContent = 'All paired — hit "Check my answers" when ready.';
      } else if (selectedCompany && !selectedDesc) {
        instr.textContent = 'Now tap the way that company makes money.';
      } else if (selectedDesc && !selectedCompany) {
        instr.textContent = 'Now tap the company that matches.';
      } else {
        instr.textContent = `${paired} of 4 paired. Pick a tile to continue.`;
      }
    }

    checkBtn.addEventListener('click', () => {
      if (completed) return;
      completed = true;

      let correctCount = 0;
      const companyTiles = Array.from(companiesHost.children);
      const descTiles = Array.from(descsHost.children);

      for (let cIdx = 0; cIdx < 4; cIdx++) {
        const dIdx = pairings[cIdx];
        const correct = dIdx === cIdx;
        if (correct) correctCount++;
        // Annotate company tile with right/wrong color.
        const cTile = companyTiles[cIdx];
        cTile.classList.add(correct ? 'matched-correct' : 'matched-wrong');
        cTile.style.borderColor = '';
        cTile.style.background = '';
        // Annotate the description that was PAIRED (not necessarily the right one)
        const dTile = descTiles.find(t => parseInt(t.dataset.idx, 10) === dIdx);
        if (dTile) {
          dTile.classList.add(correct ? 'matched-correct' : 'matched-wrong');
          dTile.style.borderColor = '';
          dTile.style.background = '';
        }
      }

      // For any wrong pair, also highlight the *actual* correct description
      // so the kid can see where it should've gone.
      if (correctCount < 4) {
        for (let cIdx = 0; cIdx < 4; cIdx++) {
          if (pairings[cIdx] !== cIdx) {
            const rightDesc = descTiles.find(t => parseInt(t.dataset.idx, 10) === cIdx);
            if (rightDesc && !rightDesc.classList.contains('matched-correct')) {
              // Visually indicate "this was the right answer for company X"
              rightDesc.style.border = '2px dashed var(--green)';
            }
          }
        }
      }

      // Disable further interaction.
      [...companyTiles, ...descTiles].forEach(t => t.classList.add('dimmed-no'));
      checkBtn.disabled = true;
      checkBtn.style.display = 'none';

      // Build the reveal: list each company + surprise fact.
      const surprises = companies.map(c =>
        `<div style="margin: 6px 0;"><strong>${SHARED.escapeHTML(c.name)}:</strong> ${SHARED.escapeHTML(c.surprise)}</div>`
      ).join('');

      let resultLabel, resultKind, headline;
      if (correctCount === 4) {
        resultLabel = '🎯 All 4 correct!';
        resultKind = 'correct';
        headline = 'Nice — you actually understand these businesses.';
      } else if (correctCount === 3) {
        resultLabel = '👍 3 out of 4';
        resultKind = 'correct';
        headline = 'Close — one tricky one to learn from.';
      } else if (correctCount > 0) {
        resultLabel = `${correctCount} of 4`;
        resultKind = 'wrong';
        headline = 'A few right — the surprises below are worth reading.';
      } else {
        resultLabel = '0 of 4';
        resultKind = 'wrong';
        headline = 'Tough one — read the surprises below.';
      }

      SHARED.renderReveal(host.querySelector('#mt-card'), {
        resultKind, resultLabel, headline,
        body: `
          ${surprises}
          <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--card-border);">
            Most people think Apple is a phone company, but they actually make more profit from <strong>Services</strong> than the iPhone alone.
            Understanding <em>how</em> a company makes money is the first step to knowing if its stock is a good investment.
          </div>
        `,
        principle: 4, // Understand what you own
      });

      if (opts.onComplete) opts.onComplete({ correct: correctCount >= 3 });
    });

    updateUI();
  }

  window.MBGames.match = { render };
})();
