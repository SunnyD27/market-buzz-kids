/**
 * src/engagement.js — Phase 11 server-side engagement engine.
 *
 * Single source of truth for Market Coins, ranks, streaks, badges, and
 * personal records. The client (public/engagement.js) drives in-session UX
 * but every state change round-trips through here.
 *
 * Public surface:
 *   ensureProgress(userId)
 *     Idempotently INSERT the user's progress + 6 badge rows + 4 record
 *     rows. Safe to call on every request; cheap if rows already exist.
 *
 *   getProgress(userId)
 *     Returns the full engagement state shape consumed by
 *     GET /api/engagement/state.
 *
 *   recordEvent(userId, eventType, eventData)
 *     The main entry point. All in one transaction:
 *       1. INSERT engagement_events row (audit log)
 *       2. Apply event-specific mutations to user_progress counters
 *       3. Re-evaluate rank
 *       4. Re-evaluate badge tiers (only families this event can affect)
 *       5. Re-evaluate personal records
 *       6. Return the result envelope (MC awarded, rank-up, badge unlocks,
 *          new records, next milestones)
 *
 * Time handling: the server is authoritative for "today" (America/New_York
 * calendar date). Clients may pass digestDate in eventData for logging,
 * but streak / weekly-record bucketing always uses the server's NY date.
 */

import { query, getClient } from './db.js';
import {
  RANKS,
  RANK_UNLOCK_MESSAGES,
  MC_AWARDS,
  BADGE_FAMILIES,
  PERSONAL_RECORDS,
  SHIELD_CONFIG,
  EVENT_TYPES,
  rankForCoins,
  shieldsUnlocked,
} from './progression.js';

// ---- Date helpers (America/New_York) ----------------------------------

/** Today's calendar date in NY, formatted YYYY-MM-DD. */
function todayNY() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/** Add days to a YYYY-MM-DD string, return YYYY-MM-DD. Anchored at UTC noon
 *  to dodge DST jitter — the absolute date is what matters, not the wall
 *  clock. */
