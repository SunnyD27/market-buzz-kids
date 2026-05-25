/* public/games/shared.js
 * Shared helpers for all 6 daily games. Exposed as window.MBGames.shared.
 *
 * Conventions:
 *   - Each game module exposes window.MBGames[gameKey] with {render(host, data, opts)}.
 *   - opts.onComplete({correct?: boolean}) fires once when the kid finishes.
 *     The picker uses this to call MarketBuzz.recordGamePlayed.
 *   - Every reveal panel ends with the principle tag — enforced via renderReveal().
 */
(function () {
  'use strict';

  window.MBGames = window.MBGames || {};

  const PRINCIPLES = {
    1: 'Principle 1 · Pay Yourself First',
    2: 'Principle 2 · Compound Growth',
    3: 'Principle 3 · Wealth Is the Gap',
    4: 'Principle 4 · Know What You Own',
    5: 'Principle 5 · Diversify',
    6: 'Principle 6 · Be Patient',
    7: 'Principle 7 · Control Your Emotions',
    8: 'Principle 8 · Think Like an Owner',
    9: 'Principle 9 · Stay Consistent',
    10: 'Principle 10 · Price vs Value',
    11: 'Principle 11 · Own Assets',
  };

  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  }

  function fmtMoney(n, opts) {
    opts = opts || {};
    const max = opts.maxDigits != null ? opts.maxDigits : (Math.abs(n) >= 100 ? 0 : 2);
    return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: max, minimumFractionDigits: max });
  }

  function fmtPct(n, signed) {
    const sign = signed && n > 0 ? '+' : '';
    return sign + (n * 100).toFixed(1) + '%';
  }

  /**
   * Render the reveal/lesson panel inside a game card.
   * Every game MUST call this on completion — the principle tag is mandatory.
   */
  function renderReveal(host, opts) {
    // opts: { resultKind: 'correct'|'wrong'|'neutral', resultLabel, headline, body (HTML), principle }
    const el = host.querySelector('.mbg-reveal') || (() => {
      const d = document.createElement('div');
      d.className = 'mbg-reveal';
      host.appendChild(d);
      return d;
    })();
    const principleLabel = PRINCIPLES[opts.principle] || '';
    el.innerHTML = `
      ${opts.resultLabel ? `<div class="mbg-result ${opts.resultKind || 'neutral'}">${escapeHTML(opts.resultLabel)}</div>` : ''}
      <div class="mbg-reveal-head">${escapeHTML(opts.headline || 'The lesson')}</div>
      <div class="mbg-reveal-body">${opts.body || ''}</div>
      ${principleLabel ? `<div class="mbg-reveal-principle">${escapeHTML(principleLabel)}</div>` : ''}
    `;
    el.classList.add('show');
    // Smooth scroll into view (after layout) for mobile so the lesson lands.
    requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  }

  /** Animate a number from `from` to `to` over `ms` and write it into `el`. */
  function animateNumber(el, from, to, ms, formatter) {
    const start = performance.now();
    const total = Math.max(60, ms);
    formatter = formatter || (v => String(Math.round(v)));
    // Cancel any prior animation so rapid slider moves don't fight each other.
    if (el._mbgAnim) cancelAnimationFrame(el._mbgAnim);
    function step(t) {
      const p = Math.min(1, (t - start) / total);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - p, 3);
      const v = from + (to - from) * eased;
      el.textContent = formatter(v);
      if (p < 1) el._mbgAnim = requestAnimationFrame(step);
      else el._mbgAnim = null;
    }
    el._mbgAnim = requestAnimationFrame(step);
  }

  /** Build a polyline SVG path from a series of numeric Y values. */
  function buildLinePath(values, width, height, opts) {
    opts = opts || {};
    const pad = opts.pad != null ? opts.pad : 6;
    const yMin = opts.yMin != null ? opts.yMin : Math.min.apply(null, values);
    const yMax = opts.yMax != null ? opts.yMax : Math.max.apply(null, values);
    const ySpan = Math.max(0.0001, yMax - yMin);
    const innerW = width - pad * 2;
    const innerH = height - pad * 2;
    const n = values.length;
    const step = n > 1 ? innerW / (n - 1) : 0;
    let d = '';
    for (let i = 0; i < n; i++) {
      const x = pad + step * i;
      const y = pad + innerH - ((values[i] - yMin) / ySpan) * innerH;
      d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
    }
    return { d, step, pad, innerW, innerH };
  }

  /** Shuffle an array (Fisher–Yates). Used by Match/Time Machine ordering. */
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  window.MBGames.shared = {
    PRINCIPLES,
    escapeHTML,
    fmtMoney,
    fmtPct,
    renderReveal,
    animateNumber,
    buildLinePath,
    shuffle,
  };
})();
