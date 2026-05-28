/**
 * src/admin.js — Phase 13 lightweight admin dashboard.
 *
 * A single server-rendered page (GET /admin, gated by ADMIN_KEY) showing
 * live product health: signups, DAU/WAU/MAU, streaks, rank distribution,
 * game popularity, game-scenario rotation health, recent signups, and email
 * deliverability pulled from the email_events webhook table.
 *
 * No frameworks, no chart libraries — inline CSS + CSS/SVG bars only. Every
 * page load runs fresh queries (no cache); at prelaunch scale that's fine.
 *
 * Public surface:
 *   gatherAdminData()              → one object with every section's data
 *   buildAdminHTML(data, adminKey) → the full HTML document (string)
 *
 * Notes / deviations from the Phase 13 spec (followed the codebase per the
 * spec's own "follow the existing codebase and flag" instruction):
 *   - This module is ESM (the project is "type":"module"); the spec's
 *     CommonJS require()/module.exports would not load here.
 *   - "Today" / time windows are evaluated in America/New_York, the product's
 *     canonical day boundary (engagement.js uses NY everywhere). The spec's
 *     raw CURRENT_DATE would bucket by the DB session's UTC day on Neon and
 *     mis-state "today" for ~4-5 evening hours ET.
 *   - Scenario rotation is computed with the REAL games.js logic
 *     (dayIndex = floor(epochMs/86400000); pickScenario offset =
 *     (dayIndex + hashString(gameType)) % count), not the spec's
 *     2026-01-01 epoch + bare `dayIndex % count`. company-models.json is
 *     reshuffled daily (stableShuffle) rather than linearly rotated, so it's
 *     reported as "randomized daily" and alerted on raw count vs target.
 *   - Each section getter is individually fault-tolerant: a single failing
 *     query (e.g. email_events missing before its migration runs) degrades
 *     that one card instead of 500-ing the whole page.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from './db.js';
import { RANKS } from './progression.js';
import { todayNY } from './digest-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');

// NY-day SQL fragments. We bucket on America/New_York so "today" matches the
// boundary engagement.js uses. `created_at` is TIMESTAMPTZ, so AT TIME ZONE
// converts the instant to NY wall-clock before truncating to a date.
const NY_TODAY = `(NOW() AT TIME ZONE 'America/New_York')::date`;
const NY_DATE = (col) => `(${col} AT TIME ZONE 'America/New_York')::date`;

// Game datasets surfaced in the Scenario Health table. Adding a new game is
// just another entry here (the game-popularity table picks new games up
// automatically once kids play them). `gameType` ties a dataset to the
// games.js rotation key so we can compute the real rotation position;
// `randomized:true` marks pools that games.js reshuffles daily instead of
// rotating (company-models → match + price-is-right), where a linear
// "position" is meaningless.
const GAME_DATASETS = [
  { game: 'Time Machine', file: 'public/data/time-machine-prices.json', target: 30, gameType: 'time-machine' },
  { game: 'Historical Charts (Bull or Bear)', file: 'public/data/historical-charts.json', target: 30, gameType: 'bull-bear', note: 'Planned for removal — replacing with What Happened Next' },
  { game: 'Company Models (Match + Price is Right)', file: 'public/data/company-models.json', target: 30, randomized: true },
  // Future games — just add entries here:
  // { game: 'What Happened Next', file: 'public/data/what-happened-next.json', target: 30, gameType: 'what-happened-next' },
];

// ---- games.js rotation replica ----------------------------------------
// Kept byte-for-byte equivalent to src/games.js so the reported scenario
// matches what kids actually see. If games.js changes its rotation math,
// change this too.
function dayIndexFromDate(yyyymmdd) {
  const d = new Date(yyyymmdd + 'T12:00:00Z');
  return Math.floor(d.getTime() / 86400000);
}
function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// ============================================================
// Data gathering
// ============================================================

export async function gatherAdminData() {
  const [
    userStats,
    engagementStats,
    scenarioStats,
    recentSignups,
    emailStats,
    rankDistribution,
    gamePopularity,
  ] = await Promise.all([
    getUserStats(),
    getEngagementStats(),
    getScenarioStats(),
    getRecentSignups(),
    getEmailStats(),
    getRankDistribution(),
    getGamePopularity(),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    userStats,
    engagementStats,
    scenarioStats,
    recentSignups,
    emailStats,
    rankDistribution,
    gamePopularity,
  };
}

async function getUserStats() {
  try {
    const { rows } = await query(`
      SELECT
        COUNT(*) FILTER (WHERE deleted_at IS NULL)::int AS total,
        COUNT(*) FILTER (WHERE is_active = TRUE AND deleted_at IS NULL)::int AS verified,
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND ${NY_DATE('created_at')} = ${NY_TODAY})::int AS today,
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND (created_at AT TIME ZONE 'America/New_York') >= date_trunc('week', NOW() AT TIME ZONE 'America/New_York'))::int AS this_week,
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND (created_at AT TIME ZONE 'America/New_York') >= date_trunc('month', NOW() AT TIME ZONE 'America/New_York'))::int AS this_month
      FROM users
    `);
    const delRes = await query(`SELECT COUNT(*)::int AS deletions FROM deletion_requests`);
    const r = rows[0] || {};
    return {
      total: r.total || 0,
      verified: r.verified || 0,
      today: r.today || 0,
      thisWeek: r.this_week || 0,
      thisMonth: r.this_month || 0,
      deletions: delRes.rows[0]?.deletions || 0,
    };
  } catch (err) {
    console.error('[admin] getUserStats failed:', err.message);
    return { total: 0, verified: 0, today: 0, thisWeek: 0, thisMonth: 0, deletions: 0, _error: err.message };
  }
}

async function getEngagementStats() {
  const out = {
    dau: 0, wau: 0, mau: 0,
    avgGamesToday: 0, perfectDaysToday: 0, totalEventsToday: 0,
    activeStreaks: 0, avgStreak: 0,
  };
  try {
    // DAU/WAU/MAU — distinct users with a meaningful (non-duplicate) event.
    const active = await query(`
      SELECT
        COUNT(DISTINCT user_id) FILTER (WHERE ${NY_DATE('created_at')} = ${NY_TODAY})::int AS dau,
        COUNT(DISTINCT user_id) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS wau,
        COUNT(DISTINCT user_id) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS mau
      FROM engagement_events
      WHERE event_type IN ('game-completed', 'word-learned', 'sunday-challenge-completed')
        AND COALESCE((event_data->>'duplicate')::boolean, false) = false
        AND created_at >= NOW() - INTERVAL '30 days'
    `);
    out.dau = active.rows[0]?.dau || 0;
    out.wau = active.rows[0]?.wau || 0;
    out.mau = active.rows[0]?.mau || 0;

    // Today's activity detail.
    const today = await query(`
      SELECT
        (SELECT ROUND(AVG(cnt), 1) FROM (
           SELECT COUNT(*) AS cnt FROM engagement_events
            WHERE event_type = 'game-completed'
              AND COALESCE((event_data->>'duplicate')::boolean, false) = false
              AND ${NY_DATE('created_at')} = ${NY_TODAY}
            GROUP BY user_id
        ) g) AS avg_games_today,
        COUNT(DISTINCT user_id) FILTER (
          WHERE event_type = 'game-completed'
            AND COALESCE((event_data->>'perfectDay')::boolean, false) = true
        )::int AS perfect_days_today,
        COUNT(*)::int AS total_events_today
      FROM engagement_events
      WHERE ${NY_DATE('created_at')} = ${NY_TODAY}
    `);
    out.avgGamesToday = Number(today.rows[0]?.avg_games_today) || 0;
    out.perfectDaysToday = today.rows[0]?.perfect_days_today || 0;
    out.totalEventsToday = today.rows[0]?.total_events_today || 0;

    // Streaks (from the canonical user_progress rows).
    const streaks = await query(`
      SELECT
        COUNT(*) FILTER (WHERE current_streak >= 3)::int AS active_streaks,
        ROUND(AVG(current_streak) FILTER (WHERE current_streak > 0), 1) AS avg_streak
      FROM user_progress
    `);
    out.activeStreaks = streaks.rows[0]?.active_streaks || 0;
    out.avgStreak = Number(streaks.rows[0]?.avg_streak) || 0;
  } catch (err) {
    console.error('[admin] getEngagementStats failed:', err.message);
    out._error = err.message;
  }
  return out;
}

function getScenarioStats() {
  const dayIndex = dayIndexFromDate(todayNY());
  return GAME_DATASETS.map(d => {
    let count = 0;
    let readError = false;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, d.file), 'utf8'));
      count = Array.isArray(parsed) ? parsed.length : Object.keys(parsed).length;
    } catch (e) {
      readError = true;
    }

    if (readError || count === 0) {
      return {
        game: d.game, count: 0, target: d.target,
        randomized: !!d.randomized, position: null, daysUntilCycle: null,
        alert: true, note: d.note || null, readError,
      };
    }

    if (d.randomized) {
      // company-models is reshuffled daily — no linear position. Alert purely
      // on whether the pool is below the healthy target.
      return {
        game: d.game, count, target: d.target,
        randomized: true, position: null, daysUntilCycle: null,
        alert: count < d.target, note: d.note || null, readError: false,
      };
    }

    // Sequential rotation — replicate games.js pickScenario exactly.
    const position = ((dayIndex + hashString(d.gameType)) % count + count) % count;
    const daysUntilCycle = count - position;
    return {
      game: d.game, count, target: d.target,
      randomized: false, position, daysUntilCycle,
      alert: daysUntilCycle <= 5, note: d.note || null, readError: false,
    };
  });
}

async function getRecentSignups() {
  try {
    const { rows } = await query(`
      SELECT kid_first_name, kid_age, timezone, is_active, created_at
        FROM users
       WHERE deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT 10
    `);
    return rows;
  } catch (err) {
    console.error('[admin] getRecentSignups failed:', err.message);
    return [];
  }
}

async function getRankDistribution() {
  let counts = {};
  try {
    const { rows } = await query(`
      SELECT rank_key, COUNT(*)::int AS count
        FROM user_progress
       GROUP BY rank_key
    `);
    for (const r of rows) counts[r.rank_key] = r.count;
  } catch (err) {
    console.error('[admin] getRankDistribution failed:', err.message);
  }
  // Emit every rank in ladder order (including zero-count ranks) so the bar
  // chart shows where the base clusters and where it thins out.
  return RANKS.map(r => ({
    key: r.key,
    name: r.name,
    badge: r.badge,
    count: counts[r.key] || 0,
  }));
}

async function getGamePopularity() {
  try {
    const { rows } = await query(`
      SELECT
        event_data->>'game' AS game,
        COUNT(*)::int AS plays,
        COUNT(*) FILTER (WHERE event_data ? 'correct')::int AS scored,
        COUNT(*) FILTER (WHERE (event_data->>'correct')::boolean = TRUE)::int AS correct,
        ROUND(
          100.0 * COUNT(*) FILTER (WHERE (event_data->>'correct')::boolean = TRUE)
          / NULLIF(COUNT(*) FILTER (WHERE event_data ? 'correct'), 0),
          1
        ) AS correct_pct
      FROM engagement_events
      WHERE event_type = 'game-completed'
        AND COALESCE((event_data->>'duplicate')::boolean, false) = false
        AND created_at >= NOW() - INTERVAL '30 days'
        AND event_data->>'game' IS NOT NULL
      GROUP BY event_data->>'game'
      ORDER BY plays DESC
    `);
    return rows.map(r => ({
      game: r.game,
      plays: r.plays,
      scored: r.scored,
      correct: r.correct,
      correctPct: r.scored > 0 ? Number(r.correct_pct) : null,
    }));
  } catch (err) {
    console.error('[admin] getGamePopularity failed:', err.message);
    return [];
  }
}

async function getEmailStats() {
  const out = { byKind: [], today: { sent: 0, delivered: 0, opened: 0, bounced: 0 }, trend: [], available: false };
  try {
    const byKind = await query(`
      SELECT
        COALESCE(email_kind, '(untagged)') AS email_kind,
        COUNT(*) FILTER (WHERE event_type = 'email.sent')::int       AS sent,
        COUNT(*) FILTER (WHERE event_type = 'email.delivered')::int  AS delivered,
        COUNT(*) FILTER (WHERE event_type = 'email.opened')::int     AS opened,
        COUNT(*) FILTER (WHERE event_type = 'email.clicked')::int    AS clicked,
        COUNT(*) FILTER (WHERE event_type = 'email.bounced')::int    AS bounced,
        COUNT(*) FILTER (WHERE event_type = 'email.complained')::int AS complained
      FROM email_events
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY email_kind
      ORDER BY sent DESC, email_kind ASC
    `);
    out.byKind = byKind.rows.map(r => ({
      kind: r.email_kind,
      sent: r.sent, delivered: r.delivered, opened: r.opened,
      clicked: r.clicked, bounced: r.bounced, complained: r.complained,
      // Open rate = opened / delivered (bounced mail can't be opened).
      openRate: r.delivered > 0 ? Math.round((r.opened / r.delivered) * 1000) / 10 : null,
    }));

    const today = await query(`
      SELECT
        COUNT(*) FILTER (WHERE event_type = 'email.sent')::int      AS sent,
        COUNT(*) FILTER (WHERE event_type = 'email.delivered')::int AS delivered,
        COUNT(*) FILTER (WHERE event_type = 'email.opened')::int    AS opened,
        COUNT(*) FILTER (WHERE event_type = 'email.bounced')::int   AS bounced
      FROM email_events
      WHERE ${NY_DATE('created_at')} = ${NY_TODAY}
    `);
    out.today = {
      sent: today.rows[0]?.sent || 0,
      delivered: today.rows[0]?.delivered || 0,
      opened: today.rows[0]?.opened || 0,
      bounced: today.rows[0]?.bounced || 0,
    };

    const trend = await query(`
      SELECT
        to_char(${NY_DATE('created_at')}, 'YYYY-MM-DD') AS day,
        COUNT(*) FILTER (WHERE event_type = 'email.delivered')::int AS delivered,
        COUNT(*) FILTER (WHERE event_type = 'email.opened')::int    AS opened
      FROM email_events
      WHERE created_at >= NOW() - INTERVAL '7 days'
      GROUP BY ${NY_DATE('created_at')}
      ORDER BY ${NY_DATE('created_at')} DESC
    `);
    out.trend = trend.rows.map(r => ({
      day: r.day,
      delivered: r.delivered,
      opened: r.opened,
      openRate: r.delivered > 0 ? Math.round((r.opened / r.delivered) * 100) : 0,
    }));
    out.available = true;
  } catch (err) {
    // email_events table not created yet (migration pending) or query error —
    // the card renders an empty-state instead of blanking the whole page.
    console.error('[admin] getEmailStats failed:', err.message);
    out._error = err.message;
  }
  return out;
}

// ============================================================
// HTML
// ============================================================

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
}

function fmtTimestamp(iso) {
  try {
    return new Date(iso).toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    }) + ' ET';
  } catch (_) {
    return String(iso);
  }
}

function fmtSignupDate(v) {
  try {
    return new Date(v).toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch (_) {
    return String(v);
  }
}

const C = {
  bg: '#0f1117', card: '#1a1d27', text: '#e4e4e7', num: '#ffffff',
  alert: '#ef4444', good: '#22c55e', muted: '#6b7280', accent: '#8b5cf6',
  border: '#262a36', alertBg: '#2a1416',
};

function metric(label, value) {
  return `<div class="metric"><div class="metric-val">${esc(value)}</div><div class="metric-label">${esc(label)}</div></div>`;
}

function buildUsersSection(u) {
  return `
    <section class="card">
      <h2>Users</h2>
      <div class="metrics">
        ${metric('Total signups', u.total)}
        ${metric('Verified', u.verified)}
        ${metric('Today', u.today)}
        ${metric('This week', u.thisWeek)}
        ${metric('This month', u.thisMonth)}
        ${metric('Deletions', u.deletions)}
      </div>
      ${u._error ? `<p class="err">Query error: ${esc(u._error)}</p>` : ''}
    </section>`;
}

function buildEngagementSection(e) {
  return `
    <section class="card">
      <h2>Engagement</h2>
      <div class="metrics">
        ${metric('DAU', e.dau)}
        ${metric('WAU', e.wau)}
        ${metric('MAU', e.mau)}
        ${metric('Avg games/user today', e.avgGamesToday)}
        ${metric('Perfect Days today', e.perfectDaysToday)}
        ${metric('Total events today', e.totalEventsToday)}
      </div>
      <p class="note">Active users counted from non-duplicate game / word / Sunday completions (excludes daily-visit + parent-question). Windows are America/New_York.</p>
      ${e._error ? `<p class="err">Query error: ${esc(e._error)}</p>` : ''}
    </section>`;
}

function buildStreaksSection(e) {
  return `
    <section class="card">
      <h2>Streaks</h2>
      <div class="metrics">
        ${metric('Active streaks (3+ days)', e.activeStreaks)}
        ${metric('Avg streak length', e.avgStreak + ' days')}
      </div>
    </section>`;
}

function buildRankSection(ranks) {
  const max = Math.max(1, ...ranks.map(r => r.count));
  const rows = ranks.map(r => {
    const pct = Math.round((r.count / max) * 100);
    return `
      <div class="bar-row">
        <div class="bar-label">${esc(r.badge)} ${esc(r.name)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%;"></div></div>
        <div class="bar-num">${r.count}</div>
      </div>`;
  }).join('');
  return `
    <section class="card">
      <h2>Rank Distribution</h2>
      <div class="bars">${rows}</div>
    </section>`;
}

function buildGamePopularitySection(games) {
  if (!games.length) {
    return `<section class="card"><h2>Game Popularity (30 days)</h2><p class="empty">No game plays recorded in the last 30 days yet.</p></section>`;
  }
  const rows = games.map(g => `
    <tr>
      <td>${esc(g.game)}</td>
      <td class="num">${g.plays}</td>
      <td class="num">${g.correctPct == null ? '—' : g.correctPct + '%'}</td>
    </tr>`).join('');
  return `
    <section class="card">
      <h2>Game Popularity (30 days)</h2>
      <table>
        <thead><tr><th>Game</th><th class="num">Plays</th><th class="num">Correct</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="note">Games without a right/wrong outcome (compound, time-machine) show — for correct rate.</p>
    </section>`;
}

function buildScenarioSection(scenarios) {
  const rows = scenarios.map(s => {
    const rotation = s.readError
      ? '<span class="bad">file unreadable</span>'
      : s.randomized
        ? 'Randomized daily'
        : `Scenario ${s.position + 1} / ${s.count}`;
    const days = s.randomized || s.position == null ? '—' : String(s.daysUntilCycle);
    let status;
    if (s.readError) status = '<span class="bad">⚠ FILE MISSING</span>';
    else if (s.alert && s.randomized) status = '<span class="bad">⚠ BELOW TARGET — ADD SCENARIOS</span>';
    else if (s.alert) status = '<span class="bad">⚠ LOW — ADD SCENARIOS</span>';
    else status = '<span class="ok">✓ Healthy</span>';
    return `
      <tr class="${s.alert ? 'alert-row' : ''}">
        <td>${esc(s.game)}${s.note ? `<div class="sub">${esc(s.note)}</div>` : ''}</td>
        <td class="num">${s.count}<span class="sub"> / ${s.target}</span></td>
        <td>${rotation}</td>
        <td class="num">${days}</td>
        <td>${status}</td>
      </tr>`;
  }).join('');
  return `
    <section class="card">
      <h2>Scenario Health</h2>
      <table>
        <thead><tr><th>Game</th><th class="num">Scenarios</th><th>Rotation</th><th class="num">Days to cycle</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="note">Rotation mirrors src/games.js (offset = (dayIndex + hash(gameType)) mod count). Company Models is reshuffled daily, so it has no linear position.</p>
    </section>`;
}

function buildRecentSignupsSection(signups) {
  if (!signups.length) {
    return `<section class="card"><h2>Recent Signups</h2><p class="empty">No signups yet.</p></section>`;
  }
  const rows = signups.map(s => `
    <tr>
      <td>${esc(s.kid_first_name)}</td>
      <td class="num">${esc(s.kid_age == null ? '—' : s.kid_age)}</td>
      <td>${esc(s.timezone || '—')}</td>
      <td>${s.is_active ? '<span class="ok">Yes</span>' : '<span class="muted">No</span>'}</td>
      <td>${esc(fmtSignupDate(s.created_at))}</td>
    </tr>`).join('');
  return `
    <section class="card">
      <h2>Recent Signups</h2>
      <table>
        <thead><tr><th>Name</th><th class="num">Age</th><th>Timezone</th><th>Verified</th><th>Signed up</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

function buildEmailSection(em) {
  if (!em.available && !em.byKind.length) {
    return `
      <section class="card">
        <h2>Email Analytics (30 days)</h2>
        <p class="empty">No email events yet. ${em._error ? 'The email_events table may not be created yet, or the Resend webhook is not configured.' : 'Once the Resend webhook starts delivering events, deliverability metrics will appear here.'}</p>
      </section>`;
  }

  const kindRows = em.byKind.map(k => {
    // verify / consent / add-child-consent / reset are transactional — open
    // tracking is misleading there, so show — when nothing was opened.
    const showRate = k.openRate != null && k.opened > 0;
    return `
      <tr>
        <td>${esc(k.kind)}</td>
        <td class="num">${k.sent}</td>
        <td class="num">${k.delivered}</td>
        <td class="num">${k.opened || '—'}</td>
        <td class="num">${showRate ? k.openRate + '%' : '—'}</td>
        <td class="num">${k.clicked || '—'}</td>
        <td class="num ${k.bounced ? 'bad' : ''}">${k.bounced}</td>
        <td class="num ${k.complained ? 'bad' : ''}">${k.complained}</td>
      </tr>`;
  }).join('');

  const t = em.today;
  const maxRate = Math.max(1, ...em.trend.map(d => d.openRate));
  const trendRows = em.trend.map(d => {
    const pct = Math.round((d.openRate / maxRate) * 100);
    return `
      <div class="bar-row">
        <div class="bar-label">${esc(fmtDay(d.day))}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%;"></div></div>
        <div class="bar-num">${d.openRate}%</div>
        <div class="bar-sub">delivered ${d.delivered}, opened ${d.opened}</div>
      </div>`;
  }).join('');

  return `
    <section class="card">
      <h2>Email Analytics (30 days)</h2>
      <table>
        <thead><tr><th>Type</th><th class="num">Sent</th><th class="num">Deliv.</th><th class="num">Opened</th><th class="num">Open %</th><th class="num">Clicked</th><th class="num">Bounced</th><th class="num">Spam</th></tr></thead>
        <tbody>${kindRows || '<tr><td colspan="8" class="empty">No events in the last 30 days.</td></tr>'}</tbody>
      </table>
      <p class="note">Open rate = opened / delivered. Transactional emails (verify, consent, reset) show — where open tracking isn't meaningful.</p>
      <div class="today-line">Today — Sent: <b>${t.sent}</b> · Delivered: <b>${t.delivered}</b> · Opened: <b>${t.opened}</b> · Bounced: <b class="${t.bounced ? 'bad' : ''}">${t.bounced}</b></div>
      ${em.trend.length ? `<h3>Daily open rate (last 7 days)</h3><div class="bars">${trendRows}</div>` : ''}
    </section>`;
}

function fmtDay(v) {
  try {
    return new Date(String(v).slice(0, 10) + 'T12:00:00Z')
      .toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
  } catch (_) {
    return String(v);
  }
}

export function buildAdminHTML(data, adminKey) {
  const keyParam = encodeURIComponent(adminKey || '');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="300">
<title>Market Juice — Admin</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: ${C.bg}; color: ${C.text};
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    font-size: 15px; line-height: 1.5; padding: 0 0 60px;
  }
  .wrap { max-width: 1000px; margin: 0 auto; padding: 20px 16px; }
  header.top {
    display: flex; align-items: center; justify-content: space-between;
    flex-wrap: wrap; gap: 12px; margin-bottom: 20px;
    border-bottom: 1px solid ${C.border}; padding-bottom: 16px;
  }
  header.top h1 {
    margin: 0; font-size: 18px; letter-spacing: 1px; font-weight: 700;
    color: ${C.num}; text-transform: uppercase;
  }
  header.top h1 span { color: ${C.accent}; }
  .refreshed { font-size: 12px; color: ${C.muted}; }
  a.refresh {
    display: inline-block; padding: 8px 16px; border-radius: 8px;
    background: ${C.accent}; color: #fff; text-decoration: none;
    font-size: 13px; font-weight: 600;
  }
  .card {
    background: ${C.card}; border: 1px solid ${C.border}; border-radius: 12px;
    padding: 18px 20px; margin-bottom: 16px;
  }
  .card h2 {
    margin: 0 0 14px; font-size: 12px; letter-spacing: 1.5px;
    text-transform: uppercase; color: ${C.accent}; font-weight: 700;
  }
  .card h3 {
    margin: 18px 0 10px; font-size: 11px; letter-spacing: 1px;
    text-transform: uppercase; color: ${C.muted}; font-weight: 700;
  }
  .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
  .metric { padding: 4px 0; }
  .metric-val {
    font-family: 'SF Mono', 'Menlo', 'Consolas', monospace;
    font-size: 26px; font-weight: 700; color: ${C.num};
  }
  .metric-label { font-size: 12px; color: ${C.muted}; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid ${C.border}; }
  th {
    font-size: 11px; letter-spacing: 0.5px; text-transform: uppercase;
    color: ${C.muted}; font-weight: 600;
  }
  td.num, th.num { text-align: right; font-family: 'SF Mono','Menlo','Consolas',monospace; }
  td .sub { color: ${C.muted}; font-size: 12px; }
  tr.alert-row td { background: ${C.alertBg}; }
  .bars { display: flex; flex-direction: column; gap: 8px; }
  .bar-row {
    display: grid; grid-template-columns: 160px 1fr 56px; align-items: center;
    gap: 10px; font-size: 13px;
  }
  .bar-row .bar-sub { grid-column: 2 / 4; font-size: 11px; color: ${C.muted}; margin-top: -4px; }
  .bar-label { color: ${C.text}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bar-track { background: ${C.bg}; border-radius: 6px; height: 16px; overflow: hidden; }
  .bar-fill { background: ${C.accent}; height: 100%; border-radius: 6px; min-width: 2px; }
  .bar-num { text-align: right; font-family: 'SF Mono','Menlo','Consolas',monospace; color: ${C.num}; }
  .ok { color: ${C.good}; font-weight: 600; }
  .bad { color: ${C.alert}; font-weight: 600; }
  .muted { color: ${C.muted}; }
  .note { font-size: 12px; color: ${C.muted}; margin: 12px 0 0; }
  .err { font-size: 12px; color: ${C.alert}; margin: 10px 0 0; }
  .empty { color: ${C.muted}; font-size: 14px; }
  .today-line { margin-top: 14px; font-size: 13px; color: ${C.text}; }
  .today-line b { color: ${C.num}; font-family: 'SF Mono','Menlo','Consolas',monospace; }
  footer { text-align: center; color: ${C.muted}; font-size: 12px; margin-top: 24px; }
  @media (max-width: 600px) {
    .metrics { grid-template-columns: repeat(2, 1fr); }
    .bar-row { grid-template-columns: 110px 1fr 44px; }
    table { font-size: 12px; }
    th, td { padding: 6px 6px; }
  }
</style>
</head>
<body>
  <div class="wrap">
    <header class="top">
      <div>
        <h1>Market <span>Juice</span> — Admin</h1>
        <div class="refreshed">Last refreshed: ${esc(fmtTimestamp(data.generatedAt))} · auto-refresh 5 min</div>
      </div>
      <a class="refresh" href="/admin?key=${keyParam}">Refresh ↻</a>
    </header>

    ${buildUsersSection(data.userStats)}
    ${buildEngagementSection(data.engagementStats)}
    ${buildStreaksSection(data.engagementStats)}
    ${buildRankSection(data.rankDistribution)}
    ${buildGamePopularitySection(data.gamePopularity)}
    ${buildScenarioSection(data.scenarioStats)}
    ${buildRecentSignupsSection(data.recentSignups)}
    ${buildEmailSection(data.emailStats)}

    <footer>Market Juice Admin · Phase 13 · Data is live, not cached</footer>
  </div>
</body>
</html>`;
}
