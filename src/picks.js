// src/picks.js — Phase 17: Tomorrow's Call (daily S&P green/red prediction).
//
// The purest open loop available: today's tap is resolved by tomorrow's
// open. It's also a stealth lesson — a kid's hit rate converging on a coin
// flip teaches Principles 6 and 7 better than any paragraph.
//
// Lifecycle:
//   pick    — POST /api/picks (server.js). digest_date = today's digest
//             (provenance only); target_date = getNextTradingOpen(now) —
//             the BLIND-PICK rule: the next trading day whose 9:30 AM ET
//             open is still in the future at pick time (server clock). A
//             pick made after Tuesday's open targets Wednesday, so an
//             evening player can't bet on a close they can look up. The
//             UNIQUE constraint on (user_id, kind, target_date) means ONE
//             BET PER MARKET CLOSE — which also closes the Sat+Sun
//             double-bet on Monday. The server recomputes the target
//             authoritatively at POST time; if the page rendered at 9:29
//             and the tap landed at 9:31, the server's target wins and the
//             response tells the client the real day.
//   resolve — resolveTomorrowCalls(), called from generateDigest() inside
//             an isolated try/catch: a resolution failure must NEVER block
//             or break digest generation. Runs on BOTH the fresh and the
//             cached-replay generation paths (a redeploy/bootstrap still
//             resolves picks) and fetches its own single ^GSPC quote — at
//             7 AM pre-open, the quote's change% IS the last trading day's
//             close-over-close move. Resolution is FACTUAL FMP data, not
//             Claude's marketVibe (which can be 'mixed'; the bet is
//             binary). changePct >= 0 resolves green ("didn't fall") —
//             flat days are vanishingly rare, decision recorded in
//             HANDOFF.
//   verdict — rendered per-request at the top of the prediction card from
//             user_picks.outcome (src/template.js); nothing personalized
//             ever enters the immutable daily_digests row.
//
// Idempotency: each row is CLAIMED atomically (`UPDATE … WHERE resolved_at
// IS NULL`); MC is awarded only for rows actually claimed, and
// engagement.js's prediction-resolved dedup (per targetDate) backstops the
// event log. Award: +5 MC correct, 0 incorrect — both outcomes log so the
// kid's running record advances either way.

import { query } from './db.js';
import {
  getNextTradingOpen, getLastTradingDay,
  getFirstTradingDayOfWeek, getLastTradingDayOfWeek, isWeeklyHoldOpen,
  weeklyHoldBasis,
} from './calendar.js';
import { fetchQuotes } from './data.js';
import { lookupCompany } from './companies.js';
import { recordEvent } from './engagement.js';

const KIND = 'tomorrow-call';
const KIND_WH = 'weekly-hold';

/**
 * pg returns DATE columns as JS Date objects (UTC-midnight) — naive
 * String(date) yields "Tue Jun 16 …", which broke target matching in the
 * first live round-trip. Same normalization as engagement.js's
 * dateColToString.
 */
