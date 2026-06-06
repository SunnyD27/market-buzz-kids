// scripts/test-glossary.js
//
// Smoke test for the glossary tap-to-reveal pass + the AI nomination filter.
// Pure / offline — no DB, no network, no secrets. Exercises the seed glossary
// view (src/glossary.js via src/glossary-runtime.js), the per-digest linker
// (src/template.js makeGlossaryLinker), the seed+approved merge
// (glossary-runtime __test.buildView), and the server-side nomination filter
// (src/ai.js filterGlossaryNominations).
//
// Usage:  node scripts/test-glossary.js
//
// Covers: longest-first matching · first-occurrence-only (within a call AND
// across the whole digest via the shared seen-set) · alias resolution ·
// word-of-day self-skip · principle tie-in line · no tag/markup corruption ·
// the kill-switch off-path · approved-term merge · nomination filtering.

import { makeGlossaryLinker } from '../src/template.js';
import { getActiveGlossary, __test as glossaryRuntimeTest } from '../src/glossary-runtime.js';
import { filterGlossaryNominations } from '../src/ai.js';

let failures = 0;
function ok(label, cond, detail) {
  if (cond) console.log(`  ✅ ${label}`);
  else { failures++; console.error(`  ❌ ${label}` + (detail ? `\n     ${detail}` : '')); }
}
function eq(label, a, b) { ok(label, a === b, a === b ? '' : `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

const SEED = getActiveGlossary();

console.log('\n📖 Glossary tap-to-reveal smoke test\n');

// ====================================================================
console.log('Section 1 — longest-first matching');
{
  const lk = makeGlossaryLinker(SEED).link('The bull market kept climbing today.');
  ok('"bull market" wins over "bull" (tip-term canonical)', lk.includes('<span class="tip-term">Bull market</span>'), lk);
  ok('visible text preserves the kid-facing casing', lk.includes('>bull market<'), lk);
  eq('exactly one term wrapped', count(lk, 'class="gloss'), 1);

  const lk2 = makeGlossaryLinker(SEED).link('The S&P 500 hit a new high.');
  ok('"S&P 500" wins over "S&P"', lk2.includes('<span class="tip-term">S&amp;P 500</span>'), lk2);
  ok('the literal & in the visible match is escaped', lk2.includes('>S&amp;P 500<'), lk2);
}

// ====================================================================
console.log('\nSection 2 — first-occurrence-only');
{
  // Within a single call: two mentions, only the first wraps.
  const within = makeGlossaryLinker(SEED).link('A dividend is great, and another dividend is better.');
  eq('one occurrence wrapped within a single field', count(within, 'class="gloss'), 1);
  ok('second mention left as plain text', within.endsWith('another dividend is better.'), within);

  // Across the WHOLE digest: the SAME linker (shared seen-set) over two fields.
  const linker = makeGlossaryLinker(SEED);
  const first = linker.link('Inflation makes each dollar buy less.');
  const second = linker.link('More inflation news today.');
  ok('term wrapped on first section', first.includes('class="gloss'), first);
  eq('term NOT re-wrapped on a later section', count(second, 'class="gloss'), 0);
}

// ====================================================================
console.log('\nSection 3 — alias resolution');
{
  const lk = makeGlossaryLinker(SEED).link('ETFs are baskets of stocks.');
  ok('alias "ETFs" resolves to canonical "ETF"', lk.includes('<span class="tip-term">ETF</span>'), lk);
  ok('visible text keeps the alias form the kid read', lk.includes('>ETFs<'), lk);

  const lk2 = makeGlossaryLinker(SEED).link('The Federal Reserve met this week.');
  ok('alias "Federal Reserve" resolves to "The Fed"', lk2.includes('<span class="tip-term">The Fed</span>'), lk2);
}

// ====================================================================
console.log('\nSection 4 — word-of-day self-skip');
{
  const lk = makeGlossaryLinker(SEED).link('A dividend is a slice of profit paid to owners.', { skipTerm: 'dividend' });
  eq('the word-of-day word is NOT tooltipped in its own card', count(lk, '<span class="tip-term">Dividend</span>'), 0);
  // ...but other terms in the same definition still link.
  const lk2 = makeGlossaryLinker(SEED).link('A dividend relates to profit and revenue.', { skipTerm: 'dividend' });
  ok('skipTerm only skips itself — other terms still link', lk2.includes('class="gloss'), lk2);
}

// ====================================================================
console.log('\nSection 5 — principle tie-in line');
{
  const withP = makeGlossaryLinker(SEED).link('A dividend pays you to own.');
  ok('term with a principle gets a "Ties to:" line', withP.includes('class="tip-principle">Ties to:'), withP);

  const noP = makeGlossaryLinker(SEED).link('Every ticker is a short nickname.');
  ok('term with principle=null gets NO tie-in line', noP.includes('class="gloss') && !noP.includes('tip-principle'), noP);
}

// ====================================================================
console.log('\nSection 6 — no tag/markup corruption + escaping');
{
  const lk = makeGlossaryLinker(SEED).link('Bears love <b>honey</b>, but a bear market is scary.');
  ok('literal markup is escaped, not passed through', lk.includes('&lt;b&gt;honey&lt;/b&gt;') && !lk.includes('<b>'), lk);
  ok('a real term outside the markup still wraps', lk.includes('<span class="tip-term">Bear market</span>'), lk);
  ok('only the gloss spans WE emit appear as live tags', count(lk, '<span class="gloss') === 1, lk);
}

// ====================================================================
console.log('\nSection 7 — kill-switch off-path');
{
  const on = makeGlossaryLinker(SEED, { enabled: true }).link('A dividend today.');
  const off = makeGlossaryLinker(SEED, { enabled: false }).link('A dividend today.');
  ok('glossary ON wraps the term', on.includes('class="gloss'), on);
  eq('glossary OFF emits no tooltips', count(off, 'class="gloss'), 0);
  eq('glossary OFF === plain escaped text', off, 'A dividend today.');
}

// ====================================================================
console.log('\nSection 8 — seed + approved merge (glossary-runtime.buildView)');
{
  const view = glossaryRuntimeTest.buildView([
    { term: 'short squeeze', definition: 'When a stock jumps fast because traders betting against it scramble to buy.', principle: 7, approved_at: new Date().toISOString() },
    { term: 'ETF', definition: 'should be ignored — already in the seed', principle: 1, approved_at: new Date().toISOString() },
  ]);
  const sq = view.lookup('short squeeze');
  ok('approved DB term is resolvable', !!sq && sq.term === 'short squeeze', JSON.stringify(sq));
  ok('recently-approved term is flagged NEW', !!sq && sq.isNew === true, JSON.stringify(sq));
  ok('approved term joins MATCHABLE_TERMS', view.MATCHABLE_TERMS.includes('short squeeze'));
  const etf = view.lookup('etf');
  ok('approved row duplicating a seed term is ignored (seed wins, not NEW)', !!etf && etf.isNew === false, JSON.stringify(etf));

  // The linker over the merged view wraps the approved term with a NEW tag.
  const lk = makeGlossaryLinker(view).link('Traders triggered a short squeeze.');
  ok('linker wraps the approved term', lk.includes('<span class="tip-term">short squeeze</span>'), lk);
  ok('approved term renders the NEW superscript class', lk.includes('class="gloss is-new"'), lk);
}

// ====================================================================
console.log('\nSection 9 — AI nomination filter (filterGlossaryNominations)');
{
  eq('drops a term already in the seed glossary', filterGlossaryNominations([{ term: 'dividend', definition: 'x' }]).length, 0);
  eq('drops a seed alias too', filterGlossaryNominations([{ term: 'ETFs', definition: 'x' }]).length, 0);

  const kept = filterGlossaryNominations([{ term: 'short squeeze', definition: 'a fast jump in price', principle: 7 }]);
  eq('keeps a genuinely new term', kept.length, 1);
  eq('keeps its principle', kept[0].principle, 7);

  eq('normalizes out-of-range principle to null', filterGlossaryNominations([{ term: 'order book', definition: 'd', principle: 99 }])[0].principle, null);
  eq('drops malformed entries (no definition)', filterGlossaryNominations([{ term: 'moat' }]).length, 0);
  eq('de-dups within one response', filterGlossaryNominations([{ term: 'moat', definition: 'a', principle: 4 }, { term: 'Moat', definition: 'b' }]).length, 1);

  const many = Array.from({ length: 8 }, (_, i) => ({ term: `newterm${i}`, definition: `def ${i}`, principle: 5 }));
  eq('caps at 5 nominations', filterGlossaryNominations(many).length, 5);
  eq('non-array input → []', filterGlossaryNominations(null).length, 0);
}

// ====================================================================
console.log('');
if (failures) {
  console.error(`❌ ${failures} assertion(s) failed.\n`);
  process.exit(1);
} else {
  console.log('✅ All glossary smoke tests passed.\n');
  process.exit(0);
}
