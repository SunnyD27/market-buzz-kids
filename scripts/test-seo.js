// scripts/test-seo.js
//
// Smoke test for technical SEO + AI discoverability (src/seo.js, the
// canonical-host redirect, robots.txt / sitemap.xml / llms.txt, noindex
// policy, landing JSON-LD + FAQ, /sample head tags).
//
// Offline — no DB, no network, no secrets, no writes:
//   1. Pure unit tests of src/seo.js + template.buildHeadMeta.
//   2. Static-file consistency checks (landing.html JSON-LD parses, every
//      FAQPage question is visible on the page, every absolute site URL in
//      landing/privacy/llms.txt uses SITE_ORIGIN, noindex metas present).
//   3. Boots src/server.js on PORT 3199 (override: SEO_TEST_PORT) with a
//      SCRUBBED env and cwd set to an empty temp dir, so dotenv finds no .env:
//      DATABASE_URL / FMP / Anthropic keys are all unset → boot migrations and
//      the digest bootstrap both skip (they log "skipping"). Then hits the
//      public routes over HTTP with explicit Host headers.
//      Skip with --no-server.
//
// Usage:  node scripts/test-seo.js [--no-server]

import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

import {
  CANONICAL_HOST, SITE_ORIGIN, REDIRECT_HOSTS, absoluteUrl,
  canonicalRedirectTarget, PUBLIC_PAGES, buildSitemapXml, buildRobotsTxt,
  ALLOWED_BOTS, ROBOTS_DISALLOW, isNoindexPath,
} from '../src/seo.js';
import { buildHeadMeta, SAMPLE_SEO } from '../src/template.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');

let failures = 0;
function ok(label, cond, detail) {
  if (cond) console.log(`  ✅ ${label}`);
  else { failures++; console.error(`  ❌ ${label}` + (detail ? `\n     ${detail}` : '')); }
}
function eq(label, a, b) {
  ok(label, a === b, a === b ? '' : `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
const read = (rel) => fs.readFileSync(path.join(PUB, rel), 'utf-8');

const ALT_HOST = [...REDIRECT_HOSTS][0];

// ====================================================================
console.log('\n1. src/seo.js — canonical host + redirect decision');
eq('SITE_ORIGIN is https + CANONICAL_HOST', SITE_ORIGIN, `https://${CANONICAL_HOST}`);
ok('exactly one redirect host, and it is not the canonical host',
  REDIRECT_HOSTS.size === 1 && !REDIRECT_HOSTS.has(CANONICAL_HOST));
eq('absoluteUrl("/sample")', absoluteUrl('/sample'), `${SITE_ORIGIN}/sample`);

const R = (method, hostname, originalUrl) => canonicalRedirectTarget({ method, hostname, originalUrl });
eq('GET / on alt host → canonical /', R('GET', ALT_HOST, '/'), `${SITE_ORIGIN}/`);
eq('GET keeps path + query', R('GET', ALT_HOST, '/sample?src=mm-share&x=1'), `${SITE_ORIGIN}/sample?src=mm-share&x=1`);
eq('HEAD redirects too', R('HEAD', ALT_HOST, '/privacy'), `${SITE_ORIGIN}/privacy`);
eq('host match is case-insensitive + port-stripped', R('GET', ALT_HOST.toUpperCase() + ':443', '/'), `${SITE_ORIGIN}/`);
eq('POST /api/webhooks/resend on alt host → no redirect', R('POST', ALT_HOST, '/api/webhooks/resend'), null);
eq('POST /api/cron/send-digest on alt host → no redirect', R('POST', ALT_HOST, '/api/cron/send-digest'), null);
eq('canonical host → no redirect', R('GET', CANONICAL_HOST, '/'), null);
eq('localhost → no redirect', R('GET', 'localhost', '/'), null);
eq('*.up.railway.app → no redirect', R('GET', 'lmiak7ju.up.railway.app', '/'), null);
eq('look-alike host → no redirect', R('GET', `evil${ALT_HOST}`, '/'), null);
eq('protocol-relative path stays on SITE_ORIGIN', R('GET', ALT_HOST, '//evil.com/x'), `${SITE_ORIGIN}/evil.com/x`);

// ====================================================================
console.log('\n2. sitemap.xml builder');
const sm = buildSitemapXml();
ok('starts with XML decl + urlset ns', sm.startsWith('<?xml') && sm.includes('http://www.sitemaps.org/schemas/sitemap/0.9'));
for (const p of ['/', '/sample', '/privacy']) ok(`contains ${p}`, sm.includes(`<loc>${absoluteUrl(p)}</loc>`));
ok('every PUBLIC_PAGES entry has a YYYY-MM-DD lastmod', PUBLIC_PAGES.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.lastmod)));
eq('lastmod count == url count', (sm.match(/<lastmod>/g) || []).length, (sm.match(/<url>/g) || []).length);
ok('no auth-gated pages in sitemap', !/\/(digest|login|progress|admin)</.test(sm));
const sm2 = buildSitemapXml(['/parents', { path: '/learn/what-is-a-stock', lastmod: '2026-10-05' }, '/sample']);
ok('extraUrls: string path appended', sm2.includes(`<loc>${absoluteUrl('/parents')}</loc>`));
ok('extraUrls: object with lastmod appended',
  sm2.includes(`<loc>${absoluteUrl('/learn/what-is-a-stock')}</loc>\n    <lastmod>2026-10-05</lastmod>`));