function dateColToString(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  if (v instanceof Date) {
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, '0');
    const d = String(v.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(v);
}

// ---- Target labelling (shared by the card render + the POST response) -------

/** 'today' when the target is the current NY date, else the weekday name. */
export function targetLabelFor(targetDate, nyToday) {
  if (!targetDate) return '';
  if (targetDate === nyToday) return 'today';
  return 'on ' + new Date(targetDate + 'T12:00:00Z')
    .toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' });
}

/**
 * The card's permanent sub-caption kind — what makes the blind-pick rule
 * feel like a rule instead of a bug:
 *   'pre-open'  → target is today (market hasn't opened yet)
 *   'post-open' → today is a trading day but its open passed → calling a
 *                 future day
 *   'closed'    → weekend/holiday → calling the next session
 */
export function captionKindFor(targetDate, nyToday, todayIsTradingDay) {
  if (targetDate === nyToday) return 'pre-open';
  return todayIsTradingDay ? 'post-open' : 'closed';
}

// ---- Picking ---------------------------------------------------------------

/**
 * Insert a pick. The target is recomputed HERE, authoritatively, from the
 * server clock (`now` injectable for tests) — never trusted from the
 * client. Returns { inserted, targetDate }; inserted=false → the kid
 * already has a bet on that market close (UNIQUE conflict — including a
 * Sunday tap after a Saturday pick, both targeting Monday).
 */
export async function createPick(userId, digestDate, choice, now = new Date()) {
  const targetDate = getNextTradingOpen(now);
  if (!targetDate) throw new Error(`No trading day within 14 days of ${digestDate}?!`);
  const { rows } = await query(
    `INSERT INTO user_picks (user_id, kind, digest_date, target_date, pick)
     VALUES ($1, $2, $3::date, $4::date, $5::jsonb)
     ON CONFLICT (user_id, kind, target_date) DO NOTHING
     RETURNING id`,
    [userId, KIND, digestDate, targetDate, JSON.stringify({ choice })],
  );
  return { inserted: rows.length > 0, targetDate };
}

/**
 * Everything the prediction card needs for one kid, in one call:
 *   currentPick — 'green' | 'red' | null: the kid's bet on the CURRENT
 *                 target (keyed by target_date, so Sunday's card shows
 *                 Saturday's Monday-bet as locked instead of 409ing a tap)
 *   targetDate / targetLabel — the live blind-pick target at render time
 *                 (the POST recomputes; a 9:29→9:31 race resolves to the
 *                 server's answer)
 *   caption     — 'pre-open' | 'post-open' | 'closed' (the sub-caption)
 *   record      — { correct, total } across all resolved picks (null if 0)
 *   verdict     — the pick that resolved against the LAST trading day
 *                 ({ choice, correct, actual, changePct }) or null. Keyed
 *                 to the last trading day so it ages out naturally.
 */
export async function getPickState(userId, digestDate, now = new Date()) {
  const targetDate = getNextTradingOpen(now);
  const lastTrading = getLastTradingDay(new Date(digestDate + 'T12:00:00Z'));

  const [currentRes, recordRes, verdictRes] = await Promise.all([
    targetDate
      ? query(
          `SELECT pick->>'choice' AS choice FROM user_picks
            WHERE user_id = $1 AND kind = $2 AND target_date = $3::date`,
          [userId, KIND, targetDate],
        )
      : Promise.resolve({ rows: [] }),
    query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE (outcome->>'correct')::boolean)::int AS correct
         FROM user_picks
        WHERE user_id = $1 AND kind = $2 AND resolved_at IS NOT NULL`,
      [userId, KIND],
    ),
    lastTrading
      ? query(
          `SELECT pick->>'choice' AS choice, outcome
             FROM user_picks
            WHERE user_id = $1 AND kind = $2 AND target_date = $3::date
              AND resolved_at IS NOT NULL`,
          [userId, KIND, lastTrading],
        )
      : Promise.resolve({ rows: [] }),
  ]);

  const rec = recordRes.rows[0];
  const verdictRow = verdictRes.rows[0];
  // "Is today a trading day at all?" drives the closed-vs-post-open caption.
  const todayIsTradingDay = getLastTradingDay(
    new Date(new Date(digestDate + 'T12:00:00Z').getTime() + 86400_000),
  ) === digestDate;

  return {
    currentPick: currentRes.rows[0]?.choice || null,
    targetDate,
    targetLabel: targetLabelFor(targetDate, digestDate),
    caption: captionKindFor(targetDate, digestDate, todayIsTradingDay),
    record: rec && rec.total > 0 ? { correct: rec.correct, total: rec.total } : null,
    verdict: verdictRow
      ? {
          choice: verdictRow.choice,
          correct: verdictRow.outcome?.correct === true,
          actual: verdictRow.outcome?.actual,
          changePct: verdictRow.outcome?.changePct,
        }
      : null,
  };
}

// ---- Resolution ------------------------------------------------------------

/**
 * Longest current run of consecutive correct picks, walked backward from
 * the most recent resolved one. Updates the best-prediction-streak
 * personal record when beaten (GREATEST keeps the existing best).
 */
async function updateBestPredictionStreak(userId, todayStr) {
  const { rows } = await query(
    `SELECT (outcome->>'correct')::boolean AS correct
       FROM user_picks
      WHERE user_id = $1 AND kind = $2 AND resolved_at IS NOT NULL
      ORDER BY target_date DESC
      LIMIT 100`,
    [userId, KIND],
  );
  let run = 0;
  for (const r of rows) {
    if (r.correct) run++;
    else break;
  }
  if (run === 0) return;
  await query(
    `INSERT INTO personal_records (user_id, record_key, value, achieved_at)
     VALUES ($1, 'best-prediction-streak', $2, $3::date)
     ON CONFLICT (user_id, record_key) DO UPDATE
       SET value = GREATEST(personal_records.value, EXCLUDED.value),
           achieved_at = CASE WHEN EXCLUDED.value > personal_records.value
                              THEN EXCLUDED.achieved_at
                              ELSE personal_records.achieved_at END,
           updated_at = NOW()`,
    [userId, run, todayStr],
  );
}

/**
 * Resolve one batch of unresolved tomorrow-call rows for `targetDate`
 * against `changePct` (the actual close-over-close move). Exported
 * separately from the sweep so the smoke test can drive it with an
 * injected value — no FMP needed.
 *
 * Returns { resolved, correct, mcAwarded }.
 */
export async function resolvePicksForDate(targetDate, changePct, todayStr) {
  const actual = changePct >= 0 ? 'green' : 'red'; // flat day counts green ("didn't fall")
  const { rows } = await query(
    `SELECT id, user_id, digest_date, pick->>'choice' AS choice
       FROM user_picks
      WHERE kind = $1 AND target_date = $2::date AND resolved_at IS NULL`,
    [KIND, targetDate],
  );

  let resolved = 0, correctCount = 0, mcAwarded = 0;
  for (const row of rows) {
    const correct = row.choice === actual;
    const outcome = { correct, actual, changePct: Number(changePct.toFixed(2)) };
    try {
      // Atomic claim — the WHERE resolved_at IS NULL makes re-runs (and
      // racing containers) award each pick exactly once.
      const claim = await query(
        `UPDATE user_picks
            SET resolved_at = NOW(), outcome = $2::jsonb
          WHERE id = $1 AND resolved_at IS NULL
          RETURNING id`,
        [row.id, JSON.stringify(outcome)],
      );
      if (claim.rows.length === 0) continue; // another run got it

      resolved++;
      if (correct) correctCount++;
      const result = await recordEvent(row.user_id, 'prediction-resolved', {
        digestDate: todayStr,                       // the day the verdict lands
        pickDigestDate: dateColToString(row.digest_date),
        targetDate,
        choice: row.choice,
        correct,
        actual,
        changePct: outcome.changePct,
      });
      mcAwarded += result?.mcAwarded || 0;
      await updateBestPredictionStreak(row.user_id, todayStr);
    } catch (err) {
      // Per-row isolation: one kid's hiccup never blocks the rest.
      console.error(`[picks] resolution failed for pick ${row.id} (user ${row.user_id}):`, err.message);
    }
  }
  return { resolved, correct: correctCount, mcAwarded };
}

/**
 * The 7 AM sweep. Self-contained: fetches its own single ^GSPC quote (at
 * pre-open, its change% is the last trading day's close), resolves every
 * unresolved pick targeting that day, then best-effort handles stragglers
 * (target_date older than the last trading day — only possible after a
 * skipped generation day) via FMP's historical EOD endpoint, fail-soft.
 *
 * NEVER throws — the caller (generateDigest) treats this as fire-and-
 * forget; the digest ships no matter what happens here.
 */
export async function resolveTomorrowCalls(todayStr) {
  try {
    const lastTrading = getLastTradingDay(new Date(todayStr + 'T12:00:00Z'));
    if (!lastTrading) return { ok: false, error: 'no last trading day?' };

    // Anything to do at all? (Skips the FMP call on pick-less days.)
    const { rows: pending } = await query(
      `SELECT DISTINCT target_date FROM user_picks
        WHERE kind = $1 AND resolved_at IS NULL AND target_date <= $2::date`,
      [KIND, lastTrading],
    );
    if (pending.length === 0) return { ok: true, resolved: 0 };

    const apiKey = process.env.FMP_API_KEY;
    if (!apiKey) return { ok: false, error: 'FMP_API_KEY not set' };

    let totalResolved = 0, totalCorrect = 0;

    // Primary: the last trading day, from a live quote.
    const wantsLastTrading = pending.some(p => dateColToString(p.target_date) === lastTrading);
    if (wantsLastTrading) {
      const quotes = await fetchQuotes(['^GSPC'], apiKey);
      const q = quotes['^GSPC'];
      if (typeof q?.changesPercentage === 'number') {
        const r = await resolvePicksForDate(lastTrading, q.changesPercentage, todayStr);
        totalResolved += r.resolved;
        totalCorrect += r.correct;
      } else {
        console.warn('[picks] ^GSPC quote unavailable — leaving today\'s picks unresolved (retried next generation).');
      }
    }

    // Stragglers: older target dates (a generation-skip day). Best-effort
    // historical close-over-close; any failure just leaves them pending.
    for (const p of pending) {
      const target = dateColToString(p.target_date);
      if (target === lastTrading) continue;
      try {
        const pct = await fetchHistoricalChangePct(target, apiKey);
        if (typeof pct === 'number') {
          const r = await resolvePicksForDate(target, pct, todayStr);
          totalResolved += r.resolved;
          totalCorrect += r.correct;
        }
      } catch (err) {
        console.warn(`[picks] straggler resolution for ${target} failed (left pending):`, err.message);
      }
    }

    if (totalResolved > 0) {
      console.log(`[picks] resolved ${totalResolved} Tomorrow's Call pick(s) — ${totalCorrect} correct`);
    }
    return { ok: true, resolved: totalResolved, correct: totalCorrect };
  } catch (err) {
    console.error('[picks] resolution sweep failed (digest generation unaffected):', err.message);
    return { ok: false, error: err.message };
  }
}

