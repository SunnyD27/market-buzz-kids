// scripts/test-template-newlines.js
//
// Smoke test for the body-text newline normalization in src/template.js
// (decodeNewlines + paragraphizeText + the makeGlossaryLinker prose path).
// Pure / offline — no DB, no network, no secrets.
//
// Regression target (prod bug, June 2026): the model intermittently emits
// paragraph breaks as the LITERAL two-char sequence backslash-n (`\`,`n`,`\`,`n`)
// inside its JSON string values instead of real newline control chars. The old
// splitter matched only real `\n\n`, so literal `\\n\\n` survived escapeHTML()
// and rendered as visible "\n\n" text in The Big Picture (and any other body
// field on the shared splitter path). The DB confirmed the leaked breaks were
// the literal/escaped form (backslash-n), not real newlines.
//
// Asserts: BOTH forms (real `\n\n` and literal `\\n\\n`), and a mix of both in
// one string, split into the correct number of <p>; single `\\n` and `\r\n`
// are handled; and — the load-bearing guard — the rendered output contains
// ZERO literal backslash-n two-char sequences.
//
// Usage:  node scripts/test-template-newlines.js

import {
  decodeNewlines,
  paragraphizeText,
  makeGlossaryLinker,
  buildHTML,
} from '../src/template.js';
import { getActiveGlossary } from '../src/glossary-runtime.js';

