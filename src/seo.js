// src/seo.js
//
// Technical-SEO + AI-discoverability helpers: canonical host, the public
// sitemap, robots.txt, and the noindex policy for auth/utility surfaces.
//
// Pure module — no env reads, no I/O at import time (macOS launchd gotcha:
// see CONTEXT.md "Lazy client initialization"). Everything here is plain
// data + pure functions so scripts/test-seo.js can unit-test it offline.
//
// ── Canonical host ────────────────────────────────────────────────────────
// The canonical origin is the WWW host. DNS today: `www.themarketjuice.com`
// is a CNAME to Railway (it reaches this Express app); the APEX
// `themarketjuice.com` resolves to the registrar's forwarding service
// (15.197.225.128 / 3.33.251.168), which serves "/" but 404s every deep path
// (themarketjuice.com/sample, /privacy, ... — see the same note in
// public/games/mystery-mover.js and the sw.js v9 bump). Canonicalizing to the
// apex would point search engines + the sitemap at URLs that 404.
//
// To move to the apex later: first point the apex at Railway (custom domain +
// ALIAS/flattened CNAME), confirm deep paths serve 200 there, THEN flip
// CANONICAL_HOST below and update the hardcoded origin in public/landing.html
// (canonical, og:url, og:image, JSON-LD) and public/llms.txt — test-seo.js
// asserts those files agree with SITE_ORIGIN, so a half-done flip fails CI.

export const CANONICAL_HOST = 'www.themarketjuice.com';
export const SITE_ORIGIN = `https://${CANONICAL_HOST}`;

// Hosts that should 301 to the canonical host. Exact, lowercase host match
// only — localhost, *.up.railway.app and any other host are never touched.
export const REDIRECT_HOSTS = new Set(
  ['themarketjuice.com', 'www.themarketjuice.com'].filter((h) => h !== CANONICAL_HOST),
);

export function absoluteUrl(pathname = '/') {
  const p = String(pathname || '/');
  return SITE_ORIGIN + (p.startsWith('/') ? p : `/${p}`);
}

/**
 * Pure decision function for the canonical-host redirect.
 * Returns the absolute target URL, or null when no redirect should happen.
 *
 * - Only GET/HEAD: webhooks (/api/webhooks/*), cron triggers (/api/cron/*)
 *   and every other POST keep working on whatever host they were sent to
 *   (a 301 on POST would make clients drop/convert the body).
 * - Only an exact match on a REDIRECT_HOSTS entry (port stripped, case-folded).
 * - Path + query are preserved verbatim.
 */
export function canonicalRedirectTarget({ method, hostname, originalUrl }) {
  const m = String(method || '').toUpperCase();
  if (m !== 'GET' && m !== 'HEAD') return null;
  const host = String(hostname || '').toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  if (!REDIRECT_HOSTS.has(host)) return null;
  let url = String(originalUrl || '/');
  if (!url.startsWith('/')) url = `/${url}`;
  // Guard against protocol-relative smuggling ("//evil.com") — collapse a
  // leading run of slashes so the target always stays on SITE_ORIGIN.
  url = url.replace(/^\/{2,}/, '/');
  return SITE_ORIGIN + url;
}

/** Express middleware wrapper around canonicalRedirectTarget. */
export function canonicalHostRedirect(req, res, next) {
  const target = canonicalRedirectTarget({
    method: req.method,
    hostname: req.hostname, // honors X-Forwarded-Host under `trust proxy`
    originalUrl: req.originalUrl,
  });
  if (target) return res.redirect(301, target);
  next();
}