// ============================================================
// Phase 20a — Weekly Hold (kind 'weekly-hold')
// ============================================================
// Pick one of 3 server-picked curated companies Monday; hold it the week.
// target_date = the week's LAST trading day (the pick's week key — the
// UNIQUE (user_id, kind, target_date) constraint is the one-per-week
// dedup). Resolution: each candidate's first-trading-day-OPEN →
// last-trading-day-CLOSE return; the pick wins (+20) only if it beats BOTH
// others (strict), else +5. Same isolation as Tomorrow's Call.

/**
 * Insert a Weekly Hold pick. Gated by isWeeklyHoldOpen(now) — the blind-
 * pick rule: locks at the week's first trading day open. `ticker` must be
 * one of `candidates` (the digest's server-baked 3). Returns
 * { inserted, targetDate, open } — open=false means the picking window
 * already closed (no insert attempted).
 */
export async function createWeeklyHoldPick(userId, digestDate, ticker, candidates, now = new Date()) {
  // The active-week basis: shifts a Sunday digest forward to the upcoming
  // Monday so the target_date (the one-per-week dedup key) and the open
  // gate both key off the SAME week the candidates belong to. Critically
  // this lives HERE, not just in the view — a Sunday pick and a Monday pick
  // compute the identical target_date, so UNIQUE(user_id,kind,target_date)
  // makes the second a no-op (no double-pick across the two editions).
  const basis = weeklyHoldBasis(digestDate);
  const open = isWeeklyHoldOpen(now, basis);
  if (!open) return { inserted: false, open: false, targetDate: getLastTradingDayOfWeek(basis) };
  const tickers = (candidates || []).map(c => c.ticker);
  if (!tickers.includes(ticker)) {
    return { inserted: false, open: true, invalid: true, targetDate: getLastTradingDayOfWeek(basis) };
  }
  const targetDate = getLastTradingDayOfWeek(basis);
  if (!targetDate) throw new Error(`No trading day in the week of ${digestDate}?!`);
  const { rows } = await query(
    `INSERT INTO user_picks (user_id, kind, digest_date, target_date, pick)
     VALUES ($1, $2, $3::date, $4::date, $5::jsonb)
     ON CONFLICT (user_id, kind, target_date) DO NOTHING
     RETURNING id`,
    [userId, KIND_WH, digestDate, targetDate, JSON.stringify({ chosen: ticker, candidates: tickers })],
  );
  return { inserted: rows.length > 0, open: true, targetDate };
}

