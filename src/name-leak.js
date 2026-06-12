// src/name-leak.js — shared name-leak detection + token normalization.
//
// Extracted from scripts/test-company-models.js (Phase 16) so the Mystery
// Mover's server-side clue guardrail and the Match-game dataset test run
// the SAME logic — the script now imports from here. Pure, no I/O.
//
// The core idea (NOT a naive substring scan):
//   - nameWords(name) extracts the significant words of a company's display
//     name: parenthetical brand words kept ("Meta (Instagram & Facebook)" →
//     meta/instagram/facebook), split on whitespace/slash/hyphen
//     ("Coca-Cola" → coca, cola), possessive `'s` dropped and apostrophes/
//     dots removed ("McDonald's" → mcdonalds, "e.l.f." → elf), lowercased,
//     corporate suffixes (Inc, Corp, …) + stopwords + 1-char tokens dropped.
//     CamelCase is deliberately NOT split ("Salesforce" stays one token).
//   - textTokens(text) normalizes prose into a SET of whole-word tokens the
//     SAME way, so possessive leaks are caught from either side and there
//     are no substring false matches ("ea" never matches "team").
//   - leakingWords(name, text) = name words present in the text as whole
//     words. Empty array = clean.

const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'and', 'for', 'to', 'in', 'on', 'at', 'by', 'with', 'or']);
const SUFFIXES = new Set([
  'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'companies',
  'holdings', 'holding', 'group', 'ltd', 'limited', 'llc', 'plc', 'sa', 'ag', 'nv',
]);

/** Shared normalization: drop possessive `'s`, then remaining apostrophes/dots. */
export function stripPunct(s) {
  return String(s).toLowerCase().replace(/['’]s\b/g, '').replace(/['’.]/g, '');
}

/** Significant words of a company display name (see header for rules). */
export function nameWords(name) {
  const flattened = String(name).replace(/[()]/g, ' ');
  return stripPunct(flattened)
    .split(/[\s/-]+/)                          // whitespace, slash, hyphen
    .map(t => t.replace(/[^a-z0-9]/g, ''))     // drop leftover non-alphanumerics (& etc.)
    .filter(t => t.length >= 2)
    .filter(t => !STOPWORDS.has(t) && !SUFFIXES.has(t));
}

/** Normalize prose into a Set of whole-word tokens (same rules as nameWords). */
export function textTokens(text) {
  return new Set(stripPunct(String(text)).split(/[^a-z0-9]+/).filter(Boolean));
}

/** Name words that appear in `text` as whole words. Empty = no leak. */
export function leakingWords(name, text) {
  const tokens = textTokens(text);
  return nameWords(name).filter(w => tokens.has(w));
}

/**
 * Normalize a free-text guess (or an acceptable answer) to a canonical
 * comparison key: lowercase, possessives/punctuation stripped, corporate
 * suffixes dropped, whitespace collapsed. "McDonald's Corp." and
 * "mcdonalds" reduce to the same key.
 */
export function normalizeAnswer(s) {
  return stripPunct(s)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter(t => !SUFFIXES.has(t))
    .join(' ');
}
