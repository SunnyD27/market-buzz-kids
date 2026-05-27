/* public/progression-config.js
 *
 * Phase 11 — client mirror of src/progression.js. Loaded via a plain
 * <script> tag in the digest template before engagement.js. Server is
 * canonical; this file MUST stay in sync.
 *
 * Exposed as window.MJProgression so engagement.js, the digest profile
 * bar, and the /progress page can all read from the same source.
 */
(function () {
  'use strict';

  const RANKS = [
    { key: 'rookie',             name: 'Rookie',             badge: '🟢', threshold: 0 },
    { key: 'market-watcher',     name: 'Market Watcher',     badge: '🔵', threshold: 50 },
    { key: 'stock-scout',        name: 'Stock Scout',        badge: '🟣', threshold: 150 },
    { key: 'trading-cadet',      name: 'Trading Cadet',      badge: '🟠', threshold: 350 },
    { key: 'market-analyst',     name: 'Market Analyst',     badge: '🔴', threshold: 650 },
    { key: 'wall-street-rookie', name: 'Wall Street Rookie', badge: '🏅', threshold: 1100 },
    { key: 'portfolio-builder',  name: 'Portfolio Builder',  badge: '⭐', threshold: 1700 },
    { key: 'market-strategist',  name: 'Market Strategist',  badge: '💫', threshold: 2500 },
    { key: 'investment-pro',     name: 'Investment Pro',     badge: '💎', threshold: 3500 },
    { key: 'fund-manager',       name: 'Fund Manager',       badge: '🏆', threshold: 5000 },
    { key: 'market-master',      name: 'Market Master',      badge: '👑', threshold: 7000 },
    { key: 'wall-street-legend', name: 'Wall Street Legend', badge: '🌟', threshold: 10000 },
  ];

  const MC_AWARDS = {
    gameCorrect:        25,
    gameParticipation:  15,
    perfectDay:         25,
    sundayComplete:     50,
    sundayBonus:        25,
    wordLearned:        5,
    streakBonus: function (streakDays) {
      return Math.min(Math.max(0, streakDays) * 2, 30);
    },
  };

  const BADGE_FAMILIES = {
    streak: {
      key: 'streak',
      name: "The Investor's Discipline",
      icon: '🔥',
      tiers: [3, 7, 14, 21, 30, 50, 75, 100, 200, 365],
      unit: 'day',
    },
    games: {
      key: 'games',
      name: 'Market Player',
      icon: '🎮',
      tiers: [5, 15, 30, 50, 100, 200, 300, 500, 750, 1000],
      unit: 'game',
    },
    perfectDays: {
      key: 'perfectDays',
      name: 'The Perfectionist',
      icon: '🎯',
      tiers: [1, 3, 7, 15, 30, 50, 75, 100, 150, 200],
      unit: 'Perfect Day',
    },
    quizzes: {
      key: 'quizzes',
      name: 'Market Scholar',
      icon: '📈',
      tiers: [5, 15, 30, 50, 100, 200, 300, 500, 750, 1000],
      unit: 'correct answer',
    },
    consistency: {
      key: 'consistency',
      name: 'The Regular',
      icon: '📅',
      tiers: [1, 2, 4, 8, 12, 16, 20, 30, 40, 52],
      unit: 'week',
    },
    sunday: {
      key: 'sunday',
      name: 'Weekend Warrior',
      icon: '🌅',
      tiers: [1, 3, 5, 10, 15, 25, 40, 52, 75, 100],
      unit: 'Sunday Challenge',
    },
  };

  const PERSONAL_RECORDS = [
    { key: 'best-day-mc',       name: 'Best Day',         unit: 'MC' },
    { key: 'best-week-mc',      name: 'Best Week',        unit: 'MC' },
    { key: 'longest-streak',    name: 'Longest Streak',   unit: 'days' },
    { key: 'best-perfect-week', name: 'Best Perfect Week', unit: 'Perfect Days' },
  ];

  const SHIELD_CONFIG = {
    maxShields: 3,
    earnEveryNDays: 7,
    unlockAtRank: 'stock-scout',
    displayName: 'Emergency Fund',
    displayNamePlural: 'Emergency Funds',
    icon: '🪙',
  };

  function rankForCoins(marketCoins) {
    let current = RANKS[0];
    let next = null;
    for (let i = 0; i < RANKS.length; i++) {
      if (marketCoins >= RANKS[i].threshold) {
        current = RANKS[i];
        next = RANKS[i + 1] || null;
      } else {
        break;
      }
    }
    return { current: current, next: next };
  }

  function shieldsUnlocked(rankKey) {
    const idx = RANKS.findIndex(function (r) { return r.key === SHIELD_CONFIG.unlockAtRank; });
    const cur = RANKS.findIndex(function (r) { return r.key === rankKey; });
    return cur >= idx;
  }

  window.MJProgression = {
    RANKS: RANKS,
    MC_AWARDS: MC_AWARDS,
    BADGE_FAMILIES: BADGE_FAMILIES,
    PERSONAL_RECORDS: PERSONAL_RECORDS,
    SHIELD_CONFIG: SHIELD_CONFIG,
    rankForCoins: rankForCoins,
    shieldsUnlocked: shieldsUnlocked,
  };
})();