/**
 * The Weekly Hold card model for one kid, given the digest's content
 * (candidates live on week-ahead AND Sunday weekly-wrap rows) and edition.
 * Phases:
 *   'verdict' — the week resolved; show all 3 returns + win flag.
 *   'locked'  — kid picked, week not yet resolved.
 *   'pick'    — week-ahead OR Sunday weekly-wrap, candidates present, window open.
 *   'closed'  — same editions, candidates present, window passed (no pick).
 *   null      — nothing to show (incl. a kid who never picked → no error).
 */
export async function getWeeklyHoldState(userId, digestDate, content = {}, now = new Date()) {
  // Active-week basis (Sunday → upcoming Monday) so Sunday's weekly-wrap
  // looks up the SAME week a Sunday/Monday pick writes to. Consequence:
  // Sunday no longer surfaces the just-resolved week's verdict — that shows
  // Saturday (results), and Sunday's "Your Week in Juice" recap covers the
  // MC. Saturday = results, Sunday = reflect + pick ahead.
  const basis = weeklyHoldBasis(digestDate);
  const targetDate = getLastTradingDayOfWeek(basis);
  if (!targetDate) return null;

  const { rows } = await query(
    `SELECT pick, outcome, resolved_at IS NOT NULL AS resolved
       FROM user_picks
      WHERE user_id = $1 AND kind = $2 AND target_date = $3::date`,
    [userId, KIND_WH, targetDate],
  );
  const row = rows[0];
  const editionType = content.editionType;
  const candidates = content.weeklyHold?.candidates || null;

  if (row && row.resolved && row.outcome) {
    const o = row.outcome;
    return {
      phase: 'verdict',
      chosen: o.chosen,
      verdict: {
        chosen: o.chosen,
        chosenName: o.chosenName,
        win: o.win === true,
        returns: Array.isArray(o.returns) ? o.returns : [],
      },
    };
  }
  if (row) {
    // Picked, awaiting the week's close.
    return {
      phase: 'locked',
      chosen: row.pick?.chosen || null,
      candidates: candidates || (row.pick?.candidates || []).map(t => ({ ticker: t, name: t })),
    };
  }
  if ((editionType === 'week-ahead' || editionType === 'weekly-wrap') && candidates) {
    return { phase: isWeeklyHoldOpen(now, basis) ? 'pick' : 'closed', chosen: null, candidates };
  }
  return null;
}

