// src/progress-template.js — Phase 11
//
// Renders the /progress page. Server-side, same pattern as digest's
// buildHTML(): pure function, no DB access, no side effects.
//
// Input shape matches engagement.getProgress():
//   { progress: { marketCoins, currentStreak, ... rank: { key, name, badge } },
//     badges: { streak: { currentTier, progress, nextTierAt, unlockedAt }, ... },
//     records: { 'best-day-mc': { value, achievedAt }, ... },
//     nextRank: { key, name, badge, threshold, remaining } | null }
//
// Layout mirrors the spec (Part 7A): profile header, How MC Works explainer,
// rank ladder, badge collection grid, personal records, Emergency Fund.
//
// Design system matches the digest — Fredoka headings, Space Mono numerics,
// dark navy background, gold/purple/blue accent gradients. Styles inline so
// the page renders coherently even before /engagement.css loads.

import { RANKS, BADGE_FAMILIES, PERSONAL_RECORDS, SHIELD_CONFIG, shieldsUnlocked } from './progression.js';

export function buildProgressHTML(state, opts = {}) {
  const kidName = opts.kidName || 'Investor';
  const p = state.progress;
  const badges = state.badges || {};
  const records = state.records || {};
  const next = state.nextRank;

  // Profile header progress bar — % toward next rank within the current tier.
  const currentRankInfo = RANKS.find(r => r.key === p.rank.key) || RANKS[0];
  const span = next ? Math.max(1, next.threshold - currentRankInfo.threshold) : 1;
  const pctToNext = next
    ? Math.min(100, Math.max(0, ((p.marketCoins - currentRankInfo.threshold) / span) * 100))
    : 100;

  const shieldsAvailable = shieldsUnlocked(p.rank.key);
  const heldShields = p.streakShields || 0;
  const maxShields = SHIELD_CONFIG.maxShields;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHTML(kidName)}'s Progress — Market Juice</title>
