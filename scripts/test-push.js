// scripts/test-push.js
//
// Phase 15 smoke test — push notifications.
//
// Pure sections (no DB): the edition/vibe-aware copy builders.
// DB sections (live Neon, same pattern as test-engagement.js): the
// push_log ledger (per-kind dedup, 2/day cap, transient-failure slot
// release), the dead-subscription cleanup, the streak-risk send path
// (with an injected fake sender — no real push service is contacted),
// the activeDays counter, and the COPPA deletion scrub.
//
// Usage:
//   node scripts/test-push.js
//
// Exit code 0 = all checks pass. Safe to run against production Neon:
// every row is keyed to a throwaway test user that is fully deleted at
// the end (finally{} block), including the deletion_requests audit row.

import dotenv from 'dotenv';
dotenv.config({ override: true });

import { query } from '../src/db.js';
import {
  buildMorningPush,
  buildStreakRiskPush,
  tryLogPush,
  deletePushLog,
  sendPushToUser,
  sendStreakRiskPush,
  sendMorningPushes,
  shouldSendStreakRiskPush,
} from '../src/push.js';
import { recordEvent as engagementRecordEvent, getProgress as engagementGetProgress } from '../src/engagement.js';
import { todayNY, getDigestForDate } from '../src/digest-store.js';
import { recordEvent, getProgress } from '../src/engagement.js';
import { storage } from '../src/storage.js';

// ---- Helpers ----------------------------------------------------------

let testUserId = null;
let testEmail = null;
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

const FAKE_SUB = { endpoint: 'https://push.example.invalid/sub/abc', keys: { p256dh: 'x', auth: 'y' } };

async function createTestUser() {
  testEmail = `push-test-${Date.now()}@example.invalid`;
  const username = `ptest_${Date.now().toString(36)}`;
  const { rows } = await query(
    `INSERT INTO users (parent_email, kid_first_name, kid_age, is_active, email_verified, username, password_hash, push_subscription)
     VALUES ($1, 'TestKid', 12, TRUE, TRUE, $2, 'not-a-real-hash', $3)
     RETURNING id`,
    [testEmail, username, JSON.stringify(FAKE_SUB)],
  );
  return rows[0].id;
}

async function pushLogRows(userId) {
  const { rows } = await query(
    `SELECT id, kind, digest_date FROM push_log WHERE user_id = $1 ORDER BY id`,
    [userId],
  );
  return rows;
}

async function getSubscription(userId) {
  const { rows } = await query(`SELECT push_subscription FROM users WHERE id = $1`, [userId]);
  return rows[0]?.push_subscription ?? null;
}

// ---- Test cases -------------------------------------------------------

