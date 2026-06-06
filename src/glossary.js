// src/glossary.js
//
// Market Juice — kid-facing glossary (ages 10–14).
//
// A flat term → definition map. The digest template (src/template.js) wraps the
// FIRST occurrence of each term per digest in a tap-to-reveal tooltip. New terms
// are nominated by the digest generator into `pending_glossary` and promoted here
// (or into a `glossary` table) only after admin approval — see CONTEXT.md.
//
// Authoring rules (keep these intact when adding terms):
//   1. One or two sentences. A 12-year-old reads it once and gets it.
//   2. NO undefined jargon inside a definition. If a definition needs another
//      market term, that term must ALSO be in this glossary (or be reworded out).
//   3. `principle` (1–11) ties the term to a core investing principle when natural;
//      use null when the term is purely mechanical (e.g. "ticker").
//   4. `aliases` lists alternate spellings/forms the matcher should also catch.
//      Keep the canonical, kid-readable form as the key.
//
// The 11 principles (mirror of src/ai.js):
//   1  Pay yourself first
//   2  Make your money work for you (compounding)
//   3  Spend less than you earn
//   4  Understand what you own
//   5  Don't put all your eggs in one basket (diversify)
//   6  Be patient — think in years, not days
//   7  Control your emotions — don't follow the crowd
//   8  Think like an owner, not a gambler
//   9  Stay consistent
//   10 Know the difference between price and value
//   11 Make money while you sleep — own assets

