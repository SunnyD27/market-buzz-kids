// scripts/test-weekly.js
//
// Phase 20 smoke test — Weekly Hold + "Your Week in Juice".
//
// Pure sections: candidate selection (deterministic, no consecutive
// overlap), finalize (canned fallback), week boundaries (holiday-Monday +
// Good-Friday edges).
//
// Live-Neon sections (throwaway users, fully cleaned up): pick dedup
// (one per week via the target_date UNIQUE), the blind-pick gate,
// resolution with injected returns (+20 beats-both / +5 otherwise, all 3
// returns stored, win flag), engagement semantics (pick = engaged-not-
// streak, resolved = MC-only), getWeeklyHoldState phases incl. the
// no-pick-kid graceful null, getWeekStats incl. the mid-week / 0-of-0
// guard, and the COPPA scrub (user_picks already covered, re-verified).
//
// Usage: node scripts/test-weekly.js

import dotenv from 'dotenv';
dotenv.config({ override: true });

import { query } from '../src/db.js';
import {
  getFirstTradingDayOfWeek, getLastTradingDayOfWeek, isWeeklyHoldOpen,
} from '../src/calendar.js';
import { pickWeeklyHoldCandidates, finalizeWeeklyHold } from '../src/weekly.js';
import {
  createWeeklyHoldPick, getWeeklyHoldState, resolveWeeklyHoldsForTarget,
} from '../src/picks.js';
import { recordEvent, getProgress, getDailyEngagementSummary, getWeekStats } from '../src/engagement.js';
import { storage } from '../src/storage.js';

let failures = 0;
const testUserIds = [];
let lastEmail = null;

function ok(label, cond, detail) {
  if (cond) console.log(`  ✅ ${label}`);
  else { failures += 1; console.error(`  ❌ ${label}` + (detail ? `\n     ${detail}` : '')); }
}
function eq(label, a, e) { ok(label, a === e, a === e ? '' : `expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`); }

async function createTestUser(tag) {
  lastEmail = `weekly-test-${tag}-${Date.now()}@example.invalid`;
  const username = `wtest_${tag}_${Date.now().toString(36)}`;
  const { rows } = await query(
    `INSERT INTO users (parent_email, kid_first_name, kid_age, is_active, email_verified, username, password_hash)
     VALUES ($1, 'TestKid', 12, TRUE, TRUE, $2, 'not-a-real-hash') RETURNING id`,
    [lastEmail, username],
  );
  testUserIds.push(rows[0].id);
  return rows[0].id;
}
const at = (s) => new Date(s);

