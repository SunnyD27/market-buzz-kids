// src/companies.js — Curated list of kid-recognizable public companies.
// Used to filter "Today's Mover", source company-centric games, AND power
// the Phase 21 Watchlist follow set + categorized picker.
//
// Two fields drive different things:
//   - `sector`   — internal metadata (mover card, legacy grouping).
//   - `category` — the kid-legible bucket the Watchlist picker groups by
//                  (keys map to WATCHLIST_CATEGORIES below).
//
// Phase 21 note — ONE list, currently all "core": every followable company
// here is also editorial-eligible (mover / Mystery Mover / Weekly Hold), and
// every one is in the daily FMP fan-out so the watchlist price snapshot costs
// ZERO extra calls. The deferred premium tier will add expanded-universe
// entries flagged `core: false`; editorial sourcing filters on that flag
// (absence = core), the picker shows everyone — so the bigger universe drops
// in behind the same picker without touching editorial code.
//
// Stored as config so it can be edited without touching logic.

export const CURATED_COMPANIES = [
  // Tech
  { ticker: 'AAPL',  name: 'Apple',      sector: 'tech', category: 'games-tech' },
  { ticker: 'GOOGL', name: 'Google',     sector: 'tech', category: 'games-tech' },
  { ticker: 'MSFT',  name: 'Microsoft',  sector: 'tech', category: 'games-tech' },
  { ticker: 'AMZN',  name: 'Amazon',     sector: 'tech', category: 'stuff' },
  { ticker: 'META',  name: 'Meta',       sector: 'tech', category: 'phones-internet' },
  { ticker: 'NVDA',  name: 'Nvidia',     sector: 'tech', category: 'games-tech' },
  { ticker: 'TSLA',  name: 'Tesla',      sector: 'tech', category: 'cars-planes' },
  { ticker: 'NFLX',  name: 'Netflix',    sector: 'tech', category: 'entertainment' },
  { ticker: 'SPOT',  name: 'Spotify',    sector: 'tech', category: 'entertainment' },
  { ticker: 'SNAP',  name: 'Snap',       sector: 'tech', category: 'phones-internet' },
  { ticker: 'PINS',  name: 'Pinterest',  sector: 'tech', category: 'phones-internet' },
  { ticker: 'RDDT',  name: 'Reddit',     sector: 'tech', category: 'phones-internet' },
  { ticker: 'UBER',  name: 'Uber',       sector: 'tech', category: 'phones-internet' },
  { ticker: 'ABNB',  name: 'Airbnb',     sector: 'tech', category: 'phones-internet' },
  { ticker: 'RBLX',  name: 'Roblox',     sector: 'tech', category: 'games-tech' },
  { ticker: 'U',     name: 'Unity',      sector: 'tech', category: 'games-tech' },
  { ticker: 'CRM',   name: 'Salesforce', sector: 'tech', category: 'games-tech' },
  { ticker: 'ADBE',  name: 'Adobe',      sector: 'tech', category: 'games-tech' },
  { ticker: 'INTC',  name: 'Intel',      sector: 'tech', category: 'games-tech' },
  { ticker: 'AMD',   name: 'AMD',        sector: 'tech', category: 'games-tech' },
  { ticker: 'QCOM',  name: 'Qualcomm',   sector: 'tech', category: 'games-tech' },
  { ticker: 'IBM',   name: 'IBM',        sector: 'tech', category: 'games-tech' },
  { ticker: 'ORCL',  name: 'Oracle',     sector: 'tech', category: 'games-tech' },
  { ticker: 'SHOP',  name: 'Shopify',    sector: 'tech', category: 'phones-internet' },
  { ticker: 'SQ',    name: 'Block',      sector: 'tech', category: 'money-banks' },
  { ticker: 'PYPL',  name: 'PayPal',     sector: 'tech', category: 'money-banks' },
  { ticker: 'COIN',  name: 'Coinbase',   sector: 'tech', category: 'money-banks' },
  { ticker: 'HOOD',  name: 'Robinhood',  sector: 'tech', category: 'money-banks' },
  { ticker: 'PLTR',  name: 'Palantir',   sector: 'tech', category: 'games-tech' },

  // Consumer
  { ticker: 'NKE',  name: 'Nike',        sector: 'consumer', category: 'stuff' },
  { ticker: 'DIS',  name: 'Disney',      sector: 'consumer', category: 'entertainment' },
  { ticker: 'MCD',  name: 'McDonald’s',  sector: 'consumer', category: 'food-drinks' },
  { ticker: 'SBUX', name: 'Starbucks',   sector: 'consumer', category: 'food-drinks' },
  { ticker: 'COST', name: 'Costco',      sector: 'consumer', category: 'stuff' },
  { ticker: 'WMT',  name: 'Walmart',     sector: 'consumer', category: 'stuff' },
  { ticker: 'TGT',  name: 'Target',      sector: 'consumer', category: 'stuff' },
  { ticker: 'KO',   name: 'Coca-Cola',   sector: 'consumer', category: 'food-drinks' },
  { ticker: 'PEP',  name: 'Pepsi',       sector: 'consumer', category: 'food-drinks' },
  { ticker: 'CMG',  name: 'Chipotle',    sector: 'consumer', category: 'food-drinks' },
  { ticker: 'LULU', name: 'Lululemon',   sector: 'consumer', category: 'stuff' },
  { ticker: 'UAA',  name: 'Under Armour',sector: 'consumer', category: 'stuff' },
  { ticker: 'YUM',  name: 'Yum! Brands', sector: 'consumer', category: 'food-drinks' },
  { ticker: 'DPZ',  name: 'Domino’s',    sector: 'consumer', category: 'food-drinks' },
  { ticker: 'DASH', name: 'DoorDash',    sector: 'consumer', category: 'food-drinks' },
  { ticker: 'PG',   name: 'Procter & Gamble', sector: 'consumer', category: 'stuff' },
  { ticker: 'CL',   name: 'Colgate-Palmolive', sector: 'consumer', category: 'stuff' },
  { ticker: 'HSY',  name: 'Hershey',     sector: 'consumer', category: 'food-drinks' },
  { ticker: 'CROX', name: 'Crocs',       sector: 'consumer', category: 'stuff' },
  { ticker: 'MAT',  name: 'Mattel',      sector: 'consumer', category: 'stuff' },
  { ticker: 'HAS',  name: 'Hasbro',      sector: 'consumer', category: 'stuff' },

  // Auto / Transport
  { ticker: 'F',    name: 'Ford',        sector: 'auto', category: 'cars-planes' },
  { ticker: 'GM',   name: 'General Motors', sector: 'auto', category: 'cars-planes' },
  { ticker: 'RIVN', name: 'Rivian',      sector: 'auto', category: 'cars-planes' },
  { ticker: 'LCID', name: 'Lucid',       sector: 'auto', category: 'cars-planes' },
  { ticker: 'BA',   name: 'Boeing',      sector: 'auto', category: 'cars-planes' },
  { ticker: 'DAL',  name: 'Delta',       sector: 'auto', category: 'cars-planes' },
  { ticker: 'LUV',  name: 'Southwest',   sector: 'auto', category: 'cars-planes' },
  { ticker: 'UAL',  name: 'United Airlines', sector: 'auto', category: 'cars-planes' },
  { ticker: 'AAL',  name: 'American Airlines', sector: 'auto', category: 'cars-planes' },
  { ticker: 'SPCX', name: 'SpaceX',      sector: 'auto', category: 'cars-planes' },

  // Entertainment / Gaming
  { ticker: 'EA',    name: 'EA Sports',  sector: 'entertainment', category: 'games-tech' },
  { ticker: 'TTWO',  name: 'Take-Two',   sector: 'entertainment', category: 'games-tech' },
  { ticker: 'PARA',  name: 'Paramount',  sector: 'entertainment', category: 'entertainment' },
  { ticker: 'WBD',   name: 'Warner Bros. Discovery', sector: 'entertainment', category: 'entertainment' },
  { ticker: 'LYV',   name: 'Live Nation',sector: 'entertainment', category: 'entertainment' },
  { ticker: 'SONY',  name: 'Sony',       sector: 'entertainment', category: 'games-tech' },
  { ticker: 'NTDOY', name: 'Nintendo',   sector: 'entertainment', category: 'games-tech' },

  // Finance
  { ticker: 'V',   name: 'Visa',         sector: 'finance', category: 'money-banks' },
  { ticker: 'MA',  name: 'Mastercard',   sector: 'finance', category: 'money-banks' },
  { ticker: 'JPM', name: 'JPMorgan Chase', sector: 'finance', category: 'money-banks' },
  { ticker: 'GS',  name: 'Goldman Sachs',sector: 'finance', category: 'money-banks' },
  { ticker: 'BAC', name: 'Bank of America', sector: 'finance', category: 'money-banks' },
  { ticker: 'AXP', name: 'American Express', sector: 'finance', category: 'money-banks' },

  // Health / Other
  { ticker: 'JNJ',  name: 'Johnson & Johnson', sector: 'health', category: 'health' },
  { ticker: 'PFE',  name: 'Pfizer',      sector: 'health', category: 'health' },
  { ticker: 'MRNA', name: 'Moderna',     sector: 'health', category: 'health' },
  { ticker: 'UNH',  name: 'UnitedHealth',sector: 'health', category: 'health' },

  // Telecom / Media
  { ticker: 'TMUS',  name: 'T-Mobile',   sector: 'telecom', category: 'phones-internet' },
  { ticker: 'VZ',    name: 'Verizon',    sector: 'telecom', category: 'phones-internet' },
  { ticker: 'CMCSA', name: 'Comcast',    sector: 'telecom', category: 'phones-internet' },
  { ticker: 'T',     name: 'AT&T',       sector: 'telecom', category: 'phones-internet' },
];

