// src/watchlist.js — Phase 21 Watchlist ("Your Companies").
//
// A kid follows up to 3 companies from the curated set and watches how they
// do OVER TIME. The point is learning + personalization, not a price ticker:
//   Layer 1 — "your company in today's news" (mover/bigPicture/story match)
//   Layer 2 — "since you started following" + first-crossing milestones
//   Layer 3 — a personalized principle tie-in (cap 1/digest)
//
// Everything renders PER-REQUEST via getWatchlistState() (threaded through
// buildHTML like prediction/weeklyHold) — never written into the immutable
// daily_digests row. /sample + logged-out skip (caller doesn't call us).
//
// Data: daily_prices (market-data snapshot, shared) + user_watchlist (follows)
// + user_watchlist_prefs (the offer state machine). The price snapshot is
// written at generation from the existing fan-out — ZERO extra FMP calls.
//
// No engagement coupling: following is a standing preference, not a daily
// action — no MC, no streak, no Perfect Day, no EVENT_TYPES.

import { query } from './db.js';
import { lookupCompany, isFollowable } from './companies.js';
import { fetchQuotes } from './data.js';

export const MAX_FOLLOWS = 3;
export const COOLDOWN_DAYS = 7;
export const MILESTONES = [10, 25, 50]; // % since following — first-crossing celebration

// ── Layer 1 false-positive guard ─────────────────────────────────────────
// Company names that are also common English words are EXCLUDED from the
// free-text (bigPicture/story) scan — a false "you're in the news!" is worse
// than a miss. They can still fire via the STRUCTURED mover-ticker match.
// Keyed by ticker (robust to name edits). Tunable; widen as the universe grows.
export const AMBIGUOUS_TICKERS = new Set([
  'SQ',   // Block
  'SNAP', // Snap
  'U',    // Unity
  'TGT',  // Target
  'V',    // Visa
  'RDDT', // Reddit
  'F',    // Ford
  'SONY', // Sony
  'LCID', // Lucid
  'DAL',  // Delta
  'CROX', // Crocs
  'META', // Meta ("meta" is now a common word)
]);

// ── small date helpers (NY 'YYYY-MM-DD' strings throughout) ──────────────
function noonUTC(dateStr) { return new Date(dateStr + 'T12:00:00Z').getTime(); }
function dayDiff(aStr, bStr) { return Math.round((noonUTC(aStr) - noonUTC(bStr)) / 86400_000); }

/** "today" / "yesterday" / "N days ago" / "N weeks ago" / "N months ago". */
export function relativeFollowLabel(followedSince, todayStr) {
  const d = dayDiff(todayStr, followedSince);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 14) return `${d} days ago`;
  if (d < 60) return `${Math.round(d / 7)} weeks ago`;
  if (d < 365) return `${Math.round(d / 30)} months ago`;
  const yrs = Math.round(d / 365);
  return yrs === 1 ? '1 year ago' : `${yrs} years ago`;
}

// ── Daily price snapshot (written at generation) ─────────────────────────

/**
 * Upsert the curated price snapshot into daily_prices for `dateStr`. `snapshot`
 * is fetchPriceSnapshot()'s array of normalized quotes. Idempotent (PK
 * (price_date,ticker)); returns the number of rows stored.
 */