/**
 * Resolve a batch of unresolved weekly-hold rows for one `targetDate`
 * (the week's last trading day) against `returnsByTicker` (pct per
 * candidate). Exported so the smoke test can inject returns — no FMP.
 * Win = chosen's return strictly beats BOTH others. Returns
 * { resolved, won, mcAwarded }.
 */
export async function resolveWeeklyHoldsForTarget(targetDate, returnsByTicker, todayStr) {
  const { rows } = await query(
    `SELECT id, user_id, pick FROM user_picks
      WHERE kind = $1 AND target_date = $2::date AND resolved_at IS NULL`,
    [KIND_WH, targetDate],
  );
  let resolved = 0, won = 0, mcAwarded = 0;
  for (const row of rows) {
    try {
      const chosen = row.pick?.chosen;
      const cands = row.pick?.candidates || [];
      // All three returns, in candidate order, with display names.
      const returns = cands.map(t => ({ ticker: t, pct: round2(returnsByTicker[t]) }));
      const chosenPct = returnsByTicker[chosen];
      const others = cands.filter(t => t !== chosen).map(t => returnsByTicker[t]);
      const win = typeof chosenPct === 'number'
        && others.every(p => typeof p === 'number' && chosenPct > p);
      const outcome = {
        chosen,
        chosenName: cands.length ? undefined : undefined, // filled below from lookup
        chosenPct: round2(chosenPct),
        returns,
        win,
      };
      // Attach display names from the curated list.
      outcome.returns = returns.map(r => ({ ...r, name: nameFor(r.ticker) }));
      outcome.chosenName = nameFor(chosen);

      const claim = await query(
        `UPDATE user_picks SET resolved_at = NOW(), outcome = $2::jsonb
          WHERE id = $1 AND resolved_at IS NULL RETURNING id`,
        [row.id, JSON.stringify(outcome)],
      );
      if (claim.rows.length === 0) continue;

      resolved++;
      if (win) won++;
      const result = await recordEvent(row.user_id, 'weekly-hold-resolved', {
        digestDate: todayStr,
        targetDate,
        chosen,
        win,
        chosenPct: outcome.chosenPct,
      });
      mcAwarded += result?.mcAwarded || 0;
    } catch (err) {
      console.error(`[weekly-hold] resolution failed for pick ${row.id} (user ${row.user_id}):`, err.message);
    }
  }
  return { resolved, won, mcAwarded };
}

/**
 * The Saturday sweep. Self-contained, NEVER throws (a failure can never
 * block the digest), runs on every generation path. Finds unresolved
 * weekly-hold rows whose week has closed (target_date ≤ the last trading
 * day available), fetches each candidate's first-open→last-close return
 * from FMP OHLC, and resolves. Mirrors resolveTomorrowCalls's isolation.
 */
