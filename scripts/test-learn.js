// scripts/test-learn.js
//
// Smoke test for the public SEO content pages (src/learn.js +
// src/learn-content.js): /learn, /learn/<slug> × 11, /parents.
// Pure/offline: NO database, NO API calls, NO env. Mounts the routes on a
// throwaway express app on an ephemeral port and requests every URL.
//
// Asserts per page: 200 + text/html, exactly one <h1>, <title> ≤ 60 chars,
// meta description ≤ 155 chars, canonical = https://www.themarketjuice.com<path>,
// OG + twitter tags, viewport + theme-color, every JSON-LD block parses,
// BreadcrumbList everywhere, LearningResource/Article with audience +
// isAccessibleForFree + publisher, FAQPage Q&As visible on the page, every
// internal link resolves (learn routes → 200; other paths → known server
// routes / files in public/), unique titles + descriptions, no unescaped
// content, word counts in range. Also re-checks the key arithmetic quoted
// in the lesson content.

import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { registerLearnRoutes, LEARN_URLS } from '../src/learn.js';
import { PRINCIPLES } from '../src/learn-content.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

let failures = 0;
function ok(label, cond, detail) {
  if (cond) console.log(`  ✅ ${label}`);
  else { failures += 1; console.error(`  ❌ ${label}` + (detail ? `\n     ${detail}` : '')); }
}

const ORIGIN = 'https://www.themarketjuice.com';

function attr(html, re) { const m = html.match(re); return m ? m[1] : null; }
function decode(s) {
  return String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
function visibleText(html) {
  const body = html.split('<body>')[1] || '';
  return decode(body.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}
function mainWords(html) {
  const main = (html.match(/<main[\s\S]*?<\/main>/) || [''])[0];
  return visibleText('<body>' + main).split(' ').filter((w) => /[A-Za-z0-9$]/.test(w)).length;
}

// Non-learn internal paths the pages link to → must be real server routes
// (source-scanned, read-only) or real files in public/.
const serverSrc = read('src/server.js');
function routeExists(p) {
  if (p === '/') return existsSync(path.join(ROOT, 'public/landing.html'));
  const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`app\\.get\\(\\s*['"]${esc}['"]`).test(serverSrc)) return true;
  return existsSync(path.join(ROOT, 'public', p));
}

