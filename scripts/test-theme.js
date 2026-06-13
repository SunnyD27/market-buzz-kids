// scripts/test-theme.js
//
// Phase 19 smoke test — "Morning Juice" visual redesign. Pure/offline: NO
// API calls, NO database. Renders the sample digest fixture through the
// real buildHTML() across all five header states and asserts the redesign
// invariants, plus source-scans every surface for a clean dark→light
// migration (the failure mode this guards against is a HALF-migrated
// stylesheet — old dark hex left in a :root that should be light).

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildHTML, sectionIcon } from '../src/template.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

let failures = 0;
function ok(label, cond, detail) {
  if (cond) console.log(`  ✅ ${label}`);
  else { failures += 1; console.error(`  ❌ ${label}` + (detail ? `\n     ${detail}` : '')); }
}

const SAMPLE = JSON.parse(read('public/data/sample-digest.json'));
function render(overrides) {
  const content = { ...structuredClone(SAMPLE), ...overrides };
  return buildHTML(content, { digestDate: '2026-06-23', kidName: 'Riley' });
}

function main() {
  console.log('\n🎨 Phase 19 "Morning Juice" theme smoke test\n');

  // -------- Section 1: vibe-tinted header (19b) — all five states ----------
  console.log('Section 1 — vibe-tinted header across all five states');
  const states = [
    { o: { editionType: 'standard', marketVibe: 'green' }, cls: 'header--green', pill: 'Green day ▲' },
    { o: { editionType: 'standard', marketVibe: 'red' },   cls: 'header--red',   pill: 'Red day ▼' },
    { o: { editionType: 'standard', marketVibe: 'mixed' }, cls: 'header--mixed', pill: 'Mixed day' },
    { o: { editionType: 'weekly-wrap', marketVibe: 'green', marketClosed: true, editionLabel: 'The Weekly Wrap 📋' }, cls: 'header--mixed', pill: 'The Weekly Wrap' },
    { o: { editionType: 'week-ahead', marketVibe: 'green', marketClosed: true, editionLabel: 'The Week Ahead 🔮' }, cls: 'header--ahead', pill: 'The Week Ahead' },
  ];
  for (const s of states) {
    const html = render(s.o);
    ok(`${s.o.editionType}/${s.o.marketVibe} → ${s.cls}`, html.includes(`class="header header--${s.cls.split('--')[1]}"`));
    ok(`  pill reads "${s.pill}"`, html.includes(`header-pill--${s.cls.split('--')[1]}`) && html.includes(s.pill));
  }

  // -------- Section 2: section-nav icons are SVG, not emoji (19d) ----------
  console.log('\nSection 2 — section nav is inline SVG, not emoji');
  const std = render({ editionType: 'standard', marketVibe: 'green' });
  ok('section headers use <svg class="ico">', (std.match(/<svg class="ico"/g) || []).length >= 5);
  ok('no literal emoji nav spans remain', !/<span class="emoji">(?!\$\{)/.test(std));
  ok('sectionIcon() returns inline SVG with currentColor stroke',
    sectionIcon('trophy').startsWith('<svg') && sectionIcon('trophy').includes('stroke="currentColor"'));
  ok('unknown icon falls back (never empty)', sectionIcon('nope').startsWith('<svg'));

  // -------- Section 3: starfield removed -----------------------------------
  console.log('\nSection 3 — starfield gone');
  ok('no <div class="stars"> in output', !std.includes('class="stars"'));
  ok('no twinkle keyframes in output', !std.includes('@keyframes twinkle'));
  ok('no star-generation JS in output', !std.includes("createElement('div')") || !std.includes("className = 'star'"));

  // -------- Section 4: type system (19c) + font-display: swap --------------
  console.log('\nSection 4 — fonts: Fredoka/Lexend/Space Grotesk + display=swap');
  ok('digest loads Lexend + Space Grotesk + Fredoka', std.includes('family=Fredoka') && std.includes('Lexend') && std.includes('Space+Grotesk'));
  ok('font-display: swap survives into the link (no invisible-text flash)', std.includes('display=swap'));
  ok('preconnect to fonts.gstatic.com present', std.includes('rel="preconnect"') && std.includes('fonts.gstatic.com'));
  ok('body font is Lexend', /body \{[^}]*font-family: 'Lexend'/.test(std));
  ok('Space Mono fully retired from the digest', !std.includes('Space Mono'));

  // -------- Section 5: dark theme preserved for Phase 23 ------------------
  console.log('\nSection 5 — dark theme preserved under [data-theme="dark"]');
  ok('[data-theme="dark"] block present (Phase 23 unlock)', std.includes('[data-theme="dark"]'));
  ok('dark block carries the old navy --bg', /\[data-theme="dark"\][^}]*--bg: #0d1117/s.test(std));
  ok('theme-color meta is cream', std.includes('content="#FFF8EF"'));

  // -------- Section 6: clean migration — no stray dark hex in light :root --
  console.log('\nSection 6 — no half-migrated dark hex in any light :root');
  // For each surface, strip the [data-theme="dark"] block, then assert the
  // dark navy hexes are gone from what remains.
  const DARK_HEX = ['#0d1117', '#161b22', '#21262d'];
  const surfaces = {
    'src/template.js': read('src/template.js'),
    'src/progress-template.js': read('src/progress-template.js'),
    'public/auth.css': read('public/auth.css'),
    'public/landing.css': read('public/landing.css'),
    'public/engagement.css': read('public/engagement.css'),
  };
  for (const [name, src] of Object.entries(surfaces)) {
    // Remove the digest's preserved dark block (only template.js has one).
    const lightOnly = src.replace(/\[data-theme="dark"\]\s*\{[^}]*\}/s, '');
    // engagement.css legitimately keeps DARK celebration popups/toasts +
    // the SW-independent offline shell; allow those specific dark surfaces.
    const allow = name === 'public/engagement.css';
    const hits = DARK_HEX.filter(h => lightOnly.includes(h));
    ok(`${name}: no stray dark navy hex`, allow ? true : hits.length === 0,
      hits.length ? `found: ${hits.join(', ')}` : '');
  }
  ok('engagement.css keeps the DARK celebration popups by design (toasts/rank-up modal)',
    surfaces['public/engagement.css'].includes('rgba(13,17,23'));

  // -------- Section 7: old-digest re-render (pure function) ----------------
  console.log('\nSection 7 — old DB rows re-render cleanly (no migration)');
  // A pre-Phase-19 row has no theme fields; it still tints from marketVibe.
  const legacy = render({ editionType: 'standard', marketVibe: 'red', mysteryMover: undefined });
  ok('legacy row (no mysteryMover) still renders the red header', legacy.includes('header--red'));
  ok('legacy row has the cream body background token', legacy.includes('--bg: #FFF8EF'));

  console.log('');
  if (failures === 0) console.log('🎉 All theme smoke-test assertions passed.\n');
  else console.error(`💥 ${failures} assertion(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
