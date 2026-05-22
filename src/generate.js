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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function generateDigest() {
  const fmpKey = process.env.FMP_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!fmpKey) throw new Error('FMP_API_KEY not set');
  if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not set');

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
  // (The games call itself parallelizes its 0-2 internal reframer calls.)
  const content = await generateContent(marketData, news, movers, topMover, {
    recentWords,
    recentFacts,
  });

  // Persist what we just picked so the next run avoids it.
  if (content?.wordOfDay?.word) {
    record('word', content.wordOfDay.word);
    console.log(`[Generate]   Word of the Day: "${content.wordOfDay.word}" recorded`);
  }
  if (content?.didYouKnow?.fact) {
    record('fact', content.didYouKnow.fact);
    console.log(`[Generate]   Did You Know fact recorded (${content.didYouKnow.fact.length} chars)`);
  }

  const dailyChallenge = await hydrateDailyGames({
    fmpKey,
    quiz: content.quiz,
  });
  content.dailyChallenge = dailyChallenge;
  console.log(`[Generate]   Daily challenge: ${dailyChallenge.picked.join(', ')}`);

  console.log('[Generate] Step 3/3: Building HTML...');
  const html = buildHTML(content);

  const publicDir = path.join(__dirname, '..', 'public');
  mkdirSync(publicDir, { recursive: true });
  const outputPath = path.join(publicDir, 'index.html');
  writeFileSync(outputPath, html, 'utf-8');

  // Also persist the structured content so the daily teaser email (Phase 6.2)
  // and any future server-side consumer can read today's digest without
  // re-parsing the HTML. This is NOT the digest template — it's the raw JSON
  // payload `buildHTML()` consumed.
  const dataPath = path.join(publicDir, 'digest-data.json');
  const payload = { ...content, generated_at: new Date().toISOString() };
  writeFileSync(dataPath, JSON.stringify(payload, null, 2), 'utf-8');

  console.log(`[Generate] ✅ Digest written to ${outputPath} (${(html.length / 1024).toFixed(1)} KB)`);
  console.log(`[Generate] ✅ Digest data written to ${dataPath}`);
  return outputPath;
}

if (process.argv[1] && process.argv[1].includes('generate.js')) {
  generateDigest()
    .then(() => { console.log('[Generate] Done!'); process.exit(0); })
    .catch(err => { console.error('[Generate] FAILED:', err.message); process.exit(1); });
}