export const CURATED_TICKERS = CURATED_COMPANIES.map(c => c.ticker);

const TICKER_TO_COMPANY = new Map(
  CURATED_COMPANIES.map(c => [c.ticker.toUpperCase(), c]),
);

export function lookupCompany(ticker) {
  if (!ticker) return null;
  return TICKER_TO_COMPANY.get(String(ticker).toUpperCase()) || null;
}

// ── Phase 21 — Watchlist follow set + categorized picker ────────────────
//
// Today the followable universe == the whole curated list (all `core`).
// `followableCompanies()` is the seam the deferred premium tier swaps: when
// expanded-universe entries land with `core: false`, this still returns
// everyone (picker shows all), while editorial code keeps using
// CURATED_TICKERS / a core filter.

/** Kid-legible picker buckets, in display order. */
export const WATCHLIST_CATEGORIES = [
  { key: 'games-tech',      label: 'Games & Tech',            emoji: '🎮' },
  { key: 'phones-internet', label: 'Phones & Internet',       emoji: '📱' },
  { key: 'entertainment',   label: 'Entertainment & Streaming', emoji: '🎬' },
  { key: 'food-drinks',     label: 'Food & Drinks',           emoji: '🍔' },
  { key: 'stuff',           label: 'Stuff You Buy',           emoji: '🛍️' },
  { key: 'cars-planes',     label: 'Cars & Planes',           emoji: '🚗' },
  { key: 'money-banks',     label: 'Money & Banks',           emoji: '💳' },
  { key: 'health',          label: 'Health & Medicine',       emoji: '💊' },
];

/** The full followable set (today: every curated company). */
export function followableCompanies() {
  return CURATED_COMPANIES.filter(c => c.core !== false);
}

/** True if `ticker` is a followable company (picker membership guard). */
export function isFollowable(ticker) {
  const c = lookupCompany(ticker);
  return !!c && c.core !== false;
}

/**
 * Followable companies grouped for the picker:
 * [{ key, label, emoji, companies: [{ticker, name, category}] }], category
 * order from WATCHLIST_CATEGORIES, companies alphabetized by name within each.
 * Empty categories are omitted.
 */
export function followableByCategory() {
  const all = followableCompanies();
  return WATCHLIST_CATEGORIES
    .map(cat => ({
      ...cat,
      companies: all
        .filter(c => c.category === cat.key)
        .map(c => ({ ticker: c.ticker, name: c.name, category: c.category }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter(cat => cat.companies.length > 0);
}
