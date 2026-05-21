// src/companies.js — Curated list of kid-recognizable public companies.
// Used to filter "Today's Mover" and to source company-centric games.
// Stored as a config so it can be edited without touching logic.

export const CURATED_COMPANIES = [
  // Tech
  { ticker: 'AAPL',  name: 'Apple',      sector: 'tech' },
  { ticker: 'GOOGL', name: 'Google',     sector: 'tech' },
  { ticker: 'MSFT',  name: 'Microsoft',  sector: 'tech' },
  { ticker: 'AMZN',  name: 'Amazon',     sector: 'tech' },
  { ticker: 'META',  name: 'Meta',       sector: 'tech' },
  { ticker: 'NVDA',  name: 'Nvidia',     sector: 'tech' },
  { ticker: 'TSLA',  name: 'Tesla',      sector: 'tech' },
  { ticker: 'NFLX',  name: 'Netflix',    sector: 'tech' },
  { ticker: 'SPOT',  name: 'Spotify',    sector: 'tech' },
  { ticker: 'SNAP',  name: 'Snap',       sector: 'tech' },
  { ticker: 'PINS',  name: 'Pinterest',  sector: 'tech' },
  { ticker: 'RDDT',  name: 'Reddit',     sector: 'tech' },
  { ticker: 'UBER',  name: 'Uber',       sector: 'tech' },
  { ticker: 'ABNB',  name: 'Airbnb',     sector: 'tech' },
  { ticker: 'RBLX',  name: 'Roblox',     sector: 'tech' },
  { ticker: 'U',     name: 'Unity',      sector: 'tech' },
  { ticker: 'CRM',   name: 'Salesforce', sector: 'tech' },
  { ticker: 'ADBE',  name: 'Adobe',      sector: 'tech' },
  { ticker: 'INTC',  name: 'Intel',      sector: 'tech' },
  { ticker: 'AMD',   name: 'AMD',        sector: 'tech' },
  { ticker: 'QCOM',  name: 'Qualcomm',   sector: 'tech' },
  { ticker: 'IBM',   name: 'IBM',        sector: 'tech' },
  { ticker: 'ORCL',  name: 'Oracle',     sector: 'tech' },
  { ticker: 'SHOP',  name: 'Shopify',    sector: 'tech' },
  { ticker: 'SQ',    name: 'Block',      sector: 'tech' },
  { ticker: 'PYPL',  name: 'PayPal',     sector: 'tech' },
  { ticker: 'COIN',  name: 'Coinbase',   sector: 'tech' },
  { ticker: 'HOOD',  name: 'Robinhood',  sector: 'tech' },

  // Consumer
  { ticker: 'NKE',  name: 'Nike',        sector: 'consumer' },
  { ticker: 'DIS',  name: 'Disney',      sector: 'consumer' },
  { ticker: 'MCD',  name: 'McDonald’s',  sector: 'consumer' },
  { ticker: 'SBUX', name: 'Starbucks',   sector: 'consumer' },
  { ticker: 'COST', name: 'Costco',      sector: 'consumer' },
  { ticker: 'WMT',  name: 'Walmart',     sector: 'consumer' },
  { ticker: 'TGT',  name: 'Target',      sector: 'consumer' },
  { ticker: 'KO',   name: 'Coca-Cola',   sector: 'consumer' },
  { ticker: 'PEP',  name: 'Pepsi',       sector: 'consumer' },
  { ticker: 'CMG',  name: 'Chipotle',    sector: 'consumer' },
  { ticker: 'LULU', name: 'Lululemon',   sector: 'consumer' },
  { ticker: 'UAA',  name: 'Under Armour',sector: 'consumer' },
  { ticker: 'YUM',  name: 'Yum! Brands', sector: 'consumer' },
  { ticker: 'DPZ',  name: 'Domino’s',    sector: 'consumer' },
  { ticker: 'DASH', name: 'DoorDash',    sector: 'consumer' },
  { ticker: 'PG',   name: 'Procter & Gamble', sector: 'consumer' },
  { ticker: 'CL',   name: 'Colgate-Palmolive', sector: 'consumer' },

  // Auto / Transport
  { ticker: 'F',    name: 'Ford',        sector: 'auto' },
  { ticker: 'GM',   name: 'General Motors', sector: 'auto' },
  { ticker: 'RIVN', name: 'Rivian',      sector: 'auto' },
  { ticker: 'LCID', name: 'Lucid',       sector: 'auto' },
  { ticker: 'BA',   name: 'Boeing',      sector: 'auto' },
  { ticker: 'DAL',  name: 'Delta',       sector: 'auto' },
  { ticker: 'LUV',  name: 'Southwest',   sector: 'auto' },
  { ticker: 'UAL',  name: 'United Airlines', sector: 'auto' },
  { ticker: 'AAL',  name: 'American Airlines', sector: 'auto' },

  // Entertainment / Gaming
  { ticker: 'EA',    name: 'EA Sports',  sector: 'entertainment' },
  { ticker: 'TTWO',  name: 'Take-Two',   sector: 'entertainment' },
  { ticker: 'PARA',  name: 'Paramount',  sector: 'entertainment' },
  { ticker: 'WBD',   name: 'Warner Bros. Discovery', sector: 'entertainment' },
  { ticker: 'LYV',   name: 'Live Nation',sector: 'entertainment' },
  { ticker: 'SONY',  name: 'Sony',       sector: 'entertainment' },
  { ticker: 'NTDOY', name: 'Nintendo',   sector: 'entertainment' },

  // Finance
  { ticker: 'V',   name: 'Visa',         sector: 'finance' },
  { ticker: 'MA',  name: 'Mastercard',   sector: 'finance' },
  { ticker: 'JPM', name: 'JPMorgan Chase', sector: 'finance' },
  { ticker: 'GS',  name: 'Goldman Sachs',sector: 'finance' },
  { ticker: 'BAC', name: 'Bank of America', sector: 'finance' },
  { ticker: 'AXP', name: 'American Express', sector: 'finance' },

  // Health / Other
  { ticker: 'JNJ',  name: 'Johnson & Johnson', sector: 'health' },
  { ticker: 'PFE',  name: 'Pfizer',      sector: 'health' },
  { ticker: 'MRNA', name: 'Moderna',     sector: 'health' },
  { ticker: 'UNH',  name: 'UnitedHealth',sector: 'health' },

  // Telecom / Media
  { ticker: 'TMUS',  name: 'T-Mobile',   sector: 'telecom' },
  { ticker: 'VZ',    name: 'Verizon',    sector: 'telecom' },
  { ticker: 'CMCSA', name: 'Comcast',    sector: 'telecom' },
  { ticker: 'T',     name: 'AT&T',       sector: 'telecom' },
];

export const CURATED_TICKERS = CURATED_COMPANIES.map(c => c.ticker);

const TICKER_TO_COMPANY = new Map(
  CURATED_COMPANIES.map(c => [c.ticker.toUpperCase(), c]),
);

export function lookupCompany(ticker) {
  if (!ticker) return null;
  return TICKER_TO_COMPANY.get(String(ticker).toUpperCase()) || null;
}
