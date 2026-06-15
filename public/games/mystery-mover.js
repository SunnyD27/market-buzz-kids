/* public/games/mystery-mover.js — Phase 16: the daily guess-the-company puzzle.
 *
 * Self-mounting (NOT part of the Daily Challenge picker — it's its own
 * section, 7 days/week, on /digest AND /sample). Hydrates from the PUBLIC
 * API so guests can play end-to-end with no account:
 *   GET  /api/mystery/today  → { date, clues: [5] }   (never the answer)
 *   POST /api/mystery/guess  → { correct }            (stateless, rate-limited)
 *
 * Clue pacing is client-side (server stores nothing per guest; it only
 * protects the answer). A wrong guess auto-unlocks the next clue. 5 guesses
 * max. Solved on clue N → MC by N (server-side table); unsolved → 0 MC but
 * the play still logs (streak + Perfect Day credit).
 *
 * Logged-in kids record via MarketJuice.recordEvent('mystery-mover-played');
 * on /sample (window.__isSample) the finish panel shows the signup CTA
 * instead. Per-day state in localStorage (mj-mystery-<date>) so reload
 * doesn't reset; the server dedup gate makes replays MC-safe regardless.
 *
 * Share grid (zero identifiers — no username, name, streak, or MC):
 *   Market Juice Mystery Mover — June 15
 *   🟧🟧🟩
 *   Got it in 3!! Beat that 😏
 *   themarketjuice.com/sample?src=mm-share
 * The brag line is a FIXED, pre-written set picked by clues-used (NOT a
 * free-text box) so the share artifact stays a closed, reviewed set (COPPA).
 */