// ── Sitemap ───────────────────────────────────────────────────────────────
// Public, indexable pages. `lastmod` is the date the page's CONTENT last
// meaningfully changed (hand-maintained — container mtimes on Railway are
// meaningless). Bump it when you edit the page. The lead/other phases append
// extra URLs (e.g. /learn/*, /parents) via buildSitemapXml(extraUrls).
export const PUBLIC_PAGES = [
  { path: '/',        lastmod: '2026-10-05', changefreq: 'weekly',  priority: '1.0' },
  { path: '/sample',  lastmod: '2026-05-25', changefreq: 'monthly', priority: '0.8' },
  { path: '/privacy', lastmod: '2026-05-28', changefreq: 'yearly',  priority: '0.3' },
];

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizeEntry(entry) {
  const e = typeof entry === 'string' ? { path: entry } : { ...entry };
  // Accept either a path ("/learn/x") or a full URL already on SITE_ORIGIN.
  const loc = e.loc || (/^https?:\/\//i.test(e.path || '') ? e.path : absoluteUrl(e.path || '/'));
  return { loc, lastmod: e.lastmod, changefreq: e.changefreq, priority: e.priority };
}

/**
 * Build sitemap.xml. `extraUrls` items may be a path string ('/parents') or
 * an object { path | loc, lastmod?, changefreq?, priority? }. Duplicate locs
 * are dropped (first wins), so appending an already-listed page is harmless.
 */
export function buildSitemapXml(extraUrls = []) {
  const seen = new Set();
  const rows = [];
  for (const raw of [...PUBLIC_PAGES, ...(extraUrls || [])]) {
    const e = normalizeEntry(raw);
    if (seen.has(e.loc)) continue;
    seen.add(e.loc);
    rows.push(
      '  <url>\n' +
      `    <loc>${xmlEscape(e.loc)}</loc>\n` +
      (e.lastmod ? `    <lastmod>${xmlEscape(e.lastmod)}</lastmod>\n` : '') +
      (e.changefreq ? `    <changefreq>${xmlEscape(e.changefreq)}</changefreq>\n` : '') +
      (e.priority ? `    <priority>${xmlEscape(e.priority)}</priority>\n` : '') +
      '  </url>',
    );
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    rows.join('\n') + '\n' +
    '</urlset>\n';
}

// ── robots.txt ────────────────────────────────────────────────────────────
// Search + AI crawlers we explicitly welcome. Each gets its own group (a bot
// obeys only the most specific matching group, so every group repeats the
// Disallow list — otherwise a named bot would be allowed into /digest etc.).
export const ALLOWED_BOTS = [
  'Googlebot',
  'Bingbot',
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'Claude-User',
  'PerplexityBot',
  'Google-Extended',
  'Applebot',
  'Applebot-Extended',
];

// Auth-gated, per-kid, token-bearing or admin surfaces. Never useful in an
// index, and some carry tokens in the query string.
export const ROBOTS_DISALLOW = [
  '/api/',
  '/admin',
  '/digest',
  '/progress',
  '/generate',
  '/parent/',
  '/reset-password',
  '/forgot-password',
  '/login',
];

export function buildRobotsTxt() {
  const disallow = ROBOTS_DISALLOW.map((p) => `Disallow: ${p}`).join('\n');
  const group = (ua) => `User-agent: ${ua}\nAllow: /\n${disallow}\n`;
  return [
    '# Market Juice — free daily market-literacy digest for kids.',
    '# Search engines and AI assistants are welcome to read and cite our public pages.',
    `# Summary for LLMs: ${absoluteUrl('/llms.txt')}`,
    '',
    ...ALLOWED_BOTS.map(group),
    group('*'),
    `Sitemap: ${absoluteUrl('/sitemap.xml')}`,
    '',
  ].join('\n');
}

// ── noindex policy ────────────────────────────────────────────────────────
// Paths that get an `X-Robots-Tag: noindex` response header (belt-and-braces
// with the <meta name="robots"> tags in the static HTML). Prefix match on
// path segments: '/parent/' covers /parent/delete-data; exact entries match
// the path itself or anything beneath it.
export const NOINDEX_PATHS = [
  '/digest',
  '/progress',
  '/login',
  '/forgot-password',
  '/reset-password',
  '/parent/',
  '/admin',
  '/generate',
  '/games-preview.html',
  '/api/',
  '/index.html',
  '/digest-data.json',
];

export function isNoindexPath(pathname) {
  const p = String(pathname || '');
  return NOINDEX_PATHS.some((rule) =>
    rule.endsWith('/')
      ? p.startsWith(rule) || p === rule.slice(0, -1)
      : p === rule || p.startsWith(`${rule}/`));
}

export function noindexHeader(req, res, next) {
  if (isNoindexPath(req.path)) res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
}