export const GLOSSARY = {
  // ─── The big three (always in the scoreboard) ───────────────────────────────
  'S&P 500': {
    def: 'A scoreboard that tracks 500 of the biggest companies in America. When people ask "how did the market do today?", this is usually what they mean.',
    principle: 5,
    aliases: ['S&P', 'SP500', 'S and P 500'],
  },
  'Nasdaq': {
    def: 'A scoreboard packed with tech companies like Apple and Nvidia. It tends to bounce around more than the other scoreboards.',
    principle: 4,
    aliases: ['Nasdaq Composite'],
  },
  'Dow Jones': {
    def: 'The oldest market scoreboard. It follows just 30 huge, famous companies, so it gives a quick snapshot rather than the whole picture.',
    principle: 6,
    aliases: ['Dow', 'Dow Jones Industrial Average', 'DJIA'],
  },

  // ─── What a stock even is ───────────────────────────────────────────────────
  'Stock': {
    def: 'A tiny piece of a real company that you can buy. Own a stock and you own a slice of that business.',
    principle: 8,
    aliases: ['stocks', 'equity', 'equities'],
  },
  'Share': {
    def: 'One single unit of a stock. If a company is a pizza, a share is one slice you own.',
    principle: 8,
    aliases: ['shares'],
  },
  'Ticker': {
    def: 'A company\'s short nickname on the market — like AAPL for Apple or NVDA for Nvidia.',
    principle: null,
    aliases: ['ticker symbol', 'symbol'],
  },
  'Stock market': {
    def: 'A giant marketplace where people buy and sell tiny pieces of companies. Prices move all day as people trade.',
    principle: null,
    aliases: ['the market', 'markets', 'equity market'],
  },
  'Exchange': {
    def: 'The place where stocks are actually bought and sold, like the New York Stock Exchange. Think of it as the stadium where the trading happens.',
    principle: null,
    aliases: ['stock exchange', 'NYSE'],
  },

  // ─── Funds & baskets ────────────────────────────────────────────────────────
  'ETF': {
    def: 'A single basket that holds many stocks at once. Buy one ETF and you instantly own a little bit of everything inside it.',
    principle: 5,
    aliases: ['ETFs', 'exchange-traded fund', 'exchange traded fund'],
  },
  'Index': {
    def: 'A scoreboard that measures how a group of stocks is doing all together — like the S&P 500.',
    principle: 5,
    aliases: ['indexes', 'indices'],
  },
  'Index fund': {
    def: 'A basket built to copy a scoreboard like the S&P 500, so it rises and falls right along with it. A simple way to own lots of companies at once.',
    principle: 5,
    aliases: ['index funds'],
  },
  'Mutual fund': {
    def: 'A big shared pot where many people\'s money is pooled together and used to buy lots of stocks. A manager decides what goes in.',
    principle: 5,
    aliases: ['mutual funds'],
  },
  'Portfolio': {
    def: 'Everything you own as an investor, all added up — all your stocks and baskets together.',
    principle: 5,
    aliases: ['portfolios'],
  },
  'Diversify': {
    def: 'To spread your money across many different things so one bad surprise can\'t wipe you out. Don\'t put all your eggs in one basket.',
    principle: 5,
    aliases: ['diversification', 'diversified'],
  },

  // ─── Company health ─────────────────────────────────────────────────────────
  'Earnings': {
    def: 'How much profit a company made over the last few months. Companies report this 4 times a year and investors watch closely.',
    principle: 8,
    aliases: ['earnings report', 'earnings season'],
  },
  'Revenue': {
    def: 'All the money a company takes in from selling its stuff, before any costs are subtracted. Also called sales.',
    principle: 8,
    aliases: ['sales', 'top line'],
  },
  'Profit': {
    def: 'The money a company keeps after paying all its bills. Revenue minus costs.',
    principle: 3,
    aliases: ['profits', 'net income', 'bottom line'],
  },
  'Market cap': {
    def: 'What the whole company is worth on the market — the price of one share times every share that exists. It\'s how we say a company is "big" or "small".',
    principle: 10,
    aliases: ['market capitalization', 'market capitalisation'],
  },
  'Valuation': {
    def: 'An estimate of what a company is really worth, which investors compare to its price to decide if it\'s cheap or expensive.',
    principle: 10,
    aliases: ['valuations', 'valued'],
  },
  'Dividend': {
    def: 'A small slice of a company\'s profit paid out to the people who own its stock — like a thank-you for being an owner.',
    principle: 11,
    aliases: ['dividends'],
  },
  'Guidance': {
    def: 'A company\'s own guess about how it will do in the coming months. Investors care a lot about whether the guess sounds good or bad.',
    principle: 8,
    aliases: ['forecast', 'outlook'],
  },

  // ─── Price moves & mood ─────────────────────────────────────────────────────
  'Bull market': {
    def: 'A stretch of time when prices are mostly going up and investors feel hopeful.',
    principle: 6,
    aliases: ['bull', 'bullish'],
  },
  'Bear market': {
    def: 'A stretch of time when prices are mostly falling and investors feel gloomy.',
    principle: 7,
    aliases: ['bear', 'bearish'],
  },
  'Volatility': {
    def: 'A fancy word for how much a price bounces up and down. High volatility means big swings; low means it\'s calm.',
    principle: 7,
    aliases: ['volatile'],
  },
  'Rally': {
    def: 'When prices climb quickly over a short time. The market "rallied" means it jumped up.',
    principle: 7,
    aliases: ['rallied', 'rallies'],
  },
  'Sell-off': {
    def: 'When lots of people sell at once and prices drop fast. Often happens when investors get scared.',
    principle: 7,
    aliases: ['selloff', 'sell off'],
  },
  'Correction': {
    def: 'When the market falls about 10% from its recent high. It sounds scary but it\'s a normal, regular event.',
    principle: 6,
    aliases: ['market correction'],
  },
  'Crash': {
    def: 'A sudden, sharp drop in prices across the whole market in a very short time.',
    principle: 7,
    aliases: ['market crash'],
  },
  'All-time high': {
    def: 'The highest price something has ever reached. When an index hits one, it has never been worth more.',
    principle: 6,
    aliases: ['record high', 'all time high'],
  },
  'Gain': {
    def: 'When something you own is worth more than what you paid. The opposite of a loss.',
    principle: null,
    aliases: ['gains', 'gained'],
  },
  'Loss': {
    def: 'When something you own is worth less than what you paid. Only counts for real if you sell.',
    principle: 6,
    aliases: ['losses'],
  },

  // ─── Big-picture economy ────────────────────────────────────────────────────
  'Inflation': {
    def: 'When prices for everyday things slowly rise over time, so each dollar buys a little less than it used to.',
    principle: 2,
    aliases: ['inflationary'],
  },
  'Interest rate': {
    def: 'The price of borrowing money. When rates go up, loans cost more and the market often gets nervous.',
    principle: null,
    aliases: ['interest rates', 'rates'],
  },
  'The Fed': {
    def: 'The Federal Reserve — America\'s central bank. It nudges interest rates up or down to keep the economy steady.',
    principle: null,
    aliases: ['Federal Reserve', 'Fed'],
  },
  'Recession': {
    def: 'A stretch when the economy shrinks instead of grows — people spend less and companies earn less. It eventually passes.',
    principle: 6,
    aliases: ['recessions'],
  },
  'GDP': {
    def: 'The total value of everything a country makes and sells in a year. A quick way to size up how the whole economy is doing.',
    principle: null,
    aliases: ['gross domestic product'],
  },

  // ─── How investing works ────────────────────────────────────────────────────
  'Compound growth': {
    def: 'When your money earns money, and then THAT money earns money too. Over many years it snowballs into a lot.',
    principle: 2,
    aliases: ['compounding', 'compound interest', 'compound'],
  },
  'Broker': {
    def: 'The company or app that lets you actually buy and sell stocks, like Fidelity or Schwab.',
    principle: null,
    aliases: ['brokerage', 'brokerage account'],
  },
  'IPO': {
    def: 'The first day a private company sells its stock to the public, so anyone can become an owner.',
    principle: 8,
    aliases: ['initial public offering', 'going public'],
  },
  'Long-term': {
    def: 'Thinking in years, not days. Good investors hold on through the bumps instead of panicking.',
    principle: 6,
    aliases: ['long term', 'long-term investing'],
  },
  'Risk': {
    def: 'The chance that an investment loses money. Bigger possible rewards usually come with bigger risk.',
    principle: 7,
    aliases: ['risky'],
  },
  'Return': {
    def: 'How much your money grows (or shrinks), usually shown as a percentage of what you put in.',
    principle: 2,
    aliases: ['returns', 'rate of return'],
  },
  'Asset': {
    def: 'Anything you own that has value and can grow or earn money — like stocks, a house, or a business.',
    principle: 11,
    aliases: ['assets'],
  },
  'Shares outstanding': {
    def: 'The total number of shares of a company that exist and are owned by people right now.',
    principle: null,
    aliases: ['outstanding shares'],
  },
};