export async function persistDailyPrices(snapshot, dateStr) {
  const rows = (Array.isArray(snapshot) ? snapshot : [])
    .filter(q => q && q.symbol && typeof q.price === 'number');
  if (!rows.length) return 0;
  const values = [];
  const params = [];
  rows.forEach((q, i) => {
    const b = i * 5;
    values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5})`);
    params.push(dateStr, q.symbol, q.price,
      q.changesPercentage ?? null, q.previousClose ?? null);
  });
  await query(
    `INSERT INTO daily_prices (price_date, ticker, price, change_pct, previous_close)
     VALUES ${values.join(', ')}
     ON CONFLICT (price_date, ticker) DO UPDATE
       SET price = EXCLUDED.price,
           change_pct = EXCLUDED.change_pct,
           previous_close = EXCLUDED.previous_close`,
    params,
  );
  return rows.length;
}

/**
 * Current price + today's move for `ticker`: today's snapshot row, else the
 * most recent snapshot (markets-closed / pre-generation fallback). Returns
 * { price, changePct, asOf } or null.
 */
async function priceFor(ticker, todayStr) {
  const { rows } = await query(
    `SELECT price, change_pct, price_date::text AS price_date
       FROM daily_prices
      WHERE ticker = $1 AND price_date <= $2::date
      ORDER BY price_date DESC
      LIMIT 1`,
    [ticker, todayStr],
  );
  if (!rows[0] || rows[0].price == null) return null;
  return {
    price: Number(rows[0].price),
    changePct: rows[0].change_pct == null ? null : Number(rows[0].change_pct),
    asOf: rows[0].price_date,
  };
}

/** Baseline price when a kid follows: today's snapshot → latest → live quote. */
async function baselinePrice(ticker, todayStr) {
  const snap = await priceFor(ticker, todayStr);
  if (snap) return snap.price;
  // Truly absent (new ticker / pre-first-generation) → one live quote.
  const key = process.env.FMP_API_KEY;
  if (!key) return null;
  try {
    const q = await fetchQuotes([ticker], key);
    return typeof q[ticker]?.price === 'number' ? q[ticker].price : null;
  } catch { return null; }
}

// ── Follow mechanics ─────────────────────────────────────────────────────

async function followedTickers(userId) {
  const { rows } = await query(
    `SELECT ticker, followed_since::text AS followed_since, price_at_follow, milestone_hit
       FROM user_watchlist WHERE user_id = $1
      ORDER BY followed_since ASC, ticker ASC`,
    [userId],
  );
  return rows.map(r => ({
    ticker: r.ticker,
    followedSince: r.followed_since,
    priceAtFollow: Number(r.price_at_follow),
    milestoneHit: Number(r.milestone_hit) || 0,
  }));
}

/**
 * Follow a company. Validates membership + cap-3 + not-already-held, captures
 * today's baseline. Free + instant. Returns { ok } or { ok:false, code }.
 */
export async function addWatchlist(userId, ticker, todayStr) {
  ticker = String(ticker || '').toUpperCase();
  if (!isFollowable(ticker)) return { ok: false, code: 'not-followable' };
  const held = await followedTickers(userId);
  if (held.some(h => h.ticker === ticker)) return { ok: false, code: 'already-following' };
  if (held.length >= MAX_FOLLOWS) return { ok: false, code: 'cap-reached' };
  const baseline = await baselinePrice(ticker, todayStr);
  if (baseline == null) return { ok: false, code: 'no-price' };
  await query(
    `INSERT INTO user_watchlist (user_id, ticker, followed_since, price_at_follow, milestone_hit)
     VALUES ($1, $2, $3::date, $4, 0)
     ON CONFLICT (user_id, ticker) DO NOTHING`,
    [userId, ticker, todayStr, baseline],
  );
  // Following counts as engaging with the feature → suppresses future nudges.
  await query(
    `INSERT INTO user_watchlist_prefs (user_id, status)
     VALUES ($1, 'active')
     ON CONFLICT (user_id) DO UPDATE SET status = 'active'`,
    [userId],
  );
  return { ok: true, ticker, followedSince: todayStr, priceAtFollow: baseline };
}

/**
 * Unfollow a company. Server-enforced per-company 7-day cooldown keyed off
 * THIS row's followed_since (swapping one never freezes others). Within the
 * window → { ok:false, code:'cooldown', daysRemaining }.
 */
export async function removeWatchlist(userId, ticker, todayStr) {
  ticker = String(ticker || '').toUpperCase();
  const { rows } = await query(
    `SELECT followed_since::text AS followed_since FROM user_watchlist WHERE user_id = $1 AND ticker = $2`,
    [userId, ticker],
  );
  if (!rows[0]) return { ok: false, code: 'not-following' };
  const followedSince = rows[0].followed_since;
  const heldDays = dayDiff(todayStr, followedSince);
  if (heldDays < COOLDOWN_DAYS) {
    return { ok: false, code: 'cooldown', daysRemaining: COOLDOWN_DAYS - heldDays };
  }
  await query(`DELETE FROM user_watchlist WHERE user_id = $1 AND ticker = $2`, [userId, ticker]);
  return { ok: true, ticker };
}

/**
 * Record a since-following milestone (+10/+25/+50%). Spoof-proof: re-computes
 * the % server-side from the stored baseline + the live snapshot, and only
 * advances milestone_hit upward for a genuinely-crossed level. Idempotent.
 */
export async function recordMilestone(userId, ticker, level, todayStr) {
  ticker = String(ticker || '').toUpperCase();
  level = Number(level);
  if (!MILESTONES.includes(level)) return { ok: false, code: 'bad-level' };
  const { rows } = await query(
    `SELECT price_at_follow, milestone_hit FROM user_watchlist WHERE user_id = $1 AND ticker = $2`,
    [userId, ticker],
  );
  if (!rows[0]) return { ok: false, code: 'not-following' };
  const priceAtFollow = Number(rows[0].price_at_follow);
  const milestoneHit = Number(rows[0].milestone_hit) || 0;
  if (level <= milestoneHit) return { ok: true, milestoneHit, noop: true };
  const cur = await priceFor(ticker, todayStr);
  if (!cur || !priceAtFollow) return { ok: false, code: 'no-price' };
  const pct = ((cur.price - priceAtFollow) / priceAtFollow) * 100;
  if (pct < level) return { ok: false, code: 'not-crossed' }; // spoof / regressed
  await query(
    `UPDATE user_watchlist SET milestone_hit = $3
       WHERE user_id = $1 AND ticker = $2 AND milestone_hit < $3`,
    [userId, ticker, level],
  );
  return { ok: true, milestoneHit: level };
}

// ── Offer state machine (first-run + one re-nudge) ───────────────────────

async function loadPrefs(userId) {
  const { rows } = await query(
    `SELECT offers_made, status, first_offer_active_day
       FROM user_watchlist_prefs WHERE user_id = $1`,
    [userId],
  );
  return rows[0]
    ? { offersMade: Number(rows[0].offers_made) || 0, status: rows[0].status,
        firstOfferActiveDay: rows[0].first_offer_active_day == null ? null : Number(rows[0].first_offer_active_day) }
    : { offersMade: 0, status: 'none', firstOfferActiveDay: null };
}

async function countActiveDays(userId) {
  const { rows } = await query(
    `SELECT COUNT(DISTINCT COALESCE(
              event_data->>'digestDate',
              TO_CHAR(created_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD')
            ))::int AS n
       FROM engagement_events
      WHERE user_id = $1 AND event_type = 'daily-visit'`,
    [userId],
  );
  return Number(rows[0]?.n || 0);
}

/**
 * Record an offer-state transition (client fires this when it shows/dismisses
 * the gentle picker prompt). event:
 *   'shown'    + kind 'first-run' → offers_made≥1, stamp first_offer_active_day
 *   'shown'    + kind 're-nudge'  → offers_made≥2
 *   'skipped'  → status='skipped' (eligible for the one re-nudge)
 *   'declined' → status='declined' (never re-nudged)
 */
export async function recordOffer(userId, event, kind) {
  if (event === 'declined') {
    await query(
      `INSERT INTO user_watchlist_prefs (user_id, status) VALUES ($1, 'declined')
       ON CONFLICT (user_id) DO UPDATE SET status = 'declined'`,
      [userId]);
    return { ok: true };
  }
  if (event === 'skipped') {
    await query(
      `INSERT INTO user_watchlist_prefs (user_id, status) VALUES ($1, 'skipped')
       ON CONFLICT (user_id) DO UPDATE
         SET status = CASE WHEN user_watchlist_prefs.status IN ('declined','active')
                           THEN user_watchlist_prefs.status ELSE 'skipped' END`,
      [userId]);
    return { ok: true };
  }
  if (event === 'shown') {
    if (kind === 're-nudge') {
      await query(
        `INSERT INTO user_watchlist_prefs (user_id, offers_made) VALUES ($1, 2)
         ON CONFLICT (user_id) DO UPDATE SET offers_made = GREATEST(user_watchlist_prefs.offers_made, 2)`,
        [userId]);
    } else {
      const activeDays = await countActiveDays(userId);
      await query(
        `INSERT INTO user_watchlist_prefs (user_id, offers_made, first_offer_active_day)
         VALUES ($1, 1, $2)
         ON CONFLICT (user_id) DO UPDATE
           SET offers_made = GREATEST(user_watchlist_prefs.offers_made, 1),
               first_offer_active_day = COALESCE(user_watchlist_prefs.first_offer_active_day, $2)`,
        [userId, activeDays]);
    }
    return { ok: true };
  }
  return { ok: false, code: 'bad-event' };
}

// ── Layer 1: in-the-news matcher (false-positive-safe) ───────────────────

function nameRegex(name) {
  // Match the full registered name as a standalone token: not flanked by a
  // letter/digit (so "Target" ≠ "Targeted", "Snap" ≠ "Snapchat"), and tolerant
  // of internal punctuation (Coca-Cola, Procter & Gamble, Warner Bros.).
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9])${esc}(?![A-Za-z0-9])`, 'i');
}

