// src/push.js — Phase 15: Web Push notifications (kid-facing trigger).
//
// Two pushes, both timezone-aware, both ledger-gated through push_log:
//
//   morning      — fires at each user's 7 AM LOCAL via an hourly sweep
//                  (same pattern as the Phase 12 evening recap), gated on
//                  today's digest row existing. NOT sent at generation
//                  time: a 7 AM ET blast would buzz west-coast kids at
//                  4 AM, which violates the habit-not-compulsion rule.
//   streak-risk  — rides the evening recap sweep's nudge fork (7 PM local,
//                  streak ≥ 3, no engagement today). See server.js.
//
// The ledger (push_log) is written BEFORE the send: the unique index on
// (user_id, kind, digest_date) makes every sweep idempotent — a restart
// mid-loop or a manual re-trigger can never double-push. On a transient
// send failure (anything other than a 404/410 "subscription gone") the
// just-inserted row is deleted so the failure doesn't consume that kid's
// daily slot. Hard cap: 2 pushes per kid per NY day, enforced in SQL.
//
// VAPID config is read lazily at call time (NOT import time) — same
// macOS-launchd gotcha as src/ai.js / src/db.js. All three env vars unset
// = push is inert: every entry point no-ops cleanly.

import webpush from 'web-push';
import { query } from './db.js';
import { todayNY, getDigestForDate } from './digest-store.js';

// ---- VAPID config (lazy) ------------------------------------------------

let vapidState = null; // null = not attempted; true/false = configured?

function ensureVapid() {
  if (vapidState !== null) return vapidState;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    console.warn('[push] VAPID keys not set — push notifications are inert.');
    vapidState = false;
    return vapidState;
  }
  try {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:hello@themarketjuice.com',
      pub,
      priv,
    );
    vapidState = true;
  } catch (err) {
    console.error('[push] VAPID setup failed — push disabled:', err.message);
    vapidState = false;
  }
  return vapidState;
}

export function isPushConfigured() {
  return ensureVapid();
}

export function getVapidPublicKey() {
  return ensureVapid() ? process.env.VAPID_PUBLIC_KEY : null;
}

// ---- Copy builders (pure — exported for the smoke test) ------------------

/**
 * Morning push copy, edition- and vibe-aware. Factual, no guilt, ever.
 *
 * Interim copy notes (approved deviations from the roadmap spec):
 *  - week-ahead says "see what's coming" until Phase 17 ships Tomorrow's
 *    Call ("make your picks" would reference a feature that doesn't exist).
 *  - weekly-wrap says "see how your week went" until Phase 20 ships the
 *    "Your Week in Juice" card. TODOs live in ROADMAP.md Phases 17 + 20.
 */
export function buildMorningPush(content) {
  const edition = content?.editionType || 'standard';
  let title;
  if (edition === 'weekly-wrap') {
    title = '📋 Weekly Wrap is ready — see how your week went';
  } else if (edition === 'week-ahead') {
    title = "🔮 New week — see what's coming";
  } else {
    const vibe = content?.marketVibe;
    if (vibe === 'green')      title = "🟢 Green day — today's Juice is ready";
    else if (vibe === 'red')   title = '🔴 Red day — see what happened';
    else                       title = "🟡 Mixed day — today's Juice is ready";
  }
  const body = truncate(content?.vibeSummary, 120) || "Open today's digest to play.";
  return { title, body, url: '/digest', tag: 'mj-morning' };
}

/** Streak-at-risk push. Copy is factual, no guilt (roadmap principle 1). */
export function buildStreakRiskPush(streak) {
  return {
    title: `Your ${streak}-day streak ends at midnight`,
    body: '3 minutes saves it.',
    url: '/digest',
    tag: 'mj-streak',
  };
}

function truncate(s, max) {
  if (typeof s !== 'string') return '';
  const t = s.trim();
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + '…';
}

// ---- push_log ledger ------------------------------------------------------

/**
 * Reserve a send slot for (user, kind, day). Inserts the ledger row BEFORE
 * the send so sweeps are idempotent. One statement enforces both gates:
 *  - the 2/day hard cap (the COUNT guard), and
 *  - the per-kind dedup (ON CONFLICT on the unique index).
 * Returns the new row id, or null when the slot is denied (dup or cap).
 */
export async function tryLogPush(userId, kind, digestDate) {
  const { rows } = await query(
    `INSERT INTO push_log (user_id, kind, digest_date)
     SELECT $1, $2, $3::date
      WHERE (SELECT COUNT(*) FROM push_log
              WHERE user_id = $1 AND digest_date = $3::date) < 2
     ON CONFLICT (user_id, kind, digest_date) DO NOTHING
     RETURNING id`,
    [userId, kind, digestDate],
  );
  return rows[0]?.id ?? null;
}

/** Release a reserved slot after a transient send failure. */
export async function deletePushLog(id) {
  await query(`DELETE FROM push_log WHERE id = $1`, [id]);
}

// ---- Sending --------------------------------------------------------------

/**
 * Deliver one push. `opts.send` is injectable for the smoke test (defaults
 * to webpush.sendNotification).
 *
 * Returns { ok:true } | { ok:false, gone:true } | { ok:false, error }.
 * A 404/410 from the push service means the subscription is dead
 * (uninstalled PWA, revoked permission) — we clear users.push_subscription
 * so the kid drops out of future sweeps. That's the "unsubscribing kid
 * receives nothing" path.
 */
