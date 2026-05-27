/* public/games/daily-challenge.js
 *
 * Daily Challenge picker — the UI that shows today's 3 games and the
 * rotation logic that decides WHICH 3.
 *
 * Per spec:
 *   - 3 games per day, drawn from 6 types (quiz, bull-bear, price-is-right,
 *     compound, match, time-machine).
 *   - Never show the same triple two days in a row.
 *   - Each game type must appear at least once every 8 days.
 *   - Kid can play 1, 2, or all 3.
 *   - Playing all 3 = Perfect Day → +25 XP + confetti (handled by engagement.js).
 *
 * Rotation: an 8-day cycle, precomputed. Each game appears 4 times in 8
 * days (well over "at least once every 8 days"). No two consecutive days
 * have the same triple. A few 1-2 game overlaps on consecutive days are
 * tolerated — strict "no single game two days in a row" forces boring
 * 2-partition alternation, which loses variety. Phase 6's daily generator
 * can use smarter context-aware logic (Fed day → quiz override, etc.).
 *
 * Public API:
 *   window.MJGames.dailyChallenge = {
 *     pickGamesForDate(yyyymmdd): string[3],   // returns today's game types
 *     render(host, dataBundle, opts),
 *   }
 *
 * dataBundle shape (provided by caller — preview page or Phase 6 generator):
 *   {
 *     games: [
 *       { type: 'bull-bear', data: <scenario object> },
 *       { type: 'compound',  data: <scenario object> },
 *       { type: 'quiz',      data: <quiz object> },
 *     ]
 *   }
 *
 * The picker doesn't know about the sample-data pools — the caller (preview
 * page or Phase 6 generator) is responsible for hydrating each entry's data.
 */
