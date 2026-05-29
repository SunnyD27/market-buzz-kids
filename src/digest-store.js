/**
 * src/digest-store.js — Postgres-backed daily-digest persistence.
 *
 * Phase 6.7. Source of truth for "today's digest" across all containers
 * and redeploys. The `daily_digests` table stores one row per
 * America/New_York calendar date with the full content payload.
 *
 * Contract:
 *   - todayNY()                 → "YYYY-MM-DD" in America/New_York
 *   - getDigestForDate(date)    → { date, content, generated_at } | null
 *   - getTodaysDigest()         → shortcut for getDigestForDate(todayNY())
 *   - saveDigest(date, content) → INSERTs if absent, NO-OPs if today's
 *                                 row already exists. Returns
 *                                 { inserted: bool, row }. Locked rows
 *                                 are immutable for the rest of the day.
 *
 * Why ON CONFLICT DO NOTHING (not UPSERT): once today's digest is set,
 * we NEVER overwrite it. Different visitors at different times of day
 * must see identical content (per Sunny's product requirement). The
 * 7 AM cron and any boot-time bootstrap on the same day both call
 * saveDigest; whichever wins the INSERT race produces the canonical
 * content. Subsequent callers get { inserted: false } and use the
 * existing row.
 */

import { query } from './db.js';

/**
 * YYYY-MM-DD in America/New_York. Stable string the DB can use as a date
 * primary key without timezone ambiguity.
 */
export function todayNY() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/**
 * Fetch the digest row for an arbitrary date (used by future "yesterday's
 * digest" features and by tests). Returns null if no row exists.
 */
export async function getDigestForDate(date) {
  const { rows } = await query(
    `SELECT digest_date, content, generated_at
       FROM daily_digests
      WHERE digest_date = $1
      LIMIT 1`,
    [date]
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    date: r.digest_date,
    content: r.content,
    generated_at: r.generated_at,
  };
}

export function getTodaysDigest() {
  return getDigestForDate(todayNY());
}

/**
 * Recent story history for the AI dedup prompt (mirrors the recentWords /
 * recentFacts pattern, but for stories). Returns up to `lookbackDays` of
 * STANDARD-edition digests strictly before `todayStr`, newest first.
 *
 * Weekly-wrap and week-ahead editions are excluded: they're recap/preview
 * formats, so they shouldn't suppress a fresh standard-day story. Standard
 * editions don't emit an `editionType` field (it's NULL), and
 * `NULL IS DISTINCT FROM 'weekly-wrap'` is TRUE, so they pass the filter;
 * weekly-wrap / week-ahead rows are filtered out.
 *
 * Each row exposes the fields the prompt builder needs: the stories array,
 * the big-picture text, and the word/fact/quiz strings (for cross-checking).
 */
export async function getRecentStories(todayStr, lookbackDays = 5) {
  const { rows } = await query(
    `SELECT
       digest_date,
       content->'stories'                  AS stories,
       content->'wordOfDay'->>'word'       AS word_of_day,
       content->'didYouKnow'->>'fact'      AS did_you_know,
       content->'quiz'->>'question'        AS quiz_question,
       content->>'bigPicture'              AS big_picture
     FROM daily_digests
     WHERE digest_date < $1
       AND digest_date >= ($1::date - $2 * INTERVAL '1 day')
       AND content->>'editionType' IS DISTINCT FROM 'weekly-wrap'
       AND content->>'editionType' IS DISTINCT FROM 'week-ahead'
     ORDER BY digest_date DESC
     LIMIT $2`,
    [todayStr, lookbackDays]
  );
  return rows;
}

/**
 * Idempotent INSERT. Returns { inserted: true, row } on first call of
 * the day; { inserted: false, row } on every subsequent call (with the
 * existing row's content).
 *
 * Callers should treat "inserted: false" as "today's digest already
 * exists — DO NOT call generateDigest, the work was already done."
 */
export async function saveDigest(date, content) {
  // Try to claim the date with our content.
  const insertRes = await query(
    `INSERT INTO daily_digests (digest_date, content)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (digest_date) DO NOTHING
     RETURNING digest_date, content, generated_at`,
    [date, JSON.stringify(content)]
  );
  if (insertRes.rows.length) {
    return { inserted: true, row: insertRes.rows[0] };
  }
  // Someone else already wrote today's row — read it back so the caller
  // can still write it to disk for fast /digest serving.
  const existing = await getDigestForDate(date);
  return { inserted: false, row: existing };
}