async function main() {
  console.log('\n🔔 Phase 15 push notification smoke test\n');

  // -------- Section 1: morning copy builder (pure) ----------------------
  console.log('Section 1 — buildMorningPush copy (edition + vibe aware)');
  const green = buildMorningPush({ editionType: 'standard', marketVibe: 'green', vibeSummary: 'Stocks climbed.' });
  eq('green day title', green.title, "🟢 Green day — today's Juice is ready");
  eq('green day body from vibeSummary', green.body, 'Stocks climbed.');
  eq('morning url', green.url, '/digest');
  eq('morning tag', green.tag, 'mj-morning');

  const red = buildMorningPush({ editionType: 'standard', marketVibe: 'red' });
  eq('red day title', red.title, '🔴 Red day — see what happened');
  eq('missing vibeSummary falls back', red.body, "Open today's digest to play.");

  const mixed = buildMorningPush({ editionType: 'standard', marketVibe: 'mixed' });
  eq('mixed day title (vibe not in roadmap spec — added)', mixed.title, "🟡 Mixed day — today's Juice is ready");

  const wrap = buildMorningPush({ editionType: 'weekly-wrap', marketVibe: 'green' });
  eq('weekly-wrap title (spec copy — Phase 20 shipped Your Week in Juice)', wrap.title, '📋 Your Week in Juice is ready — see your stats');

  const ahead = buildMorningPush({ editionType: 'week-ahead' });
  eq('week-ahead title (spec copy — Phase 17 shipped Tomorrow\'s Call)', ahead.title, '🔮 New week — make your picks');

  const longSummary = 'x'.repeat(300);
  ok('body truncated to ~120 chars', buildMorningPush({ editionType: 'standard', marketVibe: 'green', vibeSummary: longSummary }).body.length <= 121);

  // -------- Section 2: streak copy builder (pure) -----------------------
  console.log('\nSection 2 — buildStreakRiskPush copy (factual, no guilt)');
  const streak = buildStreakRiskPush(12);
  eq('streak title', streak.title, 'Your 12-day streak ends at midnight');
  eq('streak body', streak.body, '3 minutes saves it.');
  eq('streak tag distinct from morning', streak.tag, 'mj-streak');
  ok('no guilt words in copy', !/disappoint|sad|😢|miss you/i.test(streak.title + ' ' + streak.body));

  // -------- Setup (DB) ---------------------------------------------------
  testUserId = await createTestUser();
  console.log(`\n[setup] created test user ${testUserId}`);

  const D1 = '2030-01-07'; // far-future synthetic dates — can't collide with real traffic
  const D2 = '2030-01-08';

  // -------- Section 3: push_log ledger -----------------------------------
  console.log('\nSection 3 — push_log ledger (ledger-before-send, dedup, cap)');
  const morning1 = await tryLogPush(testUserId, 'morning', D1);
  ok('first morning slot reserved', morning1 !== null);
  const morning2 = await tryLogPush(testUserId, 'morning', D1);
  eq('second morning same day denied (per-kind dedup)', morning2, null);
  const streak1 = await tryLogPush(testUserId, 'streak-risk', D1);
  ok('streak-risk slot reserved (different kind, same day)', streak1 !== null);
  eq('2/day cap reached', (await pushLogRows(testUserId)).length, 2);
  const streak2 = await tryLogPush(testUserId, 'streak-risk', D1);
  eq('third push same day denied', streak2, null);

  const morningD2 = await tryLogPush(testUserId, 'morning', D2);
  ok('next day starts fresh', morningD2 !== null);

  // Transient-failure slot release: delete the reserved row → slot usable again.
  await deletePushLog(morningD2);
  const morningD2retry = await tryLogPush(testUserId, 'morning', D2);
  ok('released slot can be re-reserved (transient-failure recovery)', morningD2retry !== null);
  await deletePushLog(morningD2retry);
  await deletePushLog(morning1);
  await deletePushLog(streak1);

  // -------- Section 4: sendPushToUser error handling ----------------------
  console.log('\nSection 4 — sendPushToUser (injected fake senders, no real push service)');
  const user = { id: testUserId, push_subscription: FAKE_SUB };

  let delivered = null;
  const okSend = async (sub, body) => { delivered = { sub, body }; };
  const res1 = await sendPushToUser(user, { title: 't', body: 'b', url: '/digest', tag: 'mj-morning' }, { send: okSend });
  eq('successful send returns ok', res1.ok, true);
  ok('payload serialized to the sender', delivered && JSON.parse(delivered.body).title === 't');

  const gone410 = async () => { const e = new Error('gone'); e.statusCode = 410; throw e; };
  const res2 = await sendPushToUser(user, { title: 't' }, { send: gone410 });
  eq('410 reports gone', res2.gone, true);
  eq('410 clears users.push_subscription', await getSubscription(testUserId), null);

  // restore the subscription for the next sections
  await query(`UPDATE users SET push_subscription = $1 WHERE id = $2`, [JSON.stringify(FAKE_SUB), testUserId]);

  const fail500 = async () => { const e = new Error('service hiccup'); e.statusCode = 500; throw e; };
  const res3 = await sendPushToUser(user, { title: 't' }, { send: fail500 });
  eq('transient failure: not ok', res3.ok, false);
  eq('transient failure: not gone', res3.gone, undefined);
  ok('transient failure keeps the subscription', (await getSubscription(testUserId)) !== null);

  // -------- Section 5: sendStreakRiskPush end-to-end ----------------------
  console.log('\nSection 5 — sendStreakRiskPush (gates + ledger integration)');
  let sentPayload = null;
  const recordSend = async (sub, body) => { sentPayload = JSON.parse(body); };
  const freshUser = { id: testUserId, push_subscription: FAKE_SUB };

  const s1 = await sendStreakRiskPush(freshUser, 7, D1, { send: recordSend });
  eq('first streak push sends', s1.ok, true);
  eq('streak count rendered into copy', sentPayload.title, 'Your 7-day streak ends at midnight');
  const s2 = await sendStreakRiskPush(freshUser, 7, D1, { send: recordSend });
  eq('same-day repeat is skipped (push_log dedup)', s2.skipped, true);

  // Transient failure releases the slot → a retry within the same day works.
  const s3 = await sendStreakRiskPush(freshUser, 7, D2, { send: fail500 });
  eq('transient failure: not ok', s3.ok, false);
  const d2rows = (await pushLogRows(testUserId)).filter(r => r.kind === 'streak-risk' && r.digest_date.toISOString().startsWith('2030-01-08'));
  eq('failed send released its ledger row', d2rows.length, 0);
  const s4 = await sendStreakRiskPush(freshUser, 7, D2, { send: recordSend });
  eq('retry after transient failure sends', s4.ok, true);

  const noSub = await sendStreakRiskPush({ id: testUserId, push_subscription: null }, 7, D2, { send: recordSend });
  eq('no subscription → skipped', noSub.skipped, true);

  // -------- Section 5b: streak-at-risk gate decoupled from "engaged" -------
  // Phase 17 changed the gate: streak >= 3 AND no streak-EXTENDING event
  // today (game or Mystery Mover), INDEPENDENT of the engaged flag — a kid
  // who only tapped a Tomorrow's Call pick is engaged (no nudge email) but
  // their streak still dies at midnight, so the push must still fire.
  console.log('\nSection 5b — streak push gate (Phase 17 decoupling)');
  const TODAY = new Date().toISOString().slice(0, 10); // close enough for the pure matrix
  eq('streak 5, nothing played today → push fires',
    shouldSendStreakRiskPush({ currentStreak: 5, lastStreakDate: null, today: TODAY }), true);
  eq('streak 5, game/mystery already today → suppressed',
    shouldSendStreakRiskPush({ currentStreak: 5, lastStreakDate: TODAY, today: TODAY }), false);
  eq('streak 2 → below threshold, no push',
    shouldSendStreakRiskPush({ currentStreak: 2, lastStreakDate: null, today: TODAY }), false);
  eq('streak 3 exactly, not played → push fires',
    shouldSendStreakRiskPush({ currentStreak: 3, lastStreakDate: '2020-01-01', today: TODAY }), true);

  // The requested scenario, live: pick made, NO game played, streak >= 3 →
  // push still fires; then a game is played → push suppressed.
  const { rows: todayNYRow } = await query(`SELECT TO_CHAR(NOW() AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS d`);
  const nyToday = todayNYRow[0].d;
  await query(`UPDATE user_progress SET current_streak = 5 WHERE user_id = $1`, [testUserId])
    .catch(() => {}); // row created below if missing
  await engagementRecordEvent(testUserId, 'prediction-made', { digestDate: nyToday, choice: 'green', targetDate: '2031-03-03' });
  await query(
    `UPDATE user_progress SET current_streak = 5, last_streak_date = NULL WHERE user_id = $1`,
    [testUserId],
  );
  let prog = await engagementGetProgress(testUserId);
  eq('pick counts as engagement-event, not streak (lastStreakDate untouched)',
    prog.progress.lastStreakDate, null);
  eq('LIVE: pick made + no game + streak 5 → push fires', shouldSendStreakRiskPush({
    currentStreak: prog.progress.currentStreak,
    lastStreakDate: prog.progress.lastStreakDate,
    today: nyToday,
  }), true);
  await engagementRecordEvent(testUserId, 'game-completed', { game: 'quiz', correct: true, digestDate: nyToday });
  prog = await engagementGetProgress(testUserId);
  eq('LIVE: game played → streak extended today → push suppressed', shouldSendStreakRiskPush({
    currentStreak: prog.progress.currentStreak,
    lastStreakDate: prog.progress.lastStreakDate,
    today: nyToday,
  }), false);
  // Clean the rows this section created so later sections see a fresh user.
  await query(`DELETE FROM engagement_events WHERE user_id = $1`, [testUserId]);
  await query(`DELETE FROM user_picks WHERE user_id = $1`, [testUserId]);
  await query(`UPDATE user_progress SET current_streak = 0, last_streak_date = NULL, market_coins = 0, games_played = 0, correct_answers = 0 WHERE user_id = $1`, [testUserId]);

  // -------- Section 6: morning sweep 7–9 AM local window -------------------
  // Drives the REAL sweep (live gate SQL) scoped to the test user via
  // opts.onlyUserId, with an injected fake sender — no real push service,
  // no other user's daily slot touched. Local hour is simulated by setting
  // the test user's IANA timezone to an Etc/GMT offset whose current local
  // hour is the one under test.
  console.log('\nSection 6 — morning sweep window (late digest catch-up, no double-send)');
  const todaysDigest = await getDigestForDate(todayNY());
  if (!todaysDigest?.content) {
    failures += 1;
    console.error("  ❌ no daily_digests row for today — run `node src/generate.js` first (the sweep test needs today's digest).");
  } else {
    // Etc/GMT signs are inverted: Etc/GMT-5 == UTC+5. Tiny flake window if
    // the UTC hour rolls over mid-section; acceptable for a smoke test.
    const tzForLocalHour = (h) => {
      let east = (h - new Date().getUTCHours() + 24) % 24;
      if (east > 14) east -= 24; // out of Etc/GMT- range → use a western offset
      return east === 0 ? 'Etc/GMT' : east > 0 ? `Etc/GMT-${east}` : `Etc/GMT+${-east}`;
    };
    const setTz = (h) => query(`UPDATE users SET timezone = $1 WHERE id = $2`, [tzForLocalHour(h), testUserId]);
    const morningRowsToday = async () => (await pushLogRows(testUserId))
      .filter(r => r.kind === 'morning' && r.digest_date.toISOString().slice(0, 10) === todayNY()).length;
    let morningDelivered = 0;
    const countSend = async () => { morningDelivered++; };
    const sweep = () => sendMorningPushes({ onlyUserId: testUserId, send: countSend });

    await setTz(6); // 6:05 local — before the window
    const r6 = await sweep();
    eq('6 AM local: outside window, nothing sent', r6.sent + r6.total, 0);

    await setTz(8); // the requested case: digest landed late, 8:05 tick catches up
    const r8 = await sweep();
    eq('8 AM local: late-digest catch-up delivers', r8.sent, 1);
    eq('payload actually handed to the sender', morningDelivered, 1);
    eq('morning ledger row written', await morningRowsToday(), 1);

    await setTz(9); // 9:05 tick — already pushed, must not double-send
    const r9 = await sweep();
    eq('9 AM local after a send: not even a candidate (NOT EXISTS gate)', r9.total, 0);
    eq('no double-send', morningDelivered, 1);
    eq('still exactly one morning ledger row', await morningRowsToday(), 1);

    await query(`DELETE FROM push_log WHERE user_id = $1 AND kind = 'morning' AND digest_date = $2::date`, [testUserId, todayNY()]);
    await setTz(10); // ledger cleared, but 10 AM local is past the window
    const r10 = await sweep();
    eq('10 AM local: window closed, digest day missed (no mid-morning buzz)', r10.sent + r10.total, 0);

    await query(`UPDATE users SET timezone = NULL WHERE id = $1`, [testUserId]);
  }

  // -------- Section 7: activeDays (push-permission ask gate) ---------------
  console.log('\nSection 7 — activeDays in engagement state');
  await recordEvent(testUserId, 'daily-visit', { digestDate: '2030-02-01' });
  await recordEvent(testUserId, 'daily-visit', { digestDate: '2030-02-02' });
  await recordEvent(testUserId, 'daily-visit', { digestDate: '2030-02-03' });
  await recordEvent(testUserId, 'daily-visit', { digestDate: '2030-02-03' }); // same-day repeat
  const state = await getProgress(testUserId);
  eq('activeDays counts distinct days only', state.progress.activeDays, 3);

  // -------- Section 8: COPPA deletion scrub --------------------------------
  console.log('\nSection 8 — COPPA deletion scrub covers push_log + push_subscription');
  ok('push_log has rows before scrub', (await pushLogRows(testUserId)).length > 0);
  await storage.recordDeletionRequest({
    parent_email: testEmail,
    reason: 'phase 15 smoke test',
    userId: testUserId,
  });
  eq('push_log emptied by scrub', (await pushLogRows(testUserId)).length, 0);
  eq('push_subscription NULLed by scrub', await getSubscription(testUserId), null);

  // -------- Summary --------------------------------------------------------
  console.log('');
  if (failures === 0) {
    console.log('🎉 All push smoke-test assertions passed.\n');
  } else {
    console.error(`💥 ${failures} assertion(s) FAILED.\n`);
  }
}

main()
  .catch((err) => {
    failures += 1;
    console.error('\n💥 Test run threw:', err);
  })
  .finally(async () => {
    // Hard cleanup — remove every row the test created, including the
    // deletion_requests audit row from Section 8, so prod tables stay clean.
    if (testUserId) {
      try {
        await query(`DELETE FROM push_log           WHERE user_id = $1`, [testUserId]);
        await query(`DELETE FROM engagement_events  WHERE user_id = $1`, [testUserId]);
        await query(`DELETE FROM user_badges        WHERE user_id = $1`, [testUserId]);
        await query(`DELETE FROM personal_records   WHERE user_id = $1`, [testUserId]);
        await query(`DELETE FROM user_progress      WHERE user_id = $1`, [testUserId]);
        await query(`DELETE FROM deletion_requests  WHERE matched_user_id = $1`, [testUserId]);
        await query(`DELETE FROM users              WHERE id = $1`, [testUserId]);
        console.log(`[cleanup] removed test user ${testUserId} + all rows`);
      } catch (e) {
        console.error('[cleanup] failed — manual cleanup may be needed:', e.message);
      }
    }
    process.exit(failures === 0 ? 0 : 1);
  });
