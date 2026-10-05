// src/learn.js
//
// Public, server-rendered educational pages for SEO + answer-engine
// discoverability:
//   /learn                 hub — the 11 investing principles
//   /learn/<slug>          one page per principle (src/learn-content.js)
//   /parents               parent's guide to Market Juice
//
// No client JS. No DB. No env reads at import time (or at all) — pages are
// pure functions of src/learn-content.js, rendered once and memoized.
// Styles: public/learn.css (served by the existing express.static mount),
// reusing the landing.css "Morning Juice" palette + Fredoka/Lexend fonts.
//
// Usage (server.js):
//   import { registerLearnRoutes, LEARN_URLS } from './learn.js';
//   registerLearnRoutes(app);            // LEARN_URLS → sitemap

import { SITE, GAMES, PRINCIPLES, HUB, PARENTS } from './learn-content.js';

// ---------------------------------------------------------------------------
// Escaping helpers
// ---------------------------------------------------------------------------

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Escape, then allow the single inline markup the content uses: **bold**.
function inline(s) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

// Plain text (for meta tags / JSON-LD): strip the **bold** markers.
function plain(s) {
  return String(s ?? '').replace(/\*\*(.+?)\*\*/g, '$1');
}

// JSON-LD must not be able to close its <script> tag.
function jsonLd(obj) {
  const json = JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
  return `<script type="application/ld+json">${json}</script>`;
}

function renderBlocks(blocks) {
  return (blocks || []).map((b) => {
    if (typeof b === 'string') return `<p>${inline(b)}</p>`;
    if (b.ul) return `<ul>${b.ul.map((li) => `<li>${inline(li)}</li>`).join('')}</ul>`;
    if (b.ol) return `<ol>${b.ol.map((li) => `<li>${inline(li)}</li>`).join('')}</ol>`;
    if (b.math) return `<p class="math">${inline(b.math)}</p>`;
    if (b.table) {
      const t = b.table;
      const head = `<thead><tr>${t.head.map((h) => `<th scope="col">${inline(h)}</th>`).join('')}</tr></thead>`;
      const rows = t.rows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${inline(c)}</th>` : `<td>${inline(c)}</td>`)).join('')}</tr>`).join('');
      return `<div class="table-wrap"><table>${t.caption ? `<caption>${inline(t.caption)}</caption>` : ''}${head}<tbody>${rows}</tbody></table></div>`;
    }
    return '';
  }).join('\n');
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

const abs = (p) => SITE.origin + p;

const PUBLISHER = {
  '@type': 'Organization',
  name: SITE.name,
  url: SITE.origin,
  logo: { '@type': 'ImageObject', url: SITE.ogImage },
};

const STUDENT_AUDIENCE = {
  '@type': 'EducationalAudience',
  educationalRole: 'student',
  audienceType: `Kids and teens ${SITE.ageLabel}`,
};

function breadcrumbLd(crumbs) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: abs(c.path),
    })),
  };
}

function breadcrumbNav(crumbs) {
  const items = crumbs.map((c, i) => (i === crumbs.length - 1
    ? `<li aria-current="page">${esc(c.name)}</li>`
    : `<li><a href="${esc(c.path)}">${esc(c.name)}</a></li>`)).join('');
  return `<nav class="crumbs" aria-label="Breadcrumb"><ol>${items}</ol></nav>`;
}

const DISCLAIMER = 'Market Juice is education, not financial advice. Examples use made-up numbers for learning.';

/**
 * Shared page layout: head (meta/OG/twitter/canonical/JSON-LD), site header,
 * main, footer. `body` is trusted HTML built by this module.
 */