eq('extraUrls: duplicate /sample deduped', (sm2.match(/\/sample<\/loc>/g) || []).length, 1);
ok('xml-escapes &', buildSitemapXml(['/a?b=1&c=2']).includes('/a?b=1&amp;c=2'));

// ====================================================================
console.log('\n3. robots.txt builder');
const rb = buildRobotsTxt();
for (const bot of ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User',
  'PerplexityBot', 'Google-Extended', 'Applebot-Extended', 'Bingbot']) {
  ok(`explicit group for ${bot}`, rb.includes(`User-agent: ${bot}\nAllow: /\n`));
}
ok('wildcard group present', rb.includes('User-agent: *\nAllow: /\n'));
for (const d of ['/api/', '/admin', '/digest', '/progress', '/generate', '/parent/', '/reset-password', '/forgot-password', '/login']) {
  ok(`Disallow ${d}`, ROBOTS_DISALLOW.includes(d) && rb.includes(`Disallow: ${d}\n`));
}
eq('every group repeats the full Disallow list',
  (rb.match(/^Disallow: \/digest$/gm) || []).length, ALLOWED_BOTS.length + 1);
ok('Sitemap line points at SITE_ORIGIN', rb.includes(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`));
ok('does not disallow public pages', !/^Disallow: \/(sample|privacy|llms\.txt)?$/m.test(rb));

// ====================================================================
console.log('\n4. noindex policy');
for (const p of ['/digest', '/progress', '/login', '/forgot-password', '/reset-password', '/parent/delete-data',
  '/admin', '/generate', '/games-preview.html', '/api/health']) {
  ok(`noindex: ${p}`, isNoindexPath(p));
}
for (const p of ['/', '/sample', '/privacy', '/llms.txt', '/robots.txt', '/sitemap.xml', '/landing.css', '/digestive', '/administer']) {
  ok(`indexable: ${p}`, !isNoindexPath(p));
}

// ====================================================================
console.log('\n5. template.buildHeadMeta');
const sampleHead = buildHeadMeta({ isSample: true });
ok('sample: title', sampleHead.includes(`<title>${SAMPLE_SEO.title}</title>`));
ok('sample: description', sampleHead.includes('<meta name="description"'));
ok('sample: canonical', sampleHead.includes(`<link rel="canonical" href="${SITE_ORIGIN}/sample">`));
ok('sample: og:url/og:image/twitter:card', sampleHead.includes(`og:url" content="${SITE_ORIGIN}/sample"`)
  && sampleHead.includes('og:image') && sampleHead.includes('twitter:card'));
ok('sample: NOT noindex', !sampleHead.includes('noindex'));
const digestHead = buildHeadMeta({ kidName: 'Sam' });
ok('digest: noindex', digestHead.includes('<meta name="robots" content="noindex, nofollow">'));
ok('digest: no canonical', !digestHead.includes('canonical'));

// ====================================================================
console.log('\n6. Static files — landing JSON-LD, FAQ, canonical origin');
const landing = read('landing.html');
const ldBlocks = [...landing.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));
eq('landing has one JSON-LD block', ldBlocks.length, 1);
let graph = [];
try { graph = JSON.parse(ldBlocks[0])['@graph']; ok('JSON-LD parses', Array.isArray(graph)); }
catch (e) { ok('JSON-LD parses', false, e.message); }
const byType = (t) => graph.find((n) => n['@type'] === t);
const org = byType('Organization');
ok('Organization: name + url + logo', org?.name === 'Market Juice' && org?.url === `${SITE_ORIGIN}/`
  && org?.logo?.url === `${SITE_ORIGIN}/icons/logo.png`);
ok('WebSite present', byType('WebSite')?.url === `${SITE_ORIGIN}/`);
const course = byType('Course');
ok('Course: free, price 0', course?.isAccessibleForFree === true && course?.offers?.price === 0);
ok('Course: ages 10-16 (matches landing copy)', course?.audience?.suggestedMinAge === 10
  && course?.audience?.suggestedMaxAge === 16 && landing.includes('ages 10&#x2011;16'));
