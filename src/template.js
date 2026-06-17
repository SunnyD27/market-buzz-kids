// src/template.js — Builds the final HTML page from generated content.
// Phase 1: Market Juice — VOO removed, Today's Mover added, Did You Know
// replaces Coming Up. Engagement systems (XP, ranks, streaks, games) come in
// later phases.

import { getActiveGlossary } from './glossary-runtime.js';
import { watchlistCard, watchlistPicker, WATCHLIST_CSS, WATCHLIST_CONTROLLER } from './watchlist-ui.js';

// Short principle labels for the glossary tooltip's "Ties to:" tie-in line.
// Server-side mirror of public/games/shared.js PRINCIPLES, trimmed to fit the
// small tip card. Indexed 1-11 to match glossary.js entry.principle.
const GLOSS_PRINCIPLES = {
  1: 'Pay yourself first',
  2: 'Make your money work for you',
  3: 'Spend less than you earn',
  4: 'Understand what you own',
  5: "Don't put all your eggs in one basket",
  6: 'Be patient — think in years, not days',
  7: "Control your emotions",
  8: 'Think like an owner, not a gambler',
  9: 'Stay consistent',
  10: 'Know the difference between price and value',
  11: 'Make money while you sleep',
};

/**
 * Build a per-digest glossary linker (tap-to-reveal tooltips).
 *
 * Returns { link(rawText, opts) } that wraps the FIRST occurrence — across the
 * WHOLE digest, since the seen-set is shared — of each known glossary term in a
 * tappable tooltip, and escapes everything else. Later occurrences of an
 * already-linked term stay plain (escaped) text, so a term is defined once, the
 * first time the kid could meet it.
 *
 * Why it's built this way:
 *  - We run the matcher on the RAW field text (pre-escape), not on rendered
 *    HTML. Every field we link (bigPicture, story bodies, the DYK fact, the
 *    word-of-day definition, …) is plain text the template would otherwise pass
 *    through escapeHTML(). Matching the raw text and escaping INSIDE the linker
 *    avoids two traps at once: (a) we never match across the `&amp;`/`&lt;`
 *    entity boundaries escaping introduces (so "S&P 500" matches cleanly), and
 *    (b) with glossary OFF, link() === escapeHTML(), so output is byte-identical
 *    to the pre-feature template.
 *  - "Never match inside a tag/attribute" is satisfied BY CONSTRUCTION here:
 *    because we link the raw field (which is plain prose) and escape everything
 *    that isn't a matched term, the only markup in the output is the gloss
 *    spans WE emit — there are no live tags to corrupt. We deliberately do NOT
 *    pass `<…>` spans through untouched (the obvious "split on tags" approach):
 *    on raw input that would emit attacker-influenced angle brackets unescaped
 *    and undo the XSS protection escapeHTML gives us. Any literal "<" in a
 *    field is escaped to "&lt;" exactly as the pre-feature template did.
 *  - Matching uses the active view's MATCHABLE_TERMS (longest-first) so
 *    "bull market" beats "bull" and "S&P 500" beats "S&P". Boundaries treat
 *    [A-Za-z0-9] as word chars via lookbehind/lookahead, so "fed" doesn't fire
 *    inside "federal" and the literal "&"/"-"/space inside multiword terms work.
 *  - The term source is the merged seed + approved-DB view (glossary-runtime),
 *    cached per process — so approved nominations grow the glossary live.
 */