async function main() {
  console.log('\n📅 Phase 20 Weekly Hold + Your Week in Juice smoke test\n');

  // -------- Section 1: candidate selection (pure) --------------------------
  console.log('Section 1 — candidate selection');
  const a = pickWeeklyHoldCandidates('2026-06-15');
  const b = pickWeeklyHoldCandidates('2026-06-22');
  eq('3 candidates', a.length, 3);
  ok('deterministic', JSON.stringify(pickWeeklyHoldCandidates('2026-06-15')) === JSON.stringify(a));
  ok('no overlap between consecutive weeks', !a.some(x => b.some(y => y.ticker === x.ticker)));
  ok('Sunday resolves to its ISO week (same as Monday)',
    JSON.stringify(pickWeeklyHoldCandidates('2026-06-21').map(c => c.ticker)) === JSON.stringify(a.map(c => c.ticker)));

  // -------- Section 2: finalize (canned fallback) --------------------------
  console.log('\nSection 2 — finalizeWeeklyHold');
  const cands = [{ ticker: 'NKE', name: 'Nike' }, { ticker: 'NFLX', name: 'Netflix' }, { ticker: 'MCD', name: "McDonald's" }];
  const fin = finalizeWeeklyHold({ cases: { NKE: 'Sneaker season is heating up.', NFLX: '   ' } }, cands);
  eq('3 finalized', fin.candidates.length, 3);
  eq('AI case used', fin.candidates[0].case, 'Sneaker season is heating up.');
  ok('blank case → canned fallback', fin.candidates[1].case.includes('Netflix'));
  ok('missing case → canned fallback', fin.candidates[2].case.includes("McDonald's"));
  ok('missing raw entirely → all canned', finalizeWeeklyHold(null, cands).candidates.every(c => c.case.length > 0));

  // -------- Section 3: week boundaries (pure, the risky seam) --------------
  console.log('\nSection 3 — week boundaries (holiday edges)');
  eq('holiday-Monday week → first = Tuesday', getFirstTradingDayOfWeek('2026-05-25'), '2026-05-26');
  eq('holiday-Monday week → last = Friday', getLastTradingDayOfWeek('2026-05-25'), '2026-05-29');
  eq('Good-Friday week → last = Thursday', getLastTradingDayOfWeek('2027-03-22'), '2027-03-25');
  eq('Juneteenth-Friday week → last = Thursday', getLastTradingDayOfWeek('2026-06-15'), '2026-06-18');
  eq('plain week → Mon..Fri', getFirstTradingDayOfWeek('2026-06-08') + '..' + getLastTradingDayOfWeek('2026-06-08'), '2026-06-08..2026-06-12');
  ok('blind-pick gate open Mon 7am', isWeeklyHoldOpen(at('2026-06-15T11:00:00Z')));
  ok('blind-pick gate closed Mon 9:31am', !isWeeklyHoldOpen(at('2026-06-15T13:31:00Z')));

  // -------- Section 4: pick dedup + gate (live) ----------------------------
  console.log('\nSection 4 — pick: one per week, blind-pick gate');
  const u1 = await createTestUser('u1');
  const MON = at('2026-06-15T11:00:00Z'); // pre-open Monday → open
  const p1 = await createWeeklyHoldPick(u1, '2026-06-15', 'NKE', cands, MON);
  eq('pick inserted, target = week last trading day', p1.inserted && p1.targetDate, '2026-06-18');
  const p1dup = await createWeeklyHoldPick(u1, '2026-06-15', 'NFLX', cands, MON);
  eq('second pick same week → duplicate', p1dup.inserted, false);
  const pBad = await createWeeklyHoldPick(u1, '2026-06-15', 'ZZZZ', cands, MON);
  ok('off-list ticker rejected', pBad.invalid === true && pBad.inserted === false);
  const pClosed = await createWeeklyHoldPick(u1, '2026-06-15', 'MCD', cands, at('2026-06-15T13:31:00Z'));
  ok('after the open → window closed, no insert', pClosed.open === false && pClosed.inserted === false);

  // -------- Section 5: engagement (pick = engaged, not streak) -------------
  console.log('\nSection 5 — weekly-hold-pick semantics');
  const u2 = await createTestUser('u2');
  const made = await recordEvent(u2, 'weekly-hold-pick', { digestDate: '2031-05-05', chosen: 'NKE', targetDate: '2031-05-09' });
  eq('pick awards 0 MC', made.mcAwarded, 0);
  const madeDup = await recordEvent(u2, 'weekly-hold-pick', { digestDate: '2031-05-05', chosen: 'MCD', targetDate: '2031-05-09' });
  eq('same-week pick → duplicate event', madeDup.duplicate, true);
  const prog2 = await getProgress(u2);
  eq('pick does NOT extend streak', prog2.progress.currentStreak, 0);
  const sum2 = await getDailyEngagementSummary(u2, '2031-05-05');
  eq('pick DOES count as engaged', sum2.engaged, true);

  // -------- Section 6: resolution (+20 / +5, all returns, win flag) --------
  console.log('\nSection 6 — resolution: beats-both vs participation');
  const u3 = await createTestUser('u3'); // winner
  const u4 = await createTestUser('u4'); // participant
  // Target must equal getLastTradingDayOfWeek(verdictDigest) so getWeeklyHoldState
  // (Section 7) finds the resolved row by the same week key.
  const verdictDigest = '2031-06-07';                    // Saturday
  const T = getLastTradingDayOfWeek(verdictDigest);      // that week's last trading day
  await query(
    `INSERT INTO user_picks (user_id, kind, digest_date, target_date, pick)
     VALUES ($1, 'weekly-hold', '2031-06-01', $3::date, '{"chosen":"NKE","candidates":["NKE","NFLX","MCD"]}'),
            ($2, 'weekly-hold', '2031-06-01', $3::date, '{"chosen":"MCD","candidates":["NKE","NFLX","MCD"]}')`,
    [u3, u4, T],
  );
  const returns = { NKE: 4.2, NFLX: 1.1, MCD: -0.8 };
  const r = await resolveWeeklyHoldsForTarget(T, returns, '2031-06-06');
  eq('both resolved', r.resolved, 2);
  eq('one win (NKE beat both)', r.won, 1);
  eq('MC = 20 (winner) + 5 (participant)', r.mcAwarded, 25);
  const again = await resolveWeeklyHoldsForTarget(T, returns, '2031-06-06');
  eq('re-run resolves nothing (atomic claim)', again.resolved, 0);
  const p3 = await getProgress(u3); const p4 = await getProgress(u4);
  eq('winner has +20 MC', p3.progress.marketCoins, 20);
  eq('participant has +5 MC', p4.progress.marketCoins, 5);
  eq('resolution does NOT extend streak', p3.progress.currentStreak, 0);
  const sum3 = await getDailyEngagementSummary(u3, '2031-06-06');
  eq('resolution does NOT count as engaged', sum3.engaged, false);
  // outcome stores all 3 returns + names + win.
  const { rows: outRows } = await query(`SELECT outcome FROM user_picks WHERE user_id = $1`, [u3]);
  const o = outRows[0].outcome;
  eq('outcome has all 3 returns', o.returns.length, 3);
  ok('outcome carries display names', o.returns.every(x => typeof x.name === 'string'));
  eq('winner outcome.win = true', o.win, true);

  // -------- Section 7: getWeeklyHoldState phases (live) --------------------
  console.log('\nSection 7 — getWeeklyHoldState phases');
  // Verdict (u3, resolved). digestDate in the same ISO week as target T.
  const verdictState = await getWeeklyHoldState(u3, verdictDigest, { editionType: 'standard' }, at(verdictDigest + 'T16:00:00Z'));
  eq('resolved → verdict phase', verdictState?.phase, 'verdict');
  ok('verdict carries win + 3 returns', verdictState.verdict.win === true && verdictState.verdict.returns.length === 3);
  // No-pick kid → graceful null (no error).
  const u5 = await createTestUser('u5');
  const noneState = await getWeeklyHoldState(u5, verdictDigest, { editionType: 'standard' }, at(verdictDigest + 'T16:00:00Z'));
  eq('kid who never picked → null (no card, no error)', noneState, null);
  // Pick UI on week-ahead with candidates + open window.
  const content = { editionType: 'week-ahead', weeklyHold: { candidates: cands } };
  const pickState = await getWeeklyHoldState(u5, '2026-06-15', content, at('2026-06-15T11:00:00Z'));
  eq('week-ahead + open → pick phase', pickState?.phase, 'pick');
  const closedState = await getWeeklyHoldState(u5, '2026-06-15', content, at('2026-06-15T13:31:00Z'));
  eq('week-ahead + past open → closed phase', closedState?.phase, 'closed');

  // -------- Section 8: getWeekStats (mid-week / 0-of-0 guard) --------------
  console.log('\nSection 8 — getWeekStats');
  const u6 = await createTestUser('u6');
  // getWeekStats windows engagement_events by created_at (real time, like
  // the Phase 11 sumMCForBucket helper) — so the events portion must use a
  // REAL current-week digestDate. The records/picks portions use logical
  // dates (target_date/achieved_at), unaffected.
  const { rows: nowRow } = await query(`SELECT TO_CHAR(NOW() AT TIME ZONE 'America/New_York','YYYY-MM-DD') AS d`);
  const realToday = nowRow[0].d;
  // Fresh kid, no activity → all zeros, prediction record null (no 0-of-0).
  const ws0 = await getWeekStats(u6, realToday);
  eq('fresh kid: MC 0', ws0.mcThisWeek, 0);
  eq('fresh kid: games 0/0', `${ws0.gamesWon}/${ws0.gamesPlayed}`, '0/0');
  eq('fresh kid: predictionRecord null (no 0-of-0)', ws0.predictionRecord, null);
  ok('fresh kid: rank present', !!ws0.rank);
  await recordEvent(u6, 'game-completed', { game: 'quiz', correct: true, digestDate: realToday });
  await recordEvent(u6, 'game-completed', { game: 'match', correct: false, digestDate: realToday });
  const ws1 = await getWeekStats(u6, realToday);
  eq('after 2 games: games 1/2', `${ws1.gamesWon}/${ws1.gamesPlayed}`, '1/2');
  ok('after games: MC > 0', ws1.mcThisWeek > 0);

  // -------- Section 9: COPPA scrub covers weekly-hold rows -----------------
  console.log('\nSection 9 — deletion scrub covers user_picks (weekly-hold)');
  const before = (await query(`SELECT COUNT(*)::int AS n FROM user_picks WHERE user_id = $1`, [u3])).rows[0].n;
  ok('winner has a weekly-hold row before scrub', before > 0);
  const realEmail = (await query(`SELECT parent_email FROM users WHERE id = $1`, [u3])).rows[0]?.parent_email;
  await storage.recordDeletionRequest({ parent_email: realEmail, reason: 'phase 20 smoke', userId: u3 });
  const after = (await query(`SELECT COUNT(*)::int AS n FROM user_picks WHERE user_id = $1`, [u3])).rows[0].n;
  eq('weekly-hold rows emptied by scrub', after, 0);

  console.log('');
  if (failures === 0) console.log('🎉 All Weekly Hold smoke-test assertions passed.\n');
  else console.error(`💥 ${failures} assertion(s) FAILED.\n`);
}

main()
  .catch((err) => { failures += 1; console.error('\n💥 Test run threw:', err); })
  .finally(async () => {
    try {
      for (const id of testUserIds) {
        await query(`DELETE FROM user_picks WHERE user_id = $1`, [id]);
        await query(`DELETE FROM engagement_events WHERE user_id = $1`, [id]);
        await query(`DELETE FROM user_badges WHERE user_id = $1`, [id]);
        await query(`DELETE FROM personal_records WHERE user_id = $1`, [id]);
        await query(`DELETE FROM user_progress WHERE user_id = $1`, [id]);
        await query(`DELETE FROM deletion_requests WHERE matched_user_id = $1`, [id]);
        await query(`DELETE FROM users WHERE id = $1`, [id]);
      }
      console.log(`[cleanup] removed ${testUserIds.length} test user(s) + all rows`);
    } catch (e) { console.error('[cleanup] failed:', e.message); }
    process.exit(failures === 0 ? 0 : 1);
  });
