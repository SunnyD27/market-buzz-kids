/**
 * scripts/test-games.js — exercise hydrateDailyGames() without running the
 * full digest pipeline.
 *
 * Defaults to a DRY run (no Claude calls, no FMP calls) so it can run with
 * zero secrets. Pass flags to opt in to each external system:
 *
 *   node scripts/test-games.js                  # dry: canned scenarios only
 *   node scripts/test-games.js --ai             # also calls Claude reframers
 *   node scripts/test-games.js --fmp            # also fetches live quotes
 *   node scripts/test-games.js --ai --fmp       # full live hydration
 *   node scripts/test-games.js --date 2026-01-15  # override today
 *
 * Prints the picked games, then a compact view of each game's hydrated data.
 */
import dotenv from 'dotenv';
dotenv.config({ override: true });
import { hydrateDailyGames, pickGamesForDate } from '../src/games.js';

const args = new Set(process.argv.slice(2));
const dateFlagIdx = process.argv.indexOf('--date');
const overrideDate = dateFlagIdx > -1 ? process.argv[dateFlagIdx + 1] : undefined;

const useAI  = args.has('--ai');
const useFMP = args.has('--fmp');

console.log(`[test] mode: useAI=${useAI}, useFMP=${useFMP}, date=${overrideDate || '(today)'}`);
console.log(`[test] picker preview: ${pickGamesForDate(overrideDate || isoToday()).join(' · ')}`);

const result = await hydrateDailyGames({
  date: overrideDate,
  fmpKey: useFMP ? process.env.FMP_API_KEY : null,
  useAI,
});

console.log('');
console.log('═══════════════════════════════════════════════════════════════');
console.log(`Hydrated ${result.date} (dayIndex ${result.dayIndex})`);
console.log(`Picked:  ${result.picked.join(', ')}`);
console.log('═══════════════════════════════════════════════════════════════');

for (const g of result.games) {
  console.log('');
  console.log(`── ${g.type} ──`);
  if (g.error) {
    console.log('  ERROR:', g.error);
    continue;
  }
  switch (g.type) {
    case 'quiz':
      console.log(`  Q: ${g.data.question}`);
      console.log(`  A[${g.data.correctIndex}]: ${g.data.options[g.data.correctIndex]}`);
      console.log(`  principle: ${g.data.principle}`);
      break;
    case 'compound':
      console.log(`  amount: $${g.data.amount}`);
      console.log(`  framing: ${g.data.framing}`);
      break;
    case 'match':
      console.log(`  4 companies: ${g.data.companies.map(c => c.ticker).join(', ')}`);
      break;
    case 'bull-bear':
      console.log(`  scenario: ${g.data.id} (${g.data.company} ${g.data.ticker}) — ${g.data.actualDirection.toUpperCase()} ${g.data.actualReturnPct}%`);
      console.log(`  reframed: ${!!g.data._reframed}`);
      console.log(`  story:    ${truncate(g.data.story, 140)}`);
      console.log(`  lessonHeadline: ${g.data.lessonHeadline}`);
      break;
    case 'time-machine':
      console.log(`  scenario: ${g.data.id} (${g.data.anchor})`);
      console.log(`  choices:  ${g.data.choices.map(c => `${c.ticker}${c.status === 'active' && c.priceNow ? `→$${c.priceNow}` : ` (${c.status})`}`).join(', ')}`);
      console.log(`  reframed: ${!!g.data._reframed}`);
      console.log(`  framing:  ${truncate(g.data.framing, 140)}`);
      break;
    case 'price-is-right':
      console.log(`  ${g.data.ticker} (${g.data.name}) — real $${g.data.realPrice}${g.data._stale ? ' [STALE FALLBACK]' : ''}`);
      console.log(`  options: ${g.data.options.map(o => '$' + o).join(' · ')}`);
      console.log(`  piece:   ${truncate(g.data.piece, 140)}`);
      console.log(`  principle: ${g.data.principle}`);
      break;
  }
}
console.log('');

function truncate(s, n) {
  s = String(s || '').replace(/\s+/g, ' ');
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

function isoToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = k => parts.find(p => p.type === k)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