const visiblePrinciples = [...landing.matchAll(/<div class="principle">[\s\S]*?<h4>(.*?)<\/h4>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));
eq('Course.teaches == the 11 visible principles', JSON.stringify(course?.teaches), JSON.stringify(visiblePrinciples));
const faqLd = byType('FAQPage');
const qs = faqLd?.mainEntity || [];
ok('FAQPage has 6-8 questions', qs.length >= 6 && qs.length <= 8, `got ${qs.length}`);
const stripTags = (s) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const visibleFaq = [...landing.matchAll(/<div class="faq-item">\s*<h3>(.*?)<\/h3>\s*<p>([\s\S]*?)<\/p>/g)]
  .map((m) => ({ q: stripTags(m[1]), a: stripTags(m[2]) }));
eq('visible FAQ count == JSON-LD count', visibleFaq.length, qs.length);
qs.forEach((q, i) => {
  const v = visibleFaq[i] || {};
  ok(`FAQ ${i + 1} question visible: "${q.name}"`, v.q === q.name);
  // The privacy answer swaps the visible link for the absolute URL in JSON-LD.
  const ldAnswer = q.acceptedAnswer.text.replace(/ at https?:\/\/\S+?\/privacy\./, '.');
  ok(`FAQ ${i + 1} answer matches visible text`, v.a === ldAnswer, `visible: ${v.a}\n     ld:      ${ldAnswer}`);
});
ok('landing canonical = SITE_ORIGIN/', landing.includes(`<link rel="canonical" href="${SITE_ORIGIN}/">`));
ok('landing og:image + og:site_name + twitter:card', landing.includes('property="og:image"')
  && landing.includes('property="og:site_name"') && landing.includes('name="twitter:card"'));
ok('landing has no public link to /digest', !/href="\/digest"/.test(landing));
ok('landing footer links /sample', /<div class="foot-links">[\s\S]*?href="\/sample"/.test(landing));

const llms = read('llms.txt');
ok('llms.txt H1 + blockquote', llms.startsWith('# Market Juice\n') && /\n> .+/.test(llms));
ok('llms.txt has ## Learn section', llms.includes('\n## Learn\n'));
ok('llms.txt lists all 11 principles', visiblePrinciples.every((p) => llms.includes(p)));

const privacy = read('privacy.html');
ok('privacy: description + canonical', privacy.includes('<meta name="description"')
  && privacy.includes(`<link rel="canonical" href="${SITE_ORIGIN}/privacy">`));
ok('privacy: indexable (no robots noindex)', !privacy.includes('name="robots"'));