export async function resolveWeeklyHolds(todayStr) {
  try {
    const lastTrading = getLastTradingDay(new Date(todayStr + 'T12:00:00Z'));
    if (!lastTrading) return { ok: false, error: 'no last trading day?' };

    const { rows: pending } = await query(
      `SELECT DISTINCT target_date FROM user_picks
        WHERE kind = $1 AND resolved_at IS NULL AND target_date <= $2::date`,
      [KIND_WH, lastTrading],
    );
    if (pending.length === 0) return { ok: true, resolved: 0 };

    const apiKey = process.env.FMP_API_KEY;
    if (!apiKey) return { ok: false, error: 'FMP_API_KEY not set' };

    let totalResolved = 0, totalWon = 0;
    for (const p of pending) {
      const target = dateColToString(p.target_date);
      const firstDay = getFirstTradingDayOfWeek(new Date(target + 'T12:00:00Z'));
      if (!firstDay) continue;
      try {
        // The 3 candidate tickers for the rows targeting this week.
        const { rows: tickerRows } = await query(
          `SELECT DISTINCT jsonb_array_elements_text(pick->'candidates') AS ticker
             FROM user_picks
            WHERE kind = $1 AND target_date = $2::date AND resolved_at IS NULL`,
          [KIND_WH, target],
        );
        const tickers = tickerRows.map(r => r.ticker);
        const returnsByTicker = {};
        for (const t of tickers) {
          returnsByTicker[t] = await fetchWeeklyOHLCReturn(t, firstDay, target, apiKey);
        }
        // Only resolve when we have all candidate returns — a missing
        // quote leaves the week pending for the next generation retry.
        if (tickers.some(t => typeof returnsByTicker[t] !== 'number')) {
          console.warn(`[weekly-hold] incomplete OHLC for week ${target} (${JSON.stringify(returnsByTicker)}) — left pending`);
          continue;
        }
        const r = await resolveWeeklyHoldsForTarget(target, returnsByTicker, todayStr);
        totalResolved += r.resolved;
        totalWon += r.won;
      } catch (err) {
        console.warn(`[weekly-hold] resolution for week ${target} failed (left pending):`, err.message);
      }
    }
    if (totalResolved > 0) {
      console.log(`[weekly-hold] resolved ${totalResolved} pick(s) — ${totalWon} won`);
    }
    return { ok: true, resolved: totalResolved, won: totalWon };
  } catch (err) {
    console.error('[weekly-hold] resolution sweep failed (digest generation unaffected):', err.message);
    return { ok: false, error: err.message };
  }
}

const round2 = (n) => (typeof n === 'number' ? Number(n.toFixed(2)) : n);

/** Display name from the curated list (fallback to the ticker). */
function nameFor(ticker) {
  return lookupCompany(ticker)?.name || ticker;
}

/**
 * One ticker's first-trading-day-OPEN → last-trading-day-CLOSE % return
 * for the week, via FMP /stable full OHLC EOD. Returns a number or null.
 */
async function fetchWeeklyOHLCReturn(ticker, firstDay, lastDay, apiKey) {
  const url = `https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${encodeURIComponent(ticker)}&from=${firstDay}&to=${lastDay}&apikey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OHLC HTTP ${res.status} for ${ticker}`);
  const data = await res.json();
  const arr = Array.isArray(data) ? data : (Array.isArray(data?.historical) ? data.historical : null);
  if (!arr || !arr.length) return null;
  const byDate = Object.fromEntries(arr.map(d => [d.date, d]));
  const first = byDate[firstDay], last = byDate[lastDay];
  const open = first?.open, close = last?.close;
  if (typeof open !== 'number' || typeof close !== 'number' || open === 0) return null;
  return ((close - open) / open) * 100;
}

/** ^GSPC close-over-close % for a specific past date, via FMP /stable EOD. */
async function fetchHistoricalChangePct(dateStr, apiKey) {
  const from = new Date(new Date(dateStr + 'T12:00:00Z').getTime() - 7 * 86400_000)
    .toISOString().slice(0, 10);
  const url = `https://financialmodelingprep.com/stable/historical-price-eod/light?symbol=%5EGSPC&from=${from}&to=${dateStr}&apikey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`historical EOD HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || data.length < 2) return null;
  const sorted = data.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  const target = sorted.findIndex(d => d.date === dateStr);
  if (target < 1) return null;
  const close = sorted[target].price ?? sorted[target].close;
  const prev = sorted[target - 1].price ?? sorted[target - 1].close;
  if (typeof close !== 'number' || typeof prev !== 'number' || prev === 0) return null;
  return ((close - prev) / prev) * 100;
}
