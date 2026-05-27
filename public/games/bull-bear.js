/* public/games/bull-bear.js
 *
 * Game 2 — Bull or Bear?
 *
 * Show an UNLABELED real historical stock chart (no Y-axis, no dates, no
 * ticker). Kid predicts: did this stock go up (Bull 📈) or down (Bear 📉)
 * in the NEXT period? Reveal animates the outcome line drawing in green
 * (up) or red (down) and reveals the company + the WHY.
 *
 * Chart shapes are stored as normalized monthly arrays starting at $100 —
 * scaled by approximate real historical returns. The shape captures the
 * trajectory faithfully without ever claiming a specific dollar value for
 * a specific ticker on a specific day. The reveal then states the real
 * company, real dates, and real net % move — all verifiable facts.
 *
 * XP per spec: +20 correct, +10 attempted.
 *
 * Phase 6 content-freshness layer (NOT a code change in this game — only
 * affects the daily generator):
 *   - Picks which scenario to use today, biased away from recently-used.
 *   - Rewrites `story` and `lessonHeadline` and `lessonBody` fresh each
 *     day so the same chart powers different narrative framings.
 *   - Verified facts stay locked: contextShape, outcomeShape,
 *     actualDirection, actualReturnPct, company, ticker, era, principle.
 *     Claude never invents or alters these.
 *   See public/data/README.md for the full two-layer architecture.
 */