// Phase 19 — section-header line icons (replacing the emoji nav). Lucide/
// Tabler outline paths, inlined (no runtime dep), stroke=currentColor so they
// tint via CSS `color: var(--citrus-text)`. Emoji stays welcome INSIDE content; it
// just stops being the navigation system.
const SECTION_ICON_PATHS = {
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
  lightbulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5C17.7 10.2 18 9 18 7.5a6 6 0 0 0-12 0c0 1.5.3 2.7 1.5 4 .8.8 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
};
export function sectionIcon(name) {
  const path = SECTION_ICON_PATHS[name] || SECTION_ICON_PATHS.sparkles;
  return `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

// One tap-to-reveal gloss span (the prose `.tip` bubble shape). Module-level
// so both the first-occurrence prose linker and the always-on standalone
// helper below share one copy of the markup.
function renderGlossSpan(visibleText, entry) {
  const principleLine = entry.principle
    ? `Ties to: ${GLOSS_PRINCIPLES[entry.principle] || ''}`
    : '';
  const newClass = entry.isNew ? ' is-new' : '';
  return (
    `<span class="gloss${newClass}" tabindex="0" role="button" aria-expanded="false">` +
    escapeHTML(visibleText) +
    `<span class="tip" role="tooltip">` +
    `<span class="tip-term">${escapeHTML(entry.term)}</span>` +
    escapeHTML(entry.def || '') +
    (principleLine ? `<span class="tip-principle">${escapeHTML(principleLine)}</span>` : '') +
    `</span>` +
    `</span>`
  );
}

/**
 * Phase 17 — a standalone always-tappable gloss term, INDEPENDENT of the
 * prose linker's first-occurrence seen-set (the scoreboard-tile precedent:
 * a fixed UI surface should always explain itself, even when the term
 * already appeared in prose). Used for "S&P 500" on the Tomorrow's Call
 * card. Falls back to plain escaped text on lookup-miss or glossary-off.
 * Exported for the smoke test.
 */
export function glossTermSpan(view, visibleText, term, enabled = true) {
  if (!enabled || !view || typeof view.lookup !== 'function') return escapeHTML(visibleText);
  const entry = view.lookup(term);
  if (!entry) return escapeHTML(visibleText);
  return renderGlossSpan(visibleText, entry);
}

export function makeGlossaryLinker(view, { enabled = true } = {}) {
  const seen = new Set(); // canonical (lowercased) terms already linked this digest
  const terms = (view && view.MATCHABLE_TERMS) || [];

  const re = terms.length
    ? new RegExp(
        `(?<![A-Za-z0-9])(?:${terms.map(escapeRegExp).join('|')})(?![A-Za-z0-9])`,
        'gi',
      )
    : null;

  const renderGloss = renderGlossSpan;

  function linkSegment(text, skipLower) {
    if (!re) return escapeHTML(text);
    let out = '';
    let last = 0;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const matchText = m[0];
      const entry = view.lookup(matchText);
      if (!entry) continue;
      const canonLower = entry.term.toLowerCase();
      // Already defined earlier in the digest, or the word-of-day self-skip →
      // leave it plain. We don't advance `last`, so the match text falls into
      // the next escaped slice untouched.
      if (seen.has(canonLower) || (skipLower && canonLower === skipLower)) continue;
      seen.add(canonLower);
      out += escapeHTML(text.slice(last, m.index));
      out += renderGloss(matchText, entry);
      last = m.index + matchText.length;
    }
    out += escapeHTML(text.slice(last));
    return out;
  }

  function link(rawText, opts = {}) {
    // Decode any escaped/real newlines and flatten them to spaces: link() is
    // the SINGLE-line path (titles, vibe summary, word definition), so a stray
    // `\\n` here is a soft break, never a paragraph. paragraphizeText already
    // collapsed lone newlines before calling us, so this is a no-op for prose
    // paragraphs — it only guards the fields that bypass the splitter.
    const s = decodeNewlines(rawText).replace(/\s*\n\s*/g, ' ');
    if (!enabled || !re) return escapeHTML(s);
    const skipLower = opts.skipTerm ? String(opts.skipTerm).toLowerCase() : null;
    // Single pass over the raw prose: matched terms become gloss spans, every
    // other character (incl. any literal "<", ">", "&") is HTML-escaped. No raw
    // passthrough → no way to corrupt or inject a tag.
    return linkSegment(s, skipLower);
  }

  // Render a body field as one-or-more <p> tags for comfortable reading.
  // Paragraph boundaries come from paragraphizeText():
  //   1. If the model emitted blank-line (\n\n) breaks, those are honored
  //      exactly (newly-generated, already-chunked content).
  //   2. Otherwise (already-stored rows with no breaks) a SAFE display-time
  //      splitter groups whole sentences into ~2–3-sentence paragraphs.
  // Both paths are word-preserving: no word is removed, reordered, or
  // reworded — only <p> boundaries are inserted between whole sentences/
  // paragraphs. opts.prefix is trusted HTML (our own <strong> label) injected
  // into the FIRST paragraph only.
  //
  // Every paragraph is linked through the SAME `link()` closure, so the
  // glossary `seen` set spans all paragraphs: a term defined in paragraph 1
  // stays plain in paragraph 3 — first-occurrence-only holds across the whole
  // field, exactly as the single-string pass did.
  function linkProse(rawText, opts = {}) {
    const paras = paragraphizeText(rawText);
    const linkOpts = opts.skipTerm ? { skipTerm: opts.skipTerm } : {};
    if (!paras.length) return opts.prefix ? `<p>${opts.prefix}</p>` : '';
    return paras
      .map((p, i) => `<p>${i === 0 && opts.prefix ? opts.prefix : ''}${link(p, linkOpts)}</p>`)
      .join('');
  }

  return { link, linkProse };
}

// Abbreviations / titles whose trailing "." is NOT a sentence end. Used by
// splitSentences to avoid mis-splitting "U.S. stocks", "8:30 a.m. open",
// "Acme Inc. said", "Dr. Smith", etc.
const SENTENCE_ABBR = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'gen', 'sen', 'rep', 'gov', 'st', 'jr', 'sr',
  'inc', 'co', 'corp', 'ltd', 'vs', 'etc', 'no', 'approx', 'dept', 'fig', 'vol',
  'u.s', 'u.k', 'u.s.a', 'a.m', 'p.m', 'e.g', 'i.e', 'ave', 'blvd', 'mt',
]);

// Conservative sentence splitter — used ONLY as a display-time fallback to
// paragraph already-stored digests that have no \n\n breaks. It is
// word-preserving: it returns slices of the ORIGINAL text (trimmed), never
// dropping, reordering, or altering a word. When in doubt it does NOT split
// (a too-long single sentence is left whole rather than mis-broken).
//
// Boundary = sentence-ending [.!?] (+ optional closing quote/bracket) followed
// by whitespace and the start of a new sentence (capital / opening quote /
// paren). Decimals like "$4.2" are safe because there is no whitespace after
// the dot; abbreviations are guarded via SENTENCE_ABBR + single-initial check.
function splitSentences(text) {
  const out = [];
  let start = 0;
  const re = /[.!?]+["'”’)\]]?\s+(?=[A-Z“"'(])/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const ws = (m[0].match(/\s+$/) || [''])[0].length;
    const sentEnd = m.index + m[0].length - ws; // keep any closing quote in the sentence
    // Inspect the token ending at the first punctuation char to reject
    // abbreviations and single initials (e.g. "J." in a name).
    const pre = text.slice(0, m.index + 1);
    const wm = pre.match(/([^\s]+?)[.!?]+$/);
    const lastTok = (wm ? wm[1] : '').toLowerCase().replace(/[^a-z.]/g, '');
    const isInitial = /^[a-z]$/.test(lastTok);
    if (isInitial || SENTENCE_ABBR.has(lastTok) || SENTENCE_ABBR.has(lastTok.replace(/\.+$/, ''))) {
      continue; // not a real boundary — fold into the next sentence
    }
    out.push(text.slice(start, sentEnd).trim());
    start = m.index + m[0].length; // resume after the boundary whitespace
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out.filter(Boolean);
}

// Normalize line breaks BEFORE paragraph splitting. The model emits paragraph
// breaks two different ways inside the JSON string values it returns: as REAL
// newline control chars (`\n`), or — intermittently — as the LITERAL two-char
// sequence backslash-n (the four characters `\`,`n`,`\`,`n` for a blank line).
// The literal form is not a newline, so the splitter never matched it and the
// raw characters survived escapeHTML() and rendered as visible "\n\n" text in
// the digest (the prod bug). This converts every escaped form — `\\n`, `\\r\\n`,
// stray `\\r` — and real CR/CRLF into a single canonical real `\n`, so ONE
// splitter handles both authoring styles identically and no backslash-n can
// reach the output. Pure + word-preserving (only line-break chars change).
export function decodeNewlines(rawText) {
  return String(rawText == null ? '' : rawText)
    .replace(/\\r\\n/g, '\n') // literal "\r\n"
    .replace(/\\n/g, '\n')    // literal "\n"
    .replace(/\\r/g, '\n')    // literal "\r"
    .replace(/\r\n?/g, '\n'); // real CRLF / CR → LF
}

// Turn a body field into an array of paragraph strings. Honors model-authored
// blank-line breaks exactly — whether written as real `\n\n` or as the literal
// escaped `\\n\\n` (both normalized to real newlines by decodeNewlines first).
// Otherwise falls back to grouping whole sentences into ~2–3-sentence
// paragraphs (≤3 sentences → left as one paragraph). Pure + word-preserving —
// see splitSentences. A SINGLE newline left inside a paragraph is a soft wrap →
// collapsed to a space (safest for prose; guarantees no lone break survives).
export function paragraphizeText(rawText) {
  const t = decodeNewlines(rawText);
  const byBreaks = t
    .split(/\n\s*\n/) // paragraph delimiter = a run of 2+ newlines
    .map(p => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);
  if (byBreaks.length > 1) return byBreaks;
  const body = byBreaks.length ? byBreaks[0] : '';
  if (!body) return [];
  const sents = splitSentences(body);
  if (sents.length <= 3) return [body];
  const numParas = Math.ceil(sents.length / 3); // cap at 3 sentences/paragraph
  const base = Math.floor(sents.length / numParas);
  let rem = sents.length % numParas;
  const out = [];
  let idx = 0;
  for (let i = 0; i < numParas; i++) {
    const take = base + (rem > 0 ? 1 : 0);
    if (rem > 0) rem--;
    out.push(sents.slice(idx, idx + take).join(' '));
    idx += take;
  }
  return out;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolve a scoreboard index tile's glossary entry — the single source of truth
 * for "is this tile tappable?". Returns the merged-view entry, or null when
 * glossary is disabled or the term isn't in the view (→ the tile renders plain,
 * no broken affordance). Resolution goes through the SAME view.lookup() the
 * prose linker uses (seed + approved DB rows), so there's no second hardcoded
 * copy of the definitions, and it's independent of the prose first-occurrence
 * pass. Exported so the smoke test can exercise the hit / miss / kill-switch
 * branches directly.
 */
export function scoreboardGloss(view, term, enabled = true) {
  if (!enabled || !view || typeof view.lookup !== 'function') return null;
  return view.lookup(term) || null;
}

/**
 * Build the daily digest HTML.
 *
 * @param {object} content  The full digest JSON payload (from the DB row or
 *                          the sample-digest fallback). Same shape generateContent()
 *                          produces.
 * @param {object} [opts]   Per-request rendering hints. Currently:
 *                            kidName — kid's first name to greet in the header.
 *                                       Omitted on /sample (which has no logged-in user).
 *                                       Drives the "Hey, X! 👋" pill + Log out link.
 *                          The opts argument is the only path through which the
 *                          template learns *who* is viewing. Everything else
 *                          (stories, scoreboard, games) is identical across kids.
 */
export function buildHTML(content, opts = {}) {
  const {
    date, marketVibe, vibeSummary, bigPicture,
    scoreboard, stories, didYouKnow, wordOfDay,
    dailyChallenge, isSample,
    // Phase 6.8 (5+2 editions): the AI now stamps each digest with its
    // edition type. `editionLabel` renders as a subtitle under the date.
    // `sundayChallenge` is Sunday-only — a longer interactive game that
    // rotates between 4 formats on a 4-week cycle (trading-floor, ceo,
    // investathon, dilemma). Renderer in public/games/sunday-challenge.js.
    // `weeklyChallenge` is the deprecated predecessor — kept here so older
    // cached DB rows from before the Sunday Challenge launch still render
    // a card instead of an empty hole.
    // `marketClosed` is a static flag from the prompt schema — always true
    // on weekly-wrap + week-ahead, absent on standard. Used to render a
    // muted "markets closed" note above the scoreboard so kids understand
    // why the numbers haven't changed since Friday.
    editionType, editionLabel, sundayChallenge, weeklyChallenge, marketClosed,
    // Week-ahead editions can carry an OPTIONAL `oneToWatch` object —
    // a forward, catalyst-driven pick chosen by Claude when there's a
    // specific scheduled event this week tied to a kid-recognizable
    // company. Omitted entirely on quiet weeks (see src/ai.js
    // buildWeekAheadPrompt). When present, it replaces the gold mover
    // card with a "One to Watch" card; when absent, no card renders.
    oneToWatch,
  } = content;

  const vibeCircle = marketVibe === 'green' ? '🟢' : marketVibe === 'red' ? '🔴' : '🟡';

  // Phase 19 — vibe-tinted header. The wash is keyed off editionType first
  // (weekly-wrap → mixed, week-ahead → its own ahead tint) then marketVibe
  // on trading-day editions. Server-rendered, so OLD digest rows tint
  // correctly (they already carry marketVibe + editionType).
  const headerVibe = editionType === 'week-ahead' ? 'ahead'
    : editionType === 'weekly-wrap' ? 'mixed'
    : (marketVibe === 'green' || marketVibe === 'red') ? marketVibe : 'mixed';
  const headerPillLabel = {
    green: 'Green day ▲',
    red: 'Red day ▼',
    mixed: editionType === 'weekly-wrap' ? 'The Weekly Wrap' : 'Mixed day',
    ahead: 'The Week Ahead',
  }[headerVibe];
  const headerPillHTML = `<div class="header-pill header-pill--${headerVibe}">${escapeHTML(headerPillLabel)}</div>`;

  // ── Glossary tap-to-reveal (first-occurrence-per-digest) ───────────────
  // Wrap the FIRST mention of each known term, ONCE across the whole digest,
  // walking sections in teaching order: big picture → scoreboard → stories →
  // did-you-know → word-of-day. (The quiz/Daily Challenge is client-rendered
  // from a JSON bundle, not server HTML, so it's outside this pass.) Within
  // the scoreboard region we link the prose — the vibe-bar summary and the
  // "why the mover moved" callout — but leave the tiny per-index card blurbs
  // plain. The three index TILES are instead made always-tappable separately
  // (see scoreCard / scoreGlossPanel below): they resolve their definition via
  // _glossView.lookup() DIRECTLY, bypassing this first-occurrence pass, so a
  // tile is interactive every digest regardless of what the prose mentions.
  //
  // The call ORDER below IS the first-occurrence priority. Default ON; gated
  // off via opts.glossary === false. Appears on /digest AND /sample (harmless
  // on sample, and it helps the funnel) — unlike the sample-suppressed
  // 💬 ask-parent buttons.
  const glossaryOn = opts.glossary !== false;
  // The merged seed+approved view, shared by the prose linker AND the
  // scoreboard tiles. Tiles call `_glossView.lookup()` DIRECTLY (never the
  // linker), so they don't consume the linker's first-occurrence Set — a tile
  // and a prose mention of the same term stay independent.
  const _glossView = getActiveGlossary();
  const _linker = makeGlossaryLinker(_glossView, { enabled: glossaryOn });

  // ── Mover-card spec (edition-aware) ────────────────────────────────────
  // ONE resolver keyed on editionType — the same shape feeds the gold card
  // and the "why" callout, so the label, source field, and rendering stay
  // consistent in one place.
  //   standard      → scoreboard.topMover  · label "TODAY'S MOVER"
  //   weekly-wrap   → scoreboard.topMover  · label "WEEK'S BIGGEST MOVER"
  //   week-ahead    → content.oneToWatch   · label "ONE TO WATCH" (OPTIONAL)
  // Returns null when the source data isn't present — week-ahead with no
  // catalyst this week renders no card at all (no empty card, no fallback
  // to a backward mover).
  function resolveMoverSpec() {
    if (editionType === 'week-ahead') {
      if (!oneToWatch || !oneToWatch.name) return null;
      return {
        kind: 'forward',
        label: 'ONE TO WATCH',
        name: oneToWatch.name,
        ticker: oneToWatch.ticker || '',
        catalyst: oneToWatch.catalyst || '',
        reason: oneToWatch.reason || '',
      };
    }
    const m = scoreboard.topMover;
    if (!m) return null;
    const label = editionType === 'weekly-wrap' ? "WEEK'S BIGGEST MOVER" : "TODAY'S MOVER";
    return {
      kind: 'backward',
      label,
      name: m.name || '',
      ticker: m.ticker || '',
      price: m.price || '',
      change: m.change || '',
      direction: m.direction || 'up',
      vibe: m.vibe || '',
    };
  }
  const _moverSpec = resolveMoverSpec();

  const lk = {
    // ALL long body fields render as one-or-more <p> via linkProse, so they
    // get real paragraph breaks (from \n\n the model emits, or the safe
    // sentence-grouping fallback on already-stored rows). why-it-matters and
    // the DYK lesson pass their inline label as `prefix` so it rides the FIRST
    // paragraph. No content differs — purely structural paragraphing.
    bigPicture: _linker.linkProse(bigPicture),
    vibeSummary: _linker.link(vibeSummary),
    // Mover prose — runs whichever field the active edition actually shows
    // (the backward "vibe" sentence on standard/weekly-wrap, the forward
    // "reason" sentence on week-ahead). The other field is null/empty so
    // no extra terms are consumed from the first-occurrence pass.
    moverProse: _moverSpec
      ? (_moverSpec.kind === 'forward'
          ? (_moverSpec.reason ? _linker.link(_moverSpec.reason) : '')
          : (_moverSpec.vibe ? _linker.link(_moverSpec.vibe) : ''))
      : '',
    stories: (stories || []).map(s => ({
      title: _linker.link(s.title),
      body: _linker.linkProse(s.body),
      whyItMatters: _linker.linkProse(s.whyItMatters, { prefix: '<strong>💡 Why it matters:</strong> ' }),
    })),
    dykFact: _linker.linkProse(didYouKnow?.fact || ''),
    dykConnection: didYouKnow?.connection ? _linker.linkProse(didYouKnow.connection, { prefix: '<strong>The lesson:</strong> ' }) : '',
    // Skip the word-of-day's own word inside its own definition card — that's
    // circular. (It can still be tooltipped earlier in the digest if it appears
    // there first.)
    wordDef: _linker.link(wordOfDay.definition, { skipTerm: wordOfDay.word }),
  };

  // Phase 12 — "Ask my parent" buttons. One-tap flag per section (no
  // free-text from kids — COPPA). Hidden on /sample since unauthenticated
  // visitors have no parent email to deliver to. `section` is the dedup
  // key consumed by the evening recap email; `topic` is the display label
  // for the email body.
  function askParentBtn(section, topic) {
    if (opts.isSample) return '';
    return `<button type="button" class="mj-ask-parent-btn"
              data-section="${escapeHTML(section)}"
              data-topic="${escapeHTML(topic)}"
              onclick="MarketJuice.askParent(this)">💬 Ask my parent about this</button>`;
  }

  // Story-section heading varies by edition. Weekly Wrap recaps the past
  // 5 trading days; Week Ahead previews upcoming events; standard editions
  // cover the previous trading day.
  const storiesHeading = editionType === 'weekly-wrap'
    ? "This Week's Big Stories"
    : editionType === 'week-ahead'
      ? 'What to Watch This Week'
      : "Today's Big Stories";

  const badgeClasses = { hot: 'hot', new: 'new', money: 'money', world: 'world', brain: 'brain' };
  const badgeEmojis = { hot: '🔥', new: '🆕', money: '💰', world: '🌍', brain: '🧠' };

  const storiesHTML = stories.map((story, i) => `
    <div class="story-card" id="story-${i}" style="animation-delay: ${0.15 + i * 0.1}s">
      <span class="badge ${badgeClasses[story.badge] || 'new'}">${badgeEmojis[story.badge] || '📰'} ${escapeHTML(story.badgeLabel)}</span>
      <h3>${lk.stories[i]?.title ?? escapeHTML(story.title)}</h3>
      ${lk.stories[i]?.body ?? `<p>${escapeHTML(story.body)}</p>`}
      <div class="why-it-matters">
        ${lk.stories[i]?.whyItMatters ?? `<p><strong>💡 Why it matters:</strong> ${escapeHTML(story.whyItMatters)}</p>`}
      </div>
      ${askParentBtn(`story-${i}`, story.title)}
    </div>
  `).join('');

  // Edition label + framing subtitle — under the date for Weekly Wrap
  // (Sunday) and Week Ahead (Monday/post-holiday) editions. Standard
  // weekday digests omit this block entirely so the header looks
  // byte-identical to before.
  //
  // The framing line makes the backward/forward orientation unmistakable
  // for a kid + skimming parent on the two editions that otherwise read
  // as if they were a normal "today's" digest. Driven off the
  // authoritative editionType field — never re-derived from day-of-week
  // in the template.
  const editionFraming = editionType === 'weekly-wrap'
    ? 'Looking back at this past week 📋'
    : editionType === 'week-ahead'
      ? "Here's what to watch this coming week 🔮"
      : null;
  const editionLabelHTML = editionLabel
    ? `<div class="edition-label">${escapeHTML(editionLabel)}</div>${
        editionFraming
          ? `<div class="edition-framing">${escapeHTML(editionFraming)}</div>`
          : ''
      }`
    : '';

  // Phase 7 — personalized greeting + logout. Only rendered when a kid
  // name was passed in (i.e. an authenticated /digest request). /sample
  // never has a kidName and falls through to the un-greeted header.
  const kidName = opts.kidName;

  // Phase 17 — Tomorrow's Call prediction card (END of the digest — the
  // last thing the kid sees is tomorrow, not "done"). Per-user state
  // threaded by the /digest handler ({ todayPick, targetDate, record,
  // verdict }); absent on /sample, the static disk render, and logged-out
  // paths → the card (and its section header) is skipped entirely.
  // Personalization stays render-time only — nothing per-user is in the
  // immutable daily row.
  const prediction = opts.prediction || null;
  const predictionCardHTML = (() => {
    if (!prediction || !prediction.targetDate) return '';

    // Server-computed live target label ('today' / 'on Monday'). The POST
    // recomputes authoritatively at tap time — a 9:29-render/9:31-tap race
    // resolves to the server's answer, and the response label feeds the
    // locked chip (see the inline handler below).
    const targetLabel = prediction.targetLabel || 'today';
    // S&P 500 is always tappable on this card (scoreboard-tile precedent),
    // independent of the prose first-occurrence pass.
    const spGloss = glossTermSpan(_glossView, 'S&P 500', 'S&P 500', glossaryOn);

    // The permanent sub-caption — what makes the 9:30 blind-pick rule feel
    // like a rule instead of a bug. Three states from the server:
    //   pre-open  → today's open is still ahead
    //   post-open → today's session is running, kid calls a future close
    //   closed    → weekend/holiday, kid calls the next session
    const captionHTML = (() => {
      if (prediction.caption === 'pre-open') {
        return `<div class="tc-caption">Locks at 9:30 AM ET when the market opens.</div>`;
      }
      if (prediction.caption === 'post-open') {
        return `<div class="tc-caption">Today's market is already running — you're calling ${escapeHTML(targetLabel.replace(/^on /, ''))}'s close.</div>`;
      }
      return `<div class="tc-caption">Markets are closed today — you're calling ${escapeHTML(targetLabel.replace(/^on /, ''))}'s close.</div>`;
    })();

    const verdict = prediction.verdict;
    const verdictHTML = verdict
      ? (verdict.correct
          ? `<div class="tc-verdict tc-verdict-win">You called it! 🎯 +5 MC</div>`
          : `<div class="tc-verdict tc-verdict-miss">Not this time — the S&amp;P finished ${escapeHTML(verdict.actual || '')}.</div>`)
      : '';

    const record = prediction.record;
    const recordHTML = record
      ? `<div class="tc-record">Your record: <strong>${record.correct} of ${record.total}</strong></div>`
      : '';

    // One-time explainer (5th-grade reading level). Server always renders
    // it; the inline handler hides it instantly when localStorage says the
    // kid already tapped "Got it" (same persistence idea as the
    // Ask-my-parent intro — but with a properly styled button).
    const explainerHTML = `
    <div class="tc-intro" id="tc-intro" hidden>
      <div class="tc-intro-title">New! Make your daily call 🔮</div>
      <div class="tc-intro-body">Once a day, you predict: will the ${spGloss} finish <strong>green</strong> (up) or <strong>red</strong> (down)? Your pick locks when the market opens at 9:30 AM. Call it right and you earn <strong>+5 Market Coins</strong>. The answer lands in tomorrow morning's Juice.</div>
      <button type="button" class="tc-intro-btn" id="tc-intro-btn">Got it</button>
    </div>`;

    const pickedChip = (choice, label) => `
      <div class="tc-locked">You called ${choice === 'green' ? '▲ Green' : '▼ Red'} ${escapeHTML(label)} — come back after the market closes to see how it went.</div>`;

    const bodyHTML = prediction.currentPick
      ? pickedChip(prediction.currentPick, targetLabel)
      : `
      <div class="tc-question">Will the ${spGloss} finish green or red ${escapeHTML(targetLabel)}?</div>
      <div class="tc-buttons" id="tc-buttons">
        <button type="button" class="tc-btn tc-btn-green" data-choice="green">▲ Green</button>
        <button type="button" class="tc-btn tc-btn-red" data-choice="red">▼ Red</button>
      </div>
      <div class="tc-feedback" id="tc-feedback" aria-live="polite"></div>`;

    return `
  <div class="section-header">
    ${sectionIcon('sparkles')}
    <h2>Tomorrow's Call</h2>
    <div class="line"></div>
  </div>
  <div class="tc-card" id="tc-card" data-target-label="${escapeHTML(targetLabel)}">
    ${explainerHTML}
    ${verdictHTML}
    ${recordHTML}
    ${bodyHTML}
    ${captionHTML}
  </div>`;
  })();

  // Phase 20a — Weekly Hold card (per-user; opts.weeklyHold from the /digest
  // render path). Pick UI on Sunday's weekly-wrap AND Monday's week-ahead
  // (the widened window); locked chip mid-week; verdict (all 3 returns +
  // win) on the resolution weekend. Absent on /sample + logged-out → not
  // rendered. Uses Phase 19 tokens + --up-text/--down-text for the green/red
  // returns (WCAG-legible on cream). PLACEMENT is edition-aware in the body:
  // on Sunday it renders directly under "Your Week in Juice" (reflect→pick
  // adjacency); on every other edition it sits by the Tomorrow's Call card.
  const weeklyHold = opts.weeklyHold || null;
  const weeklyHoldCardHTML = (() => {
    if (!weeklyHold || !weeklyHold.phase) return '';
    const pctSpan = (pct) => {
      const up = pct >= 0;
      const sign = up ? '+' : '';
      return `<span class="wh-pct ${up ? 'wh-up' : 'wh-down'}">${sign}${Number(pct).toFixed(1)}%</span>`;
    };
    let body = '';
    if (weeklyHold.phase === 'verdict') {
      const v = weeklyHold.verdict;
      const rows = (v.returns || []).slice()
        .sort((a, b) => (b.pct ?? -999) - (a.pct ?? -999))
        .map(r => `<div class="wh-result-row${r.ticker === v.chosen ? ' wh-chosen' : ''}">
          <span class="wh-result-name">${escapeHTML(r.name || r.ticker)}${r.ticker === v.chosen ? ' <span class="wh-yours">your pick</span>' : ''}</span>
          ${pctSpan(r.pct)}
        </div>`).join('');
      const headline = v.win
        ? `🏆 Your pick ${escapeHTML(v.chosenName || v.chosen)} ${pctSpan(v.returns.find(r => r.ticker === v.chosen)?.pct ?? 0)} — beat both!`
        : `Your pick ${escapeHTML(v.chosenName || v.chosen)} held strong — not the top this week.`;
      body = `<div class="wh-verdict-head">${headline}</div><div class="wh-results">${rows}</div>`;
    } else if (weeklyHold.phase === 'locked') {
      const name = (weeklyHold.candidates || []).find(c => c.ticker === weeklyHold.chosen)?.name || weeklyHold.chosen;
      body = `<div class="wh-locked">You're holding <strong>${escapeHTML(name)}</strong> this week — check back Saturday to see how it did.</div>`;
    } else { // 'pick' | 'closed'
      const open = weeklyHold.phase === 'pick';
      const cards = (weeklyHold.candidates || []).map(c => `
        <button type="button" class="wh-cand" data-ticker="${escapeHTML(c.ticker)}"${open ? '' : ' disabled'}>
          <span class="wh-cand-name">${escapeHTML(c.name)}</span>
          <span class="wh-cand-case">${escapeHTML(c.case || '')}</span>
        </button>`).join('');
      body = `<div class="wh-prompt">Pick one company to <strong>hold all week</strong>. Beat the other two and earn <strong>+20 Market Coins</strong>.</div>
        <div class="wh-cands" id="wh-cands">${cards}</div>
        ${open ? '<div class="wh-caption">Locks Monday at 9:30 AM when the market opens.</div>' : '<div class="wh-caption">Picks are closed for this week — here\'s what was on offer.</div>'}
        <div class="wh-feedback" id="wh-feedback" aria-live="polite"></div>`;
    }
    return `
  <div class="section-header">
    ${sectionIcon('target')}
    <h2>Weekly Hold</h2>
    <div class="line"></div>
  </div>
  <div class="wh-card" id="wh-card">${body}</div>`;
  })();

  // Phase 20b — "Your Week in Juice" card (per-user; opts.weekStats, Sunday
  // weekly-wrap only). Built entirely from existing data. Celebration tone,
  // you-vs-you — no percentile/comparison. Renders near the TOP.
  const weekStats = opts.weekStats || null;
  const weekInJuiceHTML = (() => {
    if (!weekStats) return '';
    const stat = (label, value) => `<div class="wj-stat"><div class="wj-stat-value">${value}</div><div class="wj-stat-label">${label}</div></div>`;
    const rec = weekStats.predictionRecord;
    const recordLine = weekStats.brokenRecord
      ? `<div class="wj-record">🎉 ${escapeHTML(weekStats.brokenRecord.label)}!</div>`
      : '';
    const next = weekStats.nextRank;
    const rankLine = next
      ? `<div class="wj-rank">${escapeHTML(weekStats.rank?.badge || '')} ${escapeHTML(weekStats.rank?.name || '')} · <strong>${next.remaining}</strong> MC to ${escapeHTML(next.name)}</div>`
      : `<div class="wj-rank">${escapeHTML(weekStats.rank?.badge || '')} ${escapeHTML(weekStats.rank?.name || '')} — top rank! 👑</div>`;
    return `
  <div class="wj-card">
    <div class="wj-title">📋 Your Week in Juice</div>
    <div class="wj-stats">
      ${stat('MC earned', weekStats.mcThisWeek)}
      ${stat('games won', `${weekStats.gamesWon}/${weekStats.gamesPlayed}`)}
      ${rec ? stat('calls right', `${rec.correct} of ${rec.total}`) : stat('day streak', `🔥 ${weekStats.currentStreak}`)}
    </div>
    ${rec ? `<div class="wj-streak">🔥 ${weekStats.currentStreak}-day streak</div>` : ''}
    ${rankLine}
    ${recordLine}
  </div>`;
  })();

  // ── Phase 21 — Watchlist "Your Companies" (per-user; opts.watchlist) ──
  // Shared UI builders (src/watchlist-ui.js) so the digest + /progress render
  // the same card + picker + controller. Absent on /sample + logged-out
  // (opts.watchlist null → empty strings).
  const watchlist = opts.watchlist || null;
  const watchlistCardHTML = watchlistCard(watchlist, escapeHTML, GLOSS_PRINCIPLES);
  const watchlistPickerHTML = watchlist ? watchlistPicker(escapeHTML) : '';

  const greetingHTML = kidName
    ? `<div class="kid-greeting">
         <span class="kid-greeting-name">Hey, ${escapeHTML(kidName)}! 👋</span>
         <a href="#" class="logout-link" id="logout-link">Log out</a>
       </div>`
    : '';

  // "Markets closed" note — muted single line right above the scoreboard.
  // Only renders for weekend/holiday editions where the scoreboard is
  // showing Friday's frozen numbers, so kids understand why the values
  // aren't moving. Copy varies by edition: a recap framing for Sunday,
  // a forward-looking framing for Monday/post-holiday.
  const marketClosedNote = marketClosed
    ? (editionType === 'weekly-wrap'
        ? "📊 Markets were closed this weekend — here's how the week went"
        : "📊 Markets were closed yesterday — here's where things stand heading into the week")
    : null;
  const marketClosedHTML = marketClosedNote
    ? `<div style="text-align: center; font-size: 12px; color: var(--ink-soft); font-style: italic; margin: 0 16px 10px; padding: 8px 0;">${escapeHTML(marketClosedNote)}</div>`
    : '';

  // Sunday Challenge — Sunday-only interactive game (4 rotating types).
  // The AI generates the content; public/games/sunday-challenge.js does
  // the rendering. Section header + container div; the inline script at
  // the bottom of the page calls window.MJGames.sundayChallenge.render.
  //
  // Backward compat: if a digest row is from before the Sunday Challenge
  // launch it'll have `weeklyChallenge` instead — render the old card so
  // we don't leave a hole on those days.
  const SUNDAY_CHALLENGE_META = {
    'trading-floor': { icon: '📈', name: 'The Trading Floor',     subtitle: 'Invest $10,000 across 3 eras of stock market history' },
    'ceo':           { icon: '💼', name: 'CEO for a Day',         subtitle: '3 real business decisions — what would you do?' },
    'investathon':   { icon: '⚡', name: 'Invest-a-Thon',         subtitle: '10 rapid-fire questions — 8 seconds each' },
    'dilemma':       { icon: '⚖️', name: "The Investor's Dilemma", subtitle: 'Real math, real tradeoffs, no easy answers' },
  };
  const hasSundayChallenge = !!(sundayChallenge && sundayChallenge.type && SUNDAY_CHALLENGE_META[sundayChallenge.type]);
  const sundayChallengeHTML = hasSundayChallenge
    ? (() => {
        const meta = SUNDAY_CHALLENGE_META[sundayChallenge.type];
        return `
  <div class="section-header">
    <span class="emoji">${meta.icon}</span>
    <h2>Sunday Challenge: ${escapeHTML(meta.name)}</h2>
    <div class="line"></div>
  </div>
  <div class="sc-subtitle">${escapeHTML(meta.subtitle)}</div>
  <div id="sunday-challenge-host"></div>`;
      })()
    : (weeklyChallenge?.headline && weeklyChallenge?.body
        ? `
  <div class="section-header">
    ${sectionIcon('target')}
    <h2>Weekly Challenge</h2>
    <div class="line"></div>
  </div>
  <div class="wc-card">
    <div class="wc-label">⭐ ONE FUN TASK FOR THE WEEK</div>
    <div class="wc-headline">${escapeHTML(weeklyChallenge.headline)}</div>
    <div class="wc-body">${escapeHTML(weeklyChallenge.body)}</div>
  </div>`
        : '');

  // Phase 6.4: the bare quiz section was replaced by the Daily Challenge
  // picker. The picker decides today's 3 games (rotation in
  // public/games/daily-challenge.js) and renders them as expandable cards.
  // Today's hydrated game payloads come from src/games.js via
  // content.dailyChallenge. If for some reason dailyChallenge isn't
  // present, we omit the section entirely rather than fall back to a
  // partial bare quiz.
  const hasDailyChallenge = !!(dailyChallenge && Array.isArray(dailyChallenge.games) && dailyChallenge.games.length);
  const dailyChallengeSectionHTML = hasDailyChallenge ? `
  <div class="section-header">
    ${sectionIcon('rocket')}
    <h2>Today's Daily Challenge</h2>
    <div class="line"></div>
  </div>
  <div id="daily-challenge-host"></div>
  ` : '';

  // The three index tiles are ALWAYS tappable (every digest), revealing that
  // index's glossary definition in an expanding panel below the scoreboard
  // row — independent of whether the index name shows up in any sentence.
  // `term` is the canonical glossary key to resolve (lookup is alias- and
  // case-insensitive, so 'NASDAQ'→Nasdaq and 'DOW'→Dow Jones also work, but we
  // pass the canonical term to be explicit). Each tappable tile owns a panel
  // built by scoreGlossPanel(); the two are linked by `aria-controls`.
  const SCORE_INDICES = [
    { key: 'sp500', label: 'S&P 500', term: 'S&P 500' },
    { key: 'nasdaq', label: 'NASDAQ', term: 'Nasdaq' },
    { key: 'dow', label: 'DOW', term: 'Dow Jones' },
  ];
  const scoreGlossPanelId = (key) => `score-gloss-${key}`;

  // The glossary entry for a tile, or null when glossary is off or the lookup
  // misses (→ the tile renders plain, no broken affordance). Delegates to the
  // exported decision fn so the template and the tests agree.
  function scoreGlossEntry(term) {
    return scoreboardGloss(_glossView, term, glossaryOn);
  }

  function scoreCard(key, label, term) {
    const s = scoreboard[key];
    if (!s) return '';
    const dir = s.direction === 'up' ? 'up' : 'down';
    const arrow = s.direction === 'up' ? 'arrow-up' : 'arrow-down';
    const entry = scoreGlossEntry(term);
    const nameCell = entry
      // Affordance cue: dotted citrus underline on the index name + a small ⓘ,
      // consistent with the prose tooltip treatment.
      ? `<div class="name"><span class="sg-name">${escapeHTML(label)}</span><span class="sg-i" aria-hidden="true">ⓘ</span></div>`
      : `<div class="name">${escapeHTML(label)}</div>`;
    const tappableAttrs = entry
      ? ` tappable" role="button" tabindex="0" aria-expanded="false" aria-controls="${scoreGlossPanelId(key)}" aria-label="${escapeHTML(label)} — tap for a kid-friendly definition`
      : '';
    return `
      <div class="score-card ${dir}${tappableAttrs}">
        ${nameCell}
        <div class="price">${escapeHTML(s.price)}</div>
        <div class="change"><span class="${arrow}"></span> ${escapeHTML(s.change)}</div>
        <div class="vibe">${escapeHTML(s.vibe)}</div>
      </div>
    `;
  }

  // The reveal panel for one index tile — a full-width drawer (so it can't
  // overflow the small tile) placed right below the scoreboard grid. Dark
  // surface + citrus-yellow term label + "Ties to:" principle line under a
  // hairline — the same brand styling as the prose .tip. Returns '' when the
  // tile isn't tappable (glossary off or lookup miss).
  function scoreGlossPanel(key, label, term) {
    if (!scoreboard[key]) return '';
    const entry = scoreGlossEntry(term);
    if (!entry) return '';
    const principleLine = entry.principle
      ? `Ties to: ${GLOSS_PRINCIPLES[entry.principle] || ''}`
      : '';
    return `
      <div class="score-gloss-panel" id="${scoreGlossPanelId(key)}" role="region" aria-label="${escapeHTML(label)} definition">
        <span class="sg-term">${escapeHTML(entry.term)}</span>
        <span class="sg-def">${escapeHTML(entry.def || '')}</span>
        ${principleLine ? `<span class="sg-principle">${escapeHTML(principleLine)}</span>` : ''}
      </div>
    `;
  }

  // Renders the gold mover card from the edition-aware spec resolved
  // above. Three label variants flow from one place; the week-ahead
  // "ONE TO WATCH" variant is forward-looking and shows a catalyst
  // line instead of price/% change. Returns '' when the spec is null
  // — week-ahead with no catalyst this week renders no card at all.
  function topMoverCard() {
    if (!_moverSpec) return '';
    // The label is an internal constant ("TODAY'S MOVER" / "WEEK'S BIGGEST MOVER"
    // / "ONE TO WATCH"), not user content — render it raw so the apostrophe
    // stays as a literal `'` (matches the prior hardcoded output byte-for-byte
    // on the standard edition).
    if (_moverSpec.kind === 'forward') {
      return `
      <div class="score-card up mover mover-forward" id="mover-card">
        <div class="mover-badge">${_moverSpec.label}</div>
        <div class="mover-name">${escapeHTML(_moverSpec.name)}</div>
        ${_moverSpec.ticker ? `<div class="mover-ticker">${escapeHTML(_moverSpec.ticker)}</div>` : ''}
        ${_moverSpec.catalyst ? `<div class="mover-catalyst">${escapeHTML(_moverSpec.catalyst)}</div>` : ''}
      </div>
    `;
    }
    const dir = _moverSpec.direction === 'up' ? 'up' : 'down';
    const arrow = _moverSpec.direction === 'up' ? 'arrow-up' : 'arrow-down';
    return `
      <div class="score-card ${dir} mover" id="mover-card">
        <div class="mover-badge">${_moverSpec.label}</div>
        <div class="mover-name">${escapeHTML(_moverSpec.name)}</div>
        <div class="mover-ticker">${escapeHTML(_moverSpec.ticker)}</div>
        <div class="price">${escapeHTML(_moverSpec.price)}</div>
        <div class="change"><span class="${arrow}"></span> ${escapeHTML(_moverSpec.change)}</div>
      </div>
    `;
  }

  // Sample chip + banner — only when content.isSample is true. Extracted
  // up here as constants so we don't have to nest single-quoted CSS inside
  // the main backtick-template (the escaping turns into a mess fast).
  const sampleChipHTML = isSample ? `<span style="font-family:'Space Grotesk',sans-serif; font-size:11px; color:var(--yellow); -webkit-text-fill-color:var(--yellow); letter-spacing:2px; vertical-align:middle; padding:3px 8px; border:1px solid var(--yellow); border-radius:6px; margin-left:10px;">SAMPLE</span>` : '';

  const sampleBannerHTML = isSample ? `
  <div class="sample-banner" role="region" aria-label="Sample digest banner">
    <div class="sample-copy">
      ✨ <strong>This is a sample digest.</strong> The real one — with today's actual market moves and fresh stories — drops every weekday at&nbsp;7&nbsp;AM EST.
    </div>
    <a class="sample-cta" href="/#signup">Sign up your kid →</a>
  </div>` : '';

  // Mover one-liner — its own callout row under the scoreboard so the
  // explanation has room to breathe. Three framings depending on the
  // edition-aware mover spec:
  //   backward (standard / weekly-wrap) → "Why X moved: <vibe>"
  //   forward  (week-ahead, oneToWatch) → "Why watch X: <reason>"
  //   no spec  (e.g. week-ahead with no catalyst) → nothing
  const topMoverWhyHTML = (_moverSpec && lk.moverProse)
    ? `
      <p style="font-size: 13px; color: var(--text-dim); margin-top: 10px;">
        ⭐ <strong style="color: var(--sun-text);">${_moverSpec.kind === 'forward'
            ? `Why watch ${escapeHTML(_moverSpec.name)}:`
            : `Why ${escapeHTML(_moverSpec.name)} moved:`}</strong> ${lk.moverProse}
      </p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Market Juice">
<meta name="theme-color" content="#FFF8EF">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icons/icon.svg">
<link rel="icon" type="image/svg+xml" href="/icons/icon.svg">
<title>Market Juice</title>
<!-- Phase 19 type system: Fredoka (display), Lexend (body/labels), Space Grotesk
     (numerals). preconnect speeds the CDN handshake; display=swap keeps text
     visible during font load (no FOIT/invisible-text flash on slow links). -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Lexend:wght@400;500;600&family=Space+Grotesk:wght@500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/engagement.css">
<link rel="stylesheet" href="/games/styles.css">
<script>
  // Phase 11 — server-injected per-request hints consumed by engagement.js.
  // __digestDate is the NY calendar date the digest is for (event tracking
  // uses this for the daily-visit + game-completed event_data).
  // __isSample tells engagement.js to render the teaser profile bar
  // ("Sign up to start earning!") instead of fetching real state.
  window.__digestDate = '${escapeHTML(opts.digestDate || '')}';
  window.__isSample = ${opts.isSample ? 'true' : 'false'};
</script>
<script src="/progression-config.js"></script>
<script src="/engagement.js" defer></script>
<script src="/engagement-popups.js" defer></script>
<script src="/pwa.js" defer></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  /* ============================================================
     Phase 19 — "Morning Juice" light theme.
     The spec's NEW token names (--surface/--ink/--citrus/…) are the
     canonical palette; the OLD names the rest of the codebase wires
     through (--card/--text/--green/…) are ALIASED onto them, so every
     component re-skins without rewriting hundreds of var() references.
     The dark palette is preserved verbatim under [data-theme="dark"] —
     it becomes the Phase 23 "Night Mode" unlock (one attribute flip).
     ============================================================ */
  :root {
    /* Canonical light palette */
    --bg: #FFF8EF;            /* warm cream page */
    --surface: #FFFFFF;       /* cards */
    --surface-border: #F0E4D3;
    --ink: #2B2118;           /* body text */
    --ink-soft: #5E5349;      /* secondary — darkened from spec #6E6258 so it clears WCAG AA (4.5:1) on cream AND the vibe washes */
    --citrus: #FF7A1A;        /* primary brand */
    --sun: #FFC233;           /* accent / mover card */
    --up: #1E9E5A;            /* green day / gains — FILLS / washes / borders */
    --down: #E5484D;          /* red day / losses — FILLS / washes / borders */
    --up-text: #0E7A3E;       /* darker green for TEXT — clears WCAG AA 4.5:1 on cream/white (bright --up is only ~3.4:1 as text; measured live) */
    --down-text: #C92A2F;     /* darker red for TEXT — clears AA */
    --sun-text: #8A5E12;      /* dark amber for gold TEXT (MC counts, labels) — bright --sun is ~1.5:1 as text */
    --citrus-text: #B0500B;   /* dark citrus for orange TEXT + section icons — bright --citrus is ~2.5:1 as text */
    --berry: #5B4FC7;         /* quiz, lesson boxes, parent links */
    --vibe-green: #E7F3E6;    /* header wash, green day */
    --vibe-red: #FBEAEA;      /* header wash, red day */
    --vibe-mixed: #FBF1DC;    /* header wash, mixed + weekend/closed */
    --vibe-ahead: #EFEDFA;    /* header wash, week-ahead Monday */

    /* Aliases — older names used across template/engagement/games CSS.
       --green/--red point at the TEXT variants (most uses are colored text);
       fills that need the brighter hue use --up/--down directly. */
    --card: var(--surface);
    --card-border: var(--surface-border);
    --text: var(--ink);
    --text-dim: var(--ink-soft);
    --text-bright: var(--ink);
    --green: var(--up-text);
    --red: var(--down-text);
    --orange: var(--citrus);
    --yellow: var(--sun);
    --purple: var(--berry);
    --blue: var(--berry);     /* the spec palette has no blue — collapse to berry */
    --green-glow: rgba(30,158,90,0.12);
    --red-glow: rgba(229,72,77,0.12);
    --blue-glow: rgba(91,79,199,0.10);
    --yellow-glow: rgba(255,194,51,0.18);

    /* Readability tokens (Phase 19 bumps from the 2026-06 overhaul). */
    --body-size: 17px;          /* spec body size */
    --body-leading: 1.7;        /* spec leading */
    --prose-measure: 64ch;      /* max line length for flowing prose only */
    --para-gap: 0.95em;         /* space between split paragraphs */
    --gloss-underline: rgba(255,122,26,0.6); /* citrus dotted underline, legible on cream */
  }
  /* Phase 23 unlock — the preserved dark theme. Only the canonical tokens
     need redeclaring; the aliases above resolve through them. */
  [data-theme="dark"] {
    --bg: #0d1117;
    --surface: #161b22;
    --surface-border: #21262d;
    --ink: #e6edf3;
    --ink-soft: #8b949e;
    --citrus: #f0883e;
    --sun: #f0c040;
    --up: #3fb950;
    --down: #f85149;
    --up-text: #3fb950;   /* on dark, the bright accents ARE legible — no darkening */
    --down-text: #f85149;
    --sun-text: #f0c040;
    --citrus-text: #f0883e;
    --berry: #bc8cff;
    --vibe-green: rgba(30,158,90,0.10);
    --vibe-red: rgba(229,72,77,0.10);
    --vibe-mixed: rgba(255,194,51,0.08);
    --vibe-ahead: rgba(91,79,199,0.10);
    --text-bright: #ffffff;
    --green-glow: rgba(30,158,90,0.15);
    --red-glow: rgba(229,72,77,0.15);
    --blue-glow: rgba(91,79,199,0.12);
    --yellow-glow: rgba(255,194,51,0.12);
    --gloss-underline: rgba(255,122,26,0.45);
  }
  body { background: var(--bg); color: var(--text); font-family: 'Lexend', sans-serif; min-height: 100vh; overflow-x: hidden; -webkit-font-smoothing: antialiased; }
  /* Display type stays Fredoka; numerals use Space Grotesk (set per element). */
  h1, h2, h3, .logo, .section-header h2, .bp-header h3 { font-family: 'Fredoka', sans-serif; }
  .container { max-width: 680px; margin: 0 auto; padding: 24px 16px 60px; position: relative; z-index: 1; }
  /* Phase 19 — header band gets a soft vibe wash (keyed class set server-side). */
  .header { text-align: center; margin-bottom: 32px; padding: 22px 18px 20px; border-radius: 22px; border: 1px solid var(--surface-border); animation: slideDown 0.6s ease-out; }
  .header--green { background: linear-gradient(180deg, var(--vibe-green), var(--bg)); }
  .header--red   { background: linear-gradient(180deg, var(--vibe-red), var(--bg)); }
  .header--mixed { background: linear-gradient(180deg, var(--vibe-mixed), var(--bg)); }
  .header--ahead { background: linear-gradient(180deg, var(--vibe-ahead), var(--bg)); }
  .header-pill { display: inline-block; margin-top: 8px; font-family: 'Lexend', sans-serif; font-weight: 600; font-size: 12px; letter-spacing: 0.3px; padding: 4px 12px; border-radius: 999px; }
  .header-pill--green { background: var(--vibe-green); color: var(--up-text); border: 1px solid rgba(30,158,90,0.3); }
  .header-pill--red   { background: var(--vibe-red); color: var(--down-text); border: 1px solid rgba(229,72,77,0.3); }
  .header-pill--mixed { background: var(--vibe-mixed); color: #8A5E12; border: 1px solid rgba(255,194,51,0.45); }
  .header-pill--ahead { background: var(--vibe-ahead); color: var(--berry); border: 1px solid rgba(91,79,199,0.3); }
  @keyframes slideDown { from { opacity: 0; transform: translateY(-20px); } to { opacity: 1; transform: translateY(0); } }
  /* Brand lockup: PNG mark + wordmark in one flex container, matching the
     landing-page hero treatment (Phase 9). The wordmark keeps the
     gradient-on-Market / solid-gold-on-Juice treatment digest readers are
     used to. */
  .logo {
    display: inline-flex; align-items: center;
    gap: clamp(0.2rem, 0.6vw, 0.45rem);
    font-size: 42px; font-weight: 700;
    /* Phase 19 — recolored to the Morning Juice brand: citrus → berry → sun. */
    background: linear-gradient(135deg, var(--citrus), var(--berry), var(--sun));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    letter-spacing: -1px;
    line-height: 1;
  }
  .logo-mark {
    width: clamp(5rem, 14vw, 8rem);
    height: auto;
    display: inline-block;
    flex-shrink: 0;
    filter: drop-shadow(0 6px 18px rgba(255,122,26,0.20));
    -webkit-text-fill-color: initial;
  }
  /* "Juice" accent — solid citrus to anchor the lockup on the cream page. */
  .logo em { font-style: normal; color: var(--citrus); -webkit-text-fill-color: var(--citrus); }
  .date-line { font-family: 'Space Grotesk', sans-serif; font-size: 13px; color: var(--text-dim); margin-top: 6px; letter-spacing: 1px; }
  .tagline { font-size: 15px; color: var(--text-dim); margin-top: 4px; }
  .section-header { display: flex; align-items: center; gap: 10px; margin: 32px 0 16px; animation: fadeIn 0.5s ease-out both; }
  .section-header .emoji { font-size: 28px; line-height: 1; }
  /* Phase 19 — inline SVG section icons, citrus-tinted via currentColor. */
  .ico { width: 26px; height: 26px; flex-shrink: 0; }
  .section-header .ico { color: var(--citrus-text); }
  .bp-header .ico { width: 22px; height: 22px; color: var(--citrus-text); }
  .section-header h2 { font-size: 22px; font-weight: 700; color: var(--text-bright); }
  .section-header .line { flex: 1; height: 2px; background: linear-gradient(90deg, var(--card-border), transparent); border-radius: 1px; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  .scoreboard { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; animation: fadeIn 0.5s ease-out 0.1s both; }
  .score-card { background: var(--card); border: 1px solid var(--card-border); border-radius: 16px; padding: 16px 14px; text-align: center; transition: transform 0.2s, box-shadow 0.2s; cursor: default; }
  .score-card:hover { transform: translateY(-4px); }
  .score-card.up { box-shadow: 0 4px 20px var(--green-glow); border-color: rgba(30,158,90,0.3); }
  .score-card.down { box-shadow: 0 4px 20px var(--red-glow); border-color: rgba(229,72,77,0.3); }
  .score-card .name { font-family: 'Lexend', sans-serif; font-weight: 600; font-size: 11px; color: var(--text-dim); letter-spacing: 0.4px; text-transform: uppercase; margin-bottom: 6px; }
  .score-card .price { font-size: 20px; font-weight: 700; color: var(--text-bright); margin-bottom: 4px; }
  .score-card .change { font-family: 'Space Grotesk', sans-serif; font-size: 16px; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 4px; }
  .score-card.up .change { color: var(--green); }
  .score-card.down .change { color: var(--red); }
  .arrow-up::before { content: "▲"; font-size: 12px; }
  .arrow-down::before { content: "▼"; font-size: 12px; }
  .score-card .vibe { font-size: 12px; color: var(--text-dim); margin-top: 6px; font-style: italic; }
  .score-card.mover { background: linear-gradient(135deg, rgba(255,194,51,0.10), rgba(255,122,26,0.08)); border-color: rgba(255,194,51,0.4); box-shadow: 0 4px 24px rgba(255,194,51,0.18), inset 0 0 30px rgba(255,194,51,0.03); position: relative; }
  .score-card.mover:hover { box-shadow: 0 6px 28px rgba(255,194,51,0.28), inset 0 0 30px rgba(255,194,51,0.05); }
  .mover-badge { font-family: 'Lexend', sans-serif; font-size: 9px; letter-spacing: 0.6px; background: linear-gradient(135deg, var(--sun), var(--citrus)); color: #2B2118; padding: 3px 8px; border-radius: 6px; font-weight: 700; margin-bottom: 6px; display: inline-block; }
  .mover-name { font-size: 14px; font-weight: 700; color: var(--sun-text); margin-bottom: 2px; line-height: 1.2; }
  .mover-ticker { font-family: 'Space Grotesk', sans-serif; font-size: 10px; color: var(--text-dim); letter-spacing: 1.5px; margin-bottom: 6px; }
  /* Week-ahead "One to Watch" — forward-looking variant of the gold mover
     card. No price / arrow / % change; the catalyst replaces the numbers. */
  .mover-catalyst { font-size: 12px; font-weight: 600; color: var(--text); line-height: 1.35; margin-top: 2px; }
  .story-card { background: var(--card); border: 1px solid var(--card-border); border-radius: 16px; padding: 20px; margin-bottom: 14px; animation: fadeIn 0.5s ease-out both; transition: transform 0.2s; }
  .story-card:hover { transform: translateY(-2px); }
  .story-card .badge { display: inline-block; font-family: 'Lexend', sans-serif; font-size: 10px; letter-spacing: 0.3px; text-transform: uppercase; padding: 4px 10px; border-radius: 20px; margin-bottom: 10px; font-weight: 600; }
  .badge.hot { background: var(--red-glow); color: var(--red); border: 1px solid rgba(229,72,77,0.3); }
  .badge.new { background: var(--blue-glow); color: var(--blue); border: 1px solid rgba(91,79,199,0.3); }
  .badge.money { background: var(--green-glow); color: var(--green); border: 1px solid rgba(30,158,90,0.3); }
  .badge.world { background: var(--yellow-glow); color: var(--sun-text); border: 1px solid rgba(255,194,51,0.3); }
  .badge.brain { background: rgba(91,79,199,0.12); color: var(--purple); border: 1px solid rgba(91,79,199,0.3); }
  .story-card h3 { font-size: 18px; font-weight: 600; color: var(--text-bright); margin-bottom: 8px; line-height: 1.3; }
  /* Body prose: bigger, roomier, measure-capped. max-width keeps lines from
     running the full card width; left-aligned (not centered) so the column
     stays flush under the story heading. Paragraph gap only applies when the
     field contains \n\n breaks and renders as multiple <p>. */
  .story-card p { font-size: var(--body-size); line-height: var(--body-leading); color: var(--text); max-width: var(--prose-measure); margin: 0 0 var(--para-gap); }
  .story-card p:last-child { margin-bottom: 0; }
  .story-card .why-it-matters { margin-top: 12px; padding: 12px 14px; background: rgba(91,79,199,0.06); border-left: 3px solid var(--blue); border-radius: 0 10px 10px 0; font-size: var(--body-size); color: var(--text); line-height: var(--body-leading); }
  .story-card .why-it-matters p { margin: 0 0 var(--para-gap); }
  .story-card .why-it-matters p:last-child { margin-bottom: 0; }
  .story-card .why-it-matters strong { color: var(--blue); font-weight: 600; }
  .dyk-card { background: linear-gradient(135deg, rgba(91,79,199,0.10), rgba(91,79,199,0.06)); border: 1px solid rgba(91,79,199,0.3); border-radius: 16px; padding: 20px 22px; animation: fadeIn 0.5s ease-out both; }
  .dyk-card .dyk-label { font-family: 'Lexend', sans-serif; font-weight: 600; font-size: 10px; letter-spacing: 0.5px; text-transform: uppercase; color: var(--purple); margin-bottom: 10px; }
  .dyk-card .dyk-fact { font-size: 17px; font-weight: 500; color: var(--text-bright); line-height: var(--body-leading); max-width: var(--prose-measure); margin-bottom: 12px; }
  .dyk-card .dyk-fact p { margin: 0 0 var(--para-gap); }
  .dyk-card .dyk-fact p:last-child { margin-bottom: 0; }
  .dyk-card .dyk-connection { font-size: var(--body-size); color: var(--text); line-height: var(--body-leading); padding: 12px 14px; background: rgba(91,79,199,0.08); border-left: 3px solid var(--purple); border-radius: 0 10px 10px 0; }
  .dyk-card .dyk-connection p { margin: 0 0 var(--para-gap); }
  .dyk-card .dyk-connection p:last-child { margin-bottom: 0; }
  .dyk-card .dyk-connection strong { color: var(--purple); font-weight: 600; }
  .quiz-card { background: linear-gradient(135deg, rgba(91,79,199,0.08), rgba(91,79,199,0.08)); border: 1px solid rgba(91,79,199,0.25); border-radius: 16px; padding: 24px; text-align: center; animation: fadeIn 0.5s ease-out both; }
  .quiz-card .quiz-label { font-family: 'Lexend', sans-serif; font-weight: 600; font-size: 11px; letter-spacing: 0.5px; text-transform: uppercase; color: var(--purple); margin-bottom: 12px; }
  .quiz-card .quiz-question { font-size: 18px; font-weight: 600; color: var(--text-bright); margin-bottom: 20px; line-height: 1.4; }
  .quiz-options { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; }
  .quiz-btn { background: var(--card); border: 2px solid var(--card-border); border-radius: 12px; padding: 12px; color: var(--text); font-family: 'Fredoka', sans-serif; font-size: 15px; font-weight: 500; cursor: pointer; transition: all 0.2s; }
  .quiz-btn:hover { border-color: var(--purple); background: rgba(91,79,199,0.08); transform: scale(1.03); }
  .quiz-btn.correct { border-color: var(--green); background: var(--green-glow); color: var(--green); }
  .quiz-btn.wrong { border-color: var(--red); background: var(--red-glow); color: var(--red); opacity: 0.6; }
  .quiz-answer { display: none; font-size: 14px; color: var(--text); line-height: 1.5; padding: 14px; background: rgba(30,158,90,0.06); border-radius: 12px; border: 1px solid rgba(30,158,90,0.2); }
  .quiz-answer.visible { display: block; }
  /* Phase 17 — Tomorrow's Call prediction card (per-user, end of digest) */
  .tc-card { background: var(--card); border: 1px solid var(--card-border); border-radius: 16px; padding: 20px; animation: fadeIn 0.5s ease-out both; text-align: center; }
  .tc-verdict { font-size: 17px; font-weight: 600; border-radius: 10px; padding: 10px 12px; margin-bottom: 12px; }
  .tc-verdict-win { background: var(--green-glow); color: var(--green); border: 1px solid rgba(30,158,90,0.35); }
  .tc-verdict-miss { background: var(--red-glow); color: var(--text); border: 1px solid rgba(229,72,77,0.3); }
  .tc-record { color: var(--text-dim); font-size: 13.5px; margin-bottom: 12px; }
  .tc-record strong { color: var(--sun-text); font-family: 'Space Grotesk', sans-serif; }
  .tc-question { font-size: 17px; font-weight: 500; margin-bottom: 14px; }
  .tc-buttons { display: flex; gap: 10px; justify-content: center; }
  .tc-btn { flex: 1; max-width: 180px; border: none; border-radius: 12px; padding: 14px 10px; font-family: inherit; font-weight: 600; font-size: 16px; cursor: pointer; transition: filter 0.15s, transform 0.1s; }
  .tc-btn:hover { filter: brightness(1.15); }
  .tc-btn:active { transform: scale(0.97); }
  .tc-btn:disabled { opacity: 0.5; cursor: default; }
  .tc-btn-green { background: var(--green-glow); color: var(--green); border: 1px solid rgba(30,158,90,0.45); }
  .tc-btn-red { background: var(--red-glow); color: var(--red); border: 1px solid rgba(229,72,77,0.45); }
  .tc-locked { background: rgba(91,79,199,0.1); border: 1px solid rgba(91,79,199,0.3); color: var(--text); border-radius: 10px; padding: 12px; font-size: 14.5px; }
  .tc-feedback { margin-top: 10px; color: var(--text-dim); font-size: 13.5px; min-height: 1.2em; }
  .tc-caption { margin-top: 12px; color: var(--text-dim); font-size: 12.5px; }
  .tc-intro { background: var(--blue-glow); border: 1px solid rgba(91,79,199,0.3); border-radius: 12px; padding: 14px; margin-bottom: 14px; text-align: left; }
  .tc-intro-title { font-weight: 600; font-size: 15px; margin-bottom: 6px; }
  .tc-intro-body { color: var(--text); font-size: 14px; line-height: 1.55; margin-bottom: 10px; }
  .tc-intro-btn { background: var(--blue); color: #fff; border: none; border-radius: 8px; padding: 8px 18px; font-family: inherit; font-weight: 600; font-size: 14px; cursor: pointer; }
  .tc-intro-btn:hover { filter: brightness(1.1); }

  /* Phase 20a — Weekly Hold card (Phase 19 tokens; --up-text/--down-text for returns) */
  .wh-card { background: var(--surface); border: 1px solid var(--surface-border); border-radius: 16px; padding: 20px; animation: fadeIn 0.5s ease-out both; }
  .wh-pct { font-family: 'Space Grotesk', sans-serif; font-weight: 700; }
  .wh-up { color: var(--up-text); }
  .wh-down { color: var(--down-text); }
  .wh-prompt { font-size: 15px; color: var(--ink); margin-bottom: 14px; line-height: 1.5; }
  .wh-cands { display: grid; gap: 10px; }
  .wh-cand { display: flex; flex-direction: column; gap: 4px; text-align: left; background: var(--bg); border: 1px solid var(--surface-border); border-radius: 12px; padding: 12px 14px; font-family: inherit; cursor: pointer; transition: border-color 0.15s, transform 0.1s; }
  .wh-cand:hover:not(:disabled) { border-color: var(--berry); transform: translateY(-1px); }
  .wh-cand:active:not(:disabled) { transform: scale(0.99); }
  .wh-cand:disabled { opacity: 0.6; cursor: default; }
  .wh-cand-name { font-family: 'Fredoka', sans-serif; font-weight: 600; font-size: 16px; color: var(--ink); }
  .wh-cand-case { font-size: 13.5px; color: var(--ink-soft); line-height: 1.4; }
  .wh-cand.wh-cand-chosen { border-color: var(--berry); background: var(--vibe-ahead); }
  .wh-caption { margin-top: 12px; color: var(--ink-soft); font-size: 12.5px; }
  .wh-feedback { margin-top: 8px; color: var(--ink-soft); font-size: 13.5px; min-height: 1em; }
  .wh-locked { background: var(--vibe-ahead); border: 1px solid rgba(91,79,199,0.25); color: var(--ink); border-radius: 12px; padding: 14px; font-size: 14.5px; }
  .wh-verdict-head { font-size: 16px; font-weight: 600; color: var(--ink); margin-bottom: 12px; line-height: 1.4; }
  .wh-results { display: grid; gap: 8px; }
  .wh-result-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-radius: 10px; background: var(--bg); border: 1px solid var(--surface-border); }
  .wh-result-row.wh-chosen { background: var(--vibe-ahead); border-color: var(--berry); }
  .wh-result-name { font-weight: 500; color: var(--ink); }
  .wh-yours { font-size: 11px; font-weight: 600; color: var(--berry); background: rgba(91,79,199,0.12); padding: 1px 7px; border-radius: 999px; }

  /* Phase 20b — "Your Week in Juice" Sunday card */
  .wj-card { background: linear-gradient(180deg, var(--vibe-mixed), var(--surface)); border: 1px solid var(--surface-border); border-radius: 18px; padding: 18px 20px; margin-bottom: 24px; animation: fadeIn 0.5s ease-out both; }
  .wj-title { font-family: 'Fredoka', sans-serif; font-weight: 700; font-size: 18px; color: var(--ink); margin-bottom: 14px; }
  .wj-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 12px; }
  .wj-stat { background: var(--surface); border: 1px solid var(--surface-border); border-radius: 12px; padding: 12px 8px; text-align: center; }
  .wj-stat-value { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 22px; color: var(--citrus-text); }
  .wj-stat-label { font-size: 11.5px; color: var(--ink-soft); margin-top: 2px; }
  .wj-streak { font-size: 14px; color: var(--ink); margin-bottom: 6px; }
  .wj-rank { font-size: 13.5px; color: var(--ink-soft); }
  .wj-rank strong { color: var(--sun-text); font-family: 'Space Grotesk', sans-serif; }
  .wj-record { margin-top: 10px; font-weight: 600; font-size: 14.5px; color: var(--up-text); }

  /* Phase 16 — Mystery Mover (client-hydrated by games/mystery-mover.js) */
  .mm-card { background: var(--card); border: 1px solid var(--card-border); border-radius: 16px; padding: 20px; animation: fadeIn 0.5s ease-out both; }
  .mm-tagline { color: var(--text-dim); font-size: 13.5px; margin-bottom: 14px; }
  .mm-clue { background: rgba(255,122,26,0.08); border: 1px solid rgba(255,122,26,0.25); border-radius: 10px; padding: 10px 12px; margin-bottom: 8px; font-size: var(--body-size); line-height: 1.55; }
  .mm-clue-num { color: var(--citrus-text); font-weight: 600; font-size: 12px; letter-spacing: 0.5px; margin-right: 6px; }
  .mm-controls { display: flex; gap: 8px; margin-top: 12px; }
  .mm-input { flex: 1; min-width: 0; background: var(--bg); color: var(--text); border: 1px solid var(--card-border); border-radius: 10px; padding: 10px 12px; font-family: inherit; font-size: 15px; }
  .mm-input:focus { outline: none; border-color: var(--citrus-text); }
  .mm-guess-btn { background: var(--orange); color: #1a1208; border: none; border-radius: 10px; padding: 10px 18px; font-family: inherit; font-weight: 600; font-size: 15px; cursor: pointer; }
  .mm-guess-btn:hover { filter: brightness(1.1); }
  .mm-meta { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 10px; color: var(--text-dim); font-size: 13px; flex-wrap: wrap; }
  .mm-reveal-btn { background: none; border: 1px dashed var(--card-border); color: var(--text-dim); border-radius: 8px; padding: 6px 10px; font-family: inherit; font-size: 13px; cursor: pointer; }
  .mm-reveal-btn:hover { color: var(--text); border-color: var(--text-dim); }
  .mm-feedback { margin-top: 10px; color: var(--text-dim); font-size: 14px; min-height: 1.2em; }
  .mm-result { font-size: 19px; font-weight: 600; margin-top: 6px; }
  .mm-grid-preview { font-size: 22px; letter-spacing: 2px; margin: 10px 0 14px; }
  .mm-share-btn { background: var(--card); color: var(--text); border: 1px solid var(--orange); border-radius: 10px; padding: 10px 16px; font-family: inherit; font-weight: 600; font-size: 14px; cursor: pointer; }
  .mm-share-btn:hover { background: rgba(255,122,26,0.12); }
  .mm-signup-cta { display: block; margin-top: 14px; color: var(--sun-text); font-weight: 600; text-decoration: none; }
  .mm-signup-cta:hover { text-decoration: underline; }
  .word-card { background: var(--card); border: 1px solid var(--card-border); border-radius: 16px; padding: 20px; animation: fadeIn 0.5s ease-out both; text-align: center; }
  .word-card .word-label { font-family: 'Lexend', sans-serif; font-weight: 600; font-size: 10px; letter-spacing: 0.5px; text-transform: uppercase; color: var(--citrus-text); margin-bottom: 8px; }
  .word-card .the-word { font-size: 28px; font-weight: 700; color: var(--sun-text); margin-bottom: 4px; }
  .word-card .word-type { font-size: 12px; color: var(--text-dim); font-style: italic; margin-bottom: 10px; }
  .word-card .word-def { font-size: 15px; color: var(--text); line-height: 1.55; max-width: 500px; margin: 0 auto; }
  /* ── Glossary tap-to-reveal ───────────────────────────────────────────
     Visual treatment locked in glossary-demo.html: dotted citrus-orange
     underline on the term; a dark tooltip card with a citrus-yellow term
     label, the definition, and an optional principle tie-in under a hairline
     divider; an optional NEW superscript for freshly auto-grown terms. Colors
     are the demo's exact juice palette. One adaptation for the dark digest:
     the tip carries a hairline border + stronger shadow so the near-black card
     separates from the near-black page background. */
  .gloss {
    position: relative;
    cursor: pointer;
    color: var(--text-bright);
    font-weight: 500;
    text-decoration: underline;
    text-decoration-style: dotted;
    text-decoration-color: var(--gloss-underline);
    text-underline-offset: 3px;
    -webkit-tap-highlight-color: transparent;
  }
  .gloss:focus-visible {
    outline: 2px solid #FFC23C;
    outline-offset: 2px;
    border-radius: 3px;
  }
  .gloss.is-new::after {
    content: "NEW";
    font-family: 'Space Grotesk', sans-serif;
    font-size: 8px; vertical-align: super;
    color: var(--green); margin-left: 2px; letter-spacing: 0.5px;
  }
  .gloss .tip {
    position: absolute;
    left: 50%; bottom: calc(100% + 10px);
    transform: translateX(-50%) translateY(6px) scale(0.96);
    width: min(260px, 78vw);
    background: #1C1A17; color: #FFF8EE;
    border: 1px solid rgba(43,33,24,0.10);
    border-radius: 12px; padding: 12px 14px;
    font-size: 13.5px; line-height: 1.5; font-weight: 400;
    font-family: 'Fredoka', sans-serif;
    text-align: left; text-decoration: none;
    opacity: 0; pointer-events: none;
    transition: opacity .16s ease, transform .16s ease;
    z-index: 30;
    box-shadow: 0 10px 28px rgba(0,0,0,0.55);
  }
  .gloss .tip::after {
    content: ""; position: absolute; top: 100%; left: 50%;
    transform: translateX(-50%);
    border: 7px solid transparent; border-top-color: #1C1A17;
  }
  .gloss .tip .tip-term {
    font-family: 'Space Grotesk', sans-serif; font-size: 11px;
    text-transform: uppercase; letter-spacing: 0.6px;
    color: #FFC23C; display: block; margin-bottom: 4px;
  }
  .gloss .tip .tip-principle {
    display: block; margin-top: 8px; padding-top: 8px;
    border-top: 1px solid rgba(43,33,24,0.12);
    font-size: 11.5px; color: #C9BFB0;
  }
  .gloss.open .tip {
    opacity: 1; pointer-events: auto;
    transform: translateX(-50%) translateY(0) scale(1);
  }
  /* ── Scoreboard tile glossary (tap-to-reveal) ─────────────────────────
     The 3 index tiles are always tappable. A small tile can't host the prose
     .tip bubble (it clips), so tapping expands a full-width drawer below the
     scoreboard row instead. Same brand surface as the prose tip: dark card,
     citrus-yellow term label, "Ties to:" principle line under a hairline. */
  .score-card.tappable { cursor: pointer; }
  .score-card.tappable .sg-name {
    text-decoration: underline; text-decoration-style: dotted;
    text-decoration-color: #FF7A1A; text-underline-offset: 3px;
  }
  .score-card.tappable .sg-i {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 10px; vertical-align: super;
    color: #FF7A1A; margin-left: 3px; opacity: 0.85;
  }
  .score-card.tappable:focus-visible {
    outline: 2px solid #FFC23C; outline-offset: 2px;
  }
  /* Active tile cue while its drawer is open. */
  .score-card.tappable.open {
    border-color: rgba(255,194,51,0.55);
    box-shadow: 0 4px 20px rgba(255,194,51,0.18);
  }
  .score-gloss-panel {
    display: none;
    margin-top: 12px;
    background: #1C1A17; color: #FFF8EE;
    border: 1px solid rgba(43,33,24,0.10);
    border-radius: 12px; padding: 14px 16px;
    text-align: left;
    font-family: 'Fredoka', sans-serif;
    box-shadow: 0 10px 28px rgba(0,0,0,0.45);
  }
  .score-gloss-panel.open { display: block; animation: fadeIn 0.25s ease-out both; }
  .score-gloss-panel .sg-term {
    font-family: 'Space Grotesk', sans-serif; font-size: 11px;
    text-transform: uppercase; letter-spacing: 0.6px;
    color: #FFC23C; display: block; margin-bottom: 6px;
  }
  .score-gloss-panel .sg-def {
    display: block; font-size: 14.5px; line-height: 1.55;
  }
  .score-gloss-panel .sg-principle {
    display: block; margin-top: 10px; padding-top: 10px;
    border-top: 1px solid rgba(43,33,24,0.12);
    font-size: 12px; color: #C9BFB0;
  }
  .vibe-bar { margin-top: 16px; text-align: center; background: linear-gradient(135deg, rgba(30,158,90,0.06), rgba(91,79,199,0.06)); border: 1px solid var(--card-border); border-radius: 16px; padding: 18px 20px; animation: fadeIn 0.5s ease-out both; }
  .big-picture { margin-top: 16px; background: linear-gradient(135deg, rgba(91,79,199,0.12), rgba(91,79,199,0.03)); border: 1px solid rgba(91,79,199,0.25); border-radius: 16px; padding: 20px 22px; animation: fadeIn 0.5s ease-out both; }
  .big-picture .bp-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
  .big-picture .bp-header .emoji { font-size: 24px; line-height: 1; }
  .big-picture .bp-header h3 { font-size: 18px; font-weight: 700; color: var(--text-bright); }
  .big-picture p { font-size: var(--body-size); line-height: var(--body-leading); color: var(--text); max-width: var(--prose-measure); margin: 0 0 var(--para-gap); }
  .big-picture p:last-child { margin-bottom: 0; }
  .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid var(--card-border); font-size: 13px; color: var(--text-dim); animation: fadeIn 0.5s ease-out both; }
  .footer .rocket { font-size: 20px; }
  /* Edition label — renders under .date-line for Weekly Wrap and Week Ahead. */
  .edition-label {
    font-family: 'Fredoka', sans-serif;
    font-size: 15px; font-weight: 600;
    margin-top: 4px;
    background: linear-gradient(135deg, var(--blue), var(--purple));
    -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent;
    letter-spacing: 0.2px;
  }
  /* Framing subtitle — sits right under .edition-label on weekly-wrap +
     week-ahead. Makes the backward/forward orientation unmistakable. */
  .edition-framing {
    font-family: 'Fredoka', sans-serif;
    font-size: 13px; font-weight: 500;
    margin-top: 2px;
    color: var(--text-dim);
    letter-spacing: 0.1px;
  }
  /* Phase 7 — small greeting + logout link in the header. Subtle by
     design: this is for shared-device hygiene, not a daily-visible CTA. */
  .kid-greeting {
    margin-top: 10px;
    display: inline-flex; align-items: center; gap: 12px;
    padding: 5px 12px;
    background: rgba(91,79,199,0.08);
    border: 1px solid rgba(91,79,199,0.25);
    border-radius: 999px;
    font-size: 13px;
  }
  .kid-greeting-name { color: var(--text-bright); font-weight: 600; }
  .kid-greeting .logout-link {
    color: var(--text-dim);
    text-decoration: none;
    font-size: 12px;
    border-left: 1px solid rgba(43,33,24,0.12);
    padding-left: 12px;
  }
  .kid-greeting .logout-link:hover { color: var(--text-bright); }
  /* Weekly Challenge card — Sunday-only. Distinct blue/purple gradient
     so it doesn't visually compete with the purple dyk-card next to it. */
  .wc-card {
    background: linear-gradient(135deg, rgba(91,79,199,0.14), rgba(91,79,199,0.08));
    border: 1px solid rgba(91,79,199,0.30);
    border-radius: 16px;
    padding: 20px 22px;
    animation: fadeIn 0.5s ease-out both;
  }
  .wc-card .wc-label {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 10px; letter-spacing: 2px;
    text-transform: uppercase; color: var(--blue);
    margin-bottom: 10px;
  }
  .wc-card .wc-headline {
    font-size: 19px; font-weight: 600;
    color: var(--text-bright); line-height: 1.4;
    margin-bottom: 10px;
  }
  .wc-card .wc-body {
    font-size: 15px; color: var(--text);
    line-height: 1.6;
  }
  /* ── Sunday Challenge ────────────────────────────────────────────────
     A longer interactive game on Sundays. All 4 game types (trading-floor,
     ceo, investathon, dilemma) share these .sc-* classes — the renderer
     in public/games/sunday-challenge.js picks which structural pieces to
     compose. Distinct gold/blue gradient border so it reads as "special"
     vs the regular daily cards. */
  .sc-subtitle {
    font-size: 13px;
    color: var(--text-dim);
    text-align: center;
    margin: -6px 16px 14px;
    font-style: italic;
  }
  .sc-card {
    background: linear-gradient(135deg, rgba(255,194,51,0.10), rgba(91,79,199,0.10));
    border: 1px solid rgba(255,194,51,0.35);
    border-radius: 16px;
    padding: 20px 22px;
    animation: fadeIn 0.5s ease-out both;
  }
  .sc-round-meta {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 11px; letter-spacing: 1.5px;
    text-transform: uppercase; color: var(--sun-text);
    margin-bottom: 12px;
  }
  .sc-headline {
    background: var(--surface);
    border-radius: 12px;
    padding: 14px 16px;
    margin-bottom: 14px;
  }
  .sc-headline p {
    font-size: 15px;
    color: var(--text-bright);
    line-height: 1.55;
    margin: 0;
  }
  .sc-year {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 12px; letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--sun-text);
    margin-bottom: 8px;
  }
  .sc-allocation {
    font-size: 13px;
    color: var(--text-dim);
    margin-bottom: 10px;
  }
  .sc-stocks {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-bottom: 12px;
  }
  .sc-stock {
    background: var(--surface);
    border: 1px solid var(--surface-border);
    border-radius: 12px;
    padding: 12px;
    text-align: left;
    cursor: pointer;
    color: var(--text);
    font-family: inherit;
    transition: transform 0.1s, border-color 0.15s, background 0.15s;
  }
  .sc-stock:hover:not(:disabled) { transform: translateY(-1px); border-color: rgba(255,194,51,0.4); }
  .sc-stock:disabled { opacity: 0.7; cursor: default; }
  .sc-stock.sc-selected { border-color: var(--sun-text); background: rgba(255,194,51,0.10); }
  .sc-stock-ticker { font-weight: 700; font-size: 14px; color: var(--text-bright); }
  .sc-stock-name { font-size: 12px; color: var(--text-dim); margin-bottom: 6px; }
  .sc-stock-price { font-family: 'Space Grotesk', sans-serif; font-size: 13px; color: var(--text); }
  .sc-stock-alloc {
    margin-top: 6px;
    font-family: 'Space Grotesk', sans-serif;
    font-size: 12px;
    color: var(--sun-text);
    font-weight: 700;
  }
  .sc-total-row {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 12px; font-size: 14px; color: var(--text);
  }
  .sc-total { color: var(--sun-text); }
  .sc-options {
    display: flex; flex-direction: column; gap: 10px;
    margin-bottom: 12px;
  }
  .sc-option {
    background: var(--surface);
    border: 1px solid var(--surface-border);
    border-radius: 12px;
    padding: 12px 14px;
    text-align: left;
    color: var(--text);
    cursor: pointer;
    font-family: inherit;
    font-size: 14px;
    line-height: 1.4;
    display: flex; align-items: flex-start; gap: 12px;
    transition: transform 0.1s, border-color 0.15s, background 0.15s;
  }
  .sc-option:hover:not(:disabled) { transform: translateY(-1px); border-color: rgba(91,79,199,0.45); }
  .sc-option:disabled { cursor: default; }
  .sc-option-letter {
    flex-shrink: 0;
    width: 24px; height: 24px; border-radius: 50%;
    background: rgba(91,79,199,0.18);
    color: var(--blue);
    font-family: 'Space Grotesk', sans-serif; font-size: 12px;
    display: inline-flex; align-items: center; justify-content: center;
    font-weight: 700;
  }
  .sc-option-text { flex: 1; }
  .sc-option.sc-correct { border-color: var(--up); background: var(--green-glow); }
  .sc-option.sc-wrong   { border-color: var(--down); background: var(--red-glow); }
  .sc-option.sc-selected { border-color: var(--blue); background: rgba(91,79,199,0.10); }
  .sc-result-area { margin-top: 14px; }
  .sc-result-head {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 11px; letter-spacing: 1.5px;
    text-transform: uppercase;
    margin-bottom: 10px;
    color: var(--sun-text);
  }
  .sc-result-head.win  { color: var(--up-text); }
  .sc-result-head.miss { color: var(--down-text); }
  .sc-result-body, .sc-result-lesson, .sc-bottom-line {
    font-size: 14px; line-height: 1.6;
    color: var(--text); margin-bottom: 10px;
  }
  .sc-result-summary {
    background: var(--surface);
    border-radius: 10px;
    padding: 10px 12px;
    margin: 10px 0;
    font-size: 14px;
    display: grid; gap: 4px;
  }
  .sc-result-bars { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
  .sc-result-bar-row {
    display: grid;
    grid-template-columns: 90px 1fr 60px;
    align-items: center; gap: 8px;
    font-family: 'Space Grotesk', sans-serif;
    font-size: 12px;
  }
  .sc-result-bar-label { color: var(--text-dim); }
  .sc-result-bar {
    background: rgba(43,33,24,0.04);
    height: 8px; border-radius: 4px;
    overflow: hidden;
  }
  .sc-result-bar-fill {
    height: 100%; border-radius: 4px;
    transition: width 0.4s ease-out;
  }
  .sc-result-bar-fill.up   { background: var(--up); }
  .sc-result-bar-fill.down { background: var(--down); }
  .sc-result-bar-pct.up   { color: var(--up-text); text-align: right; }
  .sc-result-bar-pct.down { color: var(--down-text); text-align: right; }
  .sc-next-btn, .sc-reveal-btn {
    background: linear-gradient(135deg, var(--yellow), #b08a4a);
    border: none; border-radius: 10px;
    padding: 10px 16px; font-family: inherit;
    font-size: 14px; font-weight: 600; color: #2B2118;
    cursor: pointer; margin-top: 8px;
    transition: transform 0.1s, opacity 0.15s;
  }
  .sc-next-btn:hover, .sc-reveal-btn:hover { transform: translateY(-1px); }
  .sc-reveal-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .sc-dots { display: flex; gap: 6px; margin-bottom: 10px; }
  .sc-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: rgba(43,33,24,0.12);
  }
  .sc-dot.active { background: var(--yellow); }
  .sc-dot.done   { background: rgba(91,79,199,0.55); }
  .sc-timer-row {
    display: flex; flex-direction: column; gap: 6px;
    margin-bottom: 14px;
  }
  .sc-q-counter {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 11px; letter-spacing: 1.5px;
    color: var(--text-dim);
  }
  .sc-timer-bar {
    height: 6px; background: rgba(43,33,24,0.04);
    border-radius: 3px; overflow: hidden;
  }
  .sc-timer-fill {
    height: 100%; width: 100%;
    background: linear-gradient(90deg, var(--yellow), var(--down));
    border-radius: 3px;
  }
  .sc-vs-grid {
    display: grid; gap: 10px;
    grid-template-columns: 1fr;
    margin: 10px 0;
  }
  @media (min-width: 600px) {
    .sc-vs-grid { grid-template-columns: 1fr 1fr; }
  }
  .sc-analysis-card {
    background: var(--surface);
    border: 1px solid var(--surface-border);
    border-radius: 12px;
    padding: 14px;
  }
  .sc-analysis-card.sc-your-choice {
    border-color: rgba(91,79,199,0.55);
    background: rgba(91,79,199,0.06);
  }
  .sc-analysis-tag {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 10px; letter-spacing: 1.5px;
    text-transform: uppercase;
    color: var(--blue);
    margin-bottom: 6px;
  }
  .sc-analysis-card:not(.sc-your-choice) .sc-analysis-tag { color: var(--text-dim); }
  .sc-analysis-title {
    font-size: 15px; font-weight: 700;
    color: var(--text-bright); margin-bottom: 8px;
  }
  .sc-metrics {
    background: rgba(43,33,24,0.025);
    border-radius: 8px;
    padding: 8px 10px;
    margin-bottom: 10px;
  }
  .sc-metric-row {
    display: flex; justify-content: space-between; align-items: center;
    font-size: 13px;
    padding: 4px 0;
    border-bottom: 1px solid rgba(43,33,24,0.03);
  }
  .sc-metric-row:last-child { border-bottom: none; }
  .sc-metric-label { color: var(--text-dim); }
  .sc-metric-value {
    font-family: 'Space Grotesk', sans-serif;
    color: var(--text-bright); font-weight: 600;
  }
  .sc-analysis-takeaway { font-size: 13px; line-height: 1.55; color: var(--text); }
  .sc-principle-tag {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 11px; letter-spacing: 1px;
    color: var(--sun-text);
    background: rgba(255,194,51,0.10);
    border: 1px solid rgba(255,194,51,0.25);
    border-radius: 999px;
    padding: 5px 12px;
    display: inline-block;
    margin: 10px 0;
  }
  .sc-xp-badge {
    margin-top: 14px;
    background: linear-gradient(135deg, rgba(255,194,51,0.18), rgba(91,79,199,0.10));
    border: 1px solid rgba(255,194,51,0.45);
    border-radius: 12px;
    padding: 12px 14px;
    display: flex; align-items: center; gap: 12px;
  }
  .sc-xp-amount {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 18px; font-weight: 700;
    color: var(--sun-text);
  }
  .sc-xp-label { font-size: 13px; color: var(--text); }
  .sc-final {
    text-align: center;
    padding: 12px 6px 4px;
  }
  .sc-final-headline {
    font-size: 20px; font-weight: 700;
    color: var(--text-bright); margin-bottom: 12px;
  }
  .sc-final-grid {
    display: grid; gap: 12px;
    grid-template-columns: 1fr;
    margin-bottom: 14px;
  }
  @media (min-width: 480px) {
    .sc-final-grid:has(> :nth-child(2)) { grid-template-columns: 1fr 1fr; }
  }
  .sc-final-label {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 10px; letter-spacing: 1.5px;
    text-transform: uppercase;
    color: var(--text-dim);
    margin-bottom: 4px;
  }
  .sc-final-value {
    font-size: 22px; font-weight: 700;
    color: var(--text-bright);
  }
  .sc-final-pct { font-family: 'Space Grotesk', sans-serif; font-size: 13px; color: var(--sun-text); }
  .sc-final-lesson { font-size: 14px; line-height: 1.55; color: var(--text); }
  .sc-done {
    text-align: center;
    padding: 18px 14px;
  }
  .sc-done-headline { font-size: 16px; font-weight: 700; color: var(--text-bright); margin-bottom: 6px; }
  .sc-done-body { font-size: 13px; color: var(--text-dim); margin-bottom: 10px; }
  /* Sample banner — only renders when content.isSample is true. Goal is to
     LOOK like a real digest while making it clear the content is generic
     and the real version arrives by email. */
  .sample-banner {
    background: linear-gradient(135deg, rgba(255,194,51,0.16), rgba(91,79,199,0.10));
    border: 1px solid rgba(255,194,51,0.40);
    border-radius: 16px;
    padding: 14px 18px;
    margin: 0 0 22px;
    display: flex; flex-wrap: wrap;
    align-items: center; gap: 14px; justify-content: center;
    text-align: center;
    animation: fadeIn 0.5s ease-out both;
  }
  .sample-banner .sample-copy {
    font-size: 14px; color: var(--text-bright); flex: 1; min-width: 240px;
    line-height: 1.5;
  }
  .sample-banner .sample-cta {
    background: linear-gradient(135deg, var(--yellow), var(--orange));
    color: #2B2118;
    padding: 10px 18px;
    border-radius: 999px;
    font-weight: 700; text-decoration: none; font-size: 14px;
    white-space: nowrap;
    transition: transform 0.15s;
  }
  .sample-banner .sample-cta:hover { transform: translateY(-1px); }
  @media (max-width: 600px) {
    .scoreboard { grid-template-columns: 1fr 1fr; }
    .score-card { padding: 12px 14px; }
    .quiz-options { grid-template-columns: 1fr; }
    .logo { font-size: 32px; }
    .container { padding: 16px 12px 40px; }
  }

  ${WATCHLIST_CSS}
</style>
</head>
<body>


<div class="container">

  ${sampleBannerHTML}

  <div class="header header--${headerVibe}">
    <div class="logo"><img src="/icons/logo.png" alt="" class="logo-mark" width="160" height="160"/>Market&nbsp;<em>Juice</em>${sampleChipHTML}</div>
    <div class="date-line">${escapeHTML(date.toUpperCase())}</div>
    ${headerPillHTML}
    ${editionLabelHTML}
    <div class="tagline">Your daily squeeze of market smarts</div>
    ${greetingHTML}
  </div>

  <!-- Investor Profile Bar — rendered by /engagement.js from localStorage -->
  <div id="investor-profile" class="investor-profile" aria-live="polite"></div>

  ${watchlistCardHTML}

  ${weekInJuiceHTML}

  ${editionType === 'weekly-wrap' ? weeklyHoldCardHTML : ''}

  ${marketClosedHTML}

  <div class="section-header">
    ${sectionIcon('trophy')}
    <h2>Market Scoreboard</h2>
    <div class="line"></div>
  </div>

  <div class="scoreboard">
    ${SCORE_INDICES.map(ix => scoreCard(ix.key, ix.label, ix.term)).join('')}
    ${topMoverCard()}
  </div>
  ${SCORE_INDICES.map(ix => scoreGlossPanel(ix.key, ix.label, ix.term)).join('')}

  <div class="vibe-bar">
    <p style="font-size: 16px; font-weight: 500; color: var(--text-bright);">
      ${vibeCircle} <strong>${marketVibe === 'green' ? 'Green day!' : marketVibe === 'red' ? 'Red day.' : 'Mixed day.'}</strong> ${lk.vibeSummary}
    </p>
    ${topMoverWhyHTML}
  </div>

  <div class="big-picture" id="big-picture">
    <div class="bp-header">
      ${sectionIcon('globe')}
      <h3>The Big Picture</h3>
    </div>
    ${lk.bigPicture}
    ${askParentBtn('big-picture', "Today's Big Picture")}
  </div>

  <div class="section-header">
    ${sectionIcon('flame')}
    <h2>${storiesHeading}</h2>
    <div class="line"></div>
  </div>

  ${!opts.isSample ? `
  <div class="mj-ask-parent-intro" id="askParentIntro">
    <p><strong>Got a question?</strong> If something in today's digest is confusing or interesting, tap <span class="mj-ask-parent-btn-inline">💬 Ask my parent about this</span> and your parent will get a note about it tonight with a way to talk about it with you.</p>
    <button class="mj-ask-parent-intro-dismiss" onclick="this.parentElement.classList.add('mj-ask-parent-intro--out');try{localStorage.setItem('mj-ask-parent-intro-seen','true')}catch(e){}setTimeout(function(){var el=document.getElementById('askParentIntro');if(el)el.remove();},300)">Got it</button>
  </div>` : ''}

  ${storiesHTML}

  <div class="section-header">
    ${sectionIcon('lightbulb')}
    <h2>Did You Know?</h2>
    <div class="line"></div>
  </div>

  <div class="dyk-card">
    <div class="dyk-label">🧠 ${escapeHTML(didYouKnow?.category || 'mind-blowing numbers')}</div>
    <div class="dyk-fact">${lk.dykFact}</div>
    ${didYouKnow?.connection ? `<div class="dyk-connection">${lk.dykConnection}</div>` : ''}
    ${askParentBtn('did-you-know', `Did You Know: ${didYouKnow?.category || 'today’s fact'}`)}
  </div>

  ${sundayChallengeHTML}

  ${dailyChallengeSectionHTML}

  <!-- Phase 16: Mystery Mover — the daily guess-the-company puzzle. Renders
       on /digest AND /sample (it's the guest-play growth surface). The host
       is hydrated client-side by public/games/mystery-mover.js from the
       PUBLIC /api/mystery endpoints — the answer never reaches the page; on
       a 404 (no puzzle today / pre-Phase-16 row) the module hides the whole
       section, header included. -->
  <div id="mystery-mover-section" hidden>
    <div class="section-header">
      ${sectionIcon('search')}
      <h2>Mystery Mover</h2>
      <div class="line"></div>
    </div>
    <div id="mystery-mover-host"></div>
  </div>

  <div class="section-header">
    ${sectionIcon('book')}
    <h2>Word of the Day</h2>
    <div class="line"></div>
  </div>

  <div class="word-card" id="word-card">
    <div class="word-label">🔤 INVESTING VOCABULARY</div>
    <div class="the-word">${escapeHTML(wordOfDay.word)}</div>
    <div class="word-type">${escapeHTML(wordOfDay.type)} · ${escapeHTML(wordOfDay.context)}</div>
    <button type="button" class="word-reveal-btn" id="wordRevealBtn" onclick="revealWord()">Tap to reveal definition</button>
    <div class="word-def word-def-hidden" id="wordDef">${lk.wordDef}</div>
    ${askParentBtn('word-of-day', `Word of the Day: ${wordOfDay.word}`)}
  </div>

  ${predictionCardHTML}

  ${editionType === 'weekly-wrap' ? '' : weeklyHoldCardHTML}

  ${watchlistPickerHTML}

  <div class="footer">
    <div class="rocket">🚀</div>
    <p style="margin-top: 6px;">Market Juice — Built for future investors</p>
    <p style="margin-top: 4px; font-size: 11px; color: #484f58;">Not financial advice. Just getting smarter every day.</p>
  </div>

</div>

<!-- Phase 6.4: game modules. Loaded synchronously and in order before the
     inline render call below so window.MJGames is fully populated.
     shared.js is required by BOTH the Daily Challenge picker and the
     Sunday Challenge (it provides MJGames.shared.PRINCIPLES used for
     reveal-panel principle tags). We load it once when either is present. -->
${(hasDailyChallenge || hasSundayChallenge) ? `<script src="/games/shared.js"></script>` : ''}
${hasDailyChallenge ? `
<script src="/games/daily-challenge.js"></script>
<script src="/games/compound.js"></script>
<script src="/games/match.js"></script>
<script src="/games/time-machine.js"></script>
<script src="/games/bull-bear.js"></script>
<script src="/games/price-is-right.js"></script>
` : ''}
${hasSundayChallenge ? `<script src="/games/sunday-challenge.js"></script>` : ''}
<!-- Phase 16: Mystery Mover hydrates from the public API on every page. -->
<script src="/games/mystery-mover.js" defer></script>
<script>
  // Phase 17 — Tomorrow's Call: one-time explainer + tap handler.
  (function () {
    var card = document.getElementById('tc-card');
    if (!card) return; // no card on this render (sample / logged out)

    // One-time explainer: server renders it hidden; show it until the kid
    // taps "Got it" (persisted in localStorage, Ask-my-parent-intro style).
    var INTRO_KEY = 'mj_tc_intro_seen';
    var intro = document.getElementById('tc-intro');
    if (intro) {
      var seen = false;
      try { seen = localStorage.getItem(INTRO_KEY) === '1'; } catch (e) {}
      if (!seen) {
        intro.hidden = false;
        var introBtn = document.getElementById('tc-intro-btn');
        if (introBtn) introBtn.addEventListener('click', function () {
          try { localStorage.setItem(INTRO_KEY, '1'); } catch (e) {}
          intro.hidden = true;
        });
      }
    }

    // Tap handler (askParent-style optimistic swap). The SERVER recomputes
    // the blind-pick target at POST time — if the kid loaded the page at
    // 9:29 and tapped at 9:31, the response's targetLabel names the real
    // day and the locked chip uses it (never the stale render-time label).
    var host = document.getElementById('tc-buttons');
    if (!host) return; // already picked for the current target
    var renderLabel = card.getAttribute('data-target-label') || 'today';
    function lock(choice, label) {
      host.outerHTML = '<div class="tc-locked">You called ' +
        (choice === 'green' ? '▲ Green' : '▼ Red') + ' ' + label +
        ' — come back after the market closes to see how it went.</div>';
      var fb = document.getElementById('tc-feedback');
      if (fb) fb.remove();
    }
    host.addEventListener('click', function (e) {
      var btn = e.target.closest('.tc-btn');
      if (!btn) return;
      var choice = btn.getAttribute('data-choice');
      host.querySelectorAll('.tc-btn').forEach(function (b) { b.disabled = true; });
      fetch('/api/picks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ choice: choice }),
      }).then(function (res) {
        if (res.ok || res.status === 409) {
          return res.json().catch(function () { return {}; }).then(function (data) {
            lock(choice, data.targetLabel || renderLabel);
          });
        }
        throw new Error('picks ' + res.status);
      }).catch(function () {
        host.querySelectorAll('.tc-btn').forEach(function (b) { b.disabled = false; });
        var fb = document.getElementById('tc-feedback');
        if (fb) fb.textContent = "Hmm, that didn't save — try again.";
      });
    });
  })();

  // Phase 20a — Weekly Hold candidate tap handler (optimistic lock). The
  // server validates the candidate set + the blind-pick window.
  (function () {
    var host = document.getElementById('wh-cands');
    if (!host) return; // no pick UI on this render (locked/verdict/closed/none)
    host.addEventListener('click', function (e) {
      var btn = e.target.closest('.wh-cand');
      if (!btn || btn.disabled) return;
      var ticker = btn.getAttribute('data-ticker');
      host.querySelectorAll('.wh-cand').forEach(function (b) { b.disabled = true; });
      btn.classList.add('wh-cand-chosen');
      var fb = document.getElementById('wh-feedback');
      fetch('/api/weekly-hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ ticker: ticker }),
      }).then(function (res) {
        if (res.ok || res.status === 409) {
          if (fb) fb.textContent = "You're holding " + (btn.querySelector('.wh-cand-name') ? btn.querySelector('.wh-cand-name').textContent : ticker) + " this week. Check back Saturday!";
          return;
        }
        throw new Error('weekly-hold ' + res.status);
      }).catch(function () {
        host.querySelectorAll('.wh-cand').forEach(function (b) { b.disabled = false; });
        btn.classList.remove('wh-cand-chosen');
        if (fb) fb.textContent = "Hmm, that didn't save — try again.";
      });
    });
  })();
</script>

<script>
  // ---- Word of Day tap-to-reveal — fires word-learned event ----
  function revealWord() {
    document.getElementById('word-card').classList.add('word-revealed');
    if (window.MarketJuice && window.MarketJuice.recordEvent) {
      window.MarketJuice.recordEvent('word-learned', {
        digestDate: window.__digestDate || null,
      });
    }
  }

  // ---- Glossary tap-to-reveal ----
  // ONE controller for both affordances so "only one open at a time" spans
  // prose terms AND scoreboard tiles:
  //   - prose: a .gloss span whose .tip bubble is a child (toggled via the
  //     .gloss.open class).
  //   - scoreboard: a .score-card.tappable tile whose definition lives in a
  //     separate full-width .score-gloss-panel below the grid, linked by
  //     aria-controls (toggled via the panel's .open class).
  // Tap/click toggles; tapping a second trigger (tile OR prose) closes the
  // first; tap-outside closes; Enter/Space toggles, Escape closes. The markup
  // is all server-rendered — this only wires interaction, no DOM building.
  (function () {
    var triggers = Array.prototype.slice.call(
      document.querySelectorAll('.gloss, .score-card.tappable')
    );
    if (!triggers.length) return;
    function panelFor(el) {
      var id = el.getAttribute('aria-controls');
      return id ? document.getElementById(id) : null;
    }
    function setOpen(el, open) {
      el.classList.toggle('open', open);
      el.setAttribute('aria-expanded', open ? 'true' : 'false');
      var panel = panelFor(el);
      if (panel) panel.classList.toggle('open', open);
    }
    function closeAll(except) {
      triggers.forEach(function (t) { if (t !== except) setOpen(t, false); });
    }
    function toggle(el) {
      var willOpen = !el.classList.contains('open');
      closeAll(el);
      setOpen(el, willOpen);
    }
    triggers.forEach(function (el) {
      el.addEventListener('click', function (e) { e.stopPropagation(); toggle(el); });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault(); toggle(el);
        } else if (e.key === 'Escape') {
          setOpen(el, false); el.blur();
        }
      });
    });
    // Tapping inside an open scoreboard drawer shouldn't count as "tap-outside"
    // (the panel is a sibling of the tile, so its clicks would otherwise bubble
    // straight to the document handler and close it mid-read).
    Array.prototype.forEach.call(document.querySelectorAll('.score-gloss-panel'), function (p) {
      p.addEventListener('click', function (e) { e.stopPropagation(); });
    });
    document.addEventListener('click', function () { closeAll(null); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAll(null); });
  })();

  // ---- Phase 7: logout link ----
  // Tiny click handler instead of inline onclick="…" so the CSP-friendly
  // pattern matches the rest of the file. Hits /api/logout (POST → clears
  // the cookie) and bounces to /login.
  (function () {
    var el = document.getElementById('logout-link');
    if (!el) return;
    el.addEventListener('click', function (e) {
      e.preventDefault();
      fetch('/api/logout', { method: 'POST' })
        .catch(function () { /* ignore — cookie expiry will handle it */ })
        .finally(function () { location.href = '/login'; });
    });
  })();

  ${hasDailyChallenge ? `
  // ---- Daily Challenge (Phase 6.4) -------------------------------------
  // Inline quiz renderer — the quiz module isn't a standalone file (its
  // original implementation lived inline in this template). Registering on
  // window.MJGames.quiz so the picker can render quiz cards just like any
  // other game type. Mirrors public/games-preview.html's inline renderer.
  window.MJGames = window.MJGames || {};
  if (!window.MJGames.quiz) {
    window.MJGames.quiz = { render: function (host, data, opts) {
      var answered = false;
      host.innerHTML =
        '<div class="mj-card" id="qz-card">' +
          '<div class="mj-label">🧠 Daily Challenge · The Quiz</div>' +
          '<div class="mj-title">' + esc(data.question) + '</div>' +
          '<div id="qz-options" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px;"></div>' +
          '<div class="mj-reveal" id="qz-reveal"></div>' +
        '</div>';
      var optHost = host.querySelector('#qz-options');
      data.options.forEach(function (opt, i) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'mj-btn'; b.textContent = opt;
        b.addEventListener('click', function () {
          if (answered) return;
          answered = true;
          var correct = i === data.correctIndex;
          Array.from(optHost.children).forEach(function (bb, j) {
            bb.disabled = true;
            if (j === data.correctIndex) bb.classList.add('mj-btn-correct');
            else if (j === i && !correct) bb.classList.add('mj-btn-wrong');
          });
          window.MJGames.shared.renderReveal(host.querySelector('#qz-card'), {
            resultKind: correct ? 'correct' : 'wrong',
            resultLabel: correct ? '🎯 Correct!' : '🤔 Not quite',
            headline: 'The lesson',
            body: '<p>' + esc(data.explanation || '') + '</p>',
            principle: data.principle || 7,
          });
          // Phase 12: inject the 💬 ask-parent button into the reveal panel
          // after answering. Skip on /sample (no parent email to deliver to).
          if (!window.__isSample) {
            var rev = host.querySelector('#qz-card .mj-reveal');
            if (rev) {
              var ap = document.createElement('button');
              ap.type = 'button';
              ap.className = 'mj-ask-parent-btn';
              ap.dataset.section = 'quiz';
              // dataset assigns raw strings; the browser handles attribute
              // serialization, so no HTML-escape needed here.
              ap.dataset.topic = "Today's quiz question";
              ap.textContent = '💬 Ask my parent about this';
              ap.onclick = function () { window.MarketJuice && window.MarketJuice.askParent(ap); };
              rev.appendChild(ap);
            }
          }
          if (opts && opts.onComplete) opts.onComplete({ correct: correct });
        });
        optHost.appendChild(b);
      });
      function esc(s){return String(s||'').replace(/[&<>"\\']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"\\'":'&#039;'}[c]);});}
    }};
  }

  // Today's hydrated bundle, baked in at generation time. The .replace below
  // escapes every '<' in the (AI-generated) data to \\u003c so a stray
  // close-script sequence can't break out of this inline script block.
  // NOTE: keep this comment free of literal script-tag sequences — the HTML
  // parser ends the element at the first close-script token even inside a JS
  // comment, which is exactly the bug this guards against.
  var __DC_BUNDLE = ${JSON.stringify({ games: dailyChallenge.games.map(g => ({ type: g.type, data: g.data })) }).replace(/</g, '\\u003c')};
  (function () {
    var host = document.getElementById('daily-challenge-host');
    if (!host || !window.MJGames || !window.MJGames.dailyChallenge) return;
    window.MJGames.dailyChallenge.render(host, __DC_BUNDLE, {});
  })();
  ` : ''}

  ${hasSundayChallenge ? `
  // ---- Sunday Challenge ----------------------------------------------
  // Same pattern as Daily Challenge: data baked in at render time, the
  // game module dispatches based on .type to the right sub-renderer.
  var __SC_DATA = ${JSON.stringify(sundayChallenge).replace(/</g, '\\u003c')};
  (function () {
    var host = document.getElementById('sunday-challenge-host');
    if (!host || !window.MJGames || !window.MJGames.sundayChallenge) return;
    window.MJGames.sundayChallenge.render(host, __SC_DATA, {});
  })();
  ` : ''}
</script>

<!-- Phase 21 — Watchlist controller (inline; inert on /sample where the card
     is absent). Mutations reload so the server re-renders the authoritative
     state (since-%, ghost slots, news flags). -->
<script>
${WATCHLIST_CONTROLLER}
</script>

</body>
</html>`;
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
