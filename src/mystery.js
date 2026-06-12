// src/mystery.js — Phase 16: Mystery Mover (the daily Wordle).
//
// One mystery company per day from the curated 75 (src/companies.js),
// 5 progressive clues, free-text guessing. The puzzle is baked into the
// immutable daily_digests row, so every kid — and every guest on /sample —
// plays the SAME puzzle all day.
//
// Server responsibilities (this module):
//   - pickMysteryCompany: deterministic day-seeded pick, excluding the last
//     30 days of answers (rotation history lives in Postgres, content_history
//     kind='mystery' — see src/content-history.js).
//   - buildClue5: the final clue ("first letter + ticker length") is COMPOSED
//     server-side from {name, ticker}, never trusted to the model.
//   - validateMysteryMover: the name-leak HARD GATE. Clues 1–4 must not
//     contain any word of the company name, the ticker, or ANY word of any
//     acceptable answer (whatever we'd accept as a correct guess is, by
//     definition, a giveaway). Same possessive-aware whole-word token logic
//     as the Match-game guardrail (src/name-leak.js).
//   - finalizeMysteryMover: validate the AI puzzle; on ANY failure fall back
//     to a deterministic pick from the hand-written reserve pool
//     (src/mystery-reserve.json — kept under src/, NOT public/data/, because
//     it contains answers and public/ is statically served). A leaky puzzle
//     can never reach the daily row.
//   - isCorrectGuess: normalized free-text matching (case, punctuation,
//     possessives, corporate suffixes) against name + ticker +
//     acceptableAnswers.
//
// Pure + sync (reserve pool is read once at import — local file, no env).

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CURATED_COMPANIES } from './companies.js';
import { leakingWords, textTokens, normalizeAnswer } from './name-leak.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const RESERVE_POOL = JSON.parse(
  readFileSync(path.join(__dirname, 'mystery-reserve.json'), 'utf8'),
);

// Same string hash as src/games.js (kept local — games.js doesn't export it).
function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// ---- Company selection -----------------------------------------------------

/**
 * Pick the day's mystery company from the curated 75, excluding tickers used
 * in the last 30 days. Deterministic on the date string (so DATE_OVERRIDE
 * testing is reproducible and a same-day regeneration re-picks the same
 * company). If the exclusion list somehow swallows the whole list, fall back
 * to the full list rather than failing the digest.
 */
export function pickMysteryCompany(dateStr, recentTickers = []) {
  const recent = new Set(recentTickers.map(t => String(t).toUpperCase()));
  let eligible = CURATED_COMPANIES.filter(c => !recent.has(c.ticker.toUpperCase()));
  if (eligible.length === 0) eligible = CURATED_COMPANIES;
  return eligible[hashString(`mystery:${dateStr}`) % eligible.length];
}

// ---- Clue 5 (server-composed) ----------------------------------------------

export function buildClue5(company) {
  const firstLetter = String(company.name).trim().charAt(0).toUpperCase();
  const tickerLen = String(company.ticker).replace(/[^A-Za-z]/g, '').length;
  return `Their name starts with "${firstLetter}" and their stock ticker is ${tickerLen} letter${tickerLen === 1 ? '' : 's'} long.`;
}

// ---- Validation (the hard gate) ----------------------------------------------

const CLUE_MIN_LEN = 12;   // "A company." is uselessly vague — and too short
const CLUE_MAX_LEN = 260;

/**
 * Validate an AI-generated puzzle for `company`. Returns { ok, errors }.
 * Checks shape (exactly 4 clues — clue 5 is ours), length bounds, and the
 * name-leak gate: no clue may contain a whole-word token of the company
 * name, the ticker (2+ letters — single-letter tickers like V/F/T would
 * false-positive on ordinary prose), or any word of any acceptable answer.
 */