// ── Lookup helpers ────────────────────────────────────────────────────────────

// Build a fast alias → canonical-key map once at module load.
const ALIAS_INDEX = (() => {
  const idx = new Map();
  for (const [term, entry] of Object.entries(GLOSSARY)) {
    idx.set(term.toLowerCase(), term);
    for (const alias of entry.aliases || []) {
      idx.set(alias.toLowerCase(), term);
    }
  }
  return idx;
})();

// Every term + alias, sorted longest-first so the matcher prefers
// "bull market" over "bull" and "S&P 500" over "S&P".
export const MATCHABLE_TERMS = Array.from(ALIAS_INDEX.keys())
  .sort((a, b) => b.length - a.length);

/** Resolve any term or alias (case-insensitive) to its canonical glossary entry. */
export function lookup(termOrAlias) {
  const key = ALIAS_INDEX.get(String(termOrAlias).toLowerCase());
  if (!key) return null;
  return { term: key, ...GLOSSARY[key] };
}

/** True if the given word/phrase is already covered (used by the nomination gate). */
export function isKnownTerm(termOrAlias) {
  return ALIAS_INDEX.has(String(termOrAlias).toLowerCase());
}

/** Flat list of canonical terms — injected into the generator prompt so Claude
 *  only nominates terms NOT already in the glossary. */
export function knownTermList() {
  return Object.keys(GLOSSARY);
}

export default GLOSSARY;