export async function sendPushToUser(user, payload, opts = {}) {
  const send = opts.send || ((sub, body) => webpush.sendNotification(sub, body));
  try {
    await send(user.push_subscription, JSON.stringify(payload));
    return { ok: true };
  } catch (err) {
    const status = err?.statusCode;
    if (status === 404 || status === 410) {
      try {
        await query(
          `UPDATE users SET push_subscription = NULL, updated_at = NOW() WHERE id = $1`,
          [user.id],
        );
      } catch (e) {
        console.error(`[push] failed to clear dead subscription userId=${user.id}:`, e.message);
      }
      return { ok: false, gone: true };
    }
    return { ok: false, error: err?.message || String(err) };
  }
}

// ---- Morning sweep ---------------------------------------------------------

/**
 * Hourly sweep: push to every subscribed kid whose LOCAL hour is 7 AM,
 * gated on today's (NY) digest row existing. Runs at minute 5 so the
 * 7 AM ET tick never races the 7:00 generation cron. push_log makes
 * re-runs (and the POST /api/cron/send-push test trigger) idempotent.
 *
 * Known edge (documented, accepted at prelaunch scale): kids whose 7 AM
 * local lands before the 7 AM ET generation (e.g. Europe) find no digest
 * row for the new NY day and are skipped that day.
 */
export async function sendMorningPushes(opts = {}) {
  const started_at = new Date().toISOString();
  if (!ensureVapid()) {
    return { ok: true, status: 'unconfigured', sent: 0, skipped: 0, failed: 0, total: 0, started_at, finished_at: new Date().toISOString() };
  }

  const digestDate = todayNY();
  let content;
  try {
    const row = await getDigestForDate(digestDate);
    content = row?.content || null;
  } catch (err) {
    console.error('[push] morning digest lookup failed:', err.message);
    return { ok: false, status: 'db_error', sent: 0, skipped: 0, failed: 0, total: 0, started_at, finished_at: new Date().toISOString(), error: err.message };
  }
  if (!content) {
    return { ok: true, status: 'no_content', sent: 0, skipped: 0, failed: 0, total: 0, started_at, finished_at: new Date().toISOString() };
  }

  let users;
  try {
    const result = await query(`
      SELECT id, push_subscription
        FROM users
       WHERE is_active = TRUE
         AND deleted_at IS NULL
         AND push_subscription IS NOT NULL
         AND EXTRACT(HOUR FROM NOW() AT TIME ZONE COALESCE(timezone, 'America/New_York')) = 7
    `);
    users = result.rows;
  } catch (err) {
    console.error('[push] morning user query failed:', err.message);
    return { ok: false, status: 'db_error', sent: 0, skipped: 0, failed: 0, total: 0, started_at, finished_at: new Date().toISOString(), error: err.message };
  }

  if (users.length === 0) {
    return { ok: true, status: 'ok', sent: 0, skipped: 0, failed: 0, total: 0, started_at, finished_at: new Date().toISOString() };
  }

  const payload = buildMorningPush(content);
  let sent = 0, skipped = 0, failed = 0;
  for (const u of users) {
    try {
      const logId = await tryLogPush(u.id, 'morning', digestDate);
      if (!logId) { skipped++; continue; } // already pushed today / cap
      const res = await sendPushToUser(u, payload, opts);
      if (res.ok) {
        sent++;
      } else if (res.gone) {
        failed++; // subscription dead + cleared; keep the ledger row (nothing to retry)
      } else {
        failed++;
        await deletePushLog(logId); // transient failure — give the slot back
        console.error(`[push] morning send failed userId=${u.id}: ${res.error}`);
      }
    } catch (err) {
      failed++;
      console.error(`[push] morning push threw userId=${u.id}:`, err.message);
    }
  }

  const finished_at = new Date().toISOString();
  if (sent || failed) {
    console.log(`[push] morning sweep done · sent=${sent} skipped=${skipped} failed=${failed} total=${users.length}`);
  }
  return { ok: true, status: 'ok', sent, skipped, failed, total: users.length, started_at, finished_at };
}

// ---- Streak-at-risk (called from the evening recap sweep) ------------------

/**
 * One streak-at-risk push, gated. The caller (sendEveningRecaps) has
 * already established the spec's first two gates — streak ≥ 3 AND no
 * engagement today (that's exactly its nudge fork) — so this adds the
 * third (no push of this kind today) plus the 2/day cap via tryLogPush.
 */
export async function sendStreakRiskPush(user, streak, digestDate, opts = {}) {
  if (!ensureVapid() || !user.push_subscription) return { skipped: true };
  const logId = await tryLogPush(user.id, 'streak-risk', digestDate);
  if (!logId) return { skipped: true, reason: 'dedup-or-cap' };
  const res = await sendPushToUser(user, buildStreakRiskPush(streak), opts);
  if (!res.ok && !res.gone) {
    await deletePushLog(logId); // transient failure — give the slot back
    console.error(`[push] streak-risk send failed userId=${user.id}: ${res.error}`);
  }
  return res;
}
