/**
 * src/content-history.js — tracks recently-used AI-generated picks so the
 * next generation can be told what to avoid.
 *
 * Currently used for:
 *   - "word"  — Word of the Day picks (short terms like "IPO", "P/E ratio")
 *   - "fact"  — Did You Know facts (full-sentence trivia)
 *
 * Persistence: a single JSON file at state/content-history.json (gitignored).
 * Shape:
 *   {
 *     word: [{ value: "IPO", date: "2026-05-22" }, ...],
 *     fact: [{ value: "If you invested...", date: "2026-05-22" }, ...]
 *   }
 *
 * Each list is capped at 100 entries (newest first) — long enough that any
 * sane "recent N days" window finds what it needs, short enough that the
 * file stays small.
 *
 * If we ever go per-user (see Sunny's question — needs identity wired
 * post-Phase 6.3), swap this module for a DB-backed version with the same
 * exports. Call sites don't change.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_PATH = path.join(__dirname, '..', 'state', 'content-history.json');
const LEGACY_WORD_PATH = path.join(__dirname, '..', 'state', 'word-history.json');

const VALID_KINDS = new Set(['word', 'fact']);

function ensureKind(kind) {
  if (!VALID_KINDS.has(kind)) {
    throw new Error(`content-history: unknown kind "${kind}". Expected one of: ${[...VALID_KINDS].join(', ')}`);
  }
}

function safeReadAll() {
  // One-shot migration: if the old word-history.json file exists and the
  // new file doesn't, fold the legacy `{recent:[...]}` into the new schema.
  if (!fs.existsSync(HISTORY_PATH) && fs.existsSync(LEGACY_WORD_PATH)) {
    try {
      const raw = fs.readFileSync(LEGACY_WORD_PATH, 'utf8');
      const legacy = JSON.parse(raw);
      if (Array.isArray(legacy?.recent)) {
        const migrated = {
          word: legacy.recent.map(e => ({ value: e.word, date: e.date })).filter(e => e.value),
          fact: [],
        };
        fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
        fs.writeFileSync(HISTORY_PATH, JSON.stringify(migrated, null, 2), 'utf8');
      }
    } catch {
      // Ignore — fresh start.
    }
  }

  try {
    const raw = fs.readFileSync(HISTORY_PATH, 'utf8');
    const data = JSON.parse(raw);
    return {
      word: Array.isArray(data?.word) ? data.word : [],
      fact: Array.isArray(data?.fact) ? data.fact : [],
    };
  } catch {
    return { word: [], fact: [] };
  }
}

function safeWriteAll(data) {
  fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Return values used within the last `days` days for the given kind,
 * most recent first.
 */
export function getRecent(kind, days = 30) {
  ensureKind(kind);
  const cutoffMs = Date.now() - days * 86400_000;
  return safeReadAll()[kind]
    .filter(entry => {
      if (!entry?.date) return false;
      const t = new Date(entry.date + 'T00:00:00Z').getTime();
      return Number.isFinite(t) && t >= cutoffMs;
    })
    .map(entry => entry.value);
}

/**
 * Persist `value` as today's pick under the given kind. Dedupes
 * case-insensitively against existing entries (newest wins) and caps the
 * list at 100 entries.
 */
export function record(kind, value, dateStr) {
  ensureKind(kind);
  if (!value || typeof value !== 'string') return;
  const today = dateStr || new Date().toISOString().slice(0, 10);
  const all = safeReadAll();
  const lower = value.toLowerCase();
  const filtered = all[kind].filter(e => e?.value?.toLowerCase?.() !== lower);
  all[kind] = [{ value, date: today }, ...filtered].slice(0, 100);
  safeWriteAll(all);
}
