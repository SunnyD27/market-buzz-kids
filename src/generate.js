import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchAllData } from './data.js';
import { generateContent } from './ai.js';
import { buildHTML } from './template.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function generateDigest() {
  const fmpKey = process.env.FMP_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!fmpKey) throw new Error('FMP_API_KEY not set');
  if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not set');

  console.log('[Generate] Step 1/3: Fetching market data from FMP...');
  const { marketData, news, movers } = await fetchAllData(fmpKey);
  console.log(`[Generate]   Indices: ${Object.keys(marketData).length} symbols`);
  console.log(`[Generate]   News: ${news.length} articles`);
  console.log(`[Generate]   Movers: ${movers.topGainers.length} gainers, ${movers.topLosers.length} losers`);

  if (Object.keys(marketData).length === 0) {
    throw new Error('No market data returned from FMP — check API key');
  }

  console.log('[Generate] Step 2/3: Generating kid-friendly content via Claude...');
  const content = await generateContent(marketData, news, movers);

  console.log('[Generate] Step 3/3: Building HTML...');
  const html = buildHTML(content);

  const publicDir = path.join(__dirname, '..', 'public');
  mkdirSync(publicDir, { recursive: true });
  const outputPath = path.join(publicDir, 'index.html');
  writeFileSync(outputPath, html, 'utf-8');

  console.log(`[Generate] ✅ Digest written to ${outputPath} (${(html.length / 1024).toFixed(1)} KB)`);
  return outputPath;
}

if (process.argv[1] && process.argv[1].includes('generate.js')) {
  generateDigest()
    .then(() => { console.log('[Generate] Done!'); process.exit(0); })
    .catch(err => { console.error('[Generate] FAILED:', err.message); process.exit(1); });
}
