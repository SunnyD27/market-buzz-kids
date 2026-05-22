/**
 * src/games.js — Phase 6.5 daily-games orchestrator.
 *
 * Single entry point: `hydrateDailyGames(opts)`. Asks the deterministic
 * picker which 3 games run today, then hydrates each one by combining
 * verified static facts with (where applicable) live FMP quotes and a
 * Claude reframer call.
 *
 * Returns the exact shape Phase 6.4's template consumer expects:
 *   {
 *     date: "2026-05-22",
 *     dayIndex: 20371,
 *     picked: ["bull-bear", "compound", "price-is-right"],
 *     games:  [{ type, data }, { type, data }, { type, data }]
 *   }
 *
 * Hard rule: this module NEVER lets a single hydrator failure block the
 * day. If Claude or FMP is unreachable, every game falls back to canned
 * content. The digest always ships.
 *
 * No DB writes. Scenario picking is deterministic on (gameType, dayIndex)
 * so there's no last-used state to persist — consecutive days with the
 * same gameType differ by 1 day index, which steps to an adjacent
 * scenario, which is guaranteed not to be the same one.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchQuotes } from './data.js';
import { reframeBullBear, reframeTimeMachine } from './ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'public', 'data');

// ── Rotation (mirrors public/games/daily-challenge.js) ─────────────────
// Source of truth for the rotation lives in the browser module; we
// duplicate it here because importing browser code from node is messy.
// If you change one, change both.
const ROTATION = [
  ['quiz',      'bull-bear',      'compound'],
  ['match',     'time-machine',   'price-is-right'],
  ['quiz',      'time-machine',   'match'],
  ['bull-bear', 'compound',       'price-is-right'],
  ['quiz',      'price-is-right', 'match'],
  ['bull-bear', 'time-machine',   'compound'],
  ['quiz',      'match',          'compound'],
  ['bull-bear', 'price-is-right', 'time-machine'],
];

// Canned framings for the Compound Machine. Deterministic-shuffled per
// day so the kid sees variety without an AI call.
//
// IMPORTANT: the Compound Machine models a SINGLE one-time deposit of
// $amount, compounded over the slider's years. It does NOT model recurring
// (weekly/yearly) contributions. Every framing below must therefore
// describe a one-time deposit — no "every year," no "$X a week." If we
// later add a recurring-contribution mode, we can split this pool by
// scenario type.
const COMPOUND_FRAMINGS = [
  "🎂 You got $X for your birthday. Instead of spending it, you invested the whole thing.",
  "💰 You earned $X mowing lawns this summer and put it all into an index fund.",
  "👶 Someone invested $X for you the day you were born. It's just been sitting there.",
  "🎮 Instead of buying a game with your $X, you invested it.",
  "🍕 You sold your old bike for $X and decided to invest the cash.",
  "🐕 You earned $X dog-walking and dropped it straight into an index fund.",
  "🏆 You won $X at a robotics competition. Your parents helped you invest it.",
  "📦 You sold your old comic-book collection for $X and put it into the market.",
  "💸 Grandparents gave you $X for your graduation. Into an index fund it went.",
  "🛠️ You did chores for a year, ended up with $X, and invested the whole pile.",
];

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Hydrate today's three games. All options are optional — sensible defaults
 * keep the function callable from tests with zero infra.
 *
 * @param {object}  opts
 * @param {string}  [opts.date]      YYYY-MM-DD; defaults to today in America/New_York
 * @param {string}  [opts.fmpKey]    FMP API key for live quotes. If missing, time-machine
 *                                   uses approxNow and price-is-right is dropped+rotated.
 * @param {boolean} [opts.useAI]     Run Claude reframers? Defaults to true if ANTHROPIC_API_KEY set.
 * @param {object}  [opts.quiz]      Pre-generated quiz payload from generateContent(). Required
 *                                   when 'quiz' is in today's picks (or a canned fallback is used).
 * @returns {Promise<object>}
 */
export async function hydrateDailyGames(opts = {}) {
  const date = opts.date || isoDateInNY();
  const dayIndex = dayIndexFromDate(date);
  const useAI = opts.useAI ?? !!process.env.ANTHROPIC_API_KEY;
  const picked = pickGamesForDate(date);

  console.log(`[Games] hydrating ${date} (dayIndex=${dayIndex}) → picked=[${picked.join(', ')}], useAI=${useAI}, fmp=${!!opts.fmpKey}`);

  // Load static pools once.
  const companyModels  = loadJSON('company-models.json');
  const timeMachineDB  = loadJSON('time-machine-prices.json');
  const histChartsDB   = loadJSON('historical-charts.json');

  // Pre-collect any tickers we need a live quote for, batched in one
  // FMP call. Saves round-trips when both time-machine + price-is-right
  // appear on the same day.
  const liveTickers = collectLiveTickers(picked, dayIndex, { timeMachineDB, companyModels });
  let quotes = {};
  if (liveTickers.length && opts.fmpKey) {
    quotes = await fetchQuotes(liveTickers, opts.fmpKey);
  }

  // Hydrate each picked game in parallel. Each hydrator is responsible
  // for its own try/catch + fallback.
  const games = await Promise.all(picked.map(type => hydrateOne(type, {
    dayIndex,
    useAI,
    quotes,
    quiz: opts.quiz,
    companyModels,
    timeMachineDB,
    histChartsDB,
  })));

  return { date, dayIndex, picked, games };
}