export function validateMysteryMover(raw, company) {
  const errors = [];
  if (!raw || typeof raw !== 'object') {
    return { ok: false, errors: ['mysteryMover missing or not an object'] };
  }

  const clues = Array.isArray(raw.clues) ? raw.clues : [];
  if (clues.length !== 4) {
    errors.push(`expected exactly 4 clues (clue 5 is server-composed), got ${clues.length}`);
  }
  clues.forEach((clue, i) => {
    if (typeof clue !== 'string' || clue.trim().length < CLUE_MIN_LEN) {
      errors.push(`clue ${i + 1} missing/too short (each clue must narrow the field)`);
      return;
    }
    if (clue.length > CLUE_MAX_LEN) {
      errors.push(`clue ${i + 1} too long (${clue.length} > ${CLUE_MAX_LEN})`);
    }
  });

  const answers = Array.isArray(raw.acceptableAnswers) ? raw.acceptableAnswers.filter(a => typeof a === 'string') : [];
  // Every name that would be ACCEPTED as a guess is banned from clues 1–4.
  const bannedNames = [company.name, ...answers];
  const ticker = String(company.ticker).toLowerCase();

  clues.forEach((clue, i) => {
    if (typeof clue !== 'string') return;
    for (const name of bannedNames) {
      const hits = leakingWords(name, clue);
      if (hits.length) {
        errors.push(`clue ${i + 1} leaks "${hits.join('", "')}" (from "${name}")`);
      }
    }
    if (ticker.length >= 2 && textTokens(clue).has(ticker)) {
      errors.push(`clue ${i + 1} leaks the ticker "${company.ticker}"`);
    }
  });

  return { ok: errors.length === 0, errors };
}

// ---- Reserve fallback ---------------------------------------------------------

/** Deterministic reserve pick, honoring the same 30-day exclusion. */
export function pickReservePuzzle(dateStr, recentTickers = []) {
  const recent = new Set(recentTickers.map(t => String(t).toUpperCase()));
  let eligible = RESERVE_POOL.filter(p => !recent.has(p.ticker.toUpperCase()));
  if (eligible.length === 0) eligible = RESERVE_POOL;
  return eligible[hashString(`mystery-reserve:${dateStr}`) % eligible.length];
}

/**
 * Produce the final, guaranteed-clean puzzle for the day.
 *   raw            — content.mysteryMover as returned by Claude (may be junk)
 *   company        — the server-picked company the prompt asked about
 *   dateStr        — NY date (drives the deterministic reserve pick)
 *   recentTickers  — 30-day exclusion list
 * Returns { puzzle, usedFallback, errors } — puzzle always has 5 clues
 * (clue 5 composed here) and a merged acceptableAnswers list including the
 * canonical name + ticker.
 */
export function finalizeMysteryMover(raw, company, dateStr, recentTickers = []) {
  const check = validateMysteryMover(raw, company);
  let base;
  let usedFallback = false;
  if (check.ok) {
    base = { ticker: company.ticker, name: company.name, clues: raw.clues.slice(0, 4), acceptableAnswers: raw.acceptableAnswers };
  } else {
    usedFallback = true;
    const reserve = pickReservePuzzle(dateStr, recentTickers);
    base = { ticker: reserve.ticker, name: reserve.name, clues: reserve.clues.slice(0, 4), acceptableAnswers: reserve.acceptableAnswers };
  }

  const sourceCompany = { ticker: base.ticker, name: base.name };
  const answers = [...new Set(
    [base.name, base.ticker, ...(base.acceptableAnswers || [])]
      .filter(a => typeof a === 'string' && a.trim())
      .map(a => a.trim()),
  )];

  return {
    usedFallback,
    errors: check.errors,
    puzzle: {
      ticker: base.ticker,
      name: base.name,
      clues: [...base.clues, buildClue5(sourceCompany)],
      acceptableAnswers: answers,
    },
  };
}

// ---- Guess matching ------------------------------------------------------------

/**
 * Free-text guess check. Normalizes both sides (lowercase, possessive/
 * punctuation stripped, corporate suffixes dropped) so "McDonald's Corp."
 * matches "mcdonalds". Ticker matches are accepted case-insensitively.
 */
export function isCorrectGuess(guess, puzzle) {
  if (typeof guess !== 'string' || !guess.trim()) return false;
  const g = normalizeAnswer(guess);
  if (!g) return false;
  if (g === String(puzzle.ticker).toLowerCase()) return true;
  return (puzzle.acceptableAnswers || []).some(a => normalizeAnswer(a) === g);
}
