// scripts/test-engagement.js
//
// Phase 11 smoke test — exercises the server-side engagement engine
// end-to-end against the live Neon database. Creates a throwaway user,
// fires every event type through every interesting code branch, asserts
// the resulting state, then runs the deletion scrub and verifies all
// four engagement tables come back empty for that user.
//
// Usage:
//   node scripts/test-engagement.js
//
// Exit code 0 = all checks pass. Non-zero = one or more assertion failed
// (the failure detail is printed before exit).
//
// Safe to run against production Neon: every row this script creates is
// keyed to a fresh test user that gets fully deleted at the end of the
// run (even on failure — finally{} block).

import dotenv from 'dotenv';
dotenv.config({ override: true });

import { query, getClient } from '../src/db.js';
import { ensureProgress, getProgress, recordEvent } from '../src/engagement.js';
import { storage } from '../src/storage.js';
import { RANKS, BADGE_FAMILIES } from '../src/progression.js';

// ---- Helpers ----------------------------------------------------------

let testUserId = null;
let failures = 0;

function ok(label, cond, detail) {
  if (cond) {
    console.log(`  ✅ ${label}`);
  } else {
    failures += 1;
    console.error(`  ❌ ${label}` + (detail ? `\n     ${detail}` : ''));
  }
}

function eq(label, actual, expected) {
  const pass = actual === expected;
  ok(label, pass, pass ? '' : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function todayNY() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function addDays(yyyymmdd, n) {
  const d = new Date(yyyymmdd + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function createTestUser() {
  const tag = `engagement-test-${Date.now()}@example.invalid`;
  const username = `etest_${Date.now().toString(36)}`;
  const { rows } = await query(
    `INSERT INTO users (parent_email, kid_first_name, kid_age, is_active, email_verified, username, password_hash)
     VALUES ($1, 'TestKid', 12, TRUE, TRUE, $2, 'not-a-real-hash')
     RETURNING id`,
    [tag, username],
  );
  return { id: rows[0].id, parent_email: tag };
}

/** Hard-delete a test user — bypasses the soft-delete path so we don't
 *  leave audit rows in deletion_requests pointing at the test email. */
async function hardDeleteUser(userId) {
  await query(`DELETE FROM engagement_events WHERE user_id = $1`, [userId]);
  await query(`DELETE FROM user_badges       WHERE user_id = $1`, [userId]);
  await query(`DELETE FROM personal_records  WHERE user_id = $1`, [userId]);
  await query(`DELETE FROM user_progress     WHERE user_id = $1`, [userId]);
  await query(`DELETE FROM users             WHERE id      = $1`, [userId]);
}

/** Forcibly set state so we can test edge cases (rank thresholds, streak
 *  values just below a milestone, etc.) without having to drive them with
 *  100 events. */
async function setProgress(userId, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const setClauses = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = keys.map(k => fields[k]);
  await query(
    `UPDATE user_progress SET ${setClauses}, updated_at = NOW() WHERE user_id = $1`,
    [userId, ...values],
  );
}

// ---- Test cases -------------------------------------------------------

async function main() {
  console.log('\n📊 Phase 11 engagement smoke test\n');

  // -------- Setup ------------------------------------------------------
  const u = await createTestUser();
  testUserId = u.id;
  console.log(`[setup] created test user ${u.id}\n`);

  // -------- Section 1: ensureProgress is idempotent --------------------
  console.log('Section 1 — ensureProgress idempotency');
  await ensureProgress(u.id);
  await ensureProgress(u.id);          // should be a no-op
  const state1 = await getProgress(u.id);
  eq('starts at 0 MC',          state1.progress.marketCoins, 0);
  eq('starts at Rookie',        state1.progress.rank.key,    'rookie');
  eq('starts at 0 streak',      state1.progress.currentStreak, 0);
  eq('6 badge families seeded', Object.keys(state1.badges).length, 6);
  eq('4 personal records seeded', Object.keys(state1.records).length, 4);

  // -------- Section 2: a single game completion ------------------------
  // Regression: a daily-visit BEFORE the first game must not suppress the
  // streak bonus on that game. The streak signal lives on last_streak_date,
  // not last_active_date. (Caught in Checkpoint 2 browser verification —
  // daily-visit fires on every /digest load and was overwriting the wrong
  // field.)
  console.log('\nSection 2 — single correct game-completed event');
  await recordEvent(u.id, 'daily-visit', { digestDate: todayNY() });
  const r2 = await recordEvent(u.id, 'game-completed', {
    game: 'bull-bear', correct: true, digestDate: todayNY(),
  });
  // 25 (correct) + streakBonus(1) = 25 + 2 = 27
  eq('25 MC + streak bonus 2',        r2.mcAwarded, 27);
  eq('newTotal = 27',                 r2.newTotal,  27);
  eq('streak = 1',                    r2.streakUpdate.current, 1);
  eq('longest = 1',                   r2.streakUpdate.longest, 1);
  eq('no rank-up yet',                r2.rankUp, null);
  // daily-visit already took consistency tier 1; this game-completed event
  // shouldn't unlock anything new (1-day streak < 3-day tier-1 threshold).
  eq('no new badge unlocks',           r2.badgeUnlocks.length, 0);
  ok('new record: best-day-mc',       r2.newRecords.some(r => r.key === 'best-day-mc' && r.newValue === 27));
  ok('new record: longest-streak',    r2.newRecords.some(r => r.key === 'longest-streak' && r.newValue === 1));
  ok('nextRank pointer present',      !!r2.nextMilestones.nextRank);
  eq('nextRank is Market Watcher',    r2.nextMilestones.nextRank.key, 'market-watcher');
  eq('remaining = 50 - 27 = 23',      r2.nextMilestones.nextRank.remaining, 23);

  // -------- Section 3: rank-up + multi-tier badge unlock ---------------
  console.log('\nSection 3 — rank-up to Market Watcher via game 2');
  const r3 = await recordEvent(u.id, 'game-completed', {
    game: 'price-is-right', correct: true, digestDate: todayNY(),
  });
  // Same-day second game: 25 + 0 streak bonus (already counted today)
  eq('25 MC, no second streak bonus', r3.mcAwarded, 25);
  eq('newTotal = 52',                 r3.newTotal,  52);
  eq('streak stays at 1',             r3.streakUpdate.current, 1);
  ok('rank-up to Market Watcher',
     r3.rankUp && r3.rankUp.newRank.key === 'market-watcher',
     `got ${JSON.stringify(r3.rankUp)}`);
  ok('rank-up message present',       r3.rankUp.unlocksMessage.includes('Personal Records'));

  // -------- Section 4: Perfect Day (3rd unique game today) -------------
  console.log('\nSection 4 — Perfect Day on 3rd game');
  const r4 = await recordEvent(u.id, 'game-completed', {
    game: 'quiz', correct: false, digestDate: todayNY(),
  });
  // 15 (participation) + 25 (Perfect Day bonus) = 40
  eq('15 participation + 25 Perfect Day', r4.mcAwarded, 40);
  ok('Perfect Day flag in audit (state)', await hasPerfectDay(u.id), 'expected perfect_days >= 1');

  // -------- Section 5: word-learned + sunday-challenge -----------------
  console.log('\nSection 5 — word-learned + sunday-challenge');
  const r5a = await recordEvent(u.id, 'word-learned', {});
  eq('word-learned awards 5 MC', r5a.mcAwarded, 5);

  const r5b = await recordEvent(u.id, 'sunday-challenge-completed', {
    type: 'trading-floor', digestDate: todayNY(), bonus: true,
  });
  eq('sunday + bonus = 75 MC',         r5b.mcAwarded, 75);
  const s5 = await getProgress(u.id);
  eq('sunday_challenges = 1',          s5.progress.sundayChallenges, 1);
  eq('words_learned = 1',              s5.progress.wordsLearned, 1);

  // -------- Section 6: streak advancement across days ------------------
  console.log('\nSection 6 — streak advancement, longest_streak record');
  // Reset to a 5-day streak ending yesterday so we can test "consecutive
  // = 6" cleanly without driving 6 real game events.
  const yesterday = addDays(todayNY(), -1);
  await setProgress(u.id, {
    current_streak: 5,
    longest_streak: 5,
    last_active_date: yesterday,
    last_streak_date: yesterday,
  });
  const r6 = await recordEvent(u.id, 'game-completed', {
    game: 'match', correct: true, digestDate: todayNY(),
  });
  eq('streak advances 5 → 6',          r6.streakUpdate.current, 6);
  eq('longest follows to 6',           r6.streakUpdate.longest, 6);
  // 25 correct + streakBonus(6)=12 = 37
  eq('25 + streakBonus(6)=12 = 37 MC', r6.mcAwarded, 37);

  // -------- Section 7: shield earned at day 7 (rank-gated) -------------
  console.log('\nSection 7 — shield awarded on 7-day streak boundary');
  // Reset to day-6 streak ending yesterday. Current MC after section 6
  // already puts the kid past Stock Scout (150), so the shield should
  // actually award.
  await setProgress(u.id, {
    current_streak: 6,
    longest_streak: 6,
    streak_shields: 0,
    last_active_date: yesterday,
    last_streak_date: yesterday,
  });
  // Make sure rank reflects current MC (the setProgress shortcut doesn't
  // recompute rank).
  await syncRank(u.id);
  const r7 = await recordEvent(u.id, 'game-completed', {
    game: 'time-machine', correct: true, digestDate: todayNY(),
  });
  eq('streak hits 7',                   r7.streakUpdate.current, 7);
  ok('shieldAwarded flag set',          r7.streakUpdate.shieldAwarded === true,
     `got streakUpdate=${JSON.stringify(r7.streakUpdate)}`);
  eq('shieldsRemaining = 1',            r7.streakUpdate.shieldsRemaining, 1);

  // -------- Section 8: shield CONSUMED on a missed day -----------------
  console.log('\nSection 8 — shield consumes on 1-day gap');
  // Move last_streak_date back by 2 days to simulate the kid missing
  // yesterday but returning today.
  const twoDaysAgo = addDays(todayNY(), -2);
  await setProgress(u.id, {
    current_streak: 7,
    longest_streak: 7,
    streak_shields: 1,
    last_active_date: twoDaysAgo,
    last_streak_date: twoDaysAgo,
  });
  await syncRank(u.id);
  const r8 = await recordEvent(u.id, 'game-completed', {
    game: 'compound', correct: false, digestDate: todayNY(),
  });
  ok('shieldUsed=true',                 r8.streakUpdate.shieldUsed === true,
     `got streakUpdate=${JSON.stringify(r8.streakUpdate)}`);
  eq('streak preserved (7 → 8)',        r8.streakUpdate.current, 8);
  eq('shieldsRemaining = 0',            r8.streakUpdate.shieldsRemaining, 0);

  // -------- Section 9: streak RESETS on 3-day gap with no shield -------
  console.log('\nSection 9 — streak resets with no shield, 3-day gap');
  const threeDaysAgo = addDays(todayNY(), -3);
  await setProgress(u.id, {
    current_streak: 10,
    longest_streak: 10,
    streak_shields: 0,
    last_active_date: threeDaysAgo,
    last_streak_date: threeDaysAgo,
  });
  await syncRank(u.id);
  const r9 = await recordEvent(u.id, 'game-completed', {
    game: 'bull-bear', correct: true, digestDate: todayNY(),
  });
  eq('streak resets to 1',              r9.streakUpdate.current, 1);
  eq('longest preserved at 10',         r9.streakUpdate.longest, 10);

  // -------- Section 10: unknown event type rejected --------------------
  console.log('\nSection 10 — unknown event type rejected');
  let rejected = false;
  try {
    await recordEvent(u.id, 'definitely-not-real', {});
  } catch (err) {
    rejected = err.code === 'UNKNOWN_EVENT_TYPE';
  }
  ok('throws UNKNOWN_EVENT_TYPE', rejected);

  // -------- Section 11: PII deletion scrub clears engagement tables ----
  console.log('\nSection 11 — deletion scrub clears all 4 tables');
  // Use the real storage.recordDeletionRequest path so we test the
  // production code path, not just hard-delete.
  await storage.recordDeletionRequest({
    parent_email: u.parent_email,
    reason: 'smoke test',
    requested_ip: null,
    user_agent: 'smoke',
  });
  const after = await countEngagementRows(u.id);
  eq('user_progress rows = 0',     after.progress, 0);
  eq('engagement_events rows = 0', after.events,   0);
  eq('user_badges rows = 0',       after.badges,   0);
  eq('personal_records rows = 0',  after.records,  0);
  // Don't null testUserId — the finally{} block still needs to drop the
  // (now soft-deleted) users row + the deletion_requests audit row.
}

async function hasPerfectDay(userId) {
  const { rows } = await query(
    `SELECT perfect_days FROM user_progress WHERE user_id = $1`,
    [userId],
  );
  return (rows[0]?.perfect_days || 0) >= 1;
}

/** Re-derive rank_key from market_coins. Tiny helper used by tests that
 *  set MC artificially via setProgress. */
async function syncRank(userId) {
  const { rows } = await query(
    `SELECT market_coins FROM user_progress WHERE user_id = $1`,
    [userId],
  );
  const mc = rows[0]?.market_coins || 0;
  let key = 'rookie';
  for (const r of RANKS) {
    if (mc >= r.threshold) key = r.key;
  }
  await query(
    `UPDATE user_progress SET rank_key = $2 WHERE user_id = $1`,
    [userId, key],
  );
}

async function countEngagementRows(userId) {
  const p = await query(`SELECT COUNT(*)::int AS n FROM user_progress     WHERE user_id = $1`, [userId]);
  const e = await query(`SELECT COUNT(*)::int AS n FROM engagement_events WHERE user_id = $1`, [userId]);
  const b = await query(`SELECT COUNT(*)::int AS n FROM user_badges       WHERE user_id = $1`, [userId]);
  const r = await query(`SELECT COUNT(*)::int AS n FROM personal_records  WHERE user_id = $1`, [userId]);
  return { progress: p.rows[0].n, events: e.rows[0].n, badges: b.rows[0].n, records: r.rows[0].n };
}

// ---- Entry point ------------------------------------------------------

main()
  .then(() => {
    console.log(`\n${'='.repeat(50)}`);
    if (failures > 0) {
      console.error(`❌ ${failures} assertion(s) failed.`);
      process.exit(1);
    }
    console.log(`✅ All checks passed.`);
    process.exit(0);
  })
  .catch(err => {
    console.error('\nFATAL:', err);
    process.exit(2);
  })
  .finally(async () => {
    // Belt-and-suspenders cleanup. If the test ran far enough to scrub,
    // testUserId is null and this is a no-op. If it crashed earlier,
    // this removes the user + the deletion_requests audit row + the
    // engagement rows.
    if (testUserId) {
      try {
        await query(`DELETE FROM deletion_requests WHERE matched_user_id = $1`, [testUserId]);
        await query(`DELETE FROM engagement_events WHERE user_id = $1`, [testUserId]);
        await query(`DELETE FROM user_badges       WHERE user_id = $1`, [testUserId]);
        await query(`DELETE FROM personal_records  WHERE user_id = $1`, [testUserId]);
        await query(`DELETE FROM user_progress     WHERE user_id = $1`, [testUserId]);
        await query(`DELETE FROM users             WHERE id      = $1`, [testUserId]);
      } catch (e) {
        console.error('[cleanup] failed:', e.message);
      }
    }
  });