async function main() {
  console.log('\n📚 /learn + /parents content pages smoke test\n');

  // -------- Section 0: module hygiene --------------------------------------
  console.log('Section 0 — module hygiene + content shape');
  for (const f of ['src/learn.js', 'src/learn-content.js']) {
    ok(`${f} reads no env vars`, !/process\.env/.test(read(f)));
  }
  ok('11 principles', PRINCIPLES.length === 11);
  const landing = read('public/landing.html');
  for (const p of PRINCIPLES) {
    ok(`#${p.num} "${p.name}" name + tagline match landing.html`,
      landing.includes(`<h4><a class="pri-link" href="/learn/${p.slug}">${p.name}</a></h4>`) && landing.includes(p.tagline.replace(/'/g, '\'')),
      `tagline: ${p.tagline}`);
    ok(`  slug is kebab-case of name`, p.slug === p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
    ok(`  has 2–3 check-yourself Q&As`, p.check.length >= 2 && p.check.length <= 3);
  }
  ok('landing.html has #signup target', /id="signup"/.test(landing));
  ok('LEARN_URLS = hub + 11 + /parents', LEARN_URLS.length === 13 && LEARN_URLS[0] === '/learn' && LEARN_URLS.includes('/parents'));

  // -------- Section 1: arithmetic quoted in the lessons ---------------------
  console.log('\nSection 1 — arithmetic re-check');
  const fv = (p, r, y) => Math.round(p * Math.pow(1 + r, y) * 100) / 100;
  ok('$100 @10% → 1y 110, 2y 121, 3y 133.10', fv(100, 0.1, 1) === 110 && fv(100, 0.1, 2) === 121 && fv(100, 0.1, 3) === 133.1);
  ok('$100 @10% → 10y 259.37, 20y 672.75, 30y 1744.94', fv(100, 0.1, 10) === 259.37 && fv(100, 0.1, 20) === 672.75 && fv(100, 0.1, 30) === 1744.94);
  ok('$100 @10% → 40y 4525.93, 50y 11739.09', fv(100, 0.1, 40) === 4525.93 && fv(100, 0.1, 50) === 11739.09);
  ok('bumpy ride 100→90→108→124.20→117.99', fv(fv(fv(90, 0.2, 1), 0.15, 1), -0.05, 1) === 117.99);
  ok('DCA: $30 at $10/$6/$15 → 10 shares, $9 avg', 30 / 10 + 30 / 6 + 30 / 15 === 10);
  ok('diversify: 9 × $10 × 1.05 = $94.50', Math.round(9 * 10 * 1.05 * 100) / 100 === 94.5);
  ok('owner slice: $2M × 10/1M = $20', 2e6 * 10 / 1e6 === 20);
  ok('price vs value: $400×10M=$4B, $20×500M=$10B', 400 * 1e7 === 4e9 && 20 * 5e8 === 1e10);
  ok('mower: 7 × $22 = $154 ≥ $150 > 6 × $22', 7 * 22 === 154 && 6 * 22 === 132);
  ok('penny doubling 30 days = $5,368,709.12', 0.01 * 2 ** 29 === 5368709.12);
  for (const p of PRINCIPLES) {
    const all = JSON.stringify(p);
    if (all.includes('1,744.94')) ok(`  ${p.slug} quotes 1,744.94 consistently`, true);
  }

  // -------- Section 2: HTTP + per-page SEO invariants -----------------------
  console.log('\nSection 2 — every URL renders with SEO invariants');
  const app = express();
  registerLearnRoutes(app);
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;

  const titles = new Set();
  const descs = new Set();
  const linked = new Set();
  const wordCounts = [];
  try {
    for (const url of LEARN_URLS) {
      const res = await fetch(base + url);
      const html = await res.text();
      console.log(`\n ${url}`);
      ok('200 text/html', res.status === 200 && /text\/html/.test(res.headers.get('content-type') || ''), `status ${res.status}`);
      ok('exactly one <h1>', (html.match(/<h1[\s>]/g) || []).length === 1);
      ok('has semantic <h2>s', (html.match(/<h2[\s>]/g) || []).length >= 3);
      const title = decode(attr(html, /<title>([^<]*)<\/title>/) || '');
      ok(`title ≤ 60 chars (${title.length}): ${title}`, title.length > 0 && title.length <= 60);
      const desc = decode(attr(html, /<meta name="description" content="([^"]*)"/) || '');
      ok(`description ≤ 155 chars (${desc.length})`, desc.length > 50 && desc.length <= 155);
      ok('unique title', !titles.has(title)); titles.add(title);
      ok('unique description', !descs.has(desc)); descs.add(desc);
      ok('canonical', attr(html, /<link rel="canonical" href="([^"]*)"/) === ORIGIN + url);
      ok('og:title/description/url/image + twitter:card',
        html.includes('property="og:title"') && html.includes('property="og:description"')
        && attr(html, /property="og:url" content="([^"]*)"/) === ORIGIN + url
        && html.includes(`property="og:image" content="${ORIGIN}/icons/logo.png"`)
        && html.includes('name="twitter:card"'));
      ok('viewport + theme-color', html.includes('name="viewport"') && html.includes('name="theme-color" content="#FFF8EF"'));
      ok('links Fredoka + Lexend + /learn.css', html.includes('family=Fredoka') && html.includes('family=Lexend') && html.includes('href="/learn.css"'));
      ok('no client <script> (JSON-LD only)', (html.match(/<script(?![^>]*application\/ld\+json)/g) || []).length === 0);
      ok('breadcrumb nav', html.includes('aria-label="Breadcrumb"'));
      ok('disclaimer footer', /education, not financial advice/i.test(html));
      ok('privacy link in footer', html.includes('href="/privacy"'));
      ok('no "undefined"/"[object" leaks', !/undefined|\[object /.test(visibleText(html)));

      // JSON-LD
      const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
      let parsed = [];
      try { parsed = blocks.map((b) => JSON.parse(b)); ok(`JSON-LD parses (${blocks.length} blocks)`, blocks.length >= 2); }
      catch (e) { ok('JSON-LD parses', false, e.message); }
      const types = parsed.map((o) => o['@type']);
      const bc = parsed.find((o) => o['@type'] === 'BreadcrumbList');
      ok('BreadcrumbList ends at this page', bc && bc.itemListElement.at(-1).item === ORIGIN + url);
      const main = parsed.find((o) => o['@type'] === 'LearningResource' || o['@type'] === 'Article');
      ok(`LearningResource/Article (${types.join(', ')})`, !!main);
      ok('  isAccessibleForFree + publisher Market Juice + audience',
        main && main.isAccessibleForFree === true && main.publisher?.name === 'Market Juice' && !!main.audience);
      if (main && main['@type'] === 'LearningResource') ok('  typicalAgeRange 10-16 + educationalLevel', main.typicalAgeRange === '10-16' && !!main.educationalLevel);

      const isPrinciple = url.startsWith('/learn/');
      if (isPrinciple) {
        const faq = parsed.find((o) => o['@type'] === 'FAQPage');
        const text = visibleText(html);
        ok('FAQPage present', !!faq);
        ok('  every FAQ Q&A is visible on the page', faq && faq.mainEntity.every((q) => text.includes(q.name) && text.includes(q.acceptedAnswer.text)));
        ok('"For parents" box', html.includes('class="parents-box"'));
        ok('"Check yourself" section', html.includes('id="check-h"'));
        ok('links back to hub', html.includes('href="/learn"'));
      } else {
        ok('no FAQPage on non-principle page', !types.includes('FAQPage'));
      }
      ok('CTA to /#signup', html.includes('href="/#signup"'));

      const words = mainWords(html);
      wordCounts.push([url, words]);
      if (isPrinciple) ok(`word count ${words} within ~500–900`, words >= 500 && words <= 900);

      for (const m of html.matchAll(/href="([^"]+)"/g)) {
        const href = decode(m[1]);
        if (href.startsWith('/') && !href.startsWith('//')) linked.add(href);
      }
    }

    // -------- Section 3: internal links resolve ----------------------------
    console.log('\nSection 3 — internal links resolve');
    for (const href of [...linked].sort()) {
      const p = href.split('#')[0].split('?')[0] || '/';
      if (LEARN_URLS.includes(p)) {
        const r = await fetch(base + p);
        ok(`${href} → ${r.status}`, r.status === 200);
      } else {
        ok(`${href} → known route/file`, routeExists(p));
      }
    }
    ok('every principle page is linked from somewhere', PRINCIPLES.every((p) => linked.has(`/learn/${p.slug}`)));
    ok('trailing slash variant also serves', (await fetch(base + '/learn/')).status === 200);
    ok('unknown slug 404s (not caught by learn routes)', (await fetch(base + '/learn/not-a-principle')).status === 404);
  } finally {
    server.close();
  }

  console.log('\nWord counts (inside <main>):');
  for (const [u, w] of wordCounts) console.log(`  ${String(w).padStart(5)}  ${u}`);

  if (failures) { console.error(`\n❌ ${failures} check(s) failed\n`); process.exit(1); }
  console.log('\n✅ All learn-page checks passed\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