function layout({ path, title, description, ogType = 'article', ld = [], body }) {
  const url = abs(path);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#FFF8EF">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta name="robots" content="index, follow">
<meta property="og:site_name" content="${esc(SITE.name)}">
<meta property="og:type" content="${esc(ogType)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(SITE.ogImage)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(SITE.ogImage)}">
<link rel="icon" type="image/svg+xml" href="/icons/icon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Lexend:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/learn.css">
${ld.map(jsonLd).join('\n')}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="/" aria-label="Market Juice home">
      <img src="/icons/logo.png" alt="" width="36" height="36">
      <span>Market Juice</span>
    </a>
    <nav class="site-nav" aria-label="Main">
      <a href="/learn">Learn</a>
      <a href="/parents">Parents</a>
      <a href="/sample">Sample</a>
      <a class="nav-cta" href="/#signup">Sign up</a>
    </nav>
  </div>
</header>
<main id="main" class="wrap">
${body}
</main>
<footer class="site-footer">
  <div class="wrap">
    <p class="foot-links"><a href="/">Home</a> · <a href="/learn">Learn</a> · <a href="/parents">Parents</a> · <a href="/sample">Sample digest</a> · <a href="/privacy">Privacy</a></p>
    <p class="foot-fine">${esc(DISCLAIMER)}</p>
  </div>
</footer>
</body>
</html>`;
}

function ctaBox(heading = 'Learn one of these every morning') {
  return `<section class="cta-box" aria-label="Sign up">
  <h2>${esc(heading)}</h2>
  <p>Market Juice is a free daily digest for kids ${esc(SITE.ageLabel)}: real market news, three quick games, and a lesson that ties back to these principles — about 3 minutes a day.</p>
  <p class="cta-row"><a class="btn btn-primary" href="/#signup">Sign up free →</a> <a class="btn btn-ghost" href="/sample">See a sample digest</a></p>
</section>`;
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

function principlePath(p) { return `/learn/${p.slug}`; }

function renderHub() {
  const crumbs = [{ name: 'Home', path: '/' }, { name: 'Learn', path: HUB.path }];
  const cards = PRINCIPLES.map((p) => `<li class="card">
    <a href="${esc(principlePath(p))}">
      <span class="card-num" aria-hidden="true">${p.num}</span>
      <span class="card-emoji" aria-hidden="true">${p.emoji}</span>
      <span class="card-text"><span class="card-title">${esc(p.name)}</span><span class="card-sub">${esc(p.tagline)}</span></span>
    </a>
  </li>`).join('\n');

  const body = `${breadcrumbNav(crumbs)}
<article>
<h1>${esc(HUB.h1)}</h1>
${renderBlocks(HUB.intro)}
<section aria-labelledby="principles-h">
  <h2 id="principles-h">The 11 principles</h2>
  <ol class="cards">
${cards}
  </ol>
</section>
<section aria-labelledby="how-h">
  <h2 id="how-h">How to use these lessons</h2>
  <ul>
    <li><strong>Kids and teens:</strong> read one a day. Try the "Check yourself" questions before peeking at the answers.</li>
    <li><strong>Parents:</strong> each lesson has a short "For parents" box with one way to bring the idea into everyday life. Our <a href="/parents">parent's guide</a> explains how Market Juice works.</li>
    <li><strong>Everyone:</strong> the examples use made-up numbers so the math stays simple. Real investments go up and down and are never guaranteed.</li>
  </ul>
</section>
${ctaBox()}
</article>`;

  const ld = [
    breadcrumbLd(crumbs),
    {
      '@context': 'https://schema.org',
      '@type': 'LearningResource',
      name: HUB.h1,
      headline: HUB.h1,
      description: HUB.description,
      url: abs(HUB.path),
      inLanguage: 'en',
      learningResourceType: 'Course outline',
      educationalLevel: 'Beginner',
      typicalAgeRange: SITE.ageRange,
      audience: STUDENT_AUDIENCE,
      isAccessibleForFree: true,
      publisher: PUBLISHER,
      teaches: PRINCIPLES.map((p) => p.name),
      hasPart: PRINCIPLES.map((p) => ({ '@type': 'LearningResource', name: p.name, url: abs(principlePath(p)) })),
    },
  ];
  return layout({ path: HUB.path, title: HUB.title, description: HUB.description, ogType: 'website', ld, body });
}

function renderPrinciple(p, i) {
  const prev = PRINCIPLES[i - 1];
  const next = PRINCIPLES[i + 1];
  const path = principlePath(p);
  const crumbs = [{ name: 'Home', path: '/' }, { name: 'Learn', path: HUB.path }, { name: p.name, path }];
  const game = p.tryIt && GAMES[p.tryIt.game];

  const checks = p.check.map((c, n) => `<div class="qa">
    <h3>${n + 1}. ${inline(c.q)}</h3>
    <details><summary>Show answer</summary><p>${inline(c.a)}</p></details>
  </div>`).join('\n');

  const body = `${breadcrumbNav(crumbs)}
<article class="lesson">
<p class="eyebrow">Principle ${p.num} of ${PRINCIPLES.length} <span aria-hidden="true">${p.emoji}</span></p>
<h1>${esc(p.h1)}</h1>
<p class="lede">${inline(p.tagline)}</p>

<section class="in-one" aria-labelledby="one-h">
  <h2 id="one-h">${esc(p.name)} in one sentence</h2>
  <p>${inline(p.whatItIs)}</p>
</section>
${renderBlocks(p.intro)}

<section aria-labelledby="ex-h">
  <h2 id="ex-h">${esc(p.example.heading)}</h2>
  ${renderBlocks(p.example.blocks)}
</section>

<section aria-labelledby="why-h">
  <h2 id="why-h">Why it matters</h2>
  ${renderBlocks(p.why)}
</section>

<section aria-labelledby="mistake-h">
  <h2 id="mistake-h">${esc(p.mistake.heading)}</h2>
  ${renderBlocks(p.mistake.blocks)}
</section>

<section class="check" aria-labelledby="check-h">
  <h2 id="check-h">Check yourself</h2>
  ${checks}
</section>

${game ? `<section class="try" aria-labelledby="try-h">
  <h2 id="try-h">Try it: ${esc(game.name)}</h2>
  <p><strong>${esc(game.name)}</strong> is ${esc(game.what)}. ${inline(p.tryIt.text)}</p>
  <p><a href="/sample">Play today's sample digest →</a></p>
</section>` : ''}

<aside class="parents-box" aria-labelledby="par-h">
  <h2 id="par-h">For parents</h2>
  <p>${inline(p.parents)}</p>
  <p class="small">More ideas in our <a href="/parents">parent's guide to teaching kids about money</a>.</p>
</aside>

<nav class="pager" aria-label="More principles">
  ${prev ? `<a class="prev" rel="prev" href="${esc(principlePath(prev))}"><span>← Previous</span>${esc(prev.name)}</a>` : '<span></span>'}
  <a class="up" href="${HUB.path}">All 11 principles</a>
  ${next ? `<a class="next" rel="next" href="${esc(principlePath(next))}"><span>Next →</span>${esc(next.name)}</a>` : '<span></span>'}
</nav>

${ctaBox()}
</article>`;

  const ld = [
    breadcrumbLd(crumbs),
    {
      '@context': 'https://schema.org',
      '@type': 'LearningResource',
      name: p.h1,
      headline: p.h1,
      description: p.description,
      abstract: plain(p.whatItIs),
      url: abs(path),
      inLanguage: 'en',
      learningResourceType: 'Lesson',
      educationalLevel: 'Beginner',
      typicalAgeRange: SITE.ageRange,
      audience: STUDENT_AUDIENCE,
      isAccessibleForFree: true,
      teaches: p.name,
      position: p.num,
      isPartOf: { '@type': 'LearningResource', name: HUB.h1, url: abs(HUB.path) },
      publisher: PUBLISHER,
      author: PUBLISHER,
      image: SITE.ogImage,
    },
  ];
  return layout({ path, title: p.title, description: p.description, ld, body });
}

function principleLinkList() {
  return `<ol class="plain-list">${PRINCIPLES.map((p) => `<li><a href="${esc(principlePath(p))}">${esc(p.name)}</a> — ${esc(p.tagline)}</li>`).join('')}</ol>`;
}

function renderParents() {
  const crumbs = [{ name: 'Home', path: '/' }, { name: 'Parents', path: PARENTS.path }];
  const byName = Object.fromEntries(PRINCIPLES.map((p) => [p.num, p]));
  const link = (n) => `<a href="${esc(principlePath(byName[n]))}">${esc(byName[n].name)}</a>`;

  const body = `${breadcrumbNav(crumbs)}
<article>
<h1>${esc(PARENTS.h1)}</h1>
<p class="lede">Most of us never learned how investing works until we were adults — if at all. Market Juice is a free, 3-minute daily habit that teaches kids ${esc(SITE.ageLabel)} the ideas behind building wealth, using real market news and games.</p>

<section aria-labelledby="what-h">
  <h2 id="what-h">What Market Juice is</h2>
  <p>Market Juice is a daily market-literacy digest written for kids, not Wall Street. Each edition turns what happened in the stock market into short stories, a market scoreboard, and quick games. Every quiz answer and game reveal ties back to one of <a href="/learn">11 core investing principles</a>, so kids aren't just reading headlines — they're learning why the headlines matter.</p>
  <ul>
    <li><strong>Free.</strong> No subscription, no paywall, and no ads.</li>
    <li><strong>Short.</strong> About 3 minutes a day.</li>
    <li><strong>Educational, not advice.</strong> We teach how markets and businesses work. We never tell kids what to buy or sell.</li>
  </ul>
</section>

<section aria-labelledby="routine-h">
  <h2 id="routine-h">How the daily 3-minute routine works</h2>
  <ol>
    <li><strong>You sign up.</strong> It takes about 30 seconds: your email, your kid's first name and age, and a username and password for your kid to log in.</li>
    <li><strong>Every morning, a new edition.</strong> You get a quick preview email, and your kid opens the full digest on the web — no app store download needed (it can be added to a phone or tablet home screen).</li>
    <li><strong>Your kid plays and learns.</strong> The digest includes The Quiz, a Daily Challenge of three games (such as Compound Machine, Bull or Bear?, and Match the Company), and the Mystery Mover company puzzle. Kids earn Market Coins, build streaks, and climb ranks from Rookie to Wall Street Legend.</li>
    <li><strong>The week has a rhythm.</strong> Tuesday through Saturday recap the previous trading day. Sunday is The Weekly Wrap, a look back at the whole week. Monday is The Week Ahead, a preview of what to watch.</li>
    <li><strong>You get an evening recap.</strong> On days your kid plays, you receive an evening email summarizing what they did, plus "Talk About It Tonight" conversation starters. Kids can also tap a button on a story they want to ask you about, and a parent-friendly explanation of that topic is included in your recap.</li>
  </ol>
  <p>Curious? <a href="/sample">Look through a sample digest</a> — no account needed.</p>
</section>

<section aria-labelledby="learn-h">
  <h2 id="learn-h">What kids learn</h2>
  <p>Everything in Market Juice traces back to these 11 principles. Each one has a free lesson page with a worked example and practice questions you can go through together:</p>
  ${principleLinkList()}
  <p>Along the way, kids pick up the vocabulary too — tricky terms in the digest can be tapped for a kid-friendly definition.</p>
</section>

<section aria-labelledby="safety-h">
  <h2 id="safety-h">Safety and privacy</h2>
  <p>We built Market Juice for our own kids, and we hold it to the standard we'd want as parents. The short version, from our <a href="/privacy">privacy policy</a>:</p>
  <ul>
    <li><strong>Parental consent for kids under 13 (COPPA).</strong> When you sign up a child aged 10–12, we email you a consent request. Your child's account stays inactive — no digest, no data processing beyond signup — until you click to give consent. If you don't, the signup expires.</li>
    <li><strong>Parents sign up, not kids.</strong> We ask for the parent's email, never the child's, at every age.</li>
    <li><strong>We collect very little.</strong> Your kid's first name (no last name), age, login, and their game progress. No phone number, no location beyond timezone, plus the signup IP address we keep as part of the parental-consent record.</li>
    <li><strong>We don't sell or share data for advertising</strong>, we don't use kids' data to train AI models, and we don't track kids across the web.</li>
    <li><strong>No public usernames or profiles.</strong> There's no chat and no social feed.</li>
    <li><strong>You're in control.</strong> You can <a href="/parent/delete-data">delete your child's data</a> at any time.</li>
  </ul>
</section>

<section aria-labelledby="talk-h">
  <h2 id="talk-h">Conversation starters for parents</h2>
  <p>You don't need to be an investing expert. These questions work at the dinner table or in the car:</p>
  <ul>
    <li>"If you got $100 today, how much would you save before spending any?" (${link(1)})</li>
    <li>"Would you rather have $1,000 today, or a penny that doubles every day for a month?" (${link(2)})</li>
    <li>"How do you think the company that made your favorite game makes its money?" (${link(4)})</li>
    <li>"What could go wrong if a store only sold one thing?" (${link(5)})</li>
    <li>"Have you ever wanted something just because everyone else had it? How did that turn out?" (${link(7)})</li>
    <li>"If we owned a tiny piece of a business we use every week, what would make that piece worth more?" (${link(8)})</li>
    <li>"Is the most expensive thing always the best one?" (${link(10)})</li>
  </ul>
  <p>Tip: the penny that doubles every day for 30 days ends at $5,368,709.12 — a fun way to make compounding stick.</p>
</section>

<section aria-labelledby="teach-h">
  <h2 id="teach-h">For teachers and classrooms</h2>
  <p>Market Juice doesn't have a classroom or teacher account yet — every account is created and controlled by a parent or guardian. But the <a href="/learn">11 principle lessons</a> are free and open to everyone, with no sign-in required, so they work well as a short reading or warm-up. If you think your students would enjoy the daily digest, you're welcome to share this page with their parents so families can sign up at home.</p>
</section>

${ctaBox('Start the 3-minute habit')}
</article>`;

  const ld = [
    breadcrumbLd(crumbs),
    {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: PARENTS.h1,
      name: PARENTS.h1,
      description: PARENTS.description,
      url: abs(PARENTS.path),
      inLanguage: 'en',
      isAccessibleForFree: true,
      audience: { '@type': 'PeopleAudience', audienceType: `Parents of kids ${SITE.ageLabel}` },
      about: { '@type': 'Thing', name: 'Financial literacy for kids' },
      publisher: PUBLISHER,
      author: PUBLISHER,
      image: SITE.ogImage,
    },
  ];
  return layout({ path: PARENTS.path, title: PARENTS.title, description: PARENTS.description, ld, body });
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/** Absolute paths for the sitemap. */
export const LEARN_URLS = [HUB.path, ...PRINCIPLES.map(principlePath), PARENTS.path];

let _pages = null;
/** Map of path → rendered HTML (memoized; content is static). */
export function renderLearnPages() {
  if (_pages) return _pages;
  const pages = new Map();
  pages.set(HUB.path, renderHub());
  PRINCIPLES.forEach((p, i) => pages.set(principlePath(p), renderPrinciple(p, i)));
  pages.set(PARENTS.path, renderParents());
  _pages = pages;
  return pages;
}

export function registerLearnRoutes(app) {
  const send = (path) => (req, res) => {
    const html = renderLearnPages().get(path);
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('html').send(html);
  };
  // Express's default non-strict routing also serves '/learn/' etc. here;
  // the <link rel="canonical"> on every page consolidates those variants.
  for (const path of LEARN_URLS) app.get(path, send(path));
}
