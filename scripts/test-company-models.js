// scripts/test-company-models.js
//
// Guardrail for the Match game's company dataset (public/data/company-models.json).
// Pure / offline — no DB, no network, no secrets.
//
// The Match game shows company NAMES on the left and business-model
// descriptions (`shortModel`) on the right, shuffled; the kid pairs them by
// reasoning "who makes money this way?". If a `shortModel` repeats the
// company's own name (or a significant word of it), the kid can match by
// spotting the word instead of thinking — which defeats the game. This test
// scans every entry and fails on any such self-name leak.
//
// Usage:  node scripts/test-company-models.js
//
// Name-word extraction (NOT a naive substring scan):
//   - keep parenthetical brand words as significant name-words — e.g.
//     "Meta (Instagram & Facebook)" → meta, instagram, facebook. The display
//     name appears on the left tile, so any of those words showing up in the
//     right-side clue is a giveaway. (This is the task's "name OR any
//     significant word of it" rule applied literally; a clue may still name a
//     mechanism/product that is NOT in the company's own display name, just as
//     the accepted "Sells iPhones" clue does for Apple.)
//   - split on whitespace AND hyphens (so "Coca-Cola" → coca, cola), then strip
//     all non-alphanumerics inside each token ("e.l.f." → elf, "McDonald's" →
//     mcdonalds), lowercase.
//   - drop corporate suffixes (Inc, Corp, Co, Company, Holdings, Group, Ltd,
//     LLC, PLC, …), stopwords, and tokens shorter than 2 chars.
//   - we deliberately do NOT split camelCase ("Salesforce" stays one token, not
//     sales+force) — that would over-flag common stems.
//   - a name-word leaks if it appears in `shortModel` as a WHOLE word. We
//     compare against a normalized TOKEN SET of the clue, normalized the SAME
//     way as the name: possessive `'s` dropped, remaining apostrophes/dots
//     removed, every other non-alphanumeric → a boundary. So possessive leaks
//     are caught either way the name carries the apostrophe — "McDonald's
//     collects rent" (name has it) and "Costco's profit" / "Disney's parks"
//     (clue has it) all reduce to the bare stem — and there are no substring
//     false matches ("ea" never matches "team").
//
// False-positive guard: a brand word can also be a common English word
// ("Snap", "Visa", "Block", "Gap", "Planet"/"Fitness"…), so a clean reworded
// clue could trip on a coincidence. On any hit the test prints the entry name +
// the offending word + the full `shortModel` so a human can judge. Genuinely
// acceptable coincidences can be added to ALLOWLIST below (starts empty).

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '..', 'public', 'data', 'company-models.json');

let failures = 0;
function ok(label, cond, detail) {
  if (cond) console.log(`  ✅ ${label}`);
  else { failures++; console.error(`  ❌ ${label}` + (detail ? `\n     ${detail}` : '')); }
}

// Known-acceptable {name, word} coincidences (a brand word that is also a
// common English word AND is used in a clue in its common-word sense, not as
// the brand). Starts EMPTY — add an entry only after eyeballing a flagged hit
// and confirming it isn't a real leak. Example shape:
//   { name: 'Snap', word: 'snap' }  // "snap a photo" — the verb, not the brand
const ALLOWLIST = [];

// Stopwords + corporate suffixes dropped from name-word extraction.
const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'and', 'for', 'to', 'in', 'on', 'at', 'by', 'with', 'or']);
const SUFFIXES = new Set([
  'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'companies',
  'holdings', 'holding', 'group', 'ltd', 'limited', 'llc', 'plc', 'sa', 'ag', 'nv',
]);

// Shared normalization: drop possessive `'s` (so "Costco's"/"McDonald's" reduce
// to the bare stem), then remove remaining apostrophes/dots ("e.l.f." → elf).
function stripPunct(s) {
  return s.toLowerCase().replace(/['’]s\b/g, '').replace(/['’.]/g, '');
}

function nameWords(name) {
  // Keep parenthetical brand words ("Meta (Instagram & Facebook)" →
  // meta/instagram/facebook) — just turn the brackets into word boundaries.
  const flattened = String(name).replace(/[()]/g, ' ');
  return stripPunct(flattened)
    .split(/[\s/-]+/)                          // whitespace, slash, hyphen
    .map(t => t.replace(/[^a-z0-9]/g, ''))     // drop any leftover non-alphanumerics (& etc.)
    .filter(t => t.length >= 2)
    .filter(t => !STOPWORDS.has(t) && !SUFFIXES.has(t));
}

// Normalize a clue into a SET of whole-word tokens, the SAME way as name words
// (possessive `'s` dropped, apostrophes/dots removed), then split on every
// other non-alphanumeric. Set membership = exact whole-word match, so there are
// no substring leaks.
function clueTokens(model) {
  return new Set(stripPunct(String(model)).split(/[^a-z0-9]+/).filter(Boolean));
}

function leakingWords(entry) {
  const tokens = clueTokens(entry.shortModel || '');
  return nameWords(entry.name).filter(w => tokens.has(w));
}

function isAllowed(name, word) {
  return ALLOWLIST.some(a => a.name === name && a.word.toLowerCase() === word.toLowerCase());
}

const data = JSON.parse(readFileSync(DATA, 'utf8'));

console.log('\n🧩 Match game — company-models.json guardrail\n');
console.log(`Scanning ${data.length} entries for self-name leaks in shortModel…\n`);

// Sanity: dataset shape.
ok(`dataset is a non-empty array (${data.length} entries)`, Array.isArray(data) && data.length > 0);
ok('every entry has name + shortModel', data.every(e => e && typeof e.name === 'string' && typeof e.shortModel === 'string'));
ok('tickers are unique', new Set(data.map(e => e.ticker)).size === data.length);

// The core scan — one assertion per entry so a failure names the culprit.
let leakCount = 0;
for (const e of data) {
  const hits = leakingWords(e).filter(w => !isAllowed(e.name, w));
  if (hits.length) leakCount++;
  ok(
    `${e.name} — shortModel has no self-name leak`,
    hits.length === 0,
    hits.length
      ? `offending word(s): ${hits.map(w => `"${w}"`).join(', ')}\n     shortModel: "${e.shortModel}"\n     → if this is a common-word coincidence, not the brand, add { name: '${e.name}', word: '${hits[0]}' } to ALLOWLIST.`
      : '',
  );
}

console.log('');
if (failures) {
  console.error(`❌ ${failures} assertion(s) failed (${leakCount} entr${leakCount === 1 ? 'y' : 'ies'} leaking).\n`);
  process.exit(1);
} else {
  console.log(`✅ All ${data.length} entries clean — no shortModel leaks its own name.\n`);
  process.exit(0);
}