<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --bg: #0d1117; --card: #161b22; --card-border: #21262d;
    --green: #3fb950; --red: #f85149; --blue: #58a6ff;
    --purple: #bc8cff; --yellow: #f0c040; --orange: #f0883e;
    --text: #c9d1d9; --text-bright: #f0f6fc; --text-dim: #8b949e;
  }
  body {
    background:
      radial-gradient(ellipse at 20% 0%, rgba(188,140,255,0.10), transparent 50%),
      radial-gradient(ellipse at 80% 100%, rgba(88,166,255,0.10), transparent 55%),
      var(--bg);
    color: var(--text);
    font-family: 'Fredoka', sans-serif;
    min-height: 100vh;
    padding: 28px 16px 60px;
  }
  .container { max-width: 720px; margin: 0 auto; }

  /* ---- Header ---- */
  .pg-header {
    text-align: center;
    margin-bottom: 28px;
  }
  .pg-back {
    display: inline-flex; align-items: center; gap: 6px;
    color: var(--text-dim);
    font-size: 13px;
    text-decoration: none;
    margin-bottom: 16px;
    font-family: 'Space Mono', monospace;
  }
  .pg-back:hover { color: var(--text-bright); }
  .pg-title {
    font-size: 28px; font-weight: 700; color: var(--text-bright);
    letter-spacing: -0.5px;
    margin-bottom: 4px;
  }
  .pg-subtitle {
    font-size: 13px; color: var(--text-dim);
    font-family: 'Space Mono', monospace; letter-spacing: 1px;
    text-transform: uppercase;
  }

  /* ---- Profile card ---- */
  .pg-profile {
    background: linear-gradient(135deg, rgba(188,140,255,0.12), rgba(88,166,255,0.08));
    border: 1px solid var(--card-border);
    border-radius: 18px;
    padding: 22px 22px 18px;
    margin-bottom: 28px;
  }
  .pg-profile-rank {
    display: flex; align-items: center; gap: 14px;
    margin-bottom: 14px;
  }
  .pg-rank-badge { font-size: 48px; line-height: 1; }
  .pg-rank-meta { flex: 1; min-width: 0; }
  .pg-rank-name {
    font-size: 22px; font-weight: 700; color: var(--text-bright);
    line-height: 1.1;
  }
  .pg-rank-mc {
    font-family: 'Space Mono', monospace;
    font-size: 13px; color: var(--text-dim);
    margin-top: 4px;
  }
  .pg-rank-mc .pg-coins { color: var(--yellow); font-weight: 700; }
  .pg-rank-mc .pg-streak { color: var(--orange); font-weight: 700; }
  .pg-progress-track {
    height: 10px;
    background: rgba(255,255,255,0.06);
    border-radius: 5px;
    overflow: hidden;
  }
  .pg-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--purple), var(--blue), var(--yellow));
    border-radius: 5px;
    transition: width 0.6s cubic-bezier(.34,1.2,.64,1);
  }
  .pg-progress-label {
    font-family: 'Space Mono', monospace;
    font-size: 12px; color: var(--text-dim);
    margin-top: 8px;
    text-align: center;
  }

  /* ---- Sections ---- */
  .pg-section { margin-bottom: 32px; }
  .pg-section-title {
    display: flex; align-items: center; gap: 8px;
    font-size: 18px; font-weight: 700; color: var(--text-bright);
    margin-bottom: 14px;
  }
  .pg-section-title .pg-emoji { font-size: 22px; }

  /* ---- "How Market Coins Work" card ---- */
  .pg-how-card {
    background: var(--card);
    border: 1px solid var(--card-border);
    border-radius: 16px;
    padding: 20px;
  }
  .pg-how-card p {
    font-size: 14px; color: var(--text);
    line-height: 1.55;
    margin-bottom: 12px;
  }
  .pg-how-card p:last-child { margin-bottom: 0; }
  .pg-how-list {
    list-style: none;
    margin: 12px 0;
    font-family: 'Space Mono', monospace;
    font-size: 13px;
  }
  .pg-how-list li {
    display: flex; align-items: baseline; gap: 8px;
    padding: 6px 0;
    border-bottom: 1px dashed var(--card-border);
  }
  .pg-how-list li:last-child { border-bottom: none; }
  .pg-how-list .pg-how-label { flex: 1; color: var(--text); }
  .pg-how-list .pg-how-value { color: var(--yellow); font-weight: 700; white-space: nowrap; }
  .pg-how-eyebrow {
    font-family: 'Space Mono', monospace;
    font-size: 10px; letter-spacing: 1.5px;
    color: var(--purple); font-weight: 700;
    margin-bottom: 6px;
    margin-top: 14px;
  }
  .pg-how-eyebrow:first-child { margin-top: 0; }

  /* ---- Rank ladder ---- */
  .pg-ladder {
    background: var(--card);
    border: 1px solid var(--card-border);
    border-radius: 16px;
    padding: 6px 0;
  }
  .pg-rung {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 18px;
    border-bottom: 1px solid rgba(255,255,255,0.04);
    font-family: 'Space Mono', monospace;
    font-size: 13px;
    transition: background 0.2s;
  }
  .pg-rung:last-child { border-bottom: none; }
  .pg-rung-badge { font-size: 22px; flex-shrink: 0; width: 28px; text-align: center; }
  .pg-rung-name { flex: 1; min-width: 0; font-family: 'Fredoka', sans-serif; font-size: 15px; font-weight: 500; }
  .pg-rung-mc { color: var(--text-dim); white-space: nowrap; }
  .pg-rung-status { width: 80px; text-align: right; font-weight: 700; }

  .pg-rung-locked .pg-rung-badge,
  .pg-rung-locked .pg-rung-name,
  .pg-rung-locked .pg-rung-mc { opacity: 0.45; }
  .pg-rung-locked .pg-rung-status { color: var(--text-dim); opacity: 0.55; }

  .pg-rung-current {
    background: linear-gradient(90deg, rgba(240,192,64,0.15), transparent 70%);
  }
  .pg-rung-current .pg-rung-name { color: var(--yellow); font-weight: 700; }
  .pg-rung-current .pg-rung-status { color: var(--yellow); }

  .pg-rung-completed .pg-rung-name { color: var(--text); }
  .pg-rung-completed .pg-rung-status { color: var(--green); }

  /* ---- Badge grid ---- */
  .pg-badge-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 12px;
  }
  .pg-badge-tile {
    background: var(--card);
    border: 1px solid var(--card-border);
    border-radius: 14px;
    padding: 14px 16px;
    display: flex; flex-direction: column; gap: 8px;
    transition: border-color 0.2s;
  }
  .pg-badge-tile.pg-badge-unlocked {
    border-color: rgba(188,140,255,0.45);
    background: linear-gradient(135deg, rgba(188,140,255,0.08), var(--card) 80%);
  }
  .pg-badge-tile.pg-badge-locked .pg-badge-icon { opacity: 0.4; filter: grayscale(0.7); }
  .pg-badge-tile.pg-badge-locked .pg-badge-name { color: var(--text-dim); }
  .pg-badge-row {
    display: flex; align-items: center; gap: 10px;
  }
  .pg-badge-icon { font-size: 28px; line-height: 1; flex-shrink: 0; }
  .pg-badge-info { flex: 1; min-width: 0; }
  .pg-badge-name {
    font-size: 14px; font-weight: 700; color: var(--text-bright);
    line-height: 1.2;
  }
  .pg-badge-tier {
    font-family: 'Space Mono', monospace;
    font-size: 11px; color: var(--text-dim);
    margin-top: 2px;
  }
  .pg-badge-tier .pg-tier-num { color: var(--yellow); font-weight: 700; }
  .pg-badge-bar-track {
    height: 6px;
    background: rgba(255,255,255,0.06);
    border-radius: 3px;
    overflow: hidden;
  }
  .pg-badge-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--purple), var(--yellow));
    border-radius: 3px;
  }
  .pg-badge-detail {
    font-family: 'Space Mono', monospace;
    font-size: 11px; color: var(--text-dim);
  }
  .pg-badge-detail .pg-badge-next { color: var(--text); }

  /* ---- Personal records ---- */
  .pg-records {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 12px;
  }
  .pg-record {
    background: var(--card);
    border: 1px solid rgba(240,192,64,0.20);
    border-radius: 14px;
    padding: 14px 16px;
  }
  .pg-record-icon { font-size: 22px; }
  .pg-record-name {
    font-size: 13px; color: var(--text-dim);
    font-family: 'Space Mono', monospace;
    margin: 4px 0 2px;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .pg-record-value {
    font-size: 22px; font-weight: 700; color: var(--yellow);
    line-height: 1.1;
  }
  .pg-record-value .pg-record-unit {
    font-size: 13px; color: var(--text-dim); font-weight: 500;
    margin-left: 4px;
  }
  .pg-record-date {
    font-family: 'Space Mono', monospace;
    font-size: 11px; color: var(--text-dim);
    margin-top: 6px;
  }
  .pg-record-empty { color: var(--text-dim); font-style: italic; }

  /* ---- Emergency fund ---- */
  .pg-shields {
    background: var(--card);
    border: 1px solid var(--card-border);
    border-radius: 16px;
    padding: 18px 20px;
    text-align: center;
  }
  .pg-shield-row {
    display: flex; justify-content: center; gap: 12px;
    font-size: 36px;
    margin-bottom: 12px;
  }
  .pg-shield-empty { opacity: 0.28; filter: grayscale(0.8); }
  .pg-shield-locked-msg {
    color: var(--text-dim);
    font-size: 13px;
    font-family: 'Space Mono', monospace;
    margin-bottom: 12px;
  }
  .pg-shield-count {
    font-family: 'Space Mono', monospace;
    font-size: 14px; color: var(--text);
    margin-bottom: 10px;
  }
  .pg-shield-count strong { color: var(--yellow); }
  .pg-shield-explain {
    font-size: 13px; color: var(--text-dim); line-height: 1.5;
  }

  /* ---- Footer ---- */
  .pg-footer {
    text-align: center;
    margin-top: 36px;
    font-size: 12px; color: var(--text-dim);
    font-family: 'Space Mono', monospace;
  }
  .pg-footer a { color: var(--text-dim); text-decoration: underline; }
  .pg-footer a:hover { color: var(--text-bright); }

  /* ---- Mobile ---- */
  @media (max-width: 520px) {
    body { padding: 20px 12px 50px; }
    .pg-profile { padding: 16px; }
    .pg-rank-badge { font-size: 40px; }
    .pg-rank-name { font-size: 18px; }
    .pg-rung { padding: 10px 14px; gap: 10px; }
    .pg-rung-name { font-size: 14px; }
    .pg-rung-status { width: 60px; font-size: 12px; }
    .pg-badge-grid, .pg-records {
      grid-template-columns: 1fr;
    }
  }
</style>
</head>
<body>
<div class="container">

  <div class="pg-header">
    <a href="/digest" class="pg-back">← Back to today's digest</a>
    <div class="pg-title">${escapeHTML(kidName)}'s Investor Profile</div>
    <div class="pg-subtitle">Your full progress at a glance</div>
  </div>

  <!-- Profile card -->
  <div class="pg-profile">
    <div class="pg-profile-rank">
      <span class="pg-rank-badge">${escapeHTML(p.rank.badge)}</span>
      <div class="pg-rank-meta">
        <div class="pg-rank-name">${escapeHTML(p.rank.name)}</div>
        <div class="pg-rank-mc">
          🪙 <span class="pg-coins">${p.marketCoins} MC</span>
          · 🔥 <span class="pg-streak">${p.currentStreak}-day streak</span>
        </div>
      </div>
    </div>
    <div class="pg-progress-track"><div class="pg-progress-fill" style="width:${pctToNext.toFixed(1)}%"></div></div>
    <div class="pg-progress-label">
      ${next
        ? `${p.marketCoins} / ${next.threshold} MC · next: ${escapeHTML(next.name)} ${escapeHTML(next.badge)}`
        : `Max rank reached 🏆 — Wall Street Legend status`}
    </div>
  </div>

  <!-- How Market Coins Work -->
  <div class="pg-section">
    <div class="pg-section-title"><span class="pg-emoji">📖</span>How Market Coins Work</div>
    <div class="pg-how-card">
      <p>You earn <strong>Market Coins (MC)</strong> every day by reading the digest and playing games. The more you play, the more you earn — and the higher your <strong>Investor Rank</strong> climbs!</p>
      <div class="pg-how-eyebrow">EARN MC BY</div>
      <ul class="pg-how-list">
        <li><span class="pg-how-label">🎮 Playing a daily game</span><span class="pg-how-value">15 MC</span></li>
        <li><span class="pg-how-label">🎯 Getting the right answer</span><span class="pg-how-value">+10 MC bonus</span></li>
        <li><span class="pg-how-label">⭐ Perfect Day (all 3 games)</span><span class="pg-how-value">+25 MC bonus</span></li>
        <li><span class="pg-how-label">🔥 Daily streak bonus</span><span class="pg-how-value">up to +30 MC</span></li>
        <li><span class="pg-how-label">🌅 Sunday Challenge</span><span class="pg-how-value">50–75 MC</span></li>
        <li><span class="pg-how-label">📖 Word of the Day reveal</span><span class="pg-how-value">5 MC</span></li>
      </ul>
      <div class="pg-how-eyebrow">YOUR RANK</div>
      <p>Every rank takes a little more than the last. The higher you go, the more dedicated investors you join — just like real investing, the biggest rewards take patience and consistency.</p>
      <div class="pg-how-eyebrow">EMERGENCY FUND (🪙)</div>
      <p>Every 7-day streak earns you an Emergency Fund. If you miss a day, one gets used automatically to save your streak. You can hold up to ${maxShields} at a time. Smart investors always keep reserves for unexpected events!</p>
    </div>
  </div>

  <!-- Rank Ladder -->
  <div class="pg-section">
    <div class="pg-section-title"><span class="pg-emoji">🏆</span>Rank Ladder</div>
    <div class="pg-ladder">
      ${renderLadder(RANKS, p)}
    </div>
  </div>

  <!-- Badge Collection -->
  <div class="pg-section">
    <div class="pg-section-title"><span class="pg-emoji">🏅</span>Badge Collection</div>
    <div class="pg-badge-grid">
      ${Object.values(BADGE_FAMILIES).map(fam => renderBadgeTile(fam, badges[fam.key], p)).join('')}
    </div>
  </div>

  <!-- Personal Records -->
  <div class="pg-section">
    <div class="pg-section-title"><span class="pg-emoji">🏆</span>Personal Records</div>
    <div class="pg-records">
      ${PERSONAL_RECORDS.map(rec => renderRecord(rec, records[rec.key])).join('')}
    </div>
  </div>

  <!-- Emergency Fund -->
  <div class="pg-section">
    <div class="pg-section-title"><span class="pg-emoji">🪙</span>Emergency Fund</div>
    <div class="pg-shields">
      ${shieldsAvailable
        ? `<div class="pg-shield-row">${renderShieldRow(heldShields, maxShields)}</div>
           <div class="pg-shield-count"><strong>${heldShields}</strong> / ${maxShields} in reserve</div>`
        : `<div class="pg-shield-row" aria-hidden="true">
             <span class="pg-shield-empty">🪙</span>
             <span class="pg-shield-empty">🪙</span>
             <span class="pg-shield-empty">🪙</span>
           </div>
           <div class="pg-shield-locked-msg">🔒 Unlocks at Stock Scout (150 MC)</div>`}
      <div class="pg-shield-explain">
        Every 7-day streak earns one Emergency Fund. If you miss a day, one gets used automatically to save your streak — no need to do anything. Up to ${maxShields} at a time.
      </div>
    </div>
  </div>

  <div class="pg-footer">
    <a href="/digest">← Back to today's digest</a>
  </div>

</div>
</body>
</html>`;
}

// ---- Section renderers -------------------------------------------------

function renderLadder(ranks, progress) {
  // Render top-down (highest first) so the goal is visible at a glance.
  // Each rung is marked: completed / current / locked.
  return ranks.slice().reverse().map(r => {
    const isCurrent  = r.key === progress.rank.key;
    const isCleared  = progress.marketCoins >= r.threshold && !isCurrent;
    const cls = isCurrent ? 'pg-rung-current' : isCleared ? 'pg-rung-completed' : 'pg-rung-locked';
    const status = isCurrent ? '← YOU' : isCleared ? '✓' : '';
    return `
      <div class="pg-rung ${cls}">
        <span class="pg-rung-badge">${escapeHTML(r.badge)}</span>
        <span class="pg-rung-name">${escapeHTML(r.name)}</span>
        <span class="pg-rung-mc">${r.threshold.toLocaleString()} MC</span>
        <span class="pg-rung-status">${status}</span>
      </div>`;
  }).join('');
}

function renderBadgeTile(family, row, progress) {
  const tier = row?.currentTier || 0;
  const lifetime = progress[progressKeyFor(family)] || 0;
  const maxTier = family.tiers.length;
  const nextTarget = tier < maxTier ? family.tiers[tier] : null;
  const tierBaseline = tier > 0 ? family.tiers[tier - 1] : 0;
  const pct = nextTarget
    ? Math.min(100, Math.max(0, ((lifetime - tierBaseline) / Math.max(1, nextTarget - tierBaseline)) * 100))
    : 100;

  const unlocked = tier > 0;
  const cls = unlocked ? 'pg-badge-unlocked' : 'pg-badge-locked';

  const detail = nextTarget
    ? unlocked
        ? `Next: <span class="pg-badge-next">${nextTarget.toLocaleString()} ${family.unit}${nextTarget === 1 ? '' : 's'}</span> (${lifetime} / ${nextTarget})`
        : `Reach <span class="pg-badge-next">${nextTarget.toLocaleString()} ${family.unit}${nextTarget === 1 ? '' : 's'}</span> to unlock`
    : `🏆 Max tier reached!`;

  return `
    <div class="pg-badge-tile ${cls}">
      <div class="pg-badge-row">
        <span class="pg-badge-icon">${escapeHTML(family.icon)}</span>
        <div class="pg-badge-info">
          <div class="pg-badge-name">${escapeHTML(family.name)}</div>
          <div class="pg-badge-tier">Tier <span class="pg-tier-num">${tier}</span> / ${maxTier}</div>
        </div>
      </div>
      <div class="pg-badge-bar-track"><div class="pg-badge-bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
      <div class="pg-badge-detail">${detail}</div>
    </div>`;
}

function renderRecord(rec, row) {
  const value = row?.value || 0;
  const achieved = row?.achievedAt ? formatDate(row.achievedAt) : null;
  if (value === 0) {
    return `
      <div class="pg-record">
        <div class="pg-record-icon">🏅</div>
        <div class="pg-record-name">${escapeHTML(rec.name)}</div>
        <div class="pg-record-value pg-record-empty">Not yet</div>
        <div class="pg-record-date">Play to set your first record!</div>
      </div>`;
  }
  return `
    <div class="pg-record">
      <div class="pg-record-icon">🏅</div>
      <div class="pg-record-name">${escapeHTML(rec.name)}</div>
      <div class="pg-record-value">${value.toLocaleString()}<span class="pg-record-unit">${escapeHTML(rec.unit)}</span></div>
      ${achieved ? `<div class="pg-record-date">Set on ${escapeHTML(achieved)}</div>` : ''}
    </div>`;
}

function renderShieldRow(have, max) {
  let html = '';
  for (let i = 0; i < max; i++) {
    html += i < have ? '<span>🪙</span>' : '<span class="pg-shield-empty">🪙</span>';
  }
  return html;
}

// ---- Helpers -----------------------------------------------------------

/**
 * Map a badge family's `source` (snake_case user_progress column name) to
 * the camelCase field on state.progress that getProgress() returns. Server
 * uses raw columns; client-shaped state uses camelCase — this bridges them.
 */
const SOURCE_TO_PROGRESS_KEY = {
  longest_streak:    'longestStreak',
  games_played:      'gamesPlayed',
  perfect_days:      'perfectDays',
  correct_answers:   'correctAnswers',
  weeks_active:      'weeksActive',
  sunday_challenges: 'sundayChallenges',
  words_learned:     'wordsLearned',
};

function progressKeyFor(family) {
  const src = family.source;
  return SOURCE_TO_PROGRESS_KEY[src] || src || family.key;
}

function formatDate(d) {
  // d may be a Date, a YYYY-MM-DD string, or an ISO timestamp string.
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return String(d);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
}

function escapeHTML(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}
