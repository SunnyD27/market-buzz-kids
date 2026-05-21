/* public/engagement.js
 *
 * Market Buzz Kids — Engagement engine.
 *
 * Runs in the browser, client-side only. Persists everything to localStorage.
 * No backend dependency. Designed so games (Phase 3) can plug straight in via
 * window.MarketBuzz.recordGamePlayed(gameType, opts).
 *
 * Concepts
 *   XP        — cumulative, never resets. Drives rank.
 *   Rank      — derived from total XP. 8 tiers from Rookie to Market Legend.
 *               Shields unlock at Stock Scout (300 XP).
 *   Streak    — consecutive logical days the user completed ≥1 game.
 *               "Logical day" = America/New_York calendar date.
 *   Shield    — earned every 7 streak days (after reaching Stock Scout),
 *               max 2 stored, consumed automatically on a missed day to
 *               protect the streak.
 *   Perfect Day — all 3 daily games completed → +25 XP + confetti.
 *
 * Public API (window.MarketBuzz):
 *   init()                                — call on page load (auto-called)
 *   recordGamePlayed(type, { correct })   — call from each game on completion
 *   recordWordRevealed()                  — call when Word of Day is revealed
 *   getState()                            — read-only snapshot
 *   _debugReset()                         — wipe localStorage (dev only)
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'mb_engagement_v2';

  // ---- Configuration ------------------------------------------------------

  const RANKS = [
    { xp: 0,     name: 'Rookie',           badge: '🟢' },
    { xp: 100,   name: 'Market Watcher',   badge: '🔵' },
    { xp: 300,   name: 'Stock Scout',      badge: '🟣', perk: 'shields' },
    { xp: 750,   name: 'Trading Cadet',    badge: '🟠' },
    { xp: 1500,  name: 'Market Analyst',   badge: '🔴' },
    { xp: 3000,  name: 'Wall Street Pro',  badge: '⭐' },
    { xp: 6000,  name: 'Portfolio Master', badge: '💎' },
    { xp: 10000, name: 'Market Legend',    badge: '👑' },
  ];

  const STREAK_MILESTONES = [
    { days: 3,   title: 'Getting Started',        confetti: 'small', badge: '🌱' },
    { days: 7,   title: 'One Week Strong',        confetti: 'big',   badge: '🏅' },
    { days: 14,  title: 'Two Week Warrior',       confetti: 'big',   badge: '🥈' },
    { days: 30,  title: 'Monthly Master',         confetti: 'huge',  badge: '🥇' },
    { days: 50,  title: 'Unstoppable',            confetti: 'huge',  badge: '🚀' },
    { days: 100, title: 'The Century Club',       confetti: 'mega',  badge: '💯' },
    { days: 365, title: 'Market Legend Status',   confetti: 'mega',  badge: '👑' },
  ];

  const MAX_SHIELDS = 2;
  const SHIELD_UNLOCK_XP = 300; // Stock Scout
  const PERFECT_DAY_BONUS = 25;
  const STREAK_DAY_BONUS = 5;     // per day
  const STREAK_DAY10_BONUS = 50;  // additional one-shot bonus at day 10

  // ---- Day helpers (America/New_York) ------------------------------------

  function todayNY() {
    // en-CA gives YYYY-MM-DD which sorts and parses cleanly.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  }
  function daysBetween(d1, d2) {
    // d1, d2 are YYYY-MM-DD strings. Parsed as UTC-noon to avoid DST jumps
    // turning a 1-day delta into 0.999 or 1.001.
    const a = new Date(d1 + 'T12:00:00Z').getTime();
    const b = new Date(d2 + 'T12:00:00Z').getTime();
    return Math.round((b - a) / 86400000);
  }
  function monthOf(day) { return day.slice(0, 7); }

  // ---- State shape -------------------------------------------------------

  function freshDay(day) {
    return {
      day,
      opened: false,
      scrolledBottom: false,
      wordRevealed: false,
      gamesPlayed: [],         // ordered list of unique game-type strings
      gamesCorrect: {},        // { quiz: true, ... }
      perfectDay: false,
      xpEarnedToday: 0,
    };
  }

  function defaultState() {
    const today = todayNY();
    return {
      version: 2,
      xp: 0,
      streak: 0,
      shields: 0,
      perfectDaysThisMonth: 0,
      currentMonth: monthOf(today),
      today: freshDay(today),
      milestonesReached: [],
      lastSeenDay: null,
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 2) return defaultState();
      // Defensive: ensure required fields exist.
      const def = defaultState();
      return Object.assign(def, parsed, { today: Object.assign(def.today, parsed.today || {}) });
    } catch {
      return defaultState();
    }
  }
  function save(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) { /* quota etc. */ }
  }

  // ---- Rank --------------------------------------------------------------

  function rankFor(xp) {
    let current = RANKS[0];
    let next = null;
    for (let i = 0; i < RANKS.length; i++) {
      if (xp >= RANKS[i].xp) {
        current = RANKS[i];
        next = RANKS[i + 1] || null;
      } else {
        break;
      }
    }
    return { current, next };
  }

  // ---- Day rollover ------------------------------------------------------

  function rolloverIfNeeded(state) {
    const today = todayNY();
    if (state.today.day === today) return state;

    const prevDay = state.today.day;
    const gap = daysBetween(prevDay, today);

    // Month rollover resets the Perfect Day month counter.
    if (monthOf(today) !== state.currentMonth) {
      state.currentMonth = monthOf(today);
      state.perfectDaysThisMonth = 0;
    }

    // Streak preservation rules:
    //   gap = 1  → no missed day, streak survives.
    //   gap > 1  → missed (gap-1) days. Each missed day consumes a shield.
    //              If shields run out, streak resets to 0.
    if (gap > 1) {
      const missed = gap - 1;
      const before = state.shields;
      const consumed = Math.min(before, missed);
      state.shields -= consumed;
      if (consumed < missed) state.streak = 0;
    }

    state.lastSeenDay = prevDay;
    state.today = freshDay(today);
    return state;
  }

  // ---- XP awarding -------------------------------------------------------

  function awardXP(state, amount, label) {
    if (!amount) return { rankedUp: false };
    const beforeRank = rankFor(state.xp).current;
    state.xp += amount;
    state.today.xpEarnedToday += amount;
    const afterRank = rankFor(state.xp).current;
    const rankedUp = beforeRank.name !== afterRank.name;
    toastXP(amount, label);
    if (rankedUp) celebrateRankUp(afterRank);
    return { rankedUp, newRank: afterRank };
  }

  // ---- Streak ------------------------------------------------------------

  function maybeIncrementStreak(state) {
    // Called only when the user completes their FIRST game of the day.
    // (Caller ensures gamesPlayed.length === 1.)
    const today = state.today.day;
    const last = state.lastSeenDay;

    if (!last) {
      state.streak = 1;
    } else if (daysBetween(last, today) === 1) {
      state.streak += 1;
    } else {
      // Gap > 1. rolloverIfNeeded already adjusted shields / streak.
      // If shields preserved the streak (state.streak > 0), this is a
      // continuation; otherwise start fresh at 1.
      state.streak = state.streak > 0 ? state.streak + 1 : 1;
    }

    // Per-day streak bonus.
    awardXP(state, STREAK_DAY_BONUS, `🔥 ${state.streak}-day streak`);
    if (state.streak === 10) {
      awardXP(state, STREAK_DAY10_BONUS, '🎉 10-day streak bonus!');
    }

    // Milestone celebrations.
    checkStreakMilestones(state);

    // Award shields: 1 per 7-day boundary, gated by Stock Scout rank.
    const crossed7 = Math.floor(state.streak / 7) - Math.floor((state.streak - 1) / 7);
    if (crossed7 > 0 && state.xp >= SHIELD_UNLOCK_XP) {
      const before = state.shields;
      state.shields = Math.min(MAX_SHIELDS, state.shields + crossed7);
      if (state.shields > before) toastGeneric('🛡️ Streak Shield earned!');
    }
  }

  function checkStreakMilestones(state) {
    for (const m of STREAK_MILESTONES) {
      if (state.streak === m.days && !state.milestonesReached.includes(m.days)) {
        state.milestonesReached.push(m.days);
        celebrateStreakMilestone(m);
      }
    }
  }

  // ---- Action handlers ---------------------------------------------------

  function recordOpen(state) {
    if (state.today.opened) return;
    state.today.opened = true;
    awardXP(state, 10, '📖 Opened today’s digest');
  }

  function recordScrollToBottom(state) {
    if (state.today.scrolledBottom) return;
    state.today.scrolledBottom = true;
    awardXP(state, 10, '📜 Read complete');
  }

  function recordWordRevealed(state) {
    if (state.today.wordRevealed) return;
    state.today.wordRevealed = true;
    awardXP(state, 5, '📖 Word of the Day');
  }

  // Default XP per game type. Games can override via opts.fullXP / opts.attemptXP.
  // Source: Phase 1 spec section "The 6 Game Types".
  const GAME_XP_DEFAULTS = {
    'quiz':          { fullXP: 25, attemptXP: 10 },
    'bull-bear':     { fullXP: 20, attemptXP: 10 },
    'price-is-right':{ fullXP: 20, attemptXP: 10 },
    'compound':      { fullXP: 15, attemptXP: 15 }, // interaction-based, no right/wrong
    'match':         { fullXP: 25, attemptXP: 10 },
    'time-machine':  { fullXP: 15, attemptXP: 15 }, // no right/wrong by design
  };

  /** Record a daily game play. Idempotent per gameType per day. */
  function recordGamePlayed(state, gameType, opts) {
    opts = opts || {};
    // Replay of same game today: update correctness but no XP/streak again.
    if (state.today.gamesPlayed.includes(gameType)) {
      if (typeof opts.correct === 'boolean') {
        state.today.gamesCorrect[gameType] = opts.correct;
      }
      return;
    }
    state.today.gamesPlayed.push(gameType);
    if (typeof opts.correct === 'boolean') {
      state.today.gamesCorrect[gameType] = opts.correct;
    }

    const slot = state.today.gamesPlayed.length; // 1, 2, or 3+
    const defs = GAME_XP_DEFAULTS[gameType] || { fullXP: 20, attemptXP: 10 };
    const fullXP = opts.fullXP ?? defs.fullXP;
    const attemptXP = opts.attemptXP ?? defs.attemptXP;

    // Spec XP curve:
    //   1st game: full or attempt XP per correctness
    //   2nd game: +15
    //   3rd game: +10
    let xp;
    let label;
    if (slot === 1) {
      xp = opts.correct === false ? attemptXP : (opts.correct === true ? fullXP : attemptXP);
      label = opts.correct === true ? '🎯 Correct!' : '🎮 Game played';
    } else if (slot === 2) {
      xp = 15;
      label = '🎮 Second game';
    } else if (slot === 3) {
      xp = 10;
      label = '🎮 Third game';
    } else {
      // Defensive: spec says only 3 games per day. Extra plays earn nothing.
      xp = 0;
      label = '';
    }
    awardXP(state, xp, label);

    // First game of day triggers streak increment + shield/milestone checks.
    if (slot === 1) maybeIncrementStreak(state);

    // Perfect Day on the 3rd unique game of the day.
    if (slot === 3 && !state.today.perfectDay) {
      state.today.perfectDay = true;
      state.perfectDaysThisMonth += 1;
      awardXP(state, PERFECT_DAY_BONUS, '✨ Perfect Day!');
      celebratePerfectDay();
    }
  }

  // ---- Toasts / celebrations / confetti ---------------------------------

  function toastXP(amount, label) {
    if (!amount || !label) return;
    showToast(`+${amount} XP · ${label}`, 'xp');
  }
  function toastGeneric(label) { showToast(label, 'generic'); }

  function showToast(msg, kind) {
    const wrap = ensureToastWrap();
    const el = document.createElement('div');
    el.className = 'mb-toast mb-toast-' + (kind || 'xp');
    el.textContent = msg;
    wrap.appendChild(el);
    requestAnimationFrame(() => el.classList.add('mb-toast-show'));
    setTimeout(() => {
      el.classList.remove('mb-toast-show');
      el.addEventListener('transitionend', () => el.remove(), { once: true });
      // Safety: force-remove after transition window in case event misses.
      setTimeout(() => el.remove(), 600);
    }, 2400);
  }
  function ensureToastWrap() {
    let wrap = document.getElementById('mb-toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'mb-toast-wrap';
      document.body.appendChild(wrap);
    }
    return wrap;
  }

  function celebrateRankUp(rank) {
    showCelebration(`${rank.badge} Ranked up: ${rank.name}!`, 'big');
    confetti('big');
  }
  function celebrateStreakMilestone(m) {
    showCelebration(`${m.badge || '🔥'} ${m.title} — ${m.days}-day streak!`, m.confetti);
    confetti(m.confetti);
  }
  function celebratePerfectDay() {
    showCelebration('✨ Perfect Day! All 3 games complete.', 'big');
    confetti('big');
  }

  function showCelebration(msg, size) {
    const el = document.createElement('div');
    el.className = 'mb-celeb mb-celeb-' + (size || 'big');
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('mb-celeb-show'));
    setTimeout(() => {
      el.classList.remove('mb-celeb-show');
      el.addEventListener('transitionend', () => el.remove(), { once: true });
      setTimeout(() => el.remove(), 800);
    }, 3200);
  }

  function confetti(size) {
    const count = size === 'mega' ? 220
               : size === 'huge' ? 150
               : size === 'big'  ? 90
               : 40;
    const colors = ['#3fb950','#58a6ff','#f0c040','#bc8cff','#f85149','#f0883e'];
    const wrap = document.createElement('div');
    wrap.className = 'mb-confetti-wrap';
    document.body.appendChild(wrap);
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      p.className = 'mb-confetti';
      p.style.left = (Math.random() * 100) + 'vw';
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = (Math.random() * 0.6) + 's';
      p.style.animationDuration = (1.6 + Math.random() * 1.2) + 's';
      p.style.transform = 'rotate(' + (Math.random() * 360) + 'deg)';
      wrap.appendChild(p);
    }
    setTimeout(() => wrap.remove(), 3500);
  }

  // ---- Profile bar rendering --------------------------------------------

  function renderProfileBar(state) {
    const host = document.getElementById('investor-profile');
    if (!host) return;
    const { current, next } = rankFor(state.xp);
    const span = next ? Math.max(1, next.xp - current.xp) : 1;
    const pct = next ? Math.min(100, Math.max(0, ((state.xp - current.xp) / span) * 100)) : 100;

    const shieldUnlocked = state.xp >= SHIELD_UNLOCK_XP;
    const shieldHTML = shieldUnlocked
      ? `<span class="ip-stat ip-shield" title="Streak shields — protect your streak when you miss a day">🛡️ x${state.shields}</span>`
      : `<span class="ip-stat ip-shield ip-locked" title="Unlocks at Stock Scout (300 XP)">🛡️ 🔒</span>`;

    const perfectChip = state.perfectDaysThisMonth > 0
      ? `<span class="ip-stat ip-perfect" title="Perfect Days this month">✨ ${state.perfectDaysThisMonth}</span>`
      : '';

    const nextLabel = next
      ? `${state.xp - current.xp} / ${next.xp - current.xp} XP to ${escape(next.name)}`
      : 'Max rank reached 🏆';

    host.innerHTML = `
      <div class="ip-row">
        <div class="ip-rank">
          <span class="ip-badge">${current.badge}</span>
          <span class="ip-rank-name">${escape(current.name)}</span>
        </div>
        <div class="ip-stats">
          <span class="ip-stat ip-streak" title="Current daily streak">🔥 ${state.streak}</span>
          ${shieldHTML}
          ${perfectChip}
        </div>
      </div>
      <div class="ip-progress">
        <div class="ip-progress-track"><div class="ip-progress-fill" style="width:${pct.toFixed(1)}%"></div></div>
        <div class="ip-progress-label">${escape(nextLabel)} · ${state.xp} total XP</div>
      </div>
    `;
  }

  function escape(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  }

  // ---- Public API --------------------------------------------------------

  let state = load();
  function persist() { save(state); renderProfileBar(state); }

  const MarketBuzz = {
    init: function () {
      state = rolloverIfNeeded(load());
      recordOpen(state);
      persist();
      this._installScrollObserver();
    },
    recordGamePlayed: function (gameType, opts) {
      state = rolloverIfNeeded(state);
      recordGamePlayed(state, gameType, opts || {});
      persist();
    },
    recordWordRevealed: function () {
      state = rolloverIfNeeded(state);
      recordWordRevealed(state);
      persist();
    },
    getState: function () { return JSON.parse(JSON.stringify(state)); },
    _installScrollObserver: function () {
      const marker = document.getElementById('mb-bottom-marker');
      if (!marker || !('IntersectionObserver' in window)) return;
      const obs = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            state = rolloverIfNeeded(state);
            recordScrollToBottom(state);
            persist();
            obs.disconnect();
            return;
          }
        }
      }, { threshold: 0.5 });
      obs.observe(marker);
    },
    _debugReset: function () {
      localStorage.removeItem(STORAGE_KEY);
      state = load();
      persist();
    },
  };

  window.MarketBuzz = MarketBuzz;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => MarketBuzz.init());
  } else {
    MarketBuzz.init();
  }
})();
