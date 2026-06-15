import { CURATED_TICKERS, lookupCompany } from './companies.js';

const FMP_BASE = 'https://financialmodelingprep.com/stable';

async function fmpFetch(path, label) {
  const url = `${FMP_BASE}${path}`;
  const res = await fetch(url);
  const body = await res.text();
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    console.error(`[Data] ${label} returned non-JSON (HTTP ${res.status}): ${body.slice(0, 200)}`);
    return null;
  }
  if (data && typeof data === 'object' && !Array.isArray(data) && data['Error Message']) {
    console.error(`[Data] ${label} FMP error: ${data['Error Message']}`);
    return null;
  }
  return data;
}

export async function fetchMarketData(apiKey) {
  // Phase 1: indices only — VOO removed in favor of "Today's Mover" card.
  const symbols = ['^GSPC', '^IXIC', '^DJI'];
  const results = {};
  for (const symbol of symbols) {
    try {
      const data = await fmpFetch(
        `/quote?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`,
        `quote(${symbol})`,
      );
      const q = Array.isArray(data) ? data[0] : data;
      if (q && typeof q.price === 'number') {
        results[symbol] = {
          name: q.name || symbol,
          price: q.price,
          change: q.change,
          // FMP /stable renamed `changesPercentage` → `changePercentage`
          // (the legacy /api/v3 endpoints used the plural). Accept either
          // so we ride out the rollover.
          changesPercentage: q.changePercentage ?? q.changesPercentage,
          previousClose: q.previousClose,
          dayHigh: q.dayHigh,
          dayLow: q.dayLow,
        };
      } else {
        console.error(`[Data] quote(${symbol}) returned no usable data:`, JSON.stringify(data).slice(0, 200));
      }
    } catch (err) {
      console.error(`[Data] Failed to fetch ${symbol}:`, err.message);
    }
  }
  return results;
}

