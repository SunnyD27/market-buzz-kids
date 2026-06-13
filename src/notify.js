/**
 * src/notify.js — Telegram ops alerts for the 7 AM morning run.
 *
 * Detection backstop for the digest-generation failures (truncated JSON,
 * stale-disk teaser, trailing prose after JSON). The cron correctly SKIPS the
 * teaser fan-out when generation fails — but that correct behavior is silent,
 * so from the outside a failure looks identical to a quiet success (no email).
 * This makes the silence loud: a ❌ on any failed morning, a ✅ on a clean one.
 *
 * Reuses the same Telegram bot + chat as the `railway-health-check` scheduled
 * task. Token + chat id come from env (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID);
 * chat id defaults to the known ops chat so only the token must be set. When the
 * token is absent the sender is a no-op (logged), so this is inert until the
 * env var is configured in Railway — it never blocks generation either way.
 */

// Default to the same ops chat the railway-health-check task uses, so setting
// just TELEGRAM_BOT_TOKEN in Railway is enough to start receiving alerts.
const DEFAULT_CHAT_ID = '8618800483';

/**
 * Fire-and-forget Telegram send. NEVER throws — every failure (missing token,
 * network error, non-200) is swallowed and logged. Returns a small status
 * object for tests/callers that care. Plain-text (no parse_mode) on purpose:
 * error messages and JSON snippets contain characters that would break
 * Markdown/HTML parsing.
 */
export async function sendTelegram(text) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID || DEFAULT_CHAT_ID;
    if (!token) {
      console.warn('[notify] TELEGRAM_BOT_TOKEN not set — skipping alert (inert until configured).');
      return { ok: false, skipped: true };
    }
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[notify] Telegram send failed: HTTP ${res.status} ${body.slice(0, 200)}`);
      return { ok: false, status: res.status };
    }
    return { ok: true };
  } catch (err) {
    // Must never crash the cron — log and move on.
    console.error('[notify] Telegram send threw (non-fatal):', err?.message || err);
    return { ok: false, error: err?.message || String(err) };
  }
}

function truncate(s, n) {
  s = String(s == null ? '' : s);
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/**
 * ❌ Failure alert. Defensive — never throws on missing fields. `error` may be
 * an Error (we read .message and the enriched .parsePosition / .parseSnippet a
 * JSON parse failure carries) or a plain string.
 */
export function buildFailureAlert({ date, edition, stage, error } = {}) {
  let msg, pos = null, snippet = '';
  try {
    if (error && typeof error === 'object') {
      msg = error.message != null ? String(error.message) : String(error);
      if (Number.isFinite(error.parsePosition)) pos = error.parsePosition;
      if (error.parseSnippet) snippet = String(error.parseSnippet).replace(/\s+/g, ' ').trim();
    } else {
      msg = error != null ? String(error) : 'unknown error';
    }
  } catch {
    msg = 'unknown error';
  }

  const lines = [
    '❌ Market Juice — morning digest FAILED',
    '',
    `Date: ${date || 'unknown'} (${edition || 'unknown'})`,
    `Stage: ${stage || 'generation'}`,
    `Error: ${truncate(msg, 400)}`,
  ];
  if (pos != null) lines.push(`Parse position: ${pos}`);
  if (snippet) lines.push(`Near: …${truncate(snippet, 130)}…`);
  // Phase 18b — zod validation failures carry the per-field error list
  // (set by ai.js after the repair retry also fails). Cap the list so a
  // pathological digest doesn't blow past Telegram's message limit.
  try {
    if (Array.isArray(error?.validationErrors) && error.validationErrors.length) {
      lines.push('Validation errors:');
      for (const v of error.validationErrors.slice(0, 8)) lines.push(`  - ${truncate(v, 120)}`);
      if (error.validationErrors.length > 8) lines.push(`  …and ${error.validationErrors.length - 8} more`);
    }
  } catch { /* defensive — alert building must never throw */ }
  lines.push('', '⚠️ Teasers were NOT sent.');
  return lines.join('\n');
}

/**
 * ✅ Success ping. One line. Counts come from the sendDailyTeasers result
 * (sent / total parents / kids / failed). Defensive on missing numbers.
 */
export function buildSuccessPing({ date, edition, sent, failed, total, kids, attempt, maxAttempts } = {}) {
  const n = v => (Number.isFinite(v) ? v : 0);
  let line = `✅ Market Juice — ${date || 'unknown'} (${edition || 'unknown'}) generated · ${n(sent)}/${n(total)} teasers sent`;
  if (Number.isFinite(kids)) line += ` to ${kids} kids`;
  if (n(failed) > 0) line += ` · ${n(failed)} FAILED`;
  // Phase 18c — note which retry-ladder attempt produced the digest.
  // Quiet on a clean first try; loud when a retry saved the morning.
  if (Number.isFinite(attempt) && attempt > 1) {
    line += ` · ⚠️ needed attempt ${attempt}/${Number.isFinite(maxAttempts) ? maxAttempts : 3}`;
  }
  return line;
}