// Re-exported so callers (and tests) can sanity-check the picker without
// instantiating the browser module.
export function pickGamesForDate(yyyymmdd) {
  const idx = dayIndexFromDate(yyyymmdd) % ROTATION.length;
  return ROTATION[((idx % ROTATION.length) + ROTATION.length) % ROTATION.length].slice();
}

// ── Hydrators ───────────────────────────────────────────────────────────

async function hydrateOne(type, ctx) {
  try {
    switch (type) {
      case 'quiz':           return { type, data: hydrateQuiz(ctx) };
      case 'compound':       return { type, data: hydrateCompound(ctx) };
      case 'match':          return { type, data: hydrateMatch(ctx) };
      case 'bull-bear':      return { type, data: await hydrateBullBear(ctx) };
      case 'time-machine':   return { type, data: await hydrateTimeMachine(ctx) };
      case 'price-is-right': return { type, data: hydratePriceIsRight(ctx) };
      default:
        throw new Error(`unknown game type: ${type}`);
    }
  } catch (err) {
    console.error(`[Games/${type}] hydration failed: ${err.message}`);
    return { type, data: null, error: err.message };
  }
}

function hydrateQuiz({ quiz }) {
  if (quiz && typeof quiz === 'object' && Array.isArray(quiz.options)) return quiz;
  // Canned fallback only used when caller didn't pass a quiz (e.g. test runs).
  return {
    question: 'What does it mean to "own a share" of a company?',
    options: [
      'You can use any of the company\'s products for free',
      'You own a tiny piece of the actual business',
      'You work for the company',
      'You get to vote on what they sell',
    ],
    correctIndex: 1,
    explanation: 'A share = a small slice of the real business. If the business grows, your slice is worth more. That\'s principle #7 — think like an owner, not a gambler.',
    principle: 7,
  };
}

function hydrateCompound({ dayIndex }) {
  // Pick a framing deterministically; vary the amount on a different cadence
  // so even on the same framing day the dollar amount changes. These
  // amounts are realistic one-time deposits (birthday money, summer
  // earnings, etc.) — sized to feel real to a 10-14 year old.
  const framing = COMPOUND_FRAMINGS[dayIndex % COMPOUND_FRAMINGS.length];
  const amounts = [25, 50, 75, 100, 150, 200, 250, 500, 1000];
  const amount = amounts[dayIndex % amounts.length];
  return {
    amount,
    framing: framing.replace('$X', `$${amount}`),
  };
}

function hydrateMatch({ dayIndex, companyModels }) {
  // Deterministic shuffle of the company pool, then take 4. dayIndex steps
  // forward by 1 daily so the quad shifts every day.
  const shuffled = stableShuffle(companyModels, dayIndex);
  return { companies: shuffled.slice(0, 4) };
}

async function hydrateBullBear({ dayIndex, useAI, histChartsDB }) {
  const scenario = pickScenario(histChartsDB, 'bull-bear', dayIndex);
  const out = { ...scenario }; // start from canned

  if (useAI) {
    const reframed = await reframeBullBear(scenario);
    if (reframed) {
      out.story          = reframed.story;
      out.lessonHeadline = reframed.lessonHeadline;
      out.lessonBody     = reframed.lessonBody;
      out._reframed = true;
    }
  }
  return out;
}

async function hydrateTimeMachine({ dayIndex, useAI, quotes, timeMachineDB }) {
  const scenario = pickScenario(timeMachineDB, 'time-machine', dayIndex);
  const out = { ...scenario };

  // Inject live priceNow for any active choices we have a quote for.
  out.choices = scenario.choices.map(c => {
    if (c.status === 'active' && quotes[c.ticker]?.price) {
      return { ...c, priceNow: quotes[c.ticker].price };
    }
    return { ...c };
  });

  if (useAI) {
    const reframed = await reframeTimeMachine(scenario);
    if (reframed) {
      out.framing    = reframed.framing;
      out.lessonBody = reframed.lessonBody;
      out._reframed = true;
    }
  }
  return out;
}