function addDays(yyyymmdd, n) {
  const d = new Date(yyyymmdd + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole-day gap between two YYYY-MM-DD strings (b - a). */
function daysBetween(a, b) {
  const t1 = new Date(a + 'T12:00:00Z').getTime();
  const t2 = new Date(b + 'T12:00:00Z').getTime();
  return Math.round((t2 - t1) / 86400000);
}

/** Coerce whatever pg returns for a DATE column into a YYYY-MM-DD string
 *  (or null). Default pg behavior parses DATE → Date object, but we
 *  compare dates as strings throughout the engine so we don't have to
 *  worry about timezone semantics on the object form. */
function dateColToString(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  if (v instanceof Date) {
    // The DATE column was set from a YYYY-MM-DD string we computed in NY
    // time; pg parses it as a UTC midnight Date. Reading the UTC date
    // back returns the same YYYY-MM-DD.
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, '0');
    const d = String(v.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(v);
}

/** Normalize date columns on a freshly-loaded user_progress row. */
function normalizeProgressRow(row) {
  if (!row) return row;
  row.last_active_date = dateColToString(row.last_active_date);
  row.last_streak_date = dateColToString(row.last_streak_date);
  return row;
}

/** ISO week label for a YYYY-MM-DD string: 'YYYY-Www'. Used to detect
 *  new-week boundaries for the weeks_active counter and best-week record. */
function isoWeekOf(yyyymmdd) {
  // Standard ISO-8601 week calculation.
  const d = new Date(yyyymmdd + 'T12:00:00Z');
  const day = d.getUTCDay() || 7;            // 1=Mon..7=Sun
  d.setUTCDate(d.getUTCDate() + 4 - day);    // Thursday of this week
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

// ---- Shape helpers ----------------------------------------------------

function rankByKey(key) {
  return RANKS.find(r => r.key === key) || RANKS[0];
}

/** Build the "nextMilestones" block returned with every track response. */
function buildNextMilestones(progress, badgeRows) {
  const { current, next } = rankForCoins(progress.market_coins);
  const nextRank = next ? {
    key: next.key,
    name: next.name,
    badge: next.badge,
    threshold: next.threshold,
    remaining: Math.max(0, next.threshold - progress.market_coins),
  } : null;

  // Pick the 2 nearest-to-unlock next-tier badges (lowest remaining first).
  const nearest = [];
  for (const fam of Object.values(BADGE_FAMILIES)) {
    const row = badgeRows.find(b => b.badge_key === fam.key);
    const tier = row ? row.current_tier : 0;
    if (tier >= fam.tiers.length) continue;       // family maxed
    const target = fam.tiers[tier];
    const lifetime = progress[fam.source] || 0;
    nearest.push({
      family: fam.key,
      familyName: fam.name,
      icon: fam.icon,
      nextTier: tier + 1,
      progress: Math.min(lifetime, target),
      target,
      remaining: Math.max(0, target - lifetime),
    });
  }
  nearest.sort((a, b) => a.remaining - b.remaining);

  return { nextRank, nearestBadges: nearest.slice(0, 2) };
}

// ---- ensureProgress ---------------------------------------------------

/**
 * Idempotently create the user_progress + badge + record rows for a user.
 * Safe to call on every authenticated request — the ON CONFLICT clauses
 * make repeat calls free. Required so existing pre-Phase-11 users get
 * their rows lazily on first interaction.
 */
export async function ensureProgress(userId) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO user_progress (user_id) VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId],
    );

    for (const famKey of Object.keys(BADGE_FAMILIES)) {
      await client.query(
        `INSERT INTO user_badges (user_id, badge_key) VALUES ($1, $2)
         ON CONFLICT (user_id, badge_key) DO NOTHING`,
        [userId, famKey],
      );
    }

    for (const rec of PERSONAL_RECORDS) {
      await client.query(
        `INSERT INTO personal_records (user_id, record_key) VALUES ($1, $2)
         ON CONFLICT (user_id, record_key) DO NOTHING`,
        [userId, rec.key],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ---- getProgress ------------------------------------------------------

/**
 * Read the full engagement state for a user. Calls ensureProgress first so
 * pre-Phase-11 users (and any user whose rows were lost) hydrate cleanly.
 *
 * Return shape matches the GET /api/engagement/state contract.
 */
export async function getProgress(userId) {
  await ensureProgress(userId);

  const progressRes = await query(
    `SELECT * FROM user_progress WHERE user_id = $1`,
    [userId],
  );
  const progress = normalizeProgressRow(progressRes.rows[0]);

  const badgesRes = await query(
    `SELECT badge_key, current_tier, progress, unlocked_at
       FROM user_badges WHERE user_id = $1`,
    [userId],
  );
  const recordsRes = await query(
    `SELECT record_key, value, achieved_at
       FROM personal_records WHERE user_id = $1`,
    [userId],
  );

  const rank = rankByKey(progress.rank_key);
  const { next } = rankForCoins(progress.market_coins);

  // Shape badges: { streak: { currentTier, progress, nextTierAt }, ... }
  const badges = {};
  for (const fam of Object.values(BADGE_FAMILIES)) {
    const row = badgesRes.rows.find(b => b.badge_key === fam.key);
    const tier = row ? row.current_tier : 0;
    const nextTierAt = tier < fam.tiers.length ? fam.tiers[tier] : null;
    badges[fam.key] = {
      currentTier: tier,
      progress: progress[fam.source] || 0,
      nextTierAt,
      unlockedAt: row?.unlocked_at || null,
    };
  }

  // Shape records: { 'best-day-mc': { value, achievedAt }, ... }
  const records = {};
  for (const rec of PERSONAL_RECORDS) {
    const row = recordsRes.rows.find(r => r.record_key === rec.key);
    records[rec.key] = {
      value: row?.value || 0,
      achievedAt: row?.achieved_at || null,
    };
  }

  return {
    progress: {
      marketCoins: progress.market_coins,
      currentStreak: progress.current_streak,
      longestStreak: progress.longest_streak,
      streakShields: progress.streak_shields,
      shieldsUnlocked: shieldsUnlocked(progress.rank_key),
      rank: { key: rank.key, name: rank.name, badge: rank.badge },
      perfectDays: progress.perfect_days,
      gamesPlayed: progress.games_played,
      correctAnswers: progress.correct_answers,
      sundayChallenges: progress.sunday_challenges,
      weeksActive: progress.weeks_active,
      wordsLearned: progress.words_learned,
      lastActiveDate: progress.last_active_date,
    },
    badges,
    records,
    nextRank: next ? {
      key: next.key,
      name: next.name,
      badge: next.badge,
      threshold: next.threshold,
      remaining: Math.max(0, next.threshold - progress.market_coins),
    } : null,
  };
}

// ---- Duplicate detection ----------------------------------------------
//
// Prevents the "replay the same game 50 times" exploit. Daily-visit is
// already idempotent via last_active_date so it's not gated here. The
// other three event types are deduped against the engagement_events log:
//
//   game-completed              → (game, digestDate)
//   word-learned                → (digestDate)
//   sunday-challenge-completed  → (digestDate)
//
// Returns true when a non-duplicate prior event exists for the same key
// (we only count rows where event_data.duplicate is not true, so a stack
// of duplicate-marker rows can never become "the first award" by accident).
//
// `digestDate` falls back to server today if the client omitted it, so a
// client that strips eventData can't bypass the gate by sending null.

async function isDuplicate(client, userId, eventType, eventData, todayServer) {
  const digestDate = (eventData?.digestDate || todayServer);
  if (eventType === 'game-completed') {
    const game = eventData?.game;
    if (!game) return false; // no game name → can't dedup; rare, leave permissive
    const { rows } = await client.query(
      `SELECT 1 FROM engagement_events
        WHERE user_id = $1
          AND event_type = 'game-completed'
          AND event_data->>'game' = $2
          AND event_data->>'digestDate' = $3
          AND COALESCE((event_data->>'duplicate')::boolean, false) = false
        LIMIT 1`,
      [userId, game, digestDate],
    );
    return rows.length > 0;
  }
  if (eventType === 'word-learned') {
    const { rows } = await client.query(
      `SELECT 1 FROM engagement_events
        WHERE user_id = $1
          AND event_type = 'word-learned'
          AND event_data->>'digestDate' = $2
          AND COALESCE((event_data->>'duplicate')::boolean, false) = false
        LIMIT 1`,
      [userId, digestDate],
    );
    return rows.length > 0;
  }
  if (eventType === 'sunday-challenge-completed') {
    const { rows } = await client.query(
      `SELECT 1 FROM engagement_events
        WHERE user_id = $1
          AND event_type = 'sunday-challenge-completed'
          AND event_data->>'digestDate' = $2
          AND COALESCE((event_data->>'duplicate')::boolean, false) = false
        LIMIT 1`,
      [userId, digestDate],
    );
    return rows.length > 0;
  }
  // daily-visit is idempotent via last_active_date in applyDailyVisit;
  // no gate needed here.
  return false;
}

// ---- recordEvent ------------------------------------------------------

/**
 * Apply a tracked event to a user's progress. All mutations in one
 * transaction so partial failures don't leave inconsistent state.
 *
 * Return shape matches POST /api/engagement/track:
 *   {
 *     mcAwarded,                    // Market Coins gained this event
 *     newTotal,                     // running total after the event
 *     streakUpdate: { current, longest, shieldsRemaining, shieldUsed? },
 *     rankUp:       null | { oldRank, newRank, unlocksMessage },
 *     badgeUnlocks: [ { family, tier, name, icon, target } ],
 *     newRecords:   [ { key, name, oldValue, newValue } ],
 *     nextMilestones: { nextRank, nearestBadges }
 *   }
 */
export async function recordEvent(userId, eventType, eventData = {}) {
  if (!EVENT_TYPES.has(eventType)) {
    const err = new Error(`Unknown event type: ${eventType}`);
    err.code = 'UNKNOWN_EVENT_TYPE';
    throw err;
  }
  await ensureProgress(userId);

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // 1. Load current state (FOR UPDATE so concurrent events serialize).
    const progRes = await client.query(
      `SELECT * FROM user_progress WHERE user_id = $1 FOR UPDATE`,
      [userId],
    );
    const before = normalizeProgressRow(progRes.rows[0]);
    const today = todayNY();

    // Normalize digestDate so the audit log and dedup lookups stay in sync
    // regardless of whether the client passed one. (Server is authoritative
    // for "today" — clients can't forge a different date to bypass dedup.)
    if (eventData && !eventData.digestDate) eventData = { ...eventData, digestDate: today };
    else if (!eventData) eventData = { digestDate: today };

    // 1a. Duplicate gate — exit early without mutating state, but still
    //     log the duplicate to engagement_events for visibility. The kid
    //     can replay all they want; they just don't double-earn MC.
    if (await isDuplicate(client, userId, eventType, eventData, today)) {
      await client.query(
        `INSERT INTO engagement_events (user_id, event_type, event_data)
         VALUES ($1, $2, $3::jsonb)`,
        [userId, eventType, JSON.stringify({
          ...(eventData || {}),
          duplicate: true,
          mcAwarded: 0,
        })],
      );
      // Build nextMilestones from the un-mutated state so the UI still
      // gets a fresh pointer to the next rank/badge.
      const allBadgeRowsRes = await client.query(
        `SELECT badge_key, current_tier FROM user_badges WHERE user_id = $1`,
        [userId],
      );
      const nextMilestones = buildNextMilestones(before, allBadgeRowsRes.rows);
      await client.query('COMMIT');
      return {
        mcAwarded: 0,
        newTotal: before.market_coins,
        duplicate: true,
        streakUpdate: {
          current: before.current_streak,
          longest: before.longest_streak,
          shieldsRemaining: before.streak_shields,
        },
        rankUp: null,
        badgeUnlocks: [],
        newRecords: [],
        nextMilestones,
      };
    }

    // Working copy of progress that we'll write back at the end.
    const after = { ...before };
    const ctx = {
      shieldUsed: false,
      perfectDay: false,
      gamesPlayedToday: 0,
    };
    let mcAwarded = 0;

    // 2. Event-specific mutations.
    if (eventType === 'daily-visit') {
      applyDailyVisit(after, today);
    } else if (eventType === 'game-completed') {
      mcAwarded += await applyGameCompleted(client, userId, after, today, eventData, ctx);
    } else if (eventType === 'sunday-challenge-completed') {
      mcAwarded += applySundayChallenge(after, eventData);
    } else if (eventType === 'word-learned') {
      mcAwarded += applyWordLearned(after);
    }

    if (mcAwarded > 0) {
      after.market_coins = before.market_coins + mcAwarded;
    }

    // 3. Rank-up detection.
    const oldRank = rankByKey(before.rank_key);
    const { current: newRank } = rankForCoins(after.market_coins);
    let rankUp = null;
    if (newRank.key !== oldRank.key) {
      after.rank_key = newRank.key;
      rankUp = {
        oldRank: { key: oldRank.key, name: oldRank.name, badge: oldRank.badge },
        newRank: { key: newRank.key, name: newRank.name, badge: newRank.badge },
        unlocksMessage: RANK_UNLOCK_MESSAGES[newRank.key] || '',
      };
    }

    // 3a. Shield award — runs AFTER rank-up so an event that crosses
    //     both the Stock Scout threshold AND a 7-day streak boundary
    //     awards the shield (the rank gate uses the post-bump rank).
    if (ctx.crossed7DayBoundary
        && shieldsUnlocked(after.rank_key)
        && (after.streak_shields || 0) < SHIELD_CONFIG.maxShields) {
      after.streak_shields = (after.streak_shields || 0) + 1;
      ctx.shieldAwarded = true;
    }

    // 4. Persist user_progress.
    await client.query(
      `UPDATE user_progress SET
         market_coins      = $2,
         current_streak    = $3,
         longest_streak    = $4,
         streak_shields    = $5,
         rank_key          = $6,
         perfect_days      = $7,
         games_played      = $8,
         correct_answers   = $9,
         sunday_challenges = $10,
         weeks_active      = $11,
         words_learned     = $12,
         last_active_date  = $13,
         last_streak_date  = $14,
         last_iso_week     = $15,
         updated_at        = NOW()
       WHERE user_id = $1`,
      [
        userId,
        after.market_coins,
        after.current_streak,
        after.longest_streak,
        after.streak_shields,
        after.rank_key,
        after.perfect_days,
        after.games_played,
        after.correct_answers,
        after.sunday_challenges,
        after.weeks_active,
        after.words_learned,
        after.last_active_date,
        after.last_streak_date,
        after.last_iso_week,
      ],
    );

    // 5. Write the audit row LAST — enriched with server-computed values
    //    so the event log is self-describing (mcAwarded, perfectDay,
    //    shieldUsed all queryable from JSONB later).
    const enrichedData = {
      ...(eventData || {}),
      mcAwarded,
      perfectDay: ctx.perfectDay,
      shieldUsed: ctx.shieldUsed,
      shieldAwarded: !!ctx.shieldAwarded,
      streakAfter: after.current_streak,
      rankAfter: after.rank_key,
    };
    await client.query(
      `INSERT INTO engagement_events (user_id, event_type, event_data)
       VALUES ($1, $2, $3::jsonb)`,
      [userId, eventType, JSON.stringify(enrichedData)],
    );

    // 6. Badge tier checks — only families this event type can affect.
    const badgeUnlocks = await applyBadgeChecks(client, userId, after, eventType);

    // 7. Personal records — bucket sums now include this event's audit row.
    const newRecords = await applyRecordChecks(client, userId, before, after, today, mcAwarded);

    // 8. Build "what's next" pointers from final state.
    const allBadgeRows = (await client.query(
      `SELECT badge_key, current_tier FROM user_badges WHERE user_id = $1`,
      [userId],
    )).rows;
    const nextMilestones = buildNextMilestones(after, allBadgeRows);

    await client.query('COMMIT');

    const streakUpdate = {
      current: after.current_streak,
      longest: after.longest_streak,
      shieldsRemaining: after.streak_shields,
    };
    if (ctx.shieldUsed) streakUpdate.shieldUsed = true;
    if (ctx.shieldAwarded) streakUpdate.shieldAwarded = true;

    return {
      mcAwarded,
      newTotal: after.market_coins,
      streakUpdate,
      rankUp,
      badgeUnlocks,
      newRecords,
      nextMilestones,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ---- Event handlers (mutate the working `after` object) ---------------

/**
 * Daily-visit: just updates the activity timestamps + week counter. The
 * streak itself only advances on the FIRST game completion of a new day
 * (see applyGameCompleted) — opening the digest alone doesn't extend it.
 * That decision matches the research's "no XP for passive engagement"
 * principle.
 */
function applyDailyVisit(after, today) {
  if (after.last_active_date === today) return; // idempotent same-day visits

  const isoWeek = isoWeekOf(today);
  if (after.last_iso_week !== isoWeek) {
    after.weeks_active = (after.weeks_active || 0) + 1;
    after.last_iso_week = isoWeek;
  }
  after.last_active_date = today;
}

/**
 * Game completion (includes quiz, which is just another game). Updates
 * counters, advances the streak on the day's first completion, awards
 * Perfect Day on the 3rd unique game of the day.
 *
 * Games-today is derived from engagement_events (DISTINCT event_data->>'game'
 * for today) so the per-day counter survives across recordEvent calls
 * without needing a new column. Querying inside the transaction is fine
 * given the index on (user_id, created_at DESC).
 */
async function applyGameCompleted(client, userId, after, today, eventData, ctx) {
  let mc = 0;

  // Base award.
  mc += eventData?.correct ? MC_AWARDS.gameCorrect : MC_AWARDS.gameParticipation;
  after.games_played = (after.games_played || 0) + 1;
  if (eventData?.correct) {
    after.correct_answers = (after.correct_answers || 0) + 1;
  }

  // First game-completion of TODAY? Compare against last_streak_date — that
  // field only changes inside advanceStreak, so it's the right "have I
  // already had a streak-bonus today?" signal. (last_active_date is bumped
  // by daily-visit on every /digest page load, so it can't drive this.)
  const isFirstGameOfDay = after.last_streak_date !== today;
  if (isFirstGameOfDay) {
    const isoWeek = isoWeekOf(today);
    if (after.last_iso_week !== isoWeek) {
      after.weeks_active = (after.weeks_active || 0) + 1;
      after.last_iso_week = isoWeek;
    }
    after.last_active_date = today;
    const streakOutcome = advanceStreak(after, today);
    mc += MC_AWARDS.streakBonus(after.current_streak);
    if (streakOutcome.shieldUsed) ctx.shieldUsed = true;
    if (streakOutcome.crossed7DayBoundary) ctx.crossed7DayBoundary = true;
  }

  // How many unique games has this kid played today, INCLUDING this one?
  // We count distinct event_data->>'game' values for today's game-completed
  // events, then +1 for the in-flight event (audit row is written after
  // this function returns).
  const currentGame = eventData?.game || 'unknown';
  const { rows } = await client.query(
    `SELECT COUNT(DISTINCT event_data->>'game')::int AS n
       FROM engagement_events
      WHERE user_id = $1
        AND event_type = 'game-completed'
        AND (created_at AT TIME ZONE 'America/New_York')::date = $2::date
        AND event_data->>'game' IS NOT NULL
        AND event_data->>'game' <> $3`,
    [userId, today, currentGame],
  );
  const distinctGamesToday = rows[0].n + 1; // +1 for this in-flight event
  ctx.gamesPlayedToday = distinctGamesToday;

  // Perfect Day fires when the 3rd unique game lands. Guard against
  // double-firing: if perfect_days was already bumped today, the
  // condition (>= 3) still holds on subsequent events, so check whether
  // any prior event today already set perfectDay=true.
  if (distinctGamesToday >= 3) {
    const { rows: alreadyRows } = await client.query(
      `SELECT 1 FROM engagement_events
        WHERE user_id = $1
          AND event_type = 'game-completed'
          AND (event_data->>'perfectDay')::boolean = true
          AND (created_at AT TIME ZONE 'America/New_York')::date = $2::date
        LIMIT 1`,
      [userId, today],
    );
    if (alreadyRows.length === 0) {
      after.perfect_days = (after.perfect_days || 0) + 1;
      mc += MC_AWARDS.perfectDay;
      ctx.perfectDay = true;
    }
  }

  return mc;
}

/** Sunday Challenge — 50 MC base, +25 if bonus flag set. */
function applySundayChallenge(after, eventData) {
  let mc = MC_AWARDS.sundayComplete;
  if (eventData?.bonus) mc += MC_AWARDS.sundayBonus;
  after.sunday_challenges = (after.sunday_challenges || 0) + 1;
  return mc;
}

/** Word-of-Day reveal — small payout, kept per Q3. */
function applyWordLearned(after) {
  after.words_learned = (after.words_learned || 0) + 1;
  return MC_AWARDS.wordLearned;
}

// ---- Streak progression -----------------------------------------------

/**
 * Advance the streak for a fresh day. Caller has already verified that
 * `today` is a new day for this user.
 *
 * Rules:
 *   - first activity ever → streak = 1
 *   - exactly 1 day since last_streak_date → streak += 1 (consecutive)
 *   - 2+ day gap → if a shield exists AND gap is exactly 2 days,
 *     consume one and continue. Otherwise reset to 1.
 *   - longest_streak only grows.
 *   - 7-day milestones award a shield (capped at SHIELD_CONFIG.maxShields,
 *     gated by SHIELD_CONFIG.unlockAtRank).
 */
function advanceStreak(after, today) {
  const out = { shieldUsed: false };

  if (!after.last_streak_date) {
    after.current_streak = 1;
  } else {
    const gap = daysBetween(after.last_streak_date, today);
    if (gap === 1) {
      after.current_streak = (after.current_streak || 0) + 1;
    } else if (gap === 2 && (after.streak_shields || 0) > 0) {
      // Consume one shield to bridge a single missed day.
      after.streak_shields -= 1;
      after.current_streak = (after.current_streak || 0) + 1;
      out.shieldUsed = true;
    } else {
      // Reset (longest_streak preserved as a Personal Record below).
      after.current_streak = 1;
    }
  }

  after.last_streak_date = today;
  if (after.current_streak > (after.longest_streak || 0)) {
    after.longest_streak = after.current_streak;
  }

  // Flag whether this advancement crossed a 7-day boundary. The actual
  // shield award is deferred to after rank-up in recordEvent, so the
  // rank gate (shields unlock at Stock Scout) reads the post-bump rank
  // for the same event — handles the edge case where one game completion
  // both crosses the MC threshold AND a 7-day milestone.
  out.crossed7DayBoundary = (
    after.current_streak > 0 &&
    after.current_streak % SHIELD_CONFIG.earnEveryNDays === 0
  );

  return out;
}

// ---- Badge tier checks ------------------------------------------------

/**
 * For each badge family this event can affect, see if the kid's lifetime
 * counter has crossed one or more tier thresholds. Multiple tiers can
 * unlock in a single event (e.g. a shield rescue that pushes longest_streak
 * past two tiers at once) — we walk forward greedily.
 */
async function applyBadgeChecks(client, userId, after, eventType) {
  const unlocks = [];
  for (const fam of Object.values(BADGE_FAMILIES)) {
    if (!fam.eventTypes.includes(eventType)) continue;

    const lifetime = after[fam.source] || 0;
    const rowRes = await client.query(
      `SELECT current_tier FROM user_badges
        WHERE user_id = $1 AND badge_key = $2 FOR UPDATE`,
      [userId, fam.key],
    );
    let tier = rowRes.rows[0]?.current_tier || 0;
    let advanced = false;

    while (tier < fam.tiers.length && lifetime >= fam.tiers[tier]) {
      tier += 1;
      advanced = true;
      unlocks.push({
        family: fam.key,
        familyName: fam.name,
        icon: fam.icon,
        tier,
        target: fam.tiers[tier - 1],
        unit: fam.unit,
      });
    }

    if (advanced) {
      await client.query(
        `UPDATE user_badges
            SET current_tier = $3,
                progress     = $4,
                unlocked_at  = NOW(),
                updated_at   = NOW()
          WHERE user_id = $1 AND badge_key = $2`,
        [userId, fam.key, tier, lifetime],
      );
    } else {
      // Always update progress so the UI reflects the latest count even
      // when no tier flipped.
      await client.query(
        `UPDATE user_badges
            SET progress = $3, updated_at = NOW()
          WHERE user_id = $1 AND badge_key = $2`,
        [userId, fam.key, lifetime],
      );
    }
  }
  return unlocks;
}

// ---- Personal records -------------------------------------------------

/**
 * Update any personal records that may have been beaten by this event.
 * Returns a list of records that increased (oldValue → newValue).
 *
 * Records tracked:
 *   - best-day-mc:        max MC earned in a single calendar day
 *   - best-week-mc:       max MC earned in a single ISO week
 *   - longest-streak:     all-time longest streak (mirrors user_progress)
 *   - best-perfect-week:  max Perfect Days in a single ISO week (max 7)
 *
 * Day + week buckets are derived from engagement_events SUM queries
 * inside the same transaction. Cheap given the per-user volume and the
 * (user_id, created_at) index.
 */
async function applyRecordChecks(client, userId, before, after, today, mcAwarded) {
  const changes = [];

  // Longest streak — directly mirrors user_progress.
  if (after.longest_streak > before.longest_streak) {
    const rec = await bumpRecord(client, userId, 'longest-streak', before.longest_streak, after.longest_streak, today);
    if (rec) changes.push(rec);
  }

  // Best-day MC: only relevant when MC was actually awarded this event.
  // Compute today's running MC total from the event log.
  if (mcAwarded > 0) {
    const dayMC = await sumMCForBucket(client, userId, 'day', today);
    const rec = await maybeUpdateMaxRecord(client, userId, 'best-day-mc', dayMC, today);
    if (rec) changes.push(rec);

    const isoWeek = isoWeekOf(today);
    const weekMC = await sumMCForBucket(client, userId, 'week', isoWeek);
    const recW = await maybeUpdateMaxRecord(client, userId, 'best-week-mc', weekMC, today);
    if (recW) changes.push(recW);
  }

  // Best Perfect Week — count Perfect Days in current ISO week.
  if (after.perfect_days > before.perfect_days) {
    const isoWeek = isoWeekOf(today);
    const perfectThisWeek = await countPerfectDaysThisWeek(client, userId, isoWeek);
    const rec = await maybeUpdateMaxRecord(client, userId, 'best-perfect-week', perfectThisWeek, today);
    if (rec) changes.push(rec);
  }

  return changes;
}

/** Sum MC awarded to a user across all events in a given day or ISO week.
 *  Re-derived from engagement_events.event_data->>'mcAwarded' which is
 *  not currently stored — so we use a coarser proxy: count today's events
 *  and reconstruct MC from event_type. Cleaner approach: store mcAwarded
 *  in event_data going forward. We do exactly that — recordEvent writes
 *  the final MC amount into the audit row.
 *
 *  bucket = 'day' (YYYY-MM-DD) or 'week' (YYYY-Www).
 */
async function sumMCForBucket(client, userId, bucket, key) {
  if (bucket === 'day') {
    const { rows } = await client.query(
      `SELECT COALESCE(SUM((event_data->>'mcAwarded')::int), 0)::int AS total
         FROM engagement_events
        WHERE user_id = $1
          AND (created_at AT TIME ZONE 'America/New_York')::date = $2::date`,
      [userId, key],
    );
    return rows[0].total;
  }
  // 'week' — match by ISO week label. Postgres has to_char with 'IYYY-"W"IW'.
  const { rows } = await client.query(
    `SELECT COALESCE(SUM((event_data->>'mcAwarded')::int), 0)::int AS total
       FROM engagement_events
      WHERE user_id = $1
        AND to_char((created_at AT TIME ZONE 'America/New_York')::date, 'IYYY"-W"IW') = $2`,
    [userId, key],
  );
  return rows[0].total;
}

/** Count Perfect Days landed in a given ISO week. Drived from
 *  engagement_events where event_data.perfectDay = true. */
async function countPerfectDaysThisWeek(client, userId, isoWeek) {
  const { rows } = await client.query(
    `SELECT COUNT(DISTINCT (created_at AT TIME ZONE 'America/New_York')::date)::int AS n
       FROM engagement_events
      WHERE user_id = $1
        AND event_type = 'game-completed'
        AND (event_data->>'perfectDay')::boolean = true
        AND to_char((created_at AT TIME ZONE 'America/New_York')::date, 'IYYY"-W"IW') = $2`,
    [userId, isoWeek],
  );
  return rows[0].n;
}

async function maybeUpdateMaxRecord(client, userId, key, newValue, today) {
  const { rows } = await client.query(
    `SELECT value FROM personal_records
      WHERE user_id = $1 AND record_key = $2 FOR UPDATE`,
    [userId, key],
  );
  const oldValue = rows[0]?.value || 0;
  if (newValue <= oldValue) return null;
  await client.query(
    `UPDATE personal_records
        SET value = $3, achieved_at = $4, updated_at = NOW()
      WHERE user_id = $1 AND record_key = $2`,
    [userId, key, newValue, today],
  );
  const meta = PERSONAL_RECORDS.find(r => r.key === key);
  return { key, name: meta?.name || key, oldValue, newValue };
}

async function bumpRecord(client, userId, key, oldValue, newValue, today) {
  await client.query(
    `UPDATE personal_records
        SET value = $3, achieved_at = $4, updated_at = NOW()
      WHERE user_id = $1 AND record_key = $2`,
    [userId, key, newValue, today],
  );
  const meta = PERSONAL_RECORDS.find(r => r.key === key);
  return { key, name: meta?.name || key, oldValue, newValue };
}
