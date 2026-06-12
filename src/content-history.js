/**
 * src/content-history.js — tracks recently-used AI-generated picks so the
 * next generation can be told what to avoid (or, for the Mystery Mover,
 * which answers are excluded from rotation).
 *
 * Kinds:
 *   - "word"    — Word of the Day picks (short terms like "IPO", "P/E ratio")
 *   - "fact"    — Did You Know facts (full-sentence trivia)
 *   - "mystery" — Mystery Mover answer tickers (Phase 16, 30-day no-repeat)
 *
 * Phase 16 moved persistence from state/content-history.json (ephemeral on
 * Railway — wiped on every container restart, the known wart) to Postgres
 * (`content_history` table, see schema.sql + migrations/add-content-history.sql).
 * Same exports as the file-backed version, but BOTH ARE NOW ASYNC — call
 * sites must await. The old state file is intentionally not migrated: it
 * was ephemeral anyway, so the worst case is a short-term word/fact repeat
 * right after this ships.
 *
 * These rows are AI-content rotation metadata, NOT user PII — out of scope
 * for the COPPA deletion scrub (same reasoning as pending_glossary).
 */

import { query } from './db.js';

const VALID_KINDS = new Set(['word', 'fact', 'mystery']);
const MAX_PER_KIND = 100;

function ensureKind(kind) {
  if (!VALID_KINDS.has(kind)) {
    throw new Error(`content-history: unknown kind "${kind}". Expected one of: ${[...VALID_KINDS].join(', ')}`);
  }
}

/**
 * Values used within the last `days` days for the given kind, most recent
 * first, deduped. Fails SOFT (returns []) — a history hiccup must never
 * fail digest generation; the model just gets a shorter avoid-list.
 */
export async function getRecent(kind, days = 30) {
  ensureKind(kind);
  try {
    const { rows } = await query(
      `SELECT DISTINCT ON (LOWER(value)) value, used_on
         FROM content_history
        WHERE kind = $1
          AND used_on >= CURRENT_DATE - $2::int
        ORDER BY LOWER(value), used_on DESC`,
      [kind, days],
    );
    return rows
      .sort((a, b) => (a.used_on < b.used_on ? 1 : -1))
      .map(r => r.value);
  } catch (err) {
    console.error(`[content-history] getRecent(${kind}) failed (soft — empty avoid-list):`, err.message);
    return [];
  }
}

/**
 * Persist `value` as today's pick under the given kind, then prune the kind
 * to the newest MAX_PER_KIND rows. Fails SOFT (logged) — recording history
 * must never fail a generation that already succeeded.
 */
export async function record(kind, value, dateStr) {
  ensureKind(kind);
  if (!value || typeof value !== 'string') return;
  const usedOn = dateStr || new Date().toISOString().slice(0, 10);
  try {
    await query(
      `INSERT INTO content_history (kind, value, used_on) VALUES ($1, $2, $3::date)`,
      [kind, value, usedOn],
    );
    await query(
      `DELETE FROM content_history
        WHERE kind = $1
          AND id NOT IN (
            SELECT id FROM content_history
             WHERE kind = $1
             ORDER BY used_on DESC, id DESC
             LIMIT $2
          )`,
      [kind, MAX_PER_KIND],
    );
  } catch (err) {
    console.error(`[content-history] record(${kind}) failed (soft):`, err.message);
  }
}