(function () {
  'use strict';

  var MAX_GUESSES = 5;
  // ?src=mm-share is a channel tag (identical for every user — NOT an
  // identifier) so share-grid arrivals are distinguishable in logs/analytics.
  var SHARE_URL = 'themarketjuice.com/sample?src=mm-share';

  var section = null;
  var host = null;
  var state = null; // { date, cluesRevealed, guessesUsed, solved, finished, cluesUsed }
  var pendingFeedback = ''; // rendered into .mm-feedback on the NEXT render (render() replaces the DOM)

  function storageKey(date) { return 'mj-mystery-' + date; }

  function loadState(date) {
    try {
      var raw = localStorage.getItem(storageKey(date));
      if (raw) {
        var s = JSON.parse(raw);
        if (s && s.date === date) return s;
      }
    } catch (_) {}
    return { date: date, cluesRevealed: 1, guessesUsed: 0, solved: false, finished: false, cluesUsed: 0 };
  }

  function saveState() {
    try { localStorage.setItem(storageKey(state.date), JSON.stringify(state)); } catch (_) {}
  }

  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c];
    });
  }

  function dateLabel(yyyymmdd) {
    try {
      return new Date(yyyymmdd + 'T12:00:00Z').toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', timeZone: 'America/New_York',
      });
    } catch (_) { return yyyymmdd; }
  }

  // Voice-y, kid-tone brag line — a FIXED, pre-written set keyed off
  // clues-used (NOT free text → a closed, reviewed share artifact for COPPA
  // safety). Identifier-free: no name, username, streak, or MC.
  function shareBrag(solved, cluesUsed) {
    if (!solved) return "Today's one STUMPED me — bet you can't get it either";
    if (cluesUsed === 1) return "First clue. Didn't even need the rest 😎";
    if (cluesUsed <= 3) return 'Got it in ' + cluesUsed + '!! Beat that 😏';
    return 'Got it 😮‍💨 took me ' + cluesUsed + " — think you're faster?";
  }

  // 🟧 per clue used before the solving one, 🟩 on the solve; 🟥×5 if unsolved.
  // Lines: title+date · grid · brag · ?src=mm-share link — all four tiers.
  function buildShareText(label, solved, cluesUsed) {
    var grid = solved
      ? new Array(Math.max(0, cluesUsed - 1) + 1).join('🟧') + '🟩'
      : '🟥🟥🟥🟥🟥';
    return 'Market Juice Mystery Mover — ' + label + '\n'
      + grid + '\n'
      + shareBrag(solved, cluesUsed) + '\n'
      + SHARE_URL;
  }

  function copyShare(btn) {
    var text = buildShareText(dateLabel(state.date), state.solved, state.cluesUsed);
    var done = function (label) {
      btn.textContent = label;
      btn.disabled = true;
      setTimeout(function () { btn.textContent = 'Share your result'; btn.disabled = false; }, 2500);
    };

    // Web Share API first — mobile gets the native share sheet with the
    // grid pre-filled. Clipboard stays the fallback (and the usual desktop
    // path). A user cancelling the sheet (AbortError) is not a failure —
    // do nothing so they can reopen it.
    if (navigator.share) {
      navigator.share({ text: text })
        .then(function () { done('Shared! 🍊'); })
        .catch(function (err) {
          if (err && err.name === 'AbortError') return; // user closed the sheet
          clipboardShare(text, done);
        });
      return;
    }
    clipboardShare(text, done);
  }

  function clipboardShare(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(function () { done('Copied! Send it to a friend 🍊'); })
        .catch(function () { legacyCopy(text); done('Copied! Send it to a friend 🍊'); });
    } else {
      legacyCopy(text);
      done('Copied! Send it to a friend 🍊');
    }
  }

  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    } catch (_) {}
  }

  function recordPlay() {
    // Logged-in kids only — /sample renders the signup CTA instead. The
    // server computes MC from cluesUsed (clamped) and dedups per digestDate.
    if (window.__isSample) return;
    if (!window.MarketJuice || typeof window.MarketJuice.recordEvent !== 'function') return;
    window.MarketJuice.recordEvent('mystery-mover-played', {
      digestDate: window.__digestDate || state.date,
      solved: state.solved,
      cluesUsed: state.cluesUsed,
    });
  }

  function finish(clues, solved) {
    state.finished = true;
    state.solved = solved;
    state.cluesUsed = state.cluesRevealed;
    saveState();
    recordPlay();
    render(clues);
  }

  function submitGuess(clues, input, feedbackEl) {
    var guess = (input.value || '').trim();
    if (!guess) return;
    input.disabled = true;
    fetch('/api/mystery/guess', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guess: guess }),
    })
      .then(function (res) { return res.ok ? res.json() : Promise.reject(new Error('guess ' + res.status)); })
      .then(function (data) {
        if (data.correct) {
          finish(clues, true);
          return;
        }
        state.guessesUsed += 1;
        if (state.guessesUsed >= MAX_GUESSES) {
          finish(clues, false);
          return;
        }
        // Wrong guess unlocks the next clue (when there is one). The
        // feedback line must ride the re-render — render() replaces the
        // whole card, so writing to the pre-render element shows nothing.
        if (state.cluesRevealed < clues.length) state.cluesRevealed += 1;
        pendingFeedback = 'Not "' + guess + '" — here\'s another clue.';
        saveState();
        render(clues);
      })
      .catch(function () {
        input.disabled = false;
        if (feedbackEl) feedbackEl.textContent = 'Hmm, that didn\'t go through — try again.';
      });
  }

  function render(clues) {
    var cluesHTML = '';
    for (var i = 0; i < state.cluesRevealed && i < clues.length; i++) {
      cluesHTML += '<div class="mm-clue"><span class="mm-clue-num">Clue ' + (i + 1) + '</span> ' + escapeHTML(clues[i]) + '</div>';
    }

    var bodyHTML;
    if (state.finished) {
      var headline = state.solved
        ? '🎉 Solved in ' + state.cluesUsed + ' clue' + (state.cluesUsed === 1 ? '' : 's') + '!'
        : '🕵️ Stumped! Come back for tomorrow\'s mystery.';
      var ctaHTML = window.__isSample
        ? '<a class="mm-signup-cta" href="/#signup">Nice! Sign up to save your streak and earn Market Coins →</a>'
        : '';
      bodyHTML =
        '<div class="mm-result">' + headline + '</div>' +
        '<div class="mm-grid-preview">' + escapeHTML(buildShareText(dateLabel(state.date), state.solved, state.cluesUsed).split('\n')[1]) + '</div>' +
        '<button type="button" class="mm-share-btn" id="mm-share">Share your result</button>' +
        ctaHTML;
    } else {
      var guessesLeft = MAX_GUESSES - state.guessesUsed;
      bodyHTML =
        '<div class="mm-controls">' +
          '<input type="text" class="mm-input" id="mm-guess" maxlength="60" placeholder="Which company is it?" autocomplete="off">' +
          '<button type="button" class="mm-guess-btn" id="mm-submit">Guess</button>' +
        '</div>' +
        '<div class="mm-meta">' +
          '<span>' + guessesLeft + ' guess' + (guessesLeft === 1 ? '' : 'es') + ' left</span>' +
          (state.cluesRevealed < clues.length
            ? '<button type="button" class="mm-reveal-btn" id="mm-reveal">Reveal next clue (worth fewer MC)</button>'
            : '<span>All clues revealed</span>') +
        '</div>' +
        '<div class="mm-feedback" id="mm-feedback" aria-live="polite">' + escapeHTML(pendingFeedback) + '</div>';
      pendingFeedback = '';
    }

    host.innerHTML =
      '<div class="mm-card">' +
        '<div class="mm-tagline">One mystery company. Five clues. Everyone gets the same puzzle — fewer clues, more Market Coins.</div>' +
        cluesHTML +
        bodyHTML +
      '</div>';

    if (state.finished) {
      var shareBtn = document.getElementById('mm-share');
      if (shareBtn) shareBtn.addEventListener('click', function () { copyShare(shareBtn); });
    } else {
      var input = document.getElementById('mm-guess');
      var feedbackEl = document.getElementById('mm-feedback');
      var submitBtn = document.getElementById('mm-submit');
      var revealBtn = document.getElementById('mm-reveal');
      if (submitBtn) submitBtn.addEventListener('click', function () { submitGuess(clues, input, feedbackEl); });
      if (input) input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') submitGuess(clues, input, feedbackEl);
      });
      if (revealBtn) revealBtn.addEventListener('click', function () {
        state.cluesRevealed += 1;
        saveState();
        render(clues);
      });
    }
  }

  function init() {
    section = document.getElementById('mystery-mover-section');
    host = document.getElementById('mystery-mover-host');
    if (!section || !host) return;

    fetch('/api/mystery/today')
      .then(function (res) { return res.ok ? res.json() : Promise.reject(new Error('today ' + res.status)); })
      .then(function (data) {
        if (!data || !Array.isArray(data.clues) || data.clues.length === 0) return;
        state = loadState(data.date);
        section.hidden = false;
        render(data.clues);
      })
      .catch(function () { /* no puzzle today (pre-Phase-16 row) — section stays hidden */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
