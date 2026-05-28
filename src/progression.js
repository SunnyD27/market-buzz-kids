/**
 * src/progression.js — Phase 11 progression constants (server-canonical).
 *
 * Mirrored on the client in public/progression-config.js. The server file
 * is canonical: any change here must also be reflected in the client copy.
 * Keep the two files lockstep — drift will show up as subtle off-by-one
 * tier mismatches in the UI vs the rank-up popup payload.
 *
 * What's here:
 *   RANKS            — 12-tier linear-progressive ladder
 *   MC_AWARDS        — Market Coin payouts per event
 *   BADGE_FAMILIES   — 6 families × 10 tiers (early wins → rare achievements)
 *   PERSONAL_RECORDS — auto-tracked bests, persist across streak resets
 *   SHIELD_CONFIG    — Emergency Fund (streak protection) rules
 */

// 12 ranks. Linear-progressive curve: gap between consecutive ranks grows
// gradually so a kid always has a next tier within ~3–6 weeks of reach,
// even at the top of the ladder.
export const RANKS = [
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

// Rank-specific copy shown on the rank-up popup. Aspirational tier-labels
// ("top 10%") are static strings per spec — not computed from real data.
export const RANK_UNLOCK_MESSAGES = {
  'market-watcher':     "You can now see your Personal Records on the Progress page!",
  'stock-scout':        "Emergency Funds unlocked! 🪙 You'll earn shields to protect your streak.",
  'trading-cadet':      "You now see market principle tags on your game results!",
  'market-analyst':     "Your profile badge is now visible in the digest header!",
  'wall-street-rookie': "You've joined the top half of all Market Juice readers!",
  'portfolio-builder':  "Your Progress page now shows cumulative principles learned!",
  'market-strategist':  "You've earned a gold accent on your profile bar!",
  'investment-pro':     "You're in the top 10% of all Market Juice readers!",
  'fund-manager':       "Your profile now shows a portfolio performance tracker!",
  'market-master':      "Gold theme unlocked for your digest!",
  'wall-street-legend': "You've reached the highest rank. You are a Market Juice Legend.",
};

// Market Coin awards per event. Streak bonus is a function: changed from
// the old flat +5/day to min(streakDays * 2, 30) to keep long streaks
// rewarding without runaway inflation at day 100+.
export const MC_AWARDS = {
  // Daily games (includes quiz, which goes through the picker as a normal game)
  gameCorrect:        25,
  gameParticipation:  15,
  perfectDay:         25,   // bonus when all 3 daily games done today

  // Sunday Challenge
  sundayComplete:     50,
  sundayBonus:        25,   // additional payout when sunday-challenge sets bonus=true

  // Word of the Day reveal (kept per Q3 — small interaction, educational hook)
  wordLearned:        5,

  // Streak bonus: +2 MC per streak day, capped at +30. Applied once per
  // calendar day on the first game completion that extends the streak.
  streakBonus: (streakDays) => Math.min(Math.max(0, streakDays) * 2, 30),
};

// 6 badge families × 10 tiers. First tier of each is reachable in week 1
// (the "day-one win" insight from Duolingo retention data). Final tiers
// are deliberately rare so high engagement is recognized.
//
// `source` is the user_progress column whose lifetime value is compared
// against the tier ladder. `eventTypes` is the set of events that should
// trigger a tier-check for this family (used by engagement.js to avoid
// re-checking every family on every event).
export const BADGE_FAMILIES = {
  streak: {
    key: 'streak',
    name: "The Investor's Discipline",
    icon: '🔥',
    tiers: [3, 7, 14, 21, 30, 50, 75, 100, 200, 365],
    source: 'longest_streak',
    eventTypes: ['daily-visit', 'game-completed', 'sunday-challenge-completed'],
    unit: 'day',
  },
  games: {
    key: 'games',
    name: 'Market Player',
    icon: '🎮',
    tiers: [5, 15, 30, 50, 100, 200, 300, 500, 750, 1000],
    source: 'games_played',
    eventTypes: ['game-completed'],
    unit: 'game',
  },
  perfectDays: {
    key: 'perfectDays',
    name: 'The Perfectionist',
    icon: '🎯',
    tiers: [1, 3, 7, 15, 30, 50, 75, 100, 150, 200],
    source: 'perfect_days',
    eventTypes: ['game-completed'],
    unit: 'Perfect Day',
  },
  quizzes: {
    key: 'quizzes',
    name: 'Market Scholar',
    icon: '📈',
    tiers: [5, 15, 30, 50, 100, 200, 300, 500, 750, 1000],
    source: 'correct_answers',
    eventTypes: ['game-completed'],
    unit: 'correct answer',
  },
  consistency: {
    key: 'consistency',
    name: 'The Regular',
    icon: '📅',
    tiers: [1, 2, 4, 8, 12, 16, 20, 30, 40, 52],
    source: 'weeks_active',
    eventTypes: ['daily-visit', 'game-completed', 'sunday-challenge-completed'],
    unit: 'week',
  },
  sunday: {
    key: 'sunday',
    name: 'Weekend Warrior',
    icon: '🌅',
    tiers: [1, 3, 5, 10, 15, 25, 40, 52, 75, 100],
    source: 'sunday_challenges',
    eventTypes: ['sunday-challenge-completed'],
    unit: 'Sunday Challenge',
  },
};

// Auto-tracked bests. Survive everything (including streak resets) —
// a broken streak doesn't erase the longest-streak record.
export const PERSONAL_RECORDS = [
  { key: 'best-day-mc',       name: 'Best Day',         unit: 'MC' },
  { key: 'best-week-mc',      name: 'Best Week',        unit: 'MC' },
  { key: 'longest-streak',    name: 'Longest Streak',   unit: 'days' },
  { key: 'best-perfect-week', name: 'Best Perfect Week', unit: 'Perfect Days' },
];

// Emergency Fund (renamed from "Shields") — financial-literacy reframe
// of streak protection. Capped at 3 to give a long-weekend buffer without
// trivializing the streak.
export const SHIELD_CONFIG = {
  maxShields: 3,
  earnEveryNDays: 7,            // 1 shield awarded every 7 streak days
  unlockAtRank: 'stock-scout',  // shields only begin accruing once rank ≥ Stock Scout (150 MC)
  displayName: 'Emergency Fund',
  displayNamePlural: 'Emergency Funds',
  icon: '🪙',
};

// Allow-list of event types the API accepts. POST /api/engagement/track
// validates incoming requests against this set.
export const EVENT_TYPES = new Set([
  'daily-visit',
  'game-completed',
  'sunday-challenge-completed',
  'word-learned',
  // Phase 12 — kid flags a section to discuss with parent. Awards no MC,
  // no progression. Logged for the evening recap email to pick up.
  'parent-question',
]);

// Helpers — useful on both server and client (re-implemented in the client
// config). Server is the authoritative source for rank-up detection.

export function rankForCoins(marketCoins) {
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
  return { current, next };
}

export function nextBadgeTier(family, currentTier) {
  const fam = BADGE_FAMILIES[family];
  if (!fam) return null;
  if (currentTier >= fam.tiers.length) return null;
  return { tier: currentTier + 1, target: fam.tiers[currentTier] };
}

export function shieldsUnlocked(rankKey) {
  const idx = RANKS.findIndex(r => r.key === SHIELD_CONFIG.unlockAtRank);
  const cur = RANKS.findIndex(r => r.key === rankKey);
  return cur >= idx;
}
