// scripts/test-picks.js
//
// Phase 17 smoke test — Tomorrow's Call.
//
// Pure sections: the blind-pick target matrix (getNextTradingOpen — 7 AM
// vs 9:29 vs 9:31 vs evening, weekends, holiday Mondays), labels, captions.
//
// Live-Neon sections (throwaway users, fully cleaned up): one-bet-per-
// market-close dedup (incl. the Sat+Sun → same-Monday duplicate), the
// 9:29/9:31 race producing two DIFFERENT targets, resolution with injected
// close data (+5/0 MC, idempotent re-runs, flat day → green), the
// best-prediction-streak record, engagement semantics (pick = engaged but
// NOT streak; resolution = MC only, never engagement/streak), card state
// (getPickState), and the COPPA deletion scrub.
//
// Usage: node scripts/test-picks.js

import dotenv from 'dotenv';
dotenv.config({ override: true });

import { query } from '../src/db.js';
import { getNextTradingOpen } from '../src/calendar.js';
import {
  createPick,
  getPickState,
  resolvePicksForDate,
  targetLabelFor,
  captionKindFor,
} from '../src/picks.js';
import { recordEvent, getProgress, getDailyEngagementSummary } from '../src/engagement.js';
import { storage } from '../src/storage.js';

// ---- Helpers ----------------------------------------------------------

let failures = 0;
const testUserIds = [];
let lastEmail = null;

function ok(label, cond, detail) {
  if (cond) console.log(`  ✅ ${label}`);
  else { failures += 1; console.error(`  ❌ ${label}` + (detail ? `\n     ${detail}` : '')); }
}