(function () {
  'use strict';

  const ROTATION = [
    ['quiz',      'bull-bear',      'compound'],
    ['match',     'time-machine',   'price-is-right'],
    ['quiz',      'time-machine',   'match'],
    ['bull-bear', 'compound',       'price-is-right'],
    ['quiz',      'price-is-right', 'match'],
    ['bull-bear', 'time-machine',   'compound'],
    ['quiz',      'match',          'compound'],
    ['bull-bear', 'price-is-right', 'time-machine'],
  ];

  const META = {
    'quiz':           { name: 'The Quiz',             emoji: '🧠', blurb: "Quick multiple-choice on today's news or an investing idea." },
    'bull-bear':      { name: 'Bull or Bear?',        emoji: '📊', blurb: 'Read the chart. Predict what came next.' },
    'price-is-right': { name: 'Price is Right',       emoji: '💰', blurb: 'Guess the share price of a famous company.' },
    'compound':       { name: 'Compound Machine',     emoji: '🚀', blurb: 'Drag the slider — watch money grow.' },
    'match':          { name: 'Match the Company',    emoji: '🎯', blurb: 'Pair 4 companies with how they actually make money.' },
    'time-machine':   { name: 'Time Machine Trade',   emoji: '⏱️', blurb: "Pick a stock from the past — see what it's worth now." },
  };

  function pickGamesForDate(yyyymmdd) {
    // Convert YYYY-MM-DD to day-of-epoch and mod by 8.
    const d = new Date(yyyymmdd + 'T12:00:00Z');
    const day = Math.floor(d.getTime() / 86400000);
    const idx = ((day % ROTATION.length) + ROTATION.length) % ROTATION.length;
    return ROTATION[idx].slice();
  }

  function render(host, dataBundle, opts) {
    opts = opts || {};
    const games = (dataBundle && dataBundle.games) || [];
    if (games.length !== 3) {
      host.innerHTML = `<div class="mj-card"><div class="mj-title">Daily Challenge needs exactly 3 games (got ${games.length}).</div></div>`;
      return;
    }

    host.innerHTML = `
      <div class="dc-wrap" id="dc-wrap">
        <div class="dc-header">
          <div class="dc-label">🚀 Today's Daily Challenge</div>
          <div class="dc-progress" id="dc-progress">0 / 3 played</div>
        </div>
        <div class="dc-grid" id="dc-grid"></div>
      </div>
    `;

    const grid = host.querySelector('#dc-grid');
    const progress = host.querySelector('#dc-progress');

    const cardStates = games.map(() => ({ expanded: false, played: false }));

    games.forEach((entry, idx) => {
      const meta = META[entry.type];
      if (!meta) {
        const errCard = document.createElement('div');
        errCard.className = 'mj-card';
        errCard.textContent = 'Unknown game type: ' + entry.type;
        grid.appendChild(errCard);
        return;
      }

      const card = document.createElement('div');
      card.className = 'dc-card';
      card.dataset.type = entry.type;
      card.innerHTML = `
        <div class="dc-card-head" role="button" tabindex="0" aria-expanded="false">
          <div class="dc-card-icon">${meta.emoji}</div>
          <div class="dc-card-info">
            <div class="dc-card-name">${escape(meta.name)}</div>
            <div class="dc-card-blurb">${escape(meta.blurb)}</div>
          </div>
          <div class="dc-card-cta" id="dc-cta-${idx}">▶ Play</div>
        </div>
        <div class="dc-card-body" id="dc-body-${idx}" hidden></div>
      `;
      grid.appendChild(card);

      const head = card.querySelector('.dc-card-head');
      const body = card.querySelector('.dc-card-body');
      const cta = card.querySelector('.dc-card-cta');

      function expand() {
        if (cardStates[idx].expanded) return;
        cardStates[idx].expanded = true;
        head.setAttribute('aria-expanded', 'true');
        body.hidden = false;
        card.classList.add('dc-card-expanded');
        cta.textContent = '× Close';

        // Lazy-render the underlying game into the body. The game module is
        // expected to already be loaded (the digest template loads all 6).
        const renderer = (window.MJGames[entry.type] || {}).render;
        if (typeof renderer !== 'function') {
          body.innerHTML = `<div class="mj-card" style="margin:0;"><div class="mj-title">Game "${entry.type}" not loaded.</div></div>`;
          return;
        }
        // Only render the game once; re-expanding shouldn't re-trigger.
        if (!body.dataset.rendered) {
          renderer(body, entry.data, {
            onComplete: (result) => {
              if (!cardStates[idx].played) {
                cardStates[idx].played = true;
                card.classList.add('dc-card-played');
                cta.textContent = '✓ Played';
                cta.classList.add('dc-cta-played');
                updateProgress();
                // Phase 11 — server-tracked event. game-completed covers
                // quiz too (it's just another game type from the picker's
                // perspective). result may contain { correct: bool } from
                // the game module; we forward as-is.
                if (window.MarketJuice && window.MarketJuice.recordEvent) {
                  window.MarketJuice.recordEvent('game-completed', {
                    game: entry.type,
                    correct: result && typeof result.correct === 'boolean' ? result.correct : null,
                    digestDate: window.__digestDate || null,
                  });
                }
              }
            }
          });
          body.dataset.rendered = '1';
        }
      }

      function collapse() {
        cardStates[idx].expanded = false;
        head.setAttribute('aria-expanded', 'false');
        body.hidden = true;
        card.classList.remove('dc-card-expanded');
        cta.textContent = cardStates[idx].played ? '✓ Played' : '▶ Play';
      }

      head.addEventListener('click', () => {
        if (cardStates[idx].expanded) collapse(); else expand();
      });
      head.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); head.click(); }
      });
    });

    function updateProgress() {
      const played = cardStates.filter(s => s.played).length;
      progress.textContent = `${played} / 3 played`;
      if (played === 3) {
        progress.classList.add('dc-progress-perfect');
        progress.textContent = '✨ Perfect Day!';
      }
    }
  }

  function escape(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  }

  window.MJGames = window.MJGames || {};
  window.MJGames.dailyChallenge = { pickGamesForDate, render, META };
})();
