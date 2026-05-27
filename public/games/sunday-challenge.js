/* public/games/sunday-challenge.js
 *
 * The Sunday Challenge — a longer, AI-generated weekly game that rotates
 * between 4 formats on a 4-week cycle. Registered as
 * window.MJGames.sundayChallenge.render(host, data, opts). Dispatches to
 * a sub-renderer based on data.type:
 *
 *   trading-floor  → 3-round portfolio sim with real historical prices
 *   ceo            → 3 real business-decision scenarios
 *   investathon    → 10 rapid-fire questions with 8s timer
 *   dilemma        → 3 tradeoff scenarios with side-by-side math
 *
 * MC: awarded ONCE per Sunday via window.MarketJuice.recordEvent
 * ('sunday-challenge-completed'). Server treats bonus=true as the 50+25=75
 * for the bonus condition (beat S&P, perfect score, 8+/10, etc).
 *
 * Re-play: completion is tracked in localStorage at
 *   mj-sunday-challenge-<YYYY-MM-DD>
 * The XP grant is gated on this flag so replays don't re-award.
 */
(function () {
  'use strict';

  window.MJGames = window.MJGames || {};

  // ── Shared helpers ───────────────────────────────────────────────────
  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[c]));
  }

  function fmtMoney(n, digits) {
    digits = digits != null ? digits : (Math.abs(n) >= 100 ? 0 : 2);
    return '$' + Number(n).toLocaleString('en-US', {
      maximumFractionDigits: digits, minimumFractionDigits: digits,
    });
  }

  function todayKey() {
    // Use the kid's local date — this is a UI guard, not a security
    // boundary. Stays consistent within a session.
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function completionKey() {
    return 'mj-sunday-challenge-' + todayKey();
  }

  function alreadyCompleted() {
    try { return !!localStorage.getItem(completionKey()); }
    catch { return false; }
  }

  function markCompleted(bonus) {
    try {
      localStorage.setItem(completionKey(), JSON.stringify({
        completedAt: Date.now(), bonus: !!bonus,
      }));
    } catch { /* localStorage may be disabled — silently noop */ }
  }

  // Captured at render() time so awardXP knows which sub-game type to
  // report. The 4 sub-renderers share this single module via closure.
  let currentChallengeType = 'unknown';

  /**
   * Award MC via the server-tracked engagement system. Phase 11 fires a
   * 'sunday-challenge-completed' event; the server handles the 50/75 split
   * via the bonus flag and is the canonical idempotency boundary. We
   * additionally gate on a localStorage flag so kids see a clean
   * "already played" state on replay without round-tripping to the server.
   */
  function awardXP(bonus) {
    if (alreadyCompleted()) return; // replay → no double-fire
    markCompleted(bonus);
    if (window.MarketJuice && window.MarketJuice.recordEvent) {
      window.MarketJuice.recordEvent('sunday-challenge-completed', {
        type: currentChallengeType,
        digestDate: window.__digestDate || null,
        bonus: !!bonus,
      });
    }
  }

  /** Render a principle tag at the bottom of a reveal panel. */
  function principleTag(principleNum) {
    const map = (window.MJGames.shared && window.MJGames.shared.PRINCIPLES) || {};
    const label = map[principleNum] || '';
    return label
      ? `<div class="sc-principle-tag">${escapeHTML(label)}</div>`
      : '';
  }

  /** Render the final XP badge shown after a Sunday Challenge completes. */
  function xpBadgeHTML(baseLabel, bonus, bonusLabel) {
    const total = bonus ? 75 : 50;
    return `
      <div class="sc-xp-badge">
        <div class="sc-xp-amount">+${total} XP</div>
        <div class="sc-xp-label">${escapeHTML(baseLabel)}${bonus ? ' · <strong>' + escapeHTML(bonusLabel) + '</strong>' : ''}</div>
      </div>
    `;
  }

  /** Disable all buttons inside an element. */
  function lockButtons(scope) {
    scope.querySelectorAll('button').forEach(b => { b.disabled = true; });
  }

  // ──────────────────────────────────────────────────────────────────────
  // GAME 1: TRADING FLOOR
  // ──────────────────────────────────────────────────────────────────────
  function renderTradingFloor(host, data) {
    const rounds = Array.isArray(data.rounds) ? data.rounds : [];
    if (!rounds.length) { host.innerHTML = ''; return; }

    const STARTING_CASH = 10000;
    let roundIdx = 0;
    let portfolio = STARTING_CASH; // carries across rounds
    let sp500Comp = STARTING_CASH; // hypothetical S&P-only portfolio
    let perRoundResults = [];      // [{ kidPct, spPct, kidValue, spValue }]

    host.innerHTML = `<div class="sc-card sc-tf"></div>`;
    const card = host.querySelector('.sc-tf');

    function parsePctString(s) {
      // "+312%" → 3.12  |  "-42%" → -0.42
      if (typeof s === 'number') return s;
      const m = String(s).match(/(-?\d+(?:\.\d+)?)/);
      return m ? parseFloat(m[1]) / 100 : 0;
    }

    function stockReturnPct(stock) {
      if (stock.endPrice && stock.price) return (stock.endPrice - stock.price) / stock.price;
      return 0;
    }

    function renderRound() {
      const round = rounds[roundIdx];
      const stocks = Array.isArray(round.stocks) ? round.stocks.slice(0, 4) : [];
      const allocations = stocks.map(() => 0); // % of portfolio in each stock (0-100 in 25 steps)
      let totalAllocated = 0;

      card.innerHTML = `
        <div class="sc-round-meta">Round ${roundIdx + 1} of ${rounds.length} · Portfolio: <strong>${fmtMoney(portfolio)}</strong></div>
        <div class="sc-headline">
          <div class="sc-year">${escapeHTML(round.year || '')}</div>
          <p>${escapeHTML(round.headline || '')}</p>
        </div>
        <div class="sc-allocation">Tap a stock to allocate 25% of your portfolio. Tap again to add more (up to 100% total).</div>
        <div class="sc-stocks">
          ${stocks.map((s, i) => `
            <button type="button" class="sc-stock" data-i="${i}">
              <div class="sc-stock-ticker">${escapeHTML(s.ticker || '')}</div>
              <div class="sc-stock-name">${escapeHTML(s.name || '')}</div>
              <div class="sc-stock-price">${fmtMoney(s.price || 0)}</div>
              <div class="sc-stock-alloc">0%</div>
            </button>
          `).join('')}
        </div>
        <div class="sc-total-row">
          <div>Allocated: <strong class="sc-total">0%</strong></div>
          <button type="button" class="sc-reveal-btn" disabled>See what happened →</button>
        </div>
        <div class="sc-result-area"></div>
      `;

      const stockEls = Array.from(card.querySelectorAll('.sc-stock'));
      const totalEl = card.querySelector('.sc-total');
      const revealBtn = card.querySelector('.sc-reveal-btn');

      stockEls.forEach((el) => {
        el.addEventListener('click', () => {
          const i = parseInt(el.dataset.i, 10);
          if (totalAllocated >= 100) return; // full
          allocations[i] += 25;
          totalAllocated += 25;
          el.querySelector('.sc-stock-alloc').textContent = allocations[i] + '%';
          el.classList.toggle('sc-selected', allocations[i] > 0);
          totalEl.textContent = totalAllocated + '%';
          revealBtn.disabled = totalAllocated < 100;
        });
      });

      revealBtn.addEventListener('click', () => {
        lockButtons(card.querySelector('.sc-stocks'));
        revealBtn.disabled = true;

        // Compute round outcome
        let newValue = 0;
        const breakdown = stocks.map((s, i) => {
          const stake = portfolio * (allocations[i] / 100);
          const ret = stockReturnPct(s);
          const finalVal = stake * (1 + ret);
          newValue += finalVal;
          return { stock: s, alloc: allocations[i], stake, ret, finalVal };
        });

        const spReturn = parsePctString(round.sp500Return);
        sp500Comp = sp500Comp * (1 + spReturn);
        portfolio = newValue;
        perRoundResults.push({ kid: portfolio, sp: sp500Comp });

        const resultArea = card.querySelector('.sc-result-area');
        resultArea.innerHTML = `
          <div class="sc-result-head">Results for ${escapeHTML(round.year || '')}</div>
          <div class="sc-result-bars">
            ${breakdown.map(b => {
              const pct = (b.ret * 100);
              const barW = Math.max(2, Math.min(100, Math.abs(pct) * 0.5));
              const dir = pct >= 0 ? 'up' : 'down';
              return `
                <div class="sc-result-bar-row">
                  <div class="sc-result-bar-label">${escapeHTML(b.stock.ticker)} · ${b.alloc}%</div>
                  <div class="sc-result-bar"><div class="sc-result-bar-fill ${dir}" style="width:${barW}%"></div></div>
                  <div class="sc-result-bar-pct ${dir}">${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%</div>
                </div>
              `;
            }).join('')}
          </div>
          <div class="sc-result-summary">
            <div>Your portfolio: <strong>${fmtMoney(portfolio)}</strong></div>
            <div>S&amp;P 500 portfolio: <strong>${fmtMoney(sp500Comp)}</strong> (${round.sp500Return || ''})</div>
          </div>
          <div class="sc-result-lesson"><strong>The lesson:</strong> ${escapeHTML(round.lessonText || '')}</div>
          ${principleTag(round.principle)}
          <button type="button" class="sc-next-btn">${roundIdx + 1 < rounds.length ? 'Next round →' : 'See final score →'}</button>
        `;

        resultArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        resultArea.querySelector('.sc-next-btn').addEventListener('click', () => {
          if (roundIdx + 1 < rounds.length) {
            roundIdx++;
            renderRound();
          } else {
            renderFinal();
          }
        });
      });
    }

    function renderFinal() {
      const beat = portfolio > sp500Comp;
      const totalRet = (portfolio - STARTING_CASH) / STARTING_CASH * 100;
      const spRet = (sp500Comp - STARTING_CASH) / STARTING_CASH * 100;
      awardXP(beat);
      card.innerHTML = `
        <div class="sc-final ${beat ? 'win' : 'neutral'}">
          <div class="sc-final-headline">${beat ? '🏆 You beat the market!' : '📊 The market is hard.'}</div>
          <div class="sc-final-grid">
            <div><div class="sc-final-label">Your final portfolio</div><div class="sc-final-value">${fmtMoney(portfolio)}</div><div class="sc-final-pct">${totalRet >= 0 ? '+' : ''}${totalRet.toFixed(1)}%</div></div>
            <div><div class="sc-final-label">S&amp;P 500 (same period)</div><div class="sc-final-value">${fmtMoney(sp500Comp)}</div><div class="sc-final-pct">${spRet >= 0 ? '+' : ''}${spRet.toFixed(1)}%</div></div>
          </div>
          <div class="sc-final-lesson">
            ${beat
              ? 'Most professional fund managers fail to beat the S&P 500. You just did.'
              : "Roughly 90% of actively-managed funds also fail to beat the S&P 500. That's why index funds are so popular."}
          </div>
          ${xpBadgeHTML('Sunday Challenge complete', beat, 'Beat the market!')}
        </div>
      `;
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    renderRound();
  }

  // ──────────────────────────────────────────────────────────────────────
  // GAME 2: CEO FOR A DAY
  // ──────────────────────────────────────────────────────────────────────
  function renderCEO(host, data) {
    const rounds = Array.isArray(data.rounds) ? data.rounds : [];
    if (!rounds.length) { host.innerHTML = ''; return; }

    let roundIdx = 0;
    let score = 0;

    host.innerHTML = `<div class="sc-card sc-ceo"></div>`;
    const card = host.querySelector('.sc-ceo');

    function renderRound() {
      const round = rounds[roundIdx];
      const options = Array.isArray(round.options) ? round.options : [];
      const dotsHTML = rounds.map((_, i) =>
        `<span class="sc-dot ${i < roundIdx ? 'done' : i === roundIdx ? 'active' : ''}"></span>`
      ).join('');

      card.innerHTML = `
        <div class="sc-dots">${dotsHTML}</div>
        <div class="sc-round-meta">Round ${roundIdx + 1} of ${rounds.length} · ${escapeHTML(round.company || '')} (${escapeHTML(round.year || '')})</div>
        <div class="sc-headline">
          <p>${escapeHTML(round.scenario || '')}</p>
        </div>
        <div class="sc-options">
          ${options.map((opt, i) => `
            <button type="button" class="sc-option" data-i="${i}">
              <span class="sc-option-letter">${String.fromCharCode(65 + i)}</span>
              <span class="sc-option-text">${escapeHTML(opt)}</span>
            </button>
          `).join('')}
        </div>
        <div class="sc-result-area"></div>
      `;

      const optionEls = Array.from(card.querySelectorAll('.sc-option'));
      let picked = null;

      optionEls.forEach(el => {
        el.addEventListener('click', () => {
          if (picked !== null) return;
          picked = parseInt(el.dataset.i, 10);
          const correct = picked === round.correctIndex;
          if (correct) score++;

          optionEls.forEach((bb, j) => {
            bb.disabled = true;
            if (j === round.correctIndex) bb.classList.add('sc-correct');
            else if (j === picked) bb.classList.add('sc-wrong');
          });

          const resultArea = card.querySelector('.sc-result-area');
          resultArea.innerHTML = `
            <div class="sc-result-head ${correct ? 'win' : 'miss'}">${correct ? '🎯 Right call!' : '🤔 Not quite.'}</div>
            <div class="sc-result-body"><strong>What actually happened:</strong> ${escapeHTML(round.actualOutcome || '')}</div>
            <div class="sc-result-lesson"><strong>The lesson:</strong> ${escapeHTML(round.lesson || '')}</div>
            ${principleTag(round.principle)}
            <button type="button" class="sc-next-btn">${roundIdx + 1 < rounds.length ? 'Next round →' : 'See final score →'}</button>
          `;
          resultArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          resultArea.querySelector('.sc-next-btn').addEventListener('click', () => {
            if (roundIdx + 1 < rounds.length) { roundIdx++; renderRound(); }
            else { renderFinal(); }
          });
        });
      });
    }

    function renderFinal() {
      const perfect = score === rounds.length;
      const msg = perfect ? '🏆 Perfect game!'
        : score >= Math.ceil(rounds.length * 0.67) ? '💼 Sharp executive instincts.'
        : '📚 Hindsight is 20/20 — every CEO has called these wrong.';
      awardXP(perfect);
      card.innerHTML = `
        <div class="sc-final ${perfect ? 'win' : 'neutral'}">
          <div class="sc-final-headline">${escapeHTML(msg)}</div>
          <div class="sc-final-grid">
            <div><div class="sc-final-label">Your score</div><div class="sc-final-value">${score} / ${rounds.length}</div></div>
          </div>
          <div class="sc-final-lesson">Real CEOs make these calls with way less information than you just had. That's why most companies eventually fail — and why the ones that don't make incredible investments.</div>
          ${xpBadgeHTML('Sunday Challenge complete', perfect, 'Perfect game!')}
        </div>
      `;
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    renderRound();
  }

  // ──────────────────────────────────────────────────────────────────────
  // GAME 3: INVEST-A-THON
  // ──────────────────────────────────────────────────────────────────────
  function renderInvestathon(host, data) {
    const questions = Array.isArray(data.questions) ? data.questions : [];
    if (!questions.length) { host.innerHTML = ''; return; }

    const QUESTION_TIME_MS = 8000;
    let qIdx = 0;
    let score = 0;

    host.innerHTML = `<div class="sc-card sc-ito"></div>`;
    const card = host.querySelector('.sc-ito');

    function renderQuestion() {
      const q = questions[qIdx];
      const opts = Array.isArray(q.options) ? q.options : [];

      card.innerHTML = `
        <div class="sc-timer-row">
          <div class="sc-q-counter">Question ${qIdx + 1} of ${questions.length} · Score: ${score}</div>
          <div class="sc-timer-bar"><div class="sc-timer-fill"></div></div>
        </div>
        <div class="sc-headline">
          <p>${escapeHTML(q.question || '')}</p>
        </div>
        <div class="sc-options">
          ${opts.map((opt, i) => `
            <button type="button" class="sc-option" data-i="${i}">
              <span class="sc-option-text">${escapeHTML(opt)}</span>
            </button>
          `).join('')}
        </div>
        <div class="sc-result-area"></div>
      `;

      const timerFill = card.querySelector('.sc-timer-fill');
      // Use a CSS animation rather than setInterval so the bar is smooth.
      timerFill.style.transition = `width ${QUESTION_TIME_MS}ms linear`;
      requestAnimationFrame(() => { timerFill.style.width = '0%'; });

      let answered = false;
      const timeoutId = setTimeout(() => {
        if (!answered) finish(null); // ran out
      }, QUESTION_TIME_MS);

      const optionEls = Array.from(card.querySelectorAll('.sc-option'));
      optionEls.forEach(el => {
        el.addEventListener('click', () => {
          if (answered) return;
          finish(parseInt(el.dataset.i, 10));
        });
      });

      function finish(picked) {
        answered = true;
        clearTimeout(timeoutId);
        timerFill.style.transition = 'none';
        const correct = picked !== null && picked === q.correctIndex;
        if (correct) score++;

        optionEls.forEach((bb, j) => {
          bb.disabled = true;
          if (j === q.correctIndex) bb.classList.add('sc-correct');
          else if (j === picked) bb.classList.add('sc-wrong');
        });

        const resultArea = card.querySelector('.sc-result-area');
        const headLabel = picked === null
          ? '⏰ Time’s up!'
          : (correct ? '🎯 Correct!' : '🤔 Not quite.');
        resultArea.innerHTML = `
          <div class="sc-result-head ${correct ? 'win' : 'miss'}">${headLabel}</div>
          <div class="sc-result-body">${escapeHTML(q.explain || '')}</div>
          ${principleTag(q.principle)}
          <button type="button" class="sc-next-btn">${qIdx + 1 < questions.length ? 'Next question →' : 'See final score →'}</button>
        `;
        resultArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        resultArea.querySelector('.sc-next-btn').addEventListener('click', () => {
          if (qIdx + 1 < questions.length) { qIdx++; renderQuestion(); }
          else { renderFinal(); }
        });
      }
    }

    function renderFinal() {
      const bonus = score >= 8;
      const msg = score === 10 ? '🏆 Perfect 10! You’re a market savant.'
        : bonus ? '⚡ Lightning round dominator.'
        : score >= 6 ? '💪 Solid work — these were not easy.'
        : '📚 The market has surprises. So did this game.';
      awardXP(bonus);
      card.innerHTML = `
        <div class="sc-final ${bonus ? 'win' : 'neutral'}">
          <div class="sc-final-headline">${escapeHTML(msg)}</div>
          <div class="sc-final-grid">
            <div><div class="sc-final-label">Your score</div><div class="sc-final-value">${score} / ${questions.length}</div></div>
          </div>
          ${xpBadgeHTML('Sunday Challenge complete', bonus, '8+ correct!')}
        </div>
      `;
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    renderQuestion();
  }

  // ──────────────────────────────────────────────────────────────────────
  // GAME 4: INVESTOR'S DILEMMA
  // ──────────────────────────────────────────────────────────────────────
  function renderDilemma(host, data) {
    const rounds = Array.isArray(data.rounds) ? data.rounds : [];
    if (!rounds.length) { host.innerHTML = ''; return; }

    let roundIdx = 0;

    host.innerHTML = `<div class="sc-card sc-dil"></div>`;
    const card = host.querySelector('.sc-dil');

    function renderRound() {
      const round = rounds[roundIdx];
      const options = Array.isArray(round.options) ? round.options.slice(0, 2) : [];
      const dotsHTML = rounds.map((_, i) =>
        `<span class="sc-dot ${i < roundIdx ? 'done' : i === roundIdx ? 'active' : ''}"></span>`
      ).join('');

      card.innerHTML = `
        <div class="sc-dots">${dotsHTML}</div>
        <div class="sc-round-meta">Dilemma ${roundIdx + 1} of ${rounds.length}</div>
        <div class="sc-headline">
          <p>${escapeHTML(round.scenario || '')}</p>
        </div>
        <div class="sc-options">
          ${options.map((opt, i) => `
            <button type="button" class="sc-option" data-i="${i}">
              <span class="sc-option-letter">${String.fromCharCode(65 + i)}</span>
              <span class="sc-option-text">${escapeHTML(opt)}</span>
            </button>
          `).join('')}
        </div>
        <div class="sc-result-area"></div>
      `;

      const optionEls = Array.from(card.querySelectorAll('.sc-option'));
      let picked = null;

      optionEls.forEach(el => {
        el.addEventListener('click', () => {
          if (picked !== null) return;
          picked = parseInt(el.dataset.i, 10);
          optionEls.forEach((bb, j) => {
            bb.disabled = true;
            if (j === picked) bb.classList.add('sc-selected');
          });

          const resultArea = card.querySelector('.sc-result-area');
          resultArea.innerHTML = `<button type="button" class="sc-next-btn sc-show-math">Show me the math →</button>`;
          resultArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          resultArea.querySelector('.sc-show-math').addEventListener('click', () => {
            renderAnalysis(round, picked);
          });
        });
      });
    }

    function renderAnalysis(round, pickedIdx) {
      const analysis = Array.isArray(round.analysis) ? round.analysis.slice(0, 2) : [];
      const resultArea = card.querySelector('.sc-result-area');
      resultArea.innerHTML = `
        <div class="sc-vs-grid">
          ${analysis.map((a, i) => `
            <div class="sc-analysis-card ${i === pickedIdx ? 'sc-your-choice' : ''}">
              <div class="sc-analysis-tag">${i === pickedIdx ? 'YOUR CHOICE' : 'THE OTHER OPTION'}</div>
              <div class="sc-analysis-title">${escapeHTML(a.title || '')}</div>
              <div class="sc-metrics">
                ${(a.metrics || []).map(m => `
                  <div class="sc-metric-row">
                    <span class="sc-metric-label">${escapeHTML(m.label || '')}</span>
                    <span class="sc-metric-value">${escapeHTML(m.value || '')}</span>
                  </div>
                `).join('')}
              </div>
              <div class="sc-analysis-takeaway">${escapeHTML(a.takeaway || '')}</div>
            </div>
          `).join('')}
        </div>
        <div class="sc-bottom-line"><strong>The bottom line:</strong> ${escapeHTML(round.bottomLine || '')}</div>
        ${principleTag(round.principle)}
        <button type="button" class="sc-next-btn">${roundIdx + 1 < rounds.length ? 'Next dilemma →' : 'Finish challenge →'}</button>
      `;
      resultArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      resultArea.querySelector('.sc-next-btn').addEventListener('click', () => {
        if (roundIdx + 1 < rounds.length) { roundIdx++; renderRound(); }
        else { renderFinal(); }
      });
    }

    function renderFinal() {
      // Dilemma is about thinking, not right/wrong → bonus always fires.
      awardXP(true);
      card.innerHTML = `
        <div class="sc-final win">
          <div class="sc-final-headline">🧠 Critical thinker.</div>
          <div class="sc-final-lesson">There's no winner in The Investor's Dilemma — only tradeoffs. The fact that you considered both sides of ${rounds.length} hard decisions is what real investing looks like.</div>
          ${xpBadgeHTML('Sunday Challenge complete', true, 'Critical Thinker badge')}
        </div>
      `;
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    renderRound();
  }

  // ── Public entry point ───────────────────────────────────────────────
  function render(host, data, opts) {
    if (!host || !data || !data.type) return;
    currentChallengeType = data.type;
    // If the kid already finished today, show a "completed" banner with
    // a replay link. XP won't re-award on replay (gated by completionKey).
    if (alreadyCompleted()) {
      host.innerHTML = `
        <div class="sc-card sc-done">
          <div class="sc-done-headline">✅ You completed today's Sunday Challenge</div>
          <div class="sc-done-body">XP already awarded. You can replay for fun — no extra XP though.</div>
          <button type="button" class="sc-next-btn sc-replay">Replay anyway →</button>
        </div>
      `;
      host.querySelector('.sc-replay').addEventListener('click', () => dispatch(host, data));
      return;
    }
    dispatch(host, data);
  }

  function dispatch(host, data) {
    switch (data.type) {
      case 'trading-floor': return renderTradingFloor(host, data);
      case 'ceo':           return renderCEO(host, data);
      case 'investathon':   return renderInvestathon(host, data);
      case 'dilemma':       return renderDilemma(host, data);
      default:
        host.innerHTML = `<div class="sc-card"><div class="sc-headline"><p>Unknown Sunday Challenge type: ${escapeHTML(data.type)}</p></div></div>`;
    }
  }

  window.MJGames.sundayChallenge = { render };
})();