function eq(label, actual, expected) {
  const pass = actual === expected;
  ok(label, pass, pass ? '' : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function createTestUser(tag) {
  lastEmail = `picks-test-${tag}-${Date.now()}@example.invalid`;
  const username = `ptest_${tag}_${Date.now().toString(36)}`;
  const { rows } = await query(
    `INSERT INTO users (parent_email, kid_first_name, kid_age, is_active, email_verified, username, password_hash)
     VALUES ($1, 'TestKid', 12, TRUE, TRUE, $2, 'not-a-real-hash')
     RETURNING id`,
    [lastEmail, username],
  );
  testUserIds.push(rows[0].id);
  return rows[0].id;
}

// June 2026 is EDT (UTC-4): 9:30 AM ET == 13:30Z.
const at = (s) => new Date(s);

async function main() {
  console.log("\n🔮 Phase 17 Tomorrow's Call smoke test\n");

  // -------- Section 1: blind-pick target matrix (pure) --------------------
  console.log('Section 1 — getNextTradingOpen blind-pick matrix');
  eq('Tue 7:00 AM ET → targets Tuesday', getNextTradingOpen(at('2026-06-16T11:00:00Z')), '2026-06-16');
  eq('Tue 9:29 AM ET → still Tuesday', getNextTradingOpen(at('2026-06-16T13:29:00Z')), '2026-06-16');
  eq('Tue 9:31 AM ET → Wednesday (open passed)', getNextTradingOpen(at('2026-06-16T13:31:00Z')), '2026-06-17');
  eq('Tue 8:00 PM ET → Wednesday', getNextTradingOpen(at('2026-06-17T00:00:00Z')), '2026-06-17');
  eq('Sat → Monday', getNextTradingOpen(at('2026-06-13T18:00:00Z')), '2026-06-15');
  eq('Sun → Monday', getNextTradingOpen(at('2026-06-14T18:00:00Z')), '2026-06-15');
  eq('Sat before Labor Day → Tuesday (holiday Monday)', getNextTradingOpen(at('2026-09-05T18:00:00Z')), '2026-09-08');

  // -------- Section 2: labels + captions (pure) ----------------------------
  console.log('\nSection 2 — target labels + captions');
  eq('target == today → "today"', targetLabelFor('2026-06-16', '2026-06-16'), 'today');
  eq('future target → weekday name', targetLabelFor('2026-06-15', '2026-06-13'), 'on Monday');
  eq('pre-open caption kind', captionKindFor('2026-06-16', '2026-06-16', true), 'pre-open');
  eq('post-open caption kind (trading day, future target)', captionKindFor('2026-06-17', '2026-06-16', true), 'post-open');
  eq('closed caption kind (weekend)', captionKindFor('2026-06-15', '2026-06-13', false), 'closed');

  // -------- Section 3: one bet per market close (live Neon) ----------------
  console.log('\nSection 3 — pick dedup: one bet per market close');
  const u1 = await createTestUser('u1');
  const SAT = at('2026-06-13T18:00:00Z'); // both target Monday 2026-06-15
  const SUN = at('2026-06-14T18:00:00Z');

  const satPick = await createPick(u1, '2026-06-13', 'green', SAT);
  eq('Saturday pick inserted, targets Monday', satPick.inserted && satPick.targetDate, '2026-06-15');
  const sunPick = await createPick(u1, '2026-06-14', 'red', SUN);
  eq('Sunday pick after Saturday pick → duplicate (same Monday close)', sunPick.inserted, false);
  eq('duplicate response still names the target', sunPick.targetDate, '2026-06-15');

  // 9:29 vs 9:31 race: same kid legitimately holds TWO bets — Tuesday's
  // close (made pre-open) and Wednesday's (made post-open). Distinct
  // targets, both insert.
  const preOpen = await createPick(u1, '2026-06-16', 'green', at('2026-06-16T13:29:00Z'));
  eq('9:29 AM pick targets Tuesday', preOpen.inserted && preOpen.targetDate, '2026-06-16');
  const postOpen = await createPick(u1, '2026-06-16', 'red', at('2026-06-16T13:31:00Z'));
  eq('9:31 AM pick targets Wednesday (server recomputes — race resolved)', postOpen.inserted && postOpen.targetDate, '2026-06-17');
  const postOpenDup = await createPick(u1, '2026-06-16', 'green', at('2026-06-16T15:00:00Z'));
  eq('second post-open pick same day → duplicate (Wednesday already bet)', postOpenDup.inserted, false);

  // -------- Section 4: resolution (injected close data) ---------------------
  console.log('\nSection 4 — resolution: +5/0 MC, idempotent, flat day');
  const u2 = await createTestUser('u2'); // green caller
  const u3 = await createTestUser('u3'); // red caller
  const T1 = '2031-04-01';
  await query(
    `INSERT INTO user_picks (user_id, kind, digest_date, target_date, pick)
     VALUES ($1, 'tomorrow-call', '2031-03-31', $2::date, '{"choice":"green"}'),
            ($3, 'tomorrow-call', '2031-03-31', $2::date, '{"choice":"red"}')`,
    [u2, T1, u3],
  );
  const r1 = await resolvePicksForDate(T1, 1.75, '2031-04-02');
  eq('both picks resolved', r1.resolved, 2);
  eq('one correct (green caller)', r1.correct, 1);
  eq('+5 MC awarded total', r1.mcAwarded, 5);
  const r1again = await resolvePicksForDate(T1, 1.75, '2031-04-02');
  eq('re-run resolves nothing (atomic claim)', r1again.resolved, 0);

  const p2 = await getProgress(u2);
  eq('correct caller has exactly +5 MC (no streak bonus)', p2.progress.marketCoins, 5);
  eq('resolution does NOT extend the streak', p2.progress.currentStreak, 0);
  eq('resolution does NOT bump games_played', p2.progress.gamesPlayed, 0);
  const sum2 = await getDailyEngagementSummary(u2, '2031-04-02');
  eq('resolution does NOT count as engaged (server-initiated)', sum2.engaged, false);
  ok('…but the +5 shows in that day\'s MC total (recap beat)', sum2.totalMC === 5);

  const p3 = await getProgress(u3);
  eq('incorrect caller gets 0 MC', p3.progress.marketCoins, 0);

  // Flat day (exactly 0.00%) resolves green — approved decision.
  const T2 = '2031-04-02';
  await query(
    `INSERT INTO user_picks (user_id, kind, digest_date, target_date, pick)
     VALUES ($1, 'tomorrow-call', '2031-04-01', $2::date, '{"choice":"green"}')`,
    [u2, T2],
  );
  const rFlat = await resolvePicksForDate(T2, 0, '2031-04-03');
  eq('flat day: green caller is correct', rFlat.correct, 1);

  // best-prediction-streak record: u2 is now 2 correct in a row.
  const { rows: recRows } = await query(
    `SELECT value FROM personal_records WHERE user_id = $1 AND record_key = 'best-prediction-streak'`,
    [u2],
  );
  eq('best-prediction-streak record = 2', recRows[0]?.value, 2);

  // -------- Section 5: pick = engaged but NOT streak ------------------------
  console.log('\nSection 5 — prediction-made semantics');
  const u4 = await createTestUser('u4');
  const D = '2031-05-05';
  const made = await recordEvent(u4, 'prediction-made', { digestDate: D, choice: 'green', targetDate: '2031-05-06' });
  eq('prediction-made awards 0 MC', made.mcAwarded, 0);
  const madeDup = await recordEvent(u4, 'prediction-made', { digestDate: D, choice: 'red', targetDate: '2031-05-06' });
  eq('same targetDate → duplicate event', madeDup.duplicate, true);
  const p4 = await getProgress(u4);
  eq('pick does NOT extend the streak', p4.progress.currentStreak, 0);
  const sum4 = await getDailyEngagementSummary(u4, D);
  eq('pick DOES count as engaged (no nudge email that evening)', sum4.engaged, true);

  // -------- Section 6: getPickState (card data) ------------------------------
  console.log('\nSection 6 — getPickState card payload');
  const u5 = await createTestUser('u5');
  // Saturday render: no pick yet.
  const sat = at('2026-06-13T18:00:00Z');
  let state = await getPickState(u5, '2026-06-13', sat);
  eq('no pick yet → currentPick null', state.currentPick, null);
  eq('weekend target is Monday', state.targetDate, '2026-06-15');
  eq('weekend label', state.targetLabel, 'on Monday');
  eq('weekend caption kind', state.caption, 'closed');
  ok('no record before any resolution', state.record === null);

  await createPick(u5, '2026-06-13', 'green', sat);
  state = await getPickState(u5, '2026-06-13', sat);
  eq('after picking → currentPick green', state.currentPick, 'green');
  // Sunday render shows Saturday's Monday-bet as locked (no 409 surprise).
  state = await getPickState(u5, '2026-06-14', at('2026-06-14T18:00:00Z'));
  eq("Sunday's card shows Saturday's Monday-bet as locked", state.currentPick, 'green');

  // Verdict: resolved pick targeting the last trading day before a Tuesday
  // render (Monday 2026-06-15), seeded directly.
  await query(
    `UPDATE user_picks SET resolved_at = NOW(),
            outcome = '{"correct":true,"actual":"green","changePct":1.2}'::jsonb
      WHERE user_id = $1 AND target_date = '2026-06-15'`,
    [u5],
  );
  state = await getPickState(u5, '2026-06-16', at('2026-06-16T11:00:00Z'));
  ok('Tuesday render shows the Monday verdict', state.verdict && state.verdict.correct === true);
  eq('record now 1 of 1', state.record && `${state.record.correct} of ${state.record.total}`, '1 of 1');
  eq('Tuesday pre-open caption', state.caption, 'pre-open');
  eq('Tuesday pre-open label is "today"', state.targetLabel, 'today');

  // -------- Section 7: COPPA deletion scrub ----------------------------------
  console.log('\nSection 7 — deletion scrub covers user_picks');
  const { rows: before } = await query(`SELECT COUNT(*)::int AS n FROM user_picks WHERE user_id = $1`, [u5]);
  ok('user has pick rows before scrub', before[0].n > 0);
  await storage.recordDeletionRequest({ parent_email: lastEmail, reason: 'phase 17 smoke test', userId: u5 });
  const { rows: after } = await query(`SELECT COUNT(*)::int AS n FROM user_picks WHERE user_id = $1`, [u5]);
  eq('user_picks emptied by scrub', after[0].n, 0);

  console.log('');
  if (failures === 0) console.log("🎉 All Tomorrow's Call smoke-test assertions passed.\n");
  else console.error(`💥 ${failures} assertion(s) FAILED.\n`);
}

main()
  .catch((err) => {
    failures += 1;
    console.error('\n💥 Test run threw:', err);
  })
  .finally(async () => {
    try {
      for (const id of testUserIds) {
        await query(`DELETE FROM user_picks         WHERE user_id = $1`, [id]);
        await query(`DELETE FROM engagement_events  WHERE user_id = $1`, [id]);
        await query(`DELETE FROM user_badges        WHERE user_id = $1`, [id]);
        await query(`DELETE FROM personal_records   WHERE user_id = $1`, [id]);
        await query(`DELETE FROM user_progress      WHERE user_id = $1`, [id]);
        await query(`DELETE FROM deletion_requests  WHERE matched_user_id = $1`, [id]);
        await query(`DELETE FROM users              WHERE id = $1`, [id]);
      }
      console.log(`[cleanup] removed ${testUserIds.length} test user(s) + all rows`);
    } catch (e) {
      console.error('[cleanup] failed — manual cleanup may be needed:', e.message);
    }
    process.exit(failures === 0 ? 0 : 1);
  });
