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
          changesPercentage: q.changesPercentage,
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
 * Fetch batch quotes for the curated company list and pick the single stock
 * with the largest absolute % move today. This is "Today's Mover" — the
 * gold-highlighted card in the scoreboard.
 *
 * Strategy:
 *   - Batch quote endpoint supports comma-separated symbols, so this is one
 *     HTTP call regardless of curated-list size.
 *   - We return the raw quote for the winner + the curated company metadata
 *     (display name, sector) so the template and AI prompt can use both.
 *   - If the API fails or returns no usable data, return null and let the
 *     caller decide how to degrade.
 */
export async function fetchTopMover(apiKey) {
  try {
    const tickers = CURATED_TICKERS.join(',');
    const data = await fmpFetch(
      `/quote?symbol=${encodeURIComponent(tickers)}&apikey=${apiKey}`,
      'quote(curated-batch)',
    );
    const quotes = Array.isArray(data) ? data : (data ? [data] : []);
    const valid = quotes.filter(q =>
      q && typeof q.price === 'number' && typeof q.changesPercentage === 'number',
    );
    if (valid.length === 0) {
      console.error('[Data] Top mover: no valid quotes returned from curated batch');
      return null;
    }
    // Sort by absolute % change, descending.
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
      // Include the top 5 candidates so the AI prompt can see alternatives if
      // it wants context on whether today's pick is dramatic or muted.
      runnersUp: valid.slice(1, 5).map(q => ({
        ticker: q.symbol,
        name: lookupCompany(q.symbol)?.name || q.name || q.symbol,
        changesPercentage: q.changesPercentage,
        price: q.price,
      })),
    };
  } catch (err) {
    console.error('[Data] Failed to fetch top mover:', err.message);
    return null;
  }
}

export async function fetchAllData(apiKey) {
  const [marketData, news, movers, topMover] = await Promise.all([
    fetchMarketData(apiKey),
    fetchNews(apiKey),
    fetchMovers(apiKey),
    fetchTopMover(apiKey),
  ]);
  return { marketData, news, movers, topMover };
}
