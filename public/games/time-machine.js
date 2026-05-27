/* public/games/time-machine.js
 *
 * Game 6 — Time Machine Trade.
 *
 * Anchor year + $1,000 + 4 stocks. The kid picks one. The reveal shows
 * what $1,000 invested in EACH of the four would be worth today. The "right
 * answer" is rarely what a 2010 kid would have picked — and that IS the
 * lesson: nobody can predict the future. Diversify.
 *
 * Pricing model:
 *   - priceThen: UNADJUSTED historical close (matches era news / chart history)
 *   - splitFactor: cumulative stock splits since (so 1 share then = N shares now)
 *   - status: 'active' (use approxNow for preview; production injects live)
 *             'bankrupt' (finalMultiplier baked in, usually 0)
 *             'acquired' (finalMultiplier baked in)
 *   - Final value = (1000 / priceThen) × splitFactor × currentPrice
 *                 = 1000 × finalMultiplier   (for non-active)
 *
 * XP per spec: +15 for participating (no right/wrong by design — that IS the lesson).
 * Reveal ties to the scenario's principle (usually 2 — diversification).
 *
 * Phase 6 extension point: the `framing` and `lessonBody` fields can be
 * rewritten daily by the Claude generator. The verified facts (year,
 * choices, prices, splits, outcomes, principle) stay locked. See
 * public/data/README.md for the two-layer content architecture.
 */
(function () {
  'use strict';
  const SHARED = window.MJGames.shared;

  function valueOf(choice) {
    if (choice.status === 'active') {
      const shares = 1000 / choice.priceThen;
      return shares * choice.splitFactor * (choice.priceNow || choice.approxNow);
    }
    return 1000 * (choice.finalMultiplier || 0);
  }

  function render(host, scenario, opts) {
    opts = opts || {};
    const choices = scenario.choices.slice();
    let picked = null;
    let revealed = false;

    host.innerHTML = `
      <div class="mj-card" id="tm-card">
        <div class="mj-label">⏱️ Daily Challenge · Time Machine Trade</div>
        <div class="mj-title">Pick one stock. We'll fast-forward.</div>
        <div class="mj-tm-header">
          <div class="mj-tm-year">${SHARED.escapeHTML(scenario.anchor.toUpperCase())}</div>
          <div class="mj-tm-budget">You have $1,000</div>
        </div>
        <div class="mj-prompt">${scenario.framing}</div>

        <div class="mj-tm-choices" id="tm-choices"></div>

        <button type="button" class="mj-btn mj-btn-primary" id="tm-lock" disabled>
          Lock in my pick → fast-forward to today
        </button>

        <div class="mj-reveal" id="tm-reveal"></div>
      </div>
    `;

    const choicesHost = host.querySelector('#tm-choices');
    const lockBtn     = host.querySelector('#tm-lock');

    choices.forEach((c, i) => {
      const tile = document.createElement('div');
      tile.className = 'mj-tm-pick';
      tile.dataset.idx = String(i);
      tile.innerHTML = `
        <div class="mj-tm-pick-name">${SHARED.escapeHTML(c.name)}</div>
        <div class="mj-tm-pick-ticker">${SHARED.escapeHTML(c.ticker)}</div>
        <div class="mj-tm-pick-price">${SHARED.fmtMoney(c.priceThen)} / share</div>
      `;
      tile.addEventListener('click', () => {
        if (revealed) return;
        picked = i;
        Array.from(choicesHost.children).forEach(el => el.classList.remove('picked'));
        tile.classList.add('picked');
        lockBtn.disabled = false;
      });
      choicesHost.appendChild(tile);
    });

    lockBtn.addEventListener('click', () => {
      if (revealed || picked == null) return;
      revealed = true;

      // Compute and display every outcome.
      const outcomes = choices.map((c, i) => ({ c, i, value: valueOf(c) }));
      // Identify the winner so we can flag it.
      const sortedByValue = outcomes.slice().sort((a, b) => b.value - a.value);
      const winnerIdx = sortedByValue[0].i;

      // Replace the choice grid with a results list.
      choicesHost.innerHTML = '';
      // Sort the results display from best → worst so the lesson lands cleanly.
      sortedByValue.forEach(({ c, i, value }) => {
        const row = document.createElement('div');
        row.className = 'mj-tm-result-row';
        if (i === winnerIdx) row.classList.add('winner');
        if (i === picked) row.classList.add('your-pick');

        let valueLabel, valueClass, subline;
        if (c.status === 'bankrupt') {
          valueLabel = '$0';
          valueClass = 'loss';
          subline = c.outcomeNote || 'Bankrupt — shares became worthless.';
        } else if (c.status === 'acquired') {
          valueLabel = SHARED.fmtMoney(value, { maxDigits: 0 });
          valueClass = value >= 1000 ? 'gain' : 'loss';
          subline = c.outcomeNote || 'Company was acquired and no longer trades publicly.';
        } else {
          valueLabel = SHARED.fmtMoney(value, { maxDigits: 0 });
          valueClass = value >= 1000 ? 'gain' : 'loss';
          const mult = value / 1000;
          subline = `${SHARED.fmtMoney(c.priceThen)} → ~${SHARED.fmtMoney(c.priceNow || c.approxNow)}/share`
            + (c.splitFactor > 1 ? ` · After ${c.splitFactor}× split, your share count grew` : '')
            + ` · <strong>${mult.toFixed(1)}× return</strong>`;
        }

        row.innerHTML = `
          <div style="flex:1; min-width: 0;">
            <div class="mj-tm-result-name">
              ${SHARED.escapeHTML(c.name)}
              ${i === picked ? '<span style="color: var(--purple); font-size: 11px; margin-left: 6px;">· YOUR PICK</span>' : ''}
              ${i === winnerIdx ? '<span style="color: var(--yellow); font-size: 11px; margin-left: 6px;">· WINNER</span>' : ''}
            </div>
            <div style="font-size: 12px; color: var(--text-dim); margin-top: 2px; line-height: 1.45;">${subline}</div>
          </div>
          <div class="mj-tm-result-now ${valueClass}" style="margin-left: 12px; white-space: nowrap;">${valueLabel}</div>
        `;
        choicesHost.appendChild(row);
      });

      lockBtn.style.display = 'none';

      // Headline framing: was the kid's pick the winner?
      const youWon = picked === winnerIdx;
      const resultLabel = youWon ? '🎯 You picked the winner!' : '🎲 Lesson incoming';
      const resultKind = 'neutral'; // Per spec, no right/wrong — diversification is the lesson regardless.

      SHARED.renderReveal(host.querySelector('#tm-card'), {
        resultKind,
        resultLabel,
        headline: scenario.lessonHeadline,
        body: scenario.lessonBody,
        principle: scenario.principle,
      });

      if (opts.onComplete) opts.onComplete({ correct: undefined });
    });
  }

  window.MJGames['time-machine'] = { render };
})();
