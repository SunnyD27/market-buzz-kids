/* public/games/compound.js
 *
 * Game 4 — Compound Interest Machine.
 *
 * Drag the slider 1–40 years. Watch the principal compound at ~10% annual
 * (historic average S&P 500 nominal return). The exponential growth curve
 * IS the lesson — when a kid sees $50 become $2,260 over 40 years, the
 * concept of "starting early" clicks permanently.
 *
 * Data shape (one daily scenario):
 *   { id: string, amount: number, framing: string (HTML allowed for <strong>) }
 *
 * XP per spec: +15 for interacting with the slider (idempotent).
 * onComplete fires once the kid has dragged the slider at least once AND
 * settled on a value for >= 1.2s (so they actually see the number).
 */
(function () {
  'use strict';
  const SHARED = window.MJGames.shared;

  // Spec calls out ~10% average annual return for the visualization.
  // This matches S&P 500 historical nominal return over long periods.
  const ANNUAL_RETURN = 0.10;
  const MAX_YEARS = 40;
  const DEFAULT_YEARS = 10;

  function fv(principal, years) {
    return principal * Math.pow(1 + ANNUAL_RETURN, years);
  }

  function render(host, data, opts) {
    opts = opts || {};
    const amount = Math.max(1, data.amount || 50);
    host.innerHTML = `
      <div class="mj-card" id="ci-card">
        <div class="mj-label">🚀 Daily Challenge · Compound Machine</div>
        <div class="mj-title">What if you never spent it?</div>
        <div class="mj-prompt">${data.framing || ''}</div>

        <div class="mj-ci-amount">
          <div class="principal">starting amount · ${SHARED.fmtMoney(amount, { maxDigits: 0 })}</div>
          <div class="final" id="ci-final">${SHARED.fmtMoney(amount, { maxDigits: 0 })}</div>
          <div class="mj-ci-after">after <span id="ci-years">${DEFAULT_YEARS}</span> years at 10% / year (S&amp;P 500 long-term average)</div>
        </div>

        <div class="mj-ci-slider-wrap">
          <div class="mj-ci-years-label">
            <span>1 year</span>
            <span>${MAX_YEARS} years</span>
          </div>
          <input type="range" class="mj-ci-slider" id="ci-slider"
                 min="1" max="${MAX_YEARS}" step="1" value="${DEFAULT_YEARS}"
                 aria-label="Years invested">
        </div>

        <svg class="mj-ci-chart" id="ci-chart" viewBox="0 0 320 120" preserveAspectRatio="none">
          <defs>
            <linearGradient id="mj-ci-gradient" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stop-color="#bc8cff"/>
              <stop offset="50%" stop-color="#58a6ff"/>
              <stop offset="100%" stop-color="#f0c040"/>
            </linearGradient>
            <linearGradient id="mj-ci-area-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#f0c040" stop-opacity="0.35"/>
              <stop offset="100%" stop-color="#f0c040" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <path class="mj-ci-area" id="ci-area" />
          <path class="mj-ci-curve" id="ci-curve" />
          <circle class="mj-ci-current-dot" id="ci-dot" r="5"/>
        </svg>

        <div class="mj-reveal" id="ci-reveal"></div>
      </div>
    `;

    const slider = host.querySelector('#ci-slider');
    const finalEl = host.querySelector('#ci-final');
    const yearsEl = host.querySelector('#ci-years');
    const curveEl = host.querySelector('#ci-curve');
    const areaEl  = host.querySelector('#ci-area');
    const dotEl   = host.querySelector('#ci-dot');

    let lastDisplayedValue = amount;
    let interacted = false;
    let completeFired = false;
    let settleTimer = null;

    function update(years, animateNumber) {
      yearsEl.textContent = years;
      const target = fv(amount, years);

      // Build the full 0..MAX_YEARS curve so the chart shows the long-run
      // shape regardless of slider position.
      const allYears = [];
      const allValues = [];
      for (let y = 0; y <= MAX_YEARS; y++) {
        allYears.push(y);
        allValues.push(fv(amount, y));
      }
      const W = 320, H = 120;
      const { d, step, pad, innerH } = SHARED.buildLinePath(allValues, W, H, { yMin: 0 });
      curveEl.setAttribute('d', d);
      // Build the area path (curve + baseline)
      const areaPath = d + ` L${(pad + step * MAX_YEARS).toFixed(1)},${(H - pad).toFixed(1)} L${pad.toFixed(1)},${(H - pad).toFixed(1)} Z`;
      areaEl.setAttribute('d', areaPath);
      // Position the "current" dot at the slider value.
      const cx = pad + step * years;
      const cy = pad + innerH - (target / allValues[allValues.length - 1]) * innerH;
      dotEl.setAttribute('cx', cx.toFixed(1));
      dotEl.setAttribute('cy', cy.toFixed(1));

      if (animateNumber) {
        SHARED.animateNumber(finalEl, lastDisplayedValue, target, 380, v => SHARED.fmtMoney(v, { maxDigits: 0 }));
      } else {
        finalEl.textContent = SHARED.fmtMoney(target, { maxDigits: 0 });
      }
      lastDisplayedValue = target;
    }

    function maybeFireComplete(years) {
      if (completeFired) return;
      if (settleTimer) clearTimeout(settleTimer);
      // Wait 1.2s of settle on the chosen value before firing — they actually
      // looked at the number. Fires once.
      settleTimer = setTimeout(() => {
        completeFired = true;
        const finalAmount = fv(amount, years);
        const growth = finalAmount / amount;
        showReveal({ years, amount, finalAmount, growth });
        if (opts.onComplete) opts.onComplete({ correct: undefined });
      }, 1200);
    }

    slider.addEventListener('input', e => {
      const y = parseInt(slider.value, 10);
      interacted = true;
      update(y, true);
      maybeFireComplete(y);
    });

    function showReveal({ years, amount, finalAmount, growth }) {
      // Pick a lesson framing based on the result magnitude.
      const principal = SHARED.fmtMoney(amount, { maxDigits: 0 });
      const future = SHARED.fmtMoney(finalAmount, { maxDigits: 0 });
      let body;
      if (years <= 5) {
        body = `In ${years} years, ${principal} grows to about <strong>${future}</strong>. That's the start of compounding — but the magic happens when you wait. Try dragging to 30 or 40 years.`;
      } else if (years < 25) {
        body = `Look at the curve — it's not a straight line. ${principal} becomes <strong>${future}</strong> in ${years} years. Your money is now making money on the money it already made. That's compounding.`;
      } else {
        body = `${principal} → <strong>${future}</strong> in ${years} years. That's ${growth.toFixed(1)}× your starting amount, and you didn't add a single dollar. This is why every investor — Warren Buffett, your future self — says the same thing: <em>start early</em>.`;
      }
      SHARED.renderReveal(host.querySelector('#ci-card'), {
        resultKind: 'neutral',
        resultLabel: '✨ See the curve?',
        headline: 'The Compound Interest Lesson',
        body,
        principle: 2, // Make your money work for you — compound growth is a superpower
      });
    }

    // Initial render at default slider position.
    update(DEFAULT_YEARS, false);
  }

  window.MJGames.compound = { render };
})();