/**
 * Where (if anywhere) a held ticker appears in today's content. Precedence:
 * mover (structured, exact ticker) > bigPicture > story. Returns
 * { kind:'mover'|'bigPicture'|'story', section, storyIndex? } or null.
 * Free-text scan uses the full NAME only (never the ticker) and skips
 * AMBIGUOUS_TICKERS — false positives are worse than misses.
 */
export function matchInNews(ticker, content) {
  ticker = String(ticker || '').toUpperCase();
  const company = lookupCompany(ticker);
  if (!company || !content) return null;

  if (content.scoreboard?.topMover?.ticker?.toUpperCase?.() === ticker) {
    return { kind: 'mover', section: 'mover' };
  }
  if (AMBIGUOUS_TICKERS.has(ticker)) return null; // structured-only

  const re = nameRegex(company.name);
  if (typeof content.bigPicture === 'string' && re.test(content.bigPicture)) {
    return { kind: 'bigPicture', section: 'big-picture' };
  }
  const stories = Array.isArray(content.stories) ? content.stories : [];
  for (let i = 0; i < stories.length; i++) {
    const s = stories[i] || {};
    const hay = `${s.title || ''}\n${s.body || ''}`;
    if (re.test(hay)) return { kind: 'story', section: `story:${i}`, storyIndex: i };
  }
  return null;
}

