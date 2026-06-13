// src/push.js — Phase 15: Web Push notifications (kid-facing trigger).
//
// Two pushes, both timezone-aware, both ledger-gated through push_log:
//
//   morning      — fires in each user's 7–9 AM LOCAL window via an hourly
//                  sweep (same pattern as the Phase 12 evening recap),
//                  gated on today's digest row existing + no morning push
//                  logged yet. NOT sent at generation time: a 7 AM ET
//                  blast would buzz west-coast kids at 4 AM, which
//                  violates the habit-not-compulsion rule. The 8/9 AM
//                  ticks are catch-up for late generations (Phase 18's
//                  retry ladder makes those routine).
//   streak-risk  — rides the evening recap sweep's loop (7 PM local).
//                  Phase 17 decoupled its gate from the email's "engaged"
//                  fork: streak ≥ 3 AND no streak-EXTENDING play today
//                  (shouldSendStreakRiskPush below). See server.js.
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
 * Copy notes:
 *  - week-ahead says "make your picks" (the roadmap-spec copy — unlocked by
 *    Phase 17's Tomorrow's Call; was interim "see what's coming" before).
 *  - weekly-wrap says "Your Week in Juice is ready" (Phase 20 shipped the
 *    Sunday stats card this copy references).
 */
export function buildMorningPush(content) {
  const edition = content?.editionType || 'standard';
  let title;
  if (edition === 'weekly-wrap') {
    title = '📋 Your Week in Juice is ready — see your stats';
  } else if (edition === 'week-ahead') {
    title = "🔮 New week — make your picks";
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
 * Hourly sweep: push to every subscribed kid whose LOCAL hour is in the
 * 7–9 AM window AND who hasn't had a morning push today, gated on today's
 * (NY) digest row existing. Runs at minute 5 so the 7 AM ET tick never
 * races the 7:00 generation cron.
 *
 * The window is 7–9 (not == 7) as a catch-up: if generation finishes
 * after a kid's 7:05 local tick — which the Phase 18 retry ladder
 * (7:10/7:25) will make routine — the 8:05 or 9:05 tick still delivers.
 * The NOT EXISTS ledger check (+ tryLogPush's unique index) guarantees
 * exactly one morning push per kid per day, so later ticks never
 * double-send. After 9 AM local the digest day is just missed (no
 * mid-morning buzz hours later).
 *
 * push_log makes re-runs (and the POST /api/cron/send-push test trigger)
 * idempotent.
 *
 * Known edge (documented, accepted at prelaunch scale): kids whose whole
 * 7–9 AM local window lands before the 7 AM ET generation (e.g. Europe)
 * find no digest row for the new NY day and are skipped that day.
 *
 * opts.onlyUserId — smoke-test scoping: restricts the sweep to one user
 * so the test can exercise the real gate SQL against the live DB without
 * touching (or consuming the daily slot of) any real subscriber.
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
    // Gate: local hour 7–9 AND no morning push logged today AND (checked
    // above) today's digest exists. The NOT EXISTS keeps already-pushed
    // kids out of the candidate set entirely, so the 8:05/9:05 catch-up
    // ticks only ever pick up kids the earlier ticks missed.
    const params = [digestDate];
    let scope = '';
    if (opts.onlyUserId) {
      params.push(opts.onlyUserId);
      scope = 'AND u.id = $2';
    }
    const result = await query(`
      SELECT u.id, u.push_subscription
        FROM users u
       WHERE u.is_active = TRUE
         AND u.deleted_at IS NULL
         AND u.push_subscription IS NOT NULL
         AND EXTRACT(HOUR FROM NOW() AT TIME ZONE COALESCE(u.timezone, 'America/New_York')) BETWEEN 7 AND 9
         AND NOT EXISTS (
               SELECT 1 FROM push_log pl
                WHERE pl.user_id = u.id
                  AND pl.kind = 'morning'
                  AND pl.digest_date = $1::date
             )
         ${scope}
    `, params);
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
 * Phase 17 changed the streak-at-risk gate: it is DECOUPLED from the
 * evening email's "engaged" flag. A kid who only tapped a Tomorrow's Call
 * pick counts as engaged (no nudge email) but their streak still dies at
 * midnight — the push must still fire. The gate is therefore:
 *
 *   streak >= 3  AND  no streak-EXTENDING event today (game or Mystery
 *   Mover — i.e. lastStreakDate !== today)
 *
 * …independent of engagement, plus sendStreakRiskPush's own ledger gates
 * (no push of this kind today + the 2/day cap). Pure — exported for the
 * smoke test; the evening sweep in server.js is the caller.
 */
export function shouldSendStreakRiskPush({ currentStreak, lastStreakDate, today }) {
  if (!Number.isFinite(currentStreak) || currentStreak < 3) return false;
  return lastStreakDate !== today; // streak already safe today → no push
}

/**
 * One streak-at-risk push. The caller (sendEveningRecaps) gates on
 * shouldSendStreakRiskPush above (streak ≥ 3 AND streak not yet extended
 * today — independent of the email's "engaged" fork as of Phase 17); this
 * adds the no-push-of-this-kind-today gate plus the 2/day cap via
 * tryLogPush.
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