// Every absolute URL on our own domain must use the canonical origin.
const siteUrlRe = /https?:\/\/(?:www\.)?themarketjuice\.com[^\s"'<>)]*/g;
for (const f of ['landing.html', 'privacy.html', 'llms.txt']) {
  const bad = (read(f).match(siteUrlRe) || []).filter((u) => !u.startsWith(SITE_ORIGIN));
  ok(`${f}: all site URLs use ${SITE_ORIGIN}`, bad.length === 0, bad.join(', '));
}
for (const f of ['login.html', 'forgot-password.html', 'reset-password.html', 'parent-delete-data.html', 'games-preview.html']) {
  ok(`${f}: <meta name="robots" content="noindex…">`, /<meta name="robots" content="noindex/.test(read(f)));
}
ok('no static public/robots.txt or sitemap.xml shadowing the dynamic routes',
  !fs.existsSync(path.join(PUB, 'robots.txt')) && !fs.existsSync(path.join(PUB, 'sitemap.xml')));

// ====================================================================
async function liveChecks() {
  const PORT = Number(process.env.SEO_TEST_PORT || 3199);
  console.log(`\n7. Live server on :${PORT} (no DB, scrubbed env, empty cwd)`);
  const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-seo-test-'));
  const env = { PATH: process.env.PATH, PORT: String(PORT), NODE_ENV: 'development' };
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], { cwd: tmpCwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });

  const req = (method, urlPath, host) => new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, method, path: urlPath, headers: { Host: host || `localhost:${PORT}` } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    r.on('error', reject);
    r.end();
  });

  try {
    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      await new Promise((r) => setTimeout(r, 200));
      try { await req('GET', '/health'); up = true; } catch { /* not yet */ }
    }
    ok('server booted without DATABASE_URL', up, log.slice(-800));
    if (!up) return;
    ok('boot skipped DB migrations (no DATABASE_URL)', log.includes('DATABASE_URL not set'));

    let r = await req('GET', '/robots.txt');
    ok('/robots.txt 200 text/plain', r.status === 200 && /text\/plain/.test(r.headers['content-type']));
    ok('/robots.txt body = buildRobotsTxt()', r.body === buildRobotsTxt());

    r = await req('GET', '/sitemap.xml');
    ok('/sitemap.xml 200 xml', r.status === 200 && /xml/.test(r.headers['content-type']));
    ok('/sitemap.xml has /, /sample, /privacy', ['/', '/sample', '/privacy'].every((p) => r.body.includes(`<loc>${absoluteUrl(p)}</loc>`)));

    r = await req('GET', '/llms.txt');
    ok('/llms.txt 200 text/plain', r.status === 200 && /text\/plain/.test(r.headers['content-type']));
    ok('/llms.txt starts with "# Market Juice"', r.body.startsWith('# Market Juice'));

    r = await req('GET', '/sample');
    ok('/sample 200', r.status === 200, `status ${r.status}`);
    ok('/sample title + canonical', r.body.includes(`<title>${SAMPLE_SEO.title}</title>`)
      && r.body.includes(`<link rel="canonical" href="${SITE_ORIGIN}/sample">`));
    ok('/sample indexable (no noindex meta or header)', !r.body.includes('noindex') && !r.headers['x-robots-tag']);

    r = await req('GET', '/');
    ok('/ 200 on localhost (no redirect)', r.status === 200);
    ok('/ serves landing with JSON-LD', r.body.includes('application/ld+json'));

    r = await req('GET', '/', CANONICAL_HOST);
    ok(`/ 200 on canonical host ${CANONICAL_HOST}`, r.status === 200, `status ${r.status}`);
    r = await req('GET', '/', 'lmiak7ju.up.railway.app');
    ok('/ 200 on *.up.railway.app', r.status === 200, `status ${r.status}`);

    r = await req('GET', '/', ALT_HOST);
    ok(`/ on ${ALT_HOST} → 301 ${SITE_ORIGIN}/`, r.status === 301 && r.headers.location === `${SITE_ORIGIN}/`, `${r.status} ${r.headers.location}`);
    r = await req('GET', '/sample?src=mm-share', ALT_HOST);
    ok(`/sample?src=mm-share on ${ALT_HOST} → 301 keeps path+query`,
      r.status === 301 && r.headers.location === `${SITE_ORIGIN}/sample?src=mm-share`, `${r.status} ${r.headers.location}`);
    r = await req('GET', '/robots.txt', ALT_HOST);
    ok(`/robots.txt on ${ALT_HOST} → 301`, r.status === 301);
    r = await req('POST', '/api/cron/send-digest', ALT_HOST);
    ok(`POST /api/cron/send-digest on ${ALT_HOST} NOT redirected`, r.status !== 301 && r.status !== 308, `status ${r.status}`);
    r = await req('POST', '/api/webhooks/resend', ALT_HOST);
    ok(`POST /api/webhooks/resend on ${ALT_HOST} NOT redirected`, r.status !== 301 && r.status !== 308, `status ${r.status}`);

    r = await req('GET', '/login');
    ok('/login 200 + X-Robots-Tag noindex', r.status === 200 && /noindex/.test(r.headers['x-robots-tag'] || ''));
    r = await req('GET', '/parent/delete-data');
    ok('/parent/delete-data X-Robots-Tag noindex', /noindex/.test(r.headers['x-robots-tag'] || ''));
    r = await req('GET', '/digest');
    ok('/digest (logged out) not 200 + X-Robots-Tag noindex', r.status !== 200 && /noindex/.test(r.headers['x-robots-tag'] || ''), `status ${r.status}`);
    r = await req('GET', '/privacy');
    ok('/privacy 200, no X-Robots-Tag', r.status === 200 && !r.headers['x-robots-tag']);

    // Static-leak gate must still beat express.static.
    r = await req('GET', '/index.html');
    ok('static-leak gate: /index.html → redirect /digest', r.status === 302 && r.headers.location === '/digest', `${r.status} ${r.headers.location}`);
    r = await req('GET', '/digest-data.json');
    ok('static-leak gate: /digest-data.json → redirect /digest', r.status === 302 && r.headers.location === '/digest', `${r.status} ${r.headers.location}`);
  } finally {
    child.kill('SIGTERM');
    try { fs.rmSync(tmpCwd, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

if (!process.argv.includes('--no-server')) await liveChecks();

// ====================================================================
if (failures === 0) {
  console.log('\n✅ All SEO / discoverability tests passed.\n');
  process.exit(0);
} else {
  console.error(`\n❌ ${failures} assertion(s) failed.\n`);
  process.exit(1);
}
