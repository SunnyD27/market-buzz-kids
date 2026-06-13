// src/morning-run.js — Phase 18c: the 7 AM pipeline with the retry ladder.
//
// Attempts generation at 7:00 → on failure retries at 7:10 → 7:25 → only
// then sends the Telegram ❌ (listing every attempt's error). The teaser
// fan-out runs EXACTLY ONCE, after the first successful attempt, and the
// ✅ ping notes which attempt succeeded.
//
// Why a single handler with in-process delays instead of three cron
// entries: generateDigest is idempotent, but the teaser fan-out has NO
// per-recipient ledger — a second cron entry firing after a 7:00 success
// would re-run the fan-out and double-email every parent. One handler =
// one fan-out = exactly one ✅/❌ per morning.
//
// Trade-off (accepted): in-process timers die if the container restarts
// mid-window. The boot bootstrap calls generateDigest() on every boot, so
// a restart IS a generation retry — only the alert/fan-out sequencing of
// that corner is lost.
//
// Scope: retries cover the GENERATION stage only. A fan-out failure after
// successful generation alerts immediately (re-triggerable via
// POST /api/cron/send-digest) — blindly retrying it without a send ledger
// risks double-sends.
//
// Phase 15/17 interplay (by design, no changes needed here):
//  - resolveTomorrowCalls runs at the top of every generateDigest call —
//    attempt 1 resolves; attempts 2/3 are idempotent no-ops (atomic
//    resolved_at claims), so picks resolve on every retry/replay path.
//  - the morning-push sweep's 7–9 AM local catch-up window was built for
//    exactly this ladder: a 7:25 success rides the 8:05 push tick.
//
// All collaborators are injectable so the smoke test drives the ladder
// offline (fake generate/fanOut/alert/sleep).

import { generateDigest } from './generate.js';
import { sendTelegram, buildFailureAlert, buildSuccessPing } from './notify.js';

// 7:00 → +10 min (7:10) → +15 min (7:25), per the ROADMAP 18c spec.
export const RETRY_DELAYS_MS = [10 * 60_000, 15 * 60_000];

const defaultSleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Run the full morning pipeline. Returns a summary object (for tests and
 * the cron log); never throws — every failure path ends in an alert.
 *
 * deps: { date, edition, fanOut } required in production;
 *       { generate, alert, sleep, delays, successPing } injectable.
 */
export async function runMorningPipeline(deps = {}) {
  const {
    date = 'unknown',
    edition = 'unknown',
    fanOut,
    generate = generateDigest,
    alert = sendTelegram,
    sleep = defaultSleep,
    delays = RETRY_DELAYS_MS,
    successPing = process.env.ALERT_SUCCESS_PING !== 'false',
  } = deps;

  // safeAlert: a notification failure must never take down the pipeline.
  const safeAlert = async (buildMessage) => {
    try { await alert(buildMessage()); }
    catch (e) { console.error('[morning-run] alert send failed (non-fatal):', e?.message || e); }
  };

  const maxAttempts = delays.length + 1;
  const errors = [];
  let generated = false;
  let attempt = 0;

  for (let i = 0; i < maxAttempts; i++) {
    attempt = i + 1;
    try {
      await generate();
      generated = true;
      console.log(`[morning-run] generation succeeded on attempt ${attempt}/${maxAttempts}.`);
      break;
    } catch (err) {
      errors.push(err);
      console.error(`[morning-run] generation attempt ${attempt}/${maxAttempts} failed:`, err?.message || err);
      if (i < delays.length) {
        console.log(`[morning-run] retrying in ${Math.round(delays[i] / 60_000)} min…`);
        await sleep(delays[i]);
      }
    }
  }

  if (!generated) {
    // One ❌ for the whole morning, after ALL attempts — listing each
    // attempt's error so the 7:00 root cause isn't hidden by the 7:25 one.
    const last = errors[errors.length - 1];
    const attemptLines = errors.map((e, i) => `attempt ${i + 1}: ${e?.message || e}`).join('\n');
    const combined = new Error(attemptLines);
    if (last?.validationErrors) combined.validationErrors = last.validationErrors;
    if (Number.isFinite(last?.parsePosition)) combined.parsePosition = last.parsePosition;
    if (last?.parseSnippet) combined.parseSnippet = last.parseSnippet;
    await safeAlert(() => buildFailureAlert({
      date, edition, stage: `generation (all ${maxAttempts} attempts failed)`, error: combined,
    }));
    return { generated: false, attempts: attempt, errors };
  }

  // Fan-out — exactly once, after the first success.
  let fanout = null;
  try {
    fanout = await fanOut();
    if (fanout?.ok) {
      console.log(`[morning-run] fan-out done · sent=${fanout.sent} failed=${fanout.failed} total=${fanout.total}`);
      if (successPing) {
        await safeAlert(() => buildSuccessPing({
          date, edition,
          sent: fanout.sent, failed: fanout.failed, total: fanout.total, kids: fanout.kids,
          attempt, maxAttempts,
        }));
      }
    } else {
      console.error(`[morning-run] fan-out failed (${fanout?.status}): ${fanout?.error}`);
      await safeAlert(() => buildFailureAlert({
        date, edition, stage: 'teaser fan-out',
        error: fanout?.error || `fan-out status: ${fanout?.status}`,
      }));
    }
  } catch (err) {
    console.error('[morning-run] fan-out threw:', err?.message || err);
    await safeAlert(() => buildFailureAlert({ date, edition, stage: 'teaser fan-out', error: err }));
  }

  return { generated: true, attempts: attempt, fanout };
}
