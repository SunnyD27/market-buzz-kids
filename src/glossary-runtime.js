// src/glossary-runtime.js — the LIVE glossary view used by the template.
//
// The tap-to-reveal pass (src/template.js) needs ONE merged term source:
//   static seed (src/glossary.js)  +  admin-approved pending_glossary rows.
//
// That gives us the "auto-grow" behaviour: an approved nomination starts
// getting tooltips in the digest WITHOUT a redeploy or a code edit to the seed
// file. The seed file stays canonical for terms shipped in the repo; the DB
// supplies everything an adult has approved since.
//
// buildHTML() is a SYNCHRONOUS, pure-ish function called on every /digest and
// /sample render, so it must never touch the DB on the request path. Instead:
//   - getActiveGlossary()      → returns the cached merged view, synchronously.
//   - refreshActiveGlossary()  → async; re-reads approved rows and rebuilds the
//                                cache out-of-band.
// The cache is refreshed on server boot, after every real digest generation,
// and right after an admin approves/edits a term. Until the first refresh the
// view is seed-only — so seed tooltips always work even with no DATABASE_URL
// (offline `node src/generate.js`, the smoke test, a DB-less boot).

import {
  GLOSSARY,
  MATCHABLE_TERMS as SEED_MATCHABLE,
  lookup as seedLookup,
  isKnownTerm,
} from './glossary.js';

// How long after approval a DB-sourced term wears the "NEW" superscript (the
// auto-grow tag from glossary-demo.html). Seed terms are never "new".
const NEW_TERM_WINDOW_DAYS = 14;

let _view = buildView([]); // seed-only until the first refresh

/**
 * Build an immutable merged view from a set of approved pending_glossary rows.
 * Returns { MATCHABLE_TERMS, lookup, approvedCount }.
 */
function buildView(approvedRows) {
  // lower(term) → { term, def, principle, isNew }. Approved rows that collide
  // with a seed term/alias are dropped (the seed file wins). Approved rows
  // carry no aliases — the nomination schema is term/definition/principle only
  // — so each contributes exactly one matchable token.
  const approved = new Map();
  const now = Date.now();
  for (const r of approvedRows || []) {
    if (!r || !r.term) continue;
    if (isKnownTerm(r.term)) continue; // already covered by the seed (incl. aliases)
    const lower = String(r.term).toLowerCase();
    if (approved.has(lower)) continue;
    const approvedAt = r.approved_at ? new Date(r.approved_at).getTime() : null;
    const isNew = approvedAt != null && (now - approvedAt) <= NEW_TERM_WINDOW_DAYS * 86400000;
    approved.set(lower, {
      term: r.term,
      def: r.definition,
      principle: r.principle == null ? null : Number(r.principle),
      isNew,
    });
  }

  // Matchable list: seed aliases + approved terms, longest-first so multiword
  // terms beat their own prefixes ("bull market" over "bull").
  const matchable = SEED_MATCHABLE.concat(Array.from(approved.keys()))
    .sort((a, b) => b.length - a.length);

  function lookup(termOrAlias) {
    const seed = seedLookup(termOrAlias);
    if (seed) return { term: seed.term, def: seed.def, principle: seed.principle, isNew: false };
    const a = approved.get(String(termOrAlias).toLowerCase());
    if (a) return { term: a.term, def: a.def, principle: a.principle, isNew: a.isNew };
    return null;
  }

  return { MATCHABLE_TERMS: matchable, lookup, approvedCount: approved.size };
}

/** The current merged glossary view. Synchronous — safe to call per render. */
export function getActiveGlossary() {
  return _view;
}

/**
 * Re-read approved rows from the DB and rebuild the cached view. Called on
 * boot, after each real generation, and after an admin approval. Guarded: on
 * any failure we keep the previous view rather than blanking glossary tooltips.
 *
 * storage.js is imported lazily so the template's import chain
 * (template.js → glossary-runtime.js) never pulls pg into the offline/test
 * path unless a refresh is actually requested.
 */
export async function refreshActiveGlossary() {
  try {
    const { storage } = await import('./storage.js');
    const rows = await storage.getGlossaryByStatus('approved');
    _view = buildView(rows);
    console.log(`[glossary-runtime] active glossary refreshed — ${Object.keys(GLOSSARY).length} seed + ${_view.approvedCount} approved term(s)`);
    return { ok: true, approved: _view.approvedCount };
  } catch (err) {
    console.error('[glossary-runtime] refresh failed (keeping previous view):', err.message);
    return { ok: false, error: err.message };
  }
}

// Exposed for tests — lets a smoke test build a deterministic merged view
// (seed + fake approved rows) without a DB round-trip.
export const __test = { buildView };
