/* public/games/price-is-right.js
 *
 * Game 3 — Price is Right (Stock Edition).
 *
 * One famous company. Three plausible share-price options. Tap to guess.
 * Reveal shows the real price + the "you own a tiny piece of..." story.
 *
 * The whole point is to anchor a kid's intuition about what a share of
 * each company actually costs — and then immediately reframe it: a share
 * isn't a number, it's a sliver of a real business. That reframing is
 * Principle 7 (think like an owner, not a gambler).
 *
 * Data shape (one daily payload from the generator):
 *   {
 *     ticker:    "DIS",
 *     name:      "Disney",
 *     emoji:     "🏰",
 *     realPrice: 95.40,             // live FMP quote in production
 *     options:   [78, 95, 125],     // includes real + 2 distractors; game shuffles
 *     piece:     "When you buy one share, you own a tiny piece of theme parks...",
 *     principle: 4                  // per-company principle that the piece-of-
 *                                   // business story most strongly teaches.
 *                                   // (Different companies hit different
 *                                   // principles — Coke's dividend story → 1,
 *                                   // Apple's Services revenue → 4, Nvidia's
 *                                   // AI boom → 6, etc.)
 *   }
 *
 * Production data sourcing (Phase 6 daily generator):
 *   1. Pick a ticker from public/src/companies.js (curated list).
 *   2. Fetch live quote from FMP → realPrice.
 *   3. Generate 2 distractors at -30% and +30% (rounded to plausible-looking values).
 *   4. Look up or generate the "piece" story for that ticker.
 *   5. Hand the payload to this game.
 *
 * XP per spec: +20 correct, +10 attempted.
 * Distractors are set wide enough (>30% off) that picking the wrong one
 * never accidentally counts as "within 20% of real."
 */
(function () {
  'use strict';
  const SHARED = window.MJGames.shared;

  function fmtPriceOption(p) {
    // Whole-dollar formatting for prices ≥ $20, one decimal for cheaper.
    if (p >= 20) return '$' + Math.round(p);
    return '$' + p.toFixed(2);
  }

  function pctOff(guess, real) {
    return Math.abs((guess - real) / real);
  }

  function render(host, data, opts) {
    opts = opts || {};
    let answered = false;

    // Shuffle options so the real price isn't always in the same slot.
    const shuffled = SHARED.shuffle(data.options.slice());

    host.innerHTML = `
      <div class="mj-card" id="pir-card">
        <div class="mj-label">💰 Daily Challenge · Price is Right</div>
        <div class="mj-title">How much does ONE share cost right now?</div>

        <div class="mj-pir-company">
          <div style="font-size:48px; line-height:1; margin-bottom:6px;">${SHARED.escapeHTML(data.emoji || '🏢')}</div>
          <div class="mj-pir-name">${SHARED.escapeHTML(data.name)}</div>
          <div class="mj-pir-ticker">${SHARED.escapeHTML(data.ticker)}</div>
        </div>

        <div class="mj-pir-options" id="pir-options"></div>

        <div class="mj-reveal" id="pir-reveal"></div>
      </div>
    `;

    const optionsHost = host.querySelector('#pir-options');

    shuffled.forEach(price => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mj-pir-option';
      btn.textContent = fmtPriceOption(price);
      btn.addEventListener('click', () => {
        if (answered) return;
        answered = true;

        const correct = price === data.realPrice;
        const off = pctOff(price, data.realPrice);

        // Color all options after click: real price = green, others red.
        Array.from(optionsHost.children).forEach(b => {
          b.disabled = true;
          const bp = parseFloat(b.textContent.replace(/[$,]/g, ''));
          if (b === btn) b.classList.add('picked');
          if (Math.abs(bp - data.realPrice) < 0.01) b.classList.add('correct');
          else if (b === btn) b.classList.add('wrong');
        });

        // Build the reveal — actual price + how-far-off + "tiny piece of..." story.
        const guessLabel = fmtPriceOption(price);
        const realLabel = fmtPriceOption(data.realPrice);
        const offLabel = correct
          ? '🎯 Exact!'
          : (off * 100).toFixed(0) + '% ' + (price > data.realPrice ? 'too high' : 'too low');

        const piece = data.piece
          || `When you buy one share, you own a tiny piece of ${SHARED.escapeHTML(data.name)}.`;

        SHARED.renderReveal(host.querySelector('#pir-card'), {
          resultKind: correct ? 'correct' : 'wrong',
          resultLabel: correct ? '🎯 Right on the price!' : `Off by ${(off * 100).toFixed(0)}%`,
          headline: `Real price: ${realLabel}`,
          body: `
            <div style="display:flex; gap:10px; margin-bottom:12px; flex-wrap:wrap;">
              <div style="flex:1; min-width:120px; padding:10px 12px; background:rgba(255,255,255,0.04); border-radius:10px; text-align:center;">
                <div style="font-size:11px; color:var(--text-dim); font-family:'Space Mono',monospace; letter-spacing:1px;">YOUR GUESS</div>
                <div style="font-size:20px; font-weight:700; color:var(--text-bright); margin-top:2px;">${SHARED.escapeHTML(guessLabel)}</div>
              </div>
              <div style="flex:1; min-width:120px; padding:10px 12px; background:rgba(63,185,80,0.08); border:1px solid rgba(63,185,80,0.3); border-radius:10px; text-align:center;">
                <div style="font-size:11px; color:var(--green); font-family:'Space Mono',monospace; letter-spacing:1px;">REAL PRICE</div>
                <div style="font-size:20px; font-weight:700; color:var(--green); margin-top:2px;">${SHARED.escapeHTML(realLabel)}</div>
              </div>
            </div>
            <p style="margin-bottom:6px;"><strong>${SHARED.escapeHTML(piece)}</strong></p>
            <p style="font-size:14px; color:var(--text-dim); line-height:1.55;">
              A share's price is just a sliver of the whole business. When you buy one,
              you're not buying a number — you're buying a real piece of a real company.
              That's why investors talk about "owning" stocks, not "betting" on them.
            </p>
          `,
          // Principle comes from the data per-company (the piece-of-business
          // story for each company most strongly teaches a different one).
          // Fall back to 7 (think like an owner) since that's the game's
          // baseline framing if no per-company principle was provided.
          principle: data.principle || 7,
        });

        if (opts.onComplete) opts.onComplete({ correct });
      });
      optionsHost.appendChild(btn);
    });
  }

  window.MJGames['price-is-right'] = { render };
})();
