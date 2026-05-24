// Load .env when this module is invoked as a CLI entry point. server.js
// also loads it (with override:true), so importing generate.js from within
// an already-running server is a no-op since the keys are present.
import dotenv from 'dotenv';
dotenv.config({ override: true });

import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchAllData } from './data.js';
import { generateContent } from './ai.js';
import { hydrateDailyGames } from './games.js';
import { buildHTML } from './template.js';
import { getRecent, record } from './content-history.js';
import { getDigestForDate, saveDigest } from './digest-store.js';
import { getEditionDate, getEditionType } from './calendar.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Idempotent digest generation. Phase 6.7 contract:
 *
 *   - If today's row already exists in daily_digests, do NOTHING fresh —
 *     read the existing content from Postgres, write it to disk for
 *     fast /digest serving, and return. No FMP calls, no Claude calls.
 *
 *   - If today's row does NOT exist, run the full pipeline (FMP fetch,
 *     Claude content gen, game hydration, content-history recording),
 *     persist into Postgres via ON CONFLICT DO NOTHING, then write to
 *     disk. If another container races and wins the INSERT, our local
 *     content is discarded and we write the winning row to disk instead
 *     — all callers end up with identical content.
 *
 * This guarantees: every visitor for the rest of the calendar day
 * (America/New_York) sees the SAME digest, regardless of how many
 * redeploys happen.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.force=false] — DEV ONLY. Skip the DB cache check
 *   and produce a fresh digest. The INSERT still uses ON CONFLICT DO
 *   NOTHING, so an existing row remains immutable; force just wastes
 *   API calls. Useful only if today's row exists but you want to
 *   pre-warm the disk (e.g., after wiping public/index.html locally).
 */