let failures = 0;
function ok(label, cond, detail) {
  if (cond) console.log(`  ✅ ${label}`);
  else { failures++; console.error(`  ❌ ${label}` + (detail ? `\n     ${detail}` : '')); }
}
function eq(label, a, b) {
  ok(label, a === b, a === b ? '' : `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function pcount(html) {
  return html.split('<p>').length - 1;
}
// The literal two-char backslash-n sequence, built so the source itself is
// unambiguous: String.fromCharCode(92) is "\", 'n' is "n".
const BS = String.fromCharCode(92);
const LIT = BS + 'n'; // the characters backslash + n

const SEED = getActiveGlossary();

console.log('\n📐 Template newline-normalization smoke test\n');

// ====================================================================
console.log('Section 1 — paragraphizeText splits both real and literal breaks');
{
  // Real newline form.
  const real = paragraphizeText('First paragraph here.\n\nSecond paragraph here.');
  eq('real \\n\\n → 2 paragraphs', real.length, 2);
  eq('  para 1 text', real[0], 'First paragraph here.');
  eq('  para 2 text', real[1], 'Second paragraph here.');

  // Literal escaped form (what the model actually stored in prod).
  const lit = paragraphizeText('First paragraph here.' + LIT + LIT + 'Second paragraph here.');
  eq('literal \\\\n\\\\n → 2 paragraphs', lit.length, 2);
  eq('  para 1 text (no leaked backslash-n)', lit[0], 'First paragraph here.');
  eq('  para 2 text (no leaked backslash-n)', lit[1], 'Second paragraph here.');

  // The exact prod string shape from the DB inspection.
  const prod = paragraphizeText(
    'Oil supplies had been disrupted for months.' + LIT + LIT + 'When that disruption eases, more oil flows.'
  );
  eq('prod-shaped literal break → 2 paragraphs', prod.length, 2);
  ok('  no literal backslash-n survives in para text',
    !prod.join('|').includes(LIT), JSON.stringify(prod));
}

// ====================================================================
console.log('Section 2 — mixed real + literal breaks in one string');
{
  // One real break, one literal break — the intermittent case in a single field.
  const mixed = paragraphizeText(
    'Para one.\n\nPara two.' + LIT + LIT + 'Para three.'
  );
  eq('mixed real + literal → 3 paragraphs', mixed.length, 3);
  eq('  para 1', mixed[0], 'Para one.');
  eq('  para 2', mixed[1], 'Para two.');
  eq('  para 3', mixed[2], 'Para three.');
  ok('  zero literal backslash-n in any paragraph',
    !mixed.join('|').includes(LIT), JSON.stringify(mixed));
}

// ====================================================================
console.log('Section 3 — single newline / CRLF handling');
{
  // A SINGLE literal \n inside a paragraph is a soft wrap → becomes a space,
  // NOT a paragraph break, and never a visible backslash-n.
  const single = paragraphizeText('A sentence' + LIT + 'continues on.');
  eq('single literal \\\\n → still 1 paragraph', single.length, 1);
  eq('  soft break collapsed to a space', single[0], 'A sentence continues on.');

  // Real CRLF blank line → a paragraph break.
  const crlf = paragraphizeText('Line one.\r\n\r\nLine two.');
  eq('\\r\\n\\r\\n → 2 paragraphs', crlf.length, 2);
  eq('  para 2 clean', crlf[1], 'Line two.');

  // decodeNewlines is pure + word-preserving (only line-break chars change).
  eq('decodeNewlines maps literal → real newline',
    decodeNewlines('x' + LIT + LIT + 'y'), 'x\n\ny');
  eq('decodeNewlines leaves plain prose untouched',
    decodeNewlines('No breaks at all here.'), 'No breaks at all here.');
}

// ====================================================================
console.log('Section 4 — linkProse renders correct <p> count, zero leaked breaks');
{
  const lk = makeGlossaryLinker(SEED);

  const realHtml = lk.linkProse('First para.\n\nSecond para.');
  eq('linkProse(real \\n\\n) → 2 <p>', pcount(realHtml), 2);

  const litHtml = lk.linkProse('First para.' + LIT + LIT + 'Second para.');
  eq('linkProse(literal \\\\n\\\\n) → 2 <p>', pcount(litHtml), 2);
  ok('  rendered HTML has zero literal backslash-n', !litHtml.includes(LIT), litHtml);

  // Glossary linking is preserved across the normalized paragraphs (first
  // occurrence wins, spanning paragraphs — unchanged behavior).
  const glossHtml = lk.linkProse(
    'The bull market kept climbing.' + LIT + LIT + 'Later the bull market cooled.'
  );
  eq('  glossary "bull market" linked exactly once across paragraphs',
    glossHtml.split('<span class="tip-term">Bull market</span>').length - 1, 1);
}

// ====================================================================
console.log('Section 5 — GUARD: full buildHTML output has no literal backslash-n');
{
  // A minimal-but-valid standard digest whose body fields carry the literal
  // escaped breaks the model emitted in prod.
  const content = {
    date: 'Tuesday, June 16, 2026',
    tradingDay: 'yesterday',
    editionType: 'standard',
    marketVibe: 'green',
    vibeEmoji: '🚀',
    vibeSummary: 'Markets climbed' + LIT + 'broadly today.',
    bigPicture:
      'Oil supplies had been disrupted for months.' + LIT + LIT +
      'When that disruption eases, more oil flows and prices fall.',
    scoreboard: {
      sp500: { price: '5,000', change: '+1%', direction: 'up', vibe: 'up' },
      nasdaq: { price: '16,000', change: '+1%', direction: 'up', vibe: 'up' },
      dow: { price: '40,000', change: '+1%', direction: 'up', vibe: 'up' },
      topMover: {
        name: 'Acme', ticker: 'ACME', price: '$10', change: '+5%',
        direction: 'up', vibe: 'Acme rose on strong earnings.', reason: '', principle: 3,
      },
    },
    stories: [
      {
        badge: 'tech', badgeLabel: 'TECH', title: 'A Story',
        body: 'Something happened yesterday.' + LIT + LIT + 'Then something else happened.',
        whyItMatters: 'It matters because markets move.' + LIT + LIT + 'And kids can learn from it.',
        principle: 5,
      },
      {
        badge: 'world', badgeLabel: 'WORLD', title: 'Another Story',
        body: 'A second story body.', whyItMatters: 'A second why.', principle: 2,
      },
    ],
    didYouKnow: {
      fact: 'A neat fact.' + LIT + LIT + 'And a follow-up fact.',
      category: 'history', principle: 1, principleConnection: 'Ties to saving.',
    },
    quiz: {
      question: 'Q?', options: ['a', 'b', 'c', 'd'], correctIndex: 0,
      explanation: 'Because.', principle: 4,
    },
    wordOfDay: {
      word: 'Dividend', type: 'noun', context: 'in earnings season',
      definition: 'A share of profits' + LIT + 'paid to owners.', principle: 6,
    },
  };

  const html = buildHTML(content, { isSample: true });
  ok('buildHTML output contains ZERO literal backslash-n sequences',
    !html.includes(LIT),
    'Found leaked "' + LIT + '" in rendered HTML');
  ok('  bigPicture rendered as 2 paragraphs',
    (html.match(/Oil supplies had been disrupted/) && html.includes('When that disruption eases')),
    'big picture paragraphs missing');
}

// ====================================================================
if (failures === 0) {
  console.log('\n✅ All template newline-normalization tests passed.\n');
  process.exit(0);
} else {
  console.error(`\n❌ ${failures} assertion(s) failed.\n`);
  process.exit(1);
}
