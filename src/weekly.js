// src/weekly.js — Phase 20a: Weekly Hold (the week-long pick).
//
// Monday's week-ahead digest presents 3 companies from the curated 75; the
// kid "holds" one for the week. Resolution (Saturday) compares all three's
// first-trading-day-OPEN → last-trading-day-CLOSE return; the pick wins
// (+20 MC) only if it beats BOTH others, else +5 participation.
//
// Like Mystery Mover (Phase 16), the SERVER picks the 3 candidates — NOT
// Claude — so the curated-75 + no-repeat invariants are enforceable and
// the same 3 are baked identically into the immutable daily_digests row.
// Claude writes only the one-line CASE for each. Selection is STATELESS
// and deterministic on the ISO-week index (a stable shuffle strided 3 at a
// time → a clean ~25-week non-repeating cycle), so DATE_OVERRIDE testing
// reproduces and no rotation-history table is needed.
//
// The resolution math + the per-user card state live alongside Tomorrow's
// Call (src/picks.js, src/template.js); this module owns candidate
// selection + the AI-case finalize.

import { CURATED_COMPANIES } from './companies.js';
import { isoWeekMondayMs } from './calendar.js';

const CANDIDATES_PER_WEEK = 3;

// Stable hash + Fisher–Yates (same family as games.js / mystery.js).
function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function stableShuffle(arr, seed) {
  const out = arr.slice();
  let s = seed | 0 || 1;
  const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// One fixed shuffle of the curated 75, then walk it 3-at-a-time by week
// index. Computed once at import (pure, no I/O).
const SHUFFLED = stableShuffle(CURATED_COMPANIES, hashString('weekly-hold-v1'));

/**
 * The 3 server-picked candidates for the ISO week containing `dateStr`.
 * Deterministic + stateless: strides the fixed shuffle by the absolute
 * week index (weeks since epoch), so consecutive weeks never overlap and
 * any ticker recurs only after a full ~25-week cycle.
 * Returns [{ ticker, name }] in display order.
 */
export function pickWeeklyHoldCandidates(dateStr) {
  const weekIdx = Math.floor(isoWeekMondayMs(dateStr) / (7 * 86400_000));
  const start = (weekIdx * CANDIDATES_PER_WEEK) % SHUFFLED.length;
  const out = [];
  for (let i = 0; i < CANDIDATES_PER_WEEK; i++) {
    const c = SHUFFLED[(start + i) % SHUFFLED.length];
    out.push({ ticker: c.ticker, name: c.name });
  }
  return out;
}

/**
 * Build the final, guaranteed-complete weeklyHold field from the server's
 * 3 candidates + Claude's cases (raw = content.weeklyHold from the AI;
 * shape `{ cases: { TICKER: "one-line case" } }`). Each candidate gets its
 * matched case, or a canned fallback if missing/empty — mirroring the
 * Mystery Mover finalize-or-fallback. Returns the field stored on the row.
 */
export function finalizeWeeklyHold(raw, candidates) {
  const cases = (raw && typeof raw === 'object' && raw.cases && typeof raw.cases === 'object')
    ? raw.cases : {};
  return {
    candidates: candidates.map(c => {
      const aiCase = typeof cases[c.ticker] === 'string' ? cases[c.ticker].trim() : '';
      return {
        ticker: c.ticker,
        name: c.name,
        case: aiCase.length >= 8 ? aiCase : `${c.name} is one of this week's companies to watch.`,
      };
    }),
  };
}

/** The prompt block naming the 3 companies Claude must write cases for. */
export function weeklyHoldBlock(candidates) {
  if (!candidates?.length) return '';
  const list = candidates.map(c => `- ${c.name} (${c.ticker})`).join('\n');
  return `WEEKLY HOLD CASES (the kid will "hold" one of these for the week):
- Write ONE short, kid-friendly sentence (<= 20 words) making the case for why each of these companies could have a good week. Concrete and specific; no hype, no guarantees, no price targets.
- Return them in "weeklyHold.cases" keyed by TICKER. Do NOT add or remove companies — write a case for EXACTLY these three:
${list}`;
}