(function () {
  'use strict';
  const SHARED = window.MJGames.shared;

  function render(host, scenario, opts) {
    opts = opts || {};
    let answered = false;

    host.innerHTML = `
      <div class="mj-card" id="bb-card">
        <div class="mj-label">📊 Daily Challenge · Bull or Bear?</div>
        <div class="mj-title">What happened NEXT?</div>
        <div class="mj-prompt">
          Here's a real stock chart over the period leading up to a moment in history.
          Did it go <strong>up</strong> or <strong>down</strong> in the
          ${SHARED.escapeHTML(scenario.outcomeLabel.toLowerCase())} after this?
        </div>

        <svg class="mj-bb-chart" id="bb-chart" viewBox="0 0 400 200" preserveAspectRatio="none">
          <!-- Subtle gridlines: faint horizontal lines only, no labels. -->
          <line class="grid-line" x1="0" y1="50"  x2="400" y2="50"/>
          <line class="grid-line" x1="0" y1="100" x2="400" y2="100"/>
          <line class="grid-line" x1="0" y1="150" x2="400" y2="150"/>

          <!-- Decision-line marker — very subtle vertical hairline where "what you saw" ends -->
          <line id="bb-decision-line" x1="0" y1="0" x2="0" y2="200"
                stroke="rgba(255,255,255,0.10)" stroke-width="1" stroke-dasharray="2 4"/>

          <!-- Context (the visible chart) -->
          <path class="price-line" id="bb-context-line"/>

          <!-- Outcome (drawn after answer) -->
          <path class="next-line" id="bb-outcome-line" style="display:none;"/>
        </svg>

        <div style="text-align:center; font-family:'Space Mono',monospace; font-size:11px; color:var(--text-dim); letter-spacing:1.5px; margin: -6px 0 16px;">
          ${SHARED.escapeHTML(scenario.contextLabel)}
        </div>

        <div class="mj-choice-pair">
          <button type="button" class="mj-btn mj-bull" data-direction="up">📈 Bull · Went UP</button>
          <button type="button" class="mj-btn mj-bear" data-direction="down">📉 Bear · Went DOWN</button>
        </div>

        <div class="mj-data-note">Chart shape uses real historical price movement, normalized for clarity. Real ticker and dates revealed after you guess.</div>

        <div class="mj-reveal" id="bb-reveal"></div>
      </div>
    `;

    // Compute the chart paths. Context = visible. Outcome = hidden until answer.
    const ctx = scenario.contextShape;
    const out = scenario.outcomeShape;
    // Combined range so context and outcome share the same Y-scale.
    const all = ctx.concat(out);
    const yMin = Math.min.apply(null, all);
    const yMax = Math.max.apply(null, all);
    const yPad = (yMax - yMin) * 0.08;

    const W = 400, H = 200;
    const totalPoints = ctx.length + out.length - 1; // outcome[0] shares with context end
    // Context occupies (ctx.length - 1) / totalPoints of width, outcome the rest.
    const ctxRatio = (ctx.length - 1) / totalPoints;
    const ctxWidth = W * ctxRatio;

    const ctxPath = SHARED.buildLinePath(ctx, ctxWidth, H, { yMin: yMin - yPad, yMax: yMax + yPad });
    // For outcome, we need to start at the same Y as context end, and span
    // the remaining width. We'll build it manually so it aligns.
    const outPath = buildContinuation(out, ctxWidth, W - ctxWidth, H, yMin - yPad, yMax + yPad, ctxPath.pad);

    host.querySelector('#bb-context-line').setAttribute('d', ctxPath.d);
    host.querySelector('#bb-outcome-line').setAttribute('d', outPath);

    // Place the decision marker at the end of the context line.
    const decisionX = ctxPath.pad + ctxPath.step * (ctx.length - 1);
    const decisionLine = host.querySelector('#bb-decision-line');
    decisionLine.setAttribute('x1', decisionX.toFixed(1));
    decisionLine.setAttribute('x2', decisionX.toFixed(1));

    // Wire buttons.
    const buttons = Array.from(host.querySelectorAll('.mj-choice-pair .mj-btn'));
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        if (answered) return;
        answered = true;
        const guess = btn.dataset.direction;
        const correct = guess === scenario.actualDirection;

        buttons.forEach(b => {
          b.disabled = true;
          if (b.dataset.direction === scenario.actualDirection) b.classList.add('mj-btn-correct');
          else if (b === btn && !correct) b.classList.add('mj-btn-wrong');
        });

        revealOutcome(host, scenario, correct);
        if (opts.onComplete) opts.onComplete({ correct });
      });
    });
  }

  function buildContinuation(values, startX, widthAvail, H, yMin, yMax, pad) {
    // values[0] is the endpoint of the context line — same x, same y.
    const ySpan = Math.max(0.0001, yMax - yMin);
    const innerH = H - pad * 2;
    const n = values.length;
    const step = n > 1 ? widthAvail / (n - 1) : 0;
    let d = '';
    for (let i = 0; i < n; i++) {
      const x = startX + step * i;
      const y = pad + innerH - ((values[i] - yMin) / ySpan) * innerH;
      d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
    }
    return d;
  }

  function revealOutcome(host, scenario, correct) {
    const outcomeLine = host.querySelector('#bb-outcome-line');
    outcomeLine.style.display = '';
    outcomeLine.classList.add(scenario.actualDirection === 'up' ? 'up' : 'down');
    // Animate stroke-dasharray reveal so the outcome draws in.
    const len = outcomeLine.getTotalLength ? outcomeLine.getTotalLength() : 400;
    outcomeLine.style.strokeDasharray = len;
    outcomeLine.style.strokeDashoffset = len;
    outcomeLine.style.transition = 'stroke-dashoffset 1.0s ease-out';
    requestAnimationFrame(() => { outcomeLine.style.strokeDashoffset = '0'; });

    // Repaint context line in result color too, so the whole journey is one tinted ribbon.
    const ctxLine = host.querySelector('#bb-context-line');
    ctxLine.classList.add('revealed', scenario.actualDirection === 'up' ? 'up' : 'down');

    // Build the reveal — company + dates + WHY.
    const pctLabel = (scenario.actualReturnPct >= 0 ? '+' : '') + (scenario.actualReturnPct * 100).toFixed(0) + '%';
    const headline = scenario.lessonHeadline || (scenario.actualDirection === 'up' ? 'The stock went UP.' : 'The stock went DOWN.');

    SHARED.renderReveal(host.querySelector('#bb-card'), {
      resultKind: correct ? 'correct' : 'wrong',
      resultLabel: correct ? '🎯 Nailed it!' : '🤔 Tough one',
      headline,
      body: `
        <div style="padding: 10px 12px; background: rgba(255,255,255,0.04); border-radius: 10px; margin-bottom: 12px;">
          <div style="font-family:'Space Mono',monospace; font-size:11px; color:var(--text-dim); letter-spacing:1.2px;">
            ${SHARED.escapeHTML(scenario.era)} · ${SHARED.escapeHTML(scenario.company)} (${SHARED.escapeHTML(scenario.ticker)})
          </div>
          <div style="font-size:18px; font-weight:700; margin-top: 4px; color: ${scenario.actualDirection === 'up' ? 'var(--green)' : 'var(--red)'};">
            ${pctLabel} in ${SHARED.escapeHTML(scenario.outcomeLabel.toLowerCase())}
          </div>
        </div>
        <p style="margin-bottom: 12px;">${SHARED.escapeHTML(scenario.story)}</p>
        <div>${scenario.lessonBody}</div>
      `,
      principle: scenario.principle,
    });
  }

  window.MJGames['bull-bear'] = { render };
})();