function hydratePriceIsRight({ dayIndex, quotes, companyModels }) {
  // Restrict to companies we have BOTH (a) a narrative for in company-models.json
  // AND (b) a live quote for. Walk the deterministic list until we find one.
  const order = stableShuffle(companyModels, dayIndex);
  let picked = null;
  for (const c of order) {
    if (quotes[c.ticker]?.price) { picked = c; break; }
  }
  if (!picked) {
    // No live quote available for any company we have narrative for —
    // fall back to a canned realPrice from a hardcoded "demo" snapshot
    // so the game can still render. Marks _stale=true so we know.
    picked = order[0];
    const stalePrice = pickStalePrice(picked.ticker);
    const opts = makeDistractors(stalePrice, dayIndex);
    return { ...pricePayload(picked, stalePrice, opts), _stale: true };
  }
  const realPrice = quotes[picked.ticker].price;
  return pricePayload(picked, realPrice, makeDistractors(realPrice, dayIndex));
}

function pricePayload(company, realPrice, distractors) {
  // Build the "piece" commentary by joining shortModel + surprise from
  // company-models.json. shortModel = how the company makes money;
  // surprise = a specific concept-teaching fact the kid probably didn't
  // know. Together they read as one short paragraph that teaches a
  // principle, not just trivia. Joining with a space keeps it inline
  // (the renderer escapes the string — no HTML).
  const piece = company.surprise
    ? `${company.shortModel} ${company.surprise}`.trim()
    : company.shortModel;
  return {
    ticker: company.ticker,
    name: company.name,
    emoji: company.emoji,
    realPrice,
    options: [distractors.low, realPrice, distractors.high],
    piece,
    surprise: company.surprise,
    principle: company.principle,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────

function pickScenario(pool, gameType, dayIndex) {
  // (dayIndex + gameTypeHash) mod pool.length. Step is +1 between any two
  // days the same gameType appears (since dayIndex monotonically increases),
  // so consecutive picks of the same gameType land on different scenarios.
  const offset = (dayIndex + hashString(gameType)) % pool.length;
  return pool[(offset + pool.length) % pool.length];
}

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// Fisher–Yates shuffle seeded by dayIndex. Deterministic for a given day.
function stableShuffle(arr, seed) {
  const out = arr.slice();
  let s = seed | 0;
  function rand() {
    // Xorshift32 — plenty good for shuffling 37 cards once a day.
    s ^= s << 13; s ^= s >> 17; s ^= s << 5;
    return (s >>> 0) / 0xffffffff;
  }
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Distractors targeting roughly ±30% of realPrice with day-varying offset.
// Per the game's spec the gap is meant to be wide enough that picking
// either distractor never accidentally falls "within 20%" of real.
function makeDistractors(realPrice, dayIndex) {
  const lowMul  = 0.62 + ((dayIndex % 9) * 0.012);  // ~0.62 .. 0.72
  const highMul = 1.28 + (((dayIndex + 4) % 9) * 0.012); // ~1.28 .. 1.38
  return {
    low:  plausiblePrice(realPrice * lowMul),
    high: plausiblePrice(realPrice * highMul),
  };
}

function plausiblePrice(p) {
  if (p >= 500) return Math.round(p / 10) * 10;
  if (p >= 100) return Math.round(p / 5) * 5;
  if (p >= 20)  return Math.round(p);
  return Math.round(p * 4) / 4; // nearest $0.25
}

function collectLiveTickers(picked, dayIndex, { timeMachineDB, companyModels }) {
  const tickers = new Set();

  if (picked.includes('time-machine')) {
    const scen = pickScenario(timeMachineDB, 'time-machine', dayIndex);
    for (const c of scen.choices) {
      if (c.status === 'active') tickers.add(c.ticker);
    }
  }

  if (picked.includes('price-is-right')) {
    // We don't know which company will win the deterministic walk before
    // we have quotes — so quote the top ~6 in shuffle order. That's plenty.
    const order = stableShuffle(companyModels, dayIndex);
    for (const c of order.slice(0, 6)) tickers.add(c.ticker);
  }

  return [...tickers];
}

function pickStalePrice(ticker) {
  // Last-resort offline fallback so the game can render in test runs
  // without an FMP key. Order-of-magnitude correct as of late 2024.
  const STALE = {
    AAPL: 230, GOOGL: 175, MSFT: 415, AMZN: 200, META: 580, NVDA: 140,
    TSLA: 220, NFLX: 700, SPOT: 450, RBLX: 50, ABNB: 130, UBER: 70,
    SBUX: 100, NKE: 80, KO: 65, DIS: 100, MCD: 290, COST: 920,
  };
  return STALE[ticker] || 100;
}

function loadJSON(name) {
  const fullPath = path.join(DATA_DIR, name);
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

function dayIndexFromDate(yyyymmdd) {
  const d = new Date(yyyymmdd + 'T12:00:00Z');
  return Math.floor(d.getTime() / 86400000);
}

function isoDateInNY() {
  // YYYY-MM-DD in America/New_York. Uses Intl rather than juggling Date math.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = k => parts.find(p => p.type === k)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
