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
} from '../src/push.js';
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
  eq('weekly-wrap title (interim copy until Phase 20)', wrap.title, '📋 Weekly Wrap is ready — see how your week went');

  const ahead = buildMorningPush({ editionType: 'week-ahead' });
  eq('week-ahead title (interim copy until Phase 17)', ahead.title, "🔮 New week — see what's coming");

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

  // -------- Section 6: activeDays (push-permission ask gate) ---------------
  console.log('\nSection 6 — activeDays in engagement state');
  await recordEvent(testUserId, 'daily-visit', { digestDate: '2030-02-01' });
  await recordEvent(testUserId, 'daily-visit', { digestDate: '2030-02-02' });
  await recordEvent(testUserId, 'daily-visit', { digestDate: '2030-02-03' });
  await recordEvent(testUserId, 'daily-visit', { digestDate: '2030-02-03' }); // same-day repeat
  const state = await getProgress(testUserId);
  eq('activeDays counts distinct days only', state.progress.activeDays, 3);

  // -------- Section 7: COPPA deletion scrub --------------------------------
  console.log('\nSection 7 — COPPA deletion scrub covers push_log + push_subscription');
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
    // deletion_requests audit row from Section 7, so prod tables stay clean.
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