// ── The per-request render model ─────────────────────────────────────────

/**
 * The full "Your Companies" model for one kid. Always returns a model when
 * called (caller skips it on /sample + logged-out). Shape:
 *   { held: [ { ticker, name, category, priceAtFollow, sinceFollowPct,
 *               todayPct, followedSinceLabel, news, milestone } ],
 *     ghostSlots, principleTieIn, offer }
 */
export async function getWatchlistState(userId, digestDate, content = {}, _now = null) {
  const today = digestDate;
  const followed = await followedTickers(userId);

  const held = [];
  for (const f of followed) {
    const company = lookupCompany(f.ticker) || { name: f.ticker, category: null };
    const cur = await priceFor(f.ticker, today);
    const sinceFollowPct = (cur && f.priceAtFollow)
      ? ((cur.price - f.priceAtFollow) / f.priceAtFollow) * 100
      : null;

    // Milestone: highest threshold crossed; isNew when above what we've recorded.
    let milestone = null;
    if (sinceFollowPct != null) {
      const crossed = MILESTONES.filter(m => sinceFollowPct >= m).pop() || 0;
      if (crossed > 0) milestone = { level: crossed, isNew: crossed > f.milestoneHit };
    }

    held.push({
      ticker: f.ticker,
      name: company.name,
      category: company.category || null,
      priceAtFollow: f.priceAtFollow,
      currentPrice: cur?.price ?? null,
      sinceFollowPct,
      todayPct: cur?.changePct ?? null,
      followedSinceLabel: relativeFollowLabel(f.followedSince, today),
      news: matchInNews(f.ticker, content),
      milestone,
    });
  }

  // Layer 3 — ONE personalized principle tie-in, mover-hit preferred.
  let principleTieIn = null;
  const moverHit = held.find(h => h.news?.kind === 'mover');
  const moverPrinciple = content.scoreboard?.topMover?.principle;
  if (moverHit && moverPrinciple) {
    principleTieIn = { name: moverHit.name, principle: moverPrinciple, section: 'mover' };
  } else {
    const stories = Array.isArray(content.stories) ? content.stories : [];
    for (const h of held) {
      if (h.news?.kind === 'story' && h.news.storyIndex != null) {
        const p = stories[h.news.storyIndex]?.principle;
        if (p) { principleTieIn = { name: h.name, principle: p, section: h.news.section }; break; }
      }
    }
  }

  // Offer state (only relevant while empty).
  let offer = null;
  if (held.length === 0) {
    const prefs = await loadPrefs(userId);
    if (prefs.status !== 'declined' && prefs.status !== 'active') {
      if (prefs.offersMade === 0) {
        offer = { show: true, kind: 'first-run' };
      } else if (prefs.offersMade === 1 && (prefs.status === 'none' || prefs.status === 'skipped')
                 && prefs.firstOfferActiveDay != null) {
        const activeDays = await countActiveDays(userId);
        if (activeDays >= prefs.firstOfferActiveDay + 3) offer = { show: true, kind: 're-nudge' };
      }
    }
  }

  return { held, ghostSlots: Math.max(0, MAX_FOLLOWS - held.length), principleTieIn, offer };
}