export async function generateDigest(opts = {}) {
  const publicDir = path.join(__dirname, '..', 'public');
  const htmlPath = path.join(publicDir, 'index.html');
  const dataPath = path.join(publicDir, 'digest-data.json');

  // `today` honors DATE_OVERRIDE (via calendar.getEditionDate) so tests
  // can pretend it's a different day without monkey-patching globals.
  // In production with no override, this is identical to digest-store's
  // todayNY().
  const today = getEditionDate();

  // ── Cache check: today's row already in Postgres? ────────────────
  // The idempotency check MUST come before edition detection — if today's
  // row exists, we serve cached content regardless of what kind of edition
  // it was. The edition was decided when the row was first generated.
  if (!opts.force) {
    const existing = await getDigestForDate(today);
    if (existing) {
      console.log(`[Generate] Today's digest (${today}) already exists in DB — using cached copy. No API calls.`);
      mkdirSync(publicDir, { recursive: true });
      const html = buildHTML(existing.content);
      writeFileSync(htmlPath, html, 'utf-8');
      writeFileSync(dataPath, JSON.stringify(existing.content, null, 2), 'utf-8');
      console.log(`[Generate] ✅ Cached digest written to disk (${(html.length / 1024).toFixed(1)} KB)`);
      return htmlPath;
    }
  }

  // ── No cached row — run the full pipeline ─────────────────────────
  const fmpKey = process.env.FMP_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!fmpKey) throw new Error('FMP_API_KEY not set');
  if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not set');

  // ── Edition detection ──────────────────────────────────────────────
  // Resolve what KIND of digest to generate for this date (standard,
  // weekly-wrap, or week-ahead). The result is passed through to the
  // AI prompt builder so the routing happens inside ai.js. See
  // src/calendar.js for the day-of-week + holiday logic.
  const edition = getEditionType();
  console.log(`[Generate] Edition type: ${edition.editionType} (${edition.reason})${edition.holidayName ? ` — yesterday was ${edition.holidayName}` : ''}`);

  console.log(`[Generate] Generating fresh digest for ${today}...`);
  console.log('[Generate] Step 1/3: Fetching market data from FMP...');
  const { marketData, news, movers, topMover } = await fetchAllData(fmpKey);
  console.log(`[Generate]   Indices: ${Object.keys(marketData).length} symbols`);
  console.log(`[Generate]   News: ${news.length} articles`);
  console.log(`[Generate]   Movers: ${movers.topGainers.length} gainers, ${movers.topLosers.length} losers`);
  console.log(`[Generate]   Today's Mover: ${topMover ? `${topMover.ticker} (${topMover.displayName}) ${topMover.changesPercentage?.toFixed?.(2)}%` : 'unavailable'}`);

  if (Object.keys(marketData).length === 0) {
    throw new Error('No market data returned from FMP — check API key');
  }

  console.log('[Generate] Step 2/3: Generating kid-friendly content + daily games (in parallel)...');
  // Pull recently-used picks so the prompt can tell Claude what to avoid.
  // 30-day window — long enough that kids never feel déjà-vu, short
  // enough that we don't burn through the teachable inventory.
  const recentWords = getRecent('word', 30);
  const recentFacts = getRecent('fact', 30);
  if (recentWords.length) {
    console.log(`[Generate]   Avoiding ${recentWords.length} recent word(s): ${recentWords.slice(0, 8).join(', ')}${recentWords.length > 8 ? '…' : ''}`);
  }
  if (recentFacts.length) {
    console.log(`[Generate]   Avoiding ${recentFacts.length} recent fact(s)`);
  }

  // Two parallel Claude tracks:
  //   - generateContent: scoreboard + stories + quiz + didYouKnow + wordOfDay (existing)
  //   - hydrateDailyGames: today's 3-game daily challenge (new, Phase 6.5)
  // The games hydrator needs the generated quiz IF 'quiz' is in today's
  // rotation, so we await content first, then pass quiz into the games call.
  const content = await generateContent(marketData, news, movers, topMover, {
    recentWords,
    recentFacts,
    edition,
  });

  const dailyChallenge = await hydrateDailyGames({
    fmpKey,
    quiz: content.quiz,
  });
  content.dailyChallenge = dailyChallenge;
  console.log(`[Generate]   Daily challenge: ${dailyChallenge.picked.join(', ')}`);

  const fullPayload = { ...content, generated_at: new Date().toISOString() };

  // ── Persist to Postgres FIRST (the source of truth) ────────────────
  // ON CONFLICT DO NOTHING — if a parallel container raced and won,
  // we DISCARD our freshly-generated content and use theirs instead so
  // every container ends up writing identical files to disk.
  console.log('[Generate] Step 3/3: Persisting to Postgres + disk...');
  const saveResult = await saveDigest(today, fullPayload);

  if (saveResult.inserted) {
    console.log(`[Generate]   ✅ Inserted new row in daily_digests for ${today} — this is now the canonical digest of the day.`);
    // Only record word/fact rotation on a REAL insert. A losing race
    // means our content is being thrown away — don't pollute rotation
    // history with a word that's not actually being shown.
    if (content?.wordOfDay?.word) {
      record('word', content.wordOfDay.word);
      console.log(`[Generate]   Word of the Day: "${content.wordOfDay.word}" recorded to rotation history`);
    }
    if (content?.didYouKnow?.fact) {
      record('fact', content.didYouKnow.fact);
      console.log(`[Generate]   Did You Know fact recorded to rotation history`);
    }
  } else {
    console.log(`[Generate]   ⚠ Lost race — today's row was inserted by another process. Using their content.`);
  }

  // Use whichever content is in the DB (either ours or the race winner's).
  const canonical = saveResult.row?.content || fullPayload;

  mkdirSync(publicDir, { recursive: true });
  const html = buildHTML(canonical);
  writeFileSync(htmlPath, html, 'utf-8');
  writeFileSync(dataPath, JSON.stringify(canonical, null, 2), 'utf-8');

  console.log(`[Generate] ✅ Digest written to ${htmlPath} (${(html.length / 1024).toFixed(1)} KB)`);
  console.log(`[Generate] ✅ Digest data written to ${dataPath}`);
  return htmlPath;
}

if (process.argv[1] && process.argv[1].includes('generate.js')) {
  generateDigest()
    .then(() => { console.log('[Generate] Done!'); process.exit(0); })
    .catch(err => { console.error('[Generate] FAILED:', err.message); process.exit(1); });
}