export async function fetchNews(apiKey) {
  try {
    // Pull from multiple FMP /stable endpoints for broader, better coverage
    const [generalRes, spyRes, bigTechRes, etfsRes, fmpArticlesRes] = await Promise.all([
      fmpFetch(`/general-news?page=0&apikey=${apiKey}`, 'general-news'),
      fmpFetch(`/stock-news?tickers=SPY&limit=5&apikey=${apiKey}`, 'stock-news(SPY)'),
      fmpFetch(`/stock-news?tickers=NVDA,AAPL,MSFT,GOOGL,AMZN,TSLA,META&limit=8&apikey=${apiKey}`, 'stock-news(big-tech)'),
      fmpFetch(`/stock-news?tickers=QQQ&limit=3&apikey=${apiKey}`, 'stock-news(QQQ)'),
      fmpFetch(`/fmp-articles?page=0&size=5&apikey=${apiKey}`, 'fmp-articles'),
    ]);

    const general = Array.isArray(generalRes) ? generalRes : [];
    const spy = Array.isArray(spyRes) ? spyRes : [];
    const bigTech = Array.isArray(bigTechRes) ? bigTechRes : [];
    const etfs = Array.isArray(etfsRes) ? etfsRes : [];
    const fmpArticlesList = Array.isArray(fmpArticlesRes?.content)
      ? fmpArticlesRes.content
      : Array.isArray(fmpArticlesRes) ? fmpArticlesRes : [];

    const allArticles = [...general, ...spy, ...bigTech, ...etfs, ...fmpArticlesList];

    const filtered = allArticles.filter(a => {
      const title = (a.title || '').toLowerCase();
      const skipTerms = [
        'penny stock', 'cannabis', 'meme coin', 'shiba', 'dogecoin',
        'pump and dump', 'microcap', 'otc', 'short squeeze alert',
        'price target', 'analyst rating', 'buy rating', 'hold rating',
        'dividend declared', 'ex-dividend',
      ];
      if (title.length < 20) return false;
      return !skipTerms.some(term => title.includes(term));
    });

    const seen = new Set();
    const unique = filtered.filter(a => {
      const key = (a.title || '').toLowerCase().substring(0, 50);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return unique.slice(0, 15).map(a => ({
      title: a.title,
      text: (a.text || a.content || '').substring(0, 600),
      symbol: a.symbol || a.tickers || '',
      url: a.url || a.link || '',
      publishedDate: a.publishedDate || a.date || '',
      site: a.site || a.source || '',
    }));
  } catch (err) {
    console.error('[Data] Failed to fetch news:', err.message);
    return [];
  }
}

export async function fetchMovers(apiKey) {
  try {
    const [gainers, losers] = await Promise.all([
      fmpFetch(`/biggest-gainers?apikey=${apiKey}`, 'biggest-gainers'),
      fmpFetch(`/biggest-losers?apikey=${apiKey}`, 'biggest-losers'),
    ]);
    const topGainers = (Array.isArray(gainers) ? gainers : [])
      .filter(s => s.price > 5).slice(0, 3)
      .map(s => ({ symbol: s.symbol, name: s.name, change: s.changesPercentage, price: s.price }));
    const topLosers = (Array.isArray(losers) ? losers : [])
      .filter(s => s.price > 5).slice(0, 3)
      .map(s => ({ symbol: s.symbol, name: s.name, change: s.changesPercentage, price: s.price }));
    return { topGainers, topLosers };
  } catch (err) {
    console.error('[Data] Failed to fetch movers:', err.message);
    return { topGainers: [], topLosers: [] };
  }
}

/**
 * Fan out one /quote per curated ticker and return the normalized valid
 * quotes. FMP's free tier has no working multi-ticker batch (multi-ticker
 * `/stable/quote?symbol=A,B,C` returns []; `/stable/batch-quote` is paid-only
 * — see fetchQuotes), so this is a per-ticker fan-out. It's the bulk of our
 * daily FMP spend (~80 calls, well under the 250/day cap) and feeds BOTH the
 * Phase 21 `daily_prices` snapshot (every day) AND Today's Mover.
 * Returns [{ symbol, price, change, changesPercentage, previousClose, name, … }].
 */
export async function fetchPriceSnapshot(apiKey) {
  try {
    const results = await Promise.all(CURATED_TICKERS.map(t =>
      fmpFetch(`/quote?symbol=${encodeURIComponent(t)}&apikey=${apiKey}`, `quote(${t})`)
        .then(data => Array.isArray(data) ? data[0] : data)
        .catch(err => { console.error(`[Data] quote(${t}) failed:`, err.message); return null; })
    ));
    // FMP renamed `changesPercentage` → `changePercentage` on /stable.
    // Normalize so downstream consumers can keep using the historical name.
    return results
      .filter(q => q && typeof q.price === 'number' &&
        typeof (q.changePercentage ?? q.changesPercentage) === 'number')
      .map(q => ({ ...q, changesPercentage: q.changePercentage ?? q.changesPercentage }));
  } catch (err) {
    console.error('[Data] Price-snapshot fan-out failed:', err.message);
    return [];
  }
}

/**
 * Pick "Today's Mover" — the curated stock with the largest absolute % move —
 * from a price snapshot. Pure (no I/O); returns null on an empty snapshot.
 * Includes the top-5 runners-up so the AI prompt can gauge how dramatic the
 * day's pick is.
 */
export function pickTopMover(snapshot) {
  const valid = Array.isArray(snapshot) ? snapshot.slice() : [];
  if (valid.length === 0) {
    console.error('[Data] Top mover: empty price snapshot');
    return null;
  }
  valid.sort((a, b) => Math.abs(b.changesPercentage) - Math.abs(a.changesPercentage));
  const winner = valid[0];
  const company = lookupCompany(winner.symbol);
  return {
    ticker: winner.symbol,
    displayName: company?.name || winner.name || winner.symbol,
    sector: company?.sector || null,
    price: winner.price,
    change: winner.change,
    changesPercentage: winner.changesPercentage,
    previousClose: winner.previousClose,
    runnersUp: valid.slice(1, 5).map(q => ({
      ticker: q.symbol,
      name: lookupCompany(q.symbol)?.name || q.name || q.symbol,
      changesPercentage: q.changesPercentage,
      price: q.price,
    })),
  };
}

/** Back-compat: fetch the snapshot + pick the mover in one call. */
export async function fetchTopMover(apiKey) {
  return pickTopMover(await fetchPriceSnapshot(apiKey));
}

/**
 * Quote a list of tickers. Returns a map { TICKER: { price, change, changesPercentage } }.
 * Used by Phase 6.5 game hydration:
 *   - time-machine: needs today's price for choices with status:'active'
 *   - price-is-right: needs today's price for the picked ticker
 *
 * Implementation note: FMP's free tier does NOT support multi-ticker
 * `/stable/quote?symbol=A,B,C` — that endpoint returns `[]` for any
 * comma-separated input and the batch endpoint is paid-only. We therefore
 * issue N parallel single-ticker calls. Acceptable for our small batches
 * (≤6 tickers per day). FMP's free tier is 250 calls/day, plenty of room.
 *
 * Missing tickers (failed call, no row, non-numeric price) are absent
 * from the result map — callers fall back to canned values.
 */
export async function fetchQuotes(tickers, apiKey) {
  if (!tickers?.length) return {};
  const results = await Promise.all(tickers.map(async t => {
    try {
      const data = await fmpFetch(
        `/quote?symbol=${encodeURIComponent(t)}&apikey=${apiKey}`,
        `quote(${t})`,
      );
      const q = Array.isArray(data) ? data[0] : data;
      if (q?.symbol && typeof q.price === 'number') {
        return [q.symbol, {
          price: q.price,
          change: q.change,
          // FMP renamed `changesPercentage` → `changePercentage` in the
          // /stable API. Accept either so we're tolerant of the rollover.
          changesPercentage: q.changePercentage ?? q.changesPercentage,
        }];
      }
      return null;
    } catch (err) {
      console.error(`[Data] fetchQuotes(${t}) failed: ${err.message}`);
      return null;
    }
  }));
  return Object.fromEntries(results.filter(Boolean));
}

export async function fetchAllData(apiKey, opts = {}) {
  // The curated fan-out now runs EVERY day (incl. week-ahead Monday) so the
  // Phase 21 watchlist always has a same-day price snapshot. `opts.skipTopMover`
  // only suppresses the forward-looking edition's MOVER card (Friday's % move
  // is stale + would mislabel) — it NO LONGER skips the fan-out, because the
  // snapshot needs it. One fan-out feeds both the snapshot and the mover.
  const [marketData, news, movers, priceSnapshot] = await Promise.all([
    fetchMarketData(apiKey),
    fetchNews(apiKey),
    fetchMovers(apiKey),
    fetchPriceSnapshot(apiKey),
  ]);
  const topMover = opts.skipTopMover ? null : pickTopMover(priceSnapshot);
  return { marketData, news, movers, topMover, priceSnapshot };
}
