// src/watchlist-ui.js — Phase 21 Watchlist UI, shared by the digest
// (template.js) and the /progress editor (progress-template.js).
//
// Pure HTML/CSS/JS string builders so both pages render the same "Your
// Companies" card + categorized tap-to-select picker + controller. The card
// builder takes the host page's escapeHTML + principle-label map so it stays
// consistent with each page's own escaping.

import { followableByCategory } from './companies.js';

const sectionAnchor = (section) => {
  if (section === 'mover') return '#mover-card';
  if (section === 'big-picture') return '#big-picture';
  if (typeof section === 'string' && section.startsWith('story:')) return `#story-${section.slice(6)}`;
  return '#';
};
const fmtPct = (p) => `${p >= 0 ? '+' : ''}${p.toFixed(p <= -10 || p >= 10 ? 0 : 1)}%`;
const newsLabel = (news, name, esc) => {
  if (news.kind === 'mover') return `You follow ${esc(name)} — it’s today’s Big Mover`;
  if (news.kind === 'bigPicture') return `You follow ${esc(name)} — it’s in today’s Big Picture`;
  return `You follow ${esc(name)} — it’s in a story today`;
};

/**
 * The "Your Companies" card. Always renders a model when `watchlist` is
 * present (held companies + ghost slots + offer + principle tie-in); returns
 * '' when null (logged-out / sample). `principles` is the 1-11 GLOSS_PRINCIPLES
 * map from the host page.
 */
export function watchlistCard(watchlist, esc, principles = {}) {
  if (!watchlist) return '';
  const { held = [], ghostSlots = 0, principleTieIn = null, offer = null } = watchlist;

  const heldHTML = held.map(h => {
    const sincePct = h.sinceFollowPct;
    const sinceCls = sincePct == null ? '' : (sincePct >= 0 ? 'up' : 'down');
    const sinceHTML = sincePct == null
      ? `<div class="wl-since wl-since-pending">following since ${esc(h.followedSinceLabel)}</div>`
      : `<div class="wl-since ${sinceCls}"><span class="wl-since-num">${fmtPct(sincePct)}</span> since you started following · ${esc(h.followedSinceLabel)}</div>`;
    const todayHTML = (h.todayPct == null)
      ? ''
      : `<div class="wl-today ${h.todayPct >= 0 ? 'up' : 'down'}">today ${fmtPct(h.todayPct)}</div>`;
    const newsHTML = h.news
      ? `<a class="wl-news" href="${sectionAnchor(h.news.section)}">📌 ${newsLabel(h.news, h.name, esc)}</a>`
      : '';
    const milestoneHTML = (h.milestone && h.milestone.isNew)
      ? `<div class="wl-milestone" data-ticker="${esc(h.ticker)}" data-level="${h.milestone.level}">🎉 ${esc(h.name)} just passed +${h.milestone.level}% since you started following!</div>`
      : '';
    return `
        <div class="wl-company">
          <div class="wl-company-head">
            <div class="wl-company-id">
              <span class="wl-company-name">${esc(h.name)}</span>
              <span class="wl-company-ticker">${esc(h.ticker)}</span>
            </div>
            <button type="button" class="wl-drop" data-ticker="${esc(h.ticker)}" data-name="${esc(h.name)}" aria-label="Stop following ${esc(h.name)}">✕</button>
          </div>
          ${sinceHTML}
          ${todayHTML}
          ${newsHTML}
          ${milestoneHTML}
        </div>`;
  }).join('');

  const ghosts = Array.from({ length: ghostSlots }, () =>
    `<button type="button" class="wl-ghost" data-wl-open>+ Add a company</button>`).join('');
  let inviteHTML = '';
  if (held.length === 0) {
    inviteHTML = `<p class="wl-invite">Pick up to 3 companies you care about (Nike? Roblox? Disney?) and follow how they do over time.</p>`;
  } else if (ghostSlots > 0) {
    inviteHTML = `<button type="button" class="wl-add-another" data-wl-open>+ add another</button>`;
  }

  const principleHTML = principleTieIn
    ? `<div class="wl-principle"><a href="${sectionAnchor(principleTieIn.section)}">Your company <strong>${esc(principleTieIn.name)}</strong>… that’s Principle ${principleTieIn.principle}: ${esc(principles[principleTieIn.principle] || '')}</a></div>`
    : '';

  const offerHTML = offer && offer.show
    ? `<div class="wl-offer" id="wl-offer" data-kind="${esc(offer.kind)}">
           <div class="wl-offer-body">Pick a few companies to follow — watch how they do over time. Totally optional.</div>
           <div class="wl-offer-actions">
             <button type="button" class="wl-offer-pick" data-wl-open>Pick companies</button>
             <button type="button" class="wl-offer-skip">Maybe later</button>
             <button type="button" class="wl-offer-decline">No thanks</button>
           </div>
         </div>`
    : '';

  return `
  <div class="wl-card" id="watchlist-card">
    <div class="wl-head">
      <div class="wl-title">📈 Your Companies</div>
      ${held.length ? `<div class="wl-count">${held.length}/3</div>` : ''}
    </div>
    ${offerHTML}
    ${inviteHTML}
    <div class="wl-grid">
      ${heldHTML}
      ${ghosts}
    </div>
    ${principleHTML}
  </div>`;
}

/** The hidden categorized tap-to-select picker (no free text; typeahead filters only). */
export function watchlistPicker(esc) {
  const groups = followableByCategory().map(g => `
      <div class="wlp-group" data-cat="${g.key}">
        <div class="wlp-group-head">${g.emoji} ${esc(g.label)}</div>
        <div class="wlp-tiles">
          ${g.companies.map(c => `
            <button type="button" class="wlp-tile" data-ticker="${esc(c.ticker)}" data-name="${esc(c.name).toLowerCase()}">
              <span class="wlp-tile-name">${esc(c.name)}</span>
              <span class="wlp-tile-ticker">${esc(c.ticker)}</span>
            </button>`).join('')}
        </div>
      </div>`).join('');
  return `
  <div class="wl-picker" id="wl-picker" hidden aria-hidden="true">
    <div class="wlp-panel" role="dialog" aria-label="Pick companies to follow">
      <div class="wlp-top">
        <div class="wlp-title">Follow up to 3 companies</div>
        <button type="button" class="wlp-close" id="wlp-close" aria-label="Close">✕</button>
      </div>
      <input type="text" class="wlp-filter" id="wlp-filter" placeholder="Filter (e.g. ro → Roblox)…" autocomplete="off" inputmode="search" />
      <div class="wlp-empty" id="wlp-empty" hidden>No matches — try a different word.</div>
      <div class="wlp-groups">${groups}</div>
    </div>
  </div>`;
}

/** The card + picker CSS (no <style> tags). Phase 19 tokens; --up-text/--down-text. */
export const WATCHLIST_CSS = `
  /* ── Phase 21 — Watchlist "Your Companies" ─────────────────────────── */
  .wl-card { background: var(--card); border: 1px solid var(--card-border); border-radius: 18px; padding: 18px 20px; margin-bottom: 24px; animation: fadeIn 0.5s ease-out both; }
  .wl-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .wl-title { font-family: 'Fredoka', sans-serif; font-size: 19px; font-weight: 700; color: var(--text-bright); }
  .wl-count { font-family: 'Space Grotesk', sans-serif; font-size: 12px; color: var(--text-dim); padding: 3px 10px; background: rgba(91,79,199,0.10); border-radius: 999px; }
  .wl-invite { font-size: 14px; line-height: 1.55; color: var(--text-dim); margin: 0 0 12px; }
  .wl-grid { display: flex; flex-direction: column; gap: 10px; }
  .wl-company { background: var(--surface); border: 1px solid var(--surface-border); border-radius: 14px; padding: 12px 14px; }
  .wl-company-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .wl-company-name { font-size: 16px; font-weight: 700; color: var(--text-bright); }
  .wl-company-ticker { font-family: 'Space Grotesk', sans-serif; font-size: 11px; letter-spacing: 1px; color: var(--text-dim); margin-left: 6px; }
  .wl-drop { background: none; border: none; color: var(--text-dim); font-size: 15px; cursor: pointer; padding: 2px 6px; border-radius: 8px; line-height: 1; }
  .wl-drop:hover { color: var(--down-text); background: var(--red-glow); }
  .wl-since { font-size: 15px; margin-top: 6px; color: var(--text); font-weight: 600; }
  .wl-since .wl-since-num { font-family: 'Space Grotesk', sans-serif; font-weight: 700; }
  .wl-since.up { color: var(--up-text); }
  .wl-since.down { color: var(--down-text); }
  .wl-since-pending { color: var(--text-dim); font-weight: 500; font-size: 13px; }
  .wl-today { font-family: 'Space Grotesk', sans-serif; font-size: 12px; margin-top: 2px; color: var(--text-dim); }
  .wl-today.up { color: var(--up-text); } .wl-today.down { color: var(--down-text); }
  .wl-news { display: block; margin-top: 8px; font-size: 13px; font-weight: 600; color: var(--berry); text-decoration: none; background: rgba(91,79,199,0.08); border: 1px solid rgba(91,79,199,0.20); border-radius: 10px; padding: 7px 10px; }
  .wl-news:hover { background: rgba(91,79,199,0.14); }
  .wl-milestone { margin-top: 8px; font-size: 13px; font-weight: 700; color: var(--sun-text); background: rgba(255,194,51,0.12); border: 1px solid rgba(255,194,51,0.30); border-radius: 10px; padding: 7px 10px; }
  .wl-ghost, .wl-add-another { font-family: 'Fredoka', sans-serif; font-size: 14px; font-weight: 600; color: var(--text-dim); cursor: pointer; background: rgba(91,79,199,0.03); border: 1.5px dashed var(--surface-border); border-radius: 14px; padding: 16px; text-align: center; width: 100%; transition: border-color 0.15s, color 0.15s, background 0.15s; }
  .wl-ghost:hover, .wl-add-another:hover { border-color: var(--berry); color: var(--berry); background: rgba(91,79,199,0.07); }
  .wl-add-another { padding: 10px; font-size: 13px; }
  .wl-principle { margin-top: 12px; font-size: 13px; line-height: 1.5; background: rgba(255,194,51,0.10); border: 1px solid rgba(255,194,51,0.25); border-radius: 12px; padding: 9px 12px; }
  .wl-principle a { color: var(--sun-text); text-decoration: none; }
  .wl-offer { background: linear-gradient(135deg, rgba(255,194,51,0.10), rgba(91,79,199,0.08)); border: 1px solid var(--surface-border); border-radius: 14px; padding: 12px 14px; margin-bottom: 12px; }
  .wl-offer-body { font-size: 14px; color: var(--text); line-height: 1.5; margin-bottom: 10px; }
  .wl-offer-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .wl-offer-pick { font-family: 'Fredoka', sans-serif; font-weight: 600; font-size: 13px; background: linear-gradient(135deg, var(--citrus), var(--berry)); color: #fff; border: none; border-radius: 999px; padding: 8px 16px; cursor: pointer; }
  .wl-offer-skip, .wl-offer-decline { font-family: 'Fredoka', sans-serif; font-size: 13px; color: var(--text-dim); background: none; border: none; cursor: pointer; padding: 8px 6px; }
  .wl-offer-skip:hover, .wl-offer-decline:hover { color: var(--text); }
  .wl-picker { position: fixed; inset: 0; z-index: 50; background: rgba(13,17,23,0.45); display: flex; align-items: flex-end; justify-content: center; animation: fadeIn 0.2s ease-out; }
  @media (min-width: 600px) { .wl-picker { align-items: center; } }
  .wlp-panel { background: var(--bg); width: 100%; max-width: 560px; max-height: 82vh; border-radius: 20px 20px 0 0; padding: 16px 16px 24px; overflow-y: auto; border: 1px solid var(--surface-border); }
  @media (min-width: 600px) { .wlp-panel { border-radius: 20px; max-height: 80vh; } }
  .wlp-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .wlp-title { font-family: 'Fredoka', sans-serif; font-size: 17px; font-weight: 700; color: var(--text-bright); }
  .wlp-close { background: none; border: none; font-size: 18px; color: var(--text-dim); cursor: pointer; padding: 4px 8px; }
  .wlp-filter { width: 100%; box-sizing: border-box; font-family: 'Lexend', sans-serif; font-size: 15px; padding: 11px 14px; border-radius: 12px; border: 1px solid var(--surface-border); background: var(--surface); color: var(--ink); margin-bottom: 12px; }
  .wlp-empty { font-size: 13px; color: var(--text-dim); padding: 8px 2px; }
  .wlp-group { margin-bottom: 14px; }
  .wlp-group-head { font-family: 'Space Grotesk', sans-serif; font-size: 12px; letter-spacing: 0.5px; color: var(--text-dim); margin-bottom: 8px; }
  .wlp-tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  @media (min-width: 600px) { .wlp-tiles { grid-template-columns: 1fr 1fr 1fr; } }
  .wlp-tile { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; background: var(--surface); border: 1px solid var(--surface-border); border-radius: 12px; padding: 11px 12px; cursor: pointer; text-align: left; transition: border-color 0.12s, background 0.12s, transform 0.1s; }
  .wlp-tile:hover { border-color: var(--berry); background: rgba(91,79,199,0.06); }
  .wlp-tile:active { transform: scale(0.98); }
  .wlp-tile-name { font-size: 14px; font-weight: 700; color: var(--text-bright); }
  .wlp-tile-ticker { font-family: 'Space Grotesk', sans-serif; font-size: 10px; letter-spacing: 1px; color: var(--text-dim); }
`;

/** The card + picker controller JS (no <script> tags). Inert when #watchlist-card absent. */
export const WATCHLIST_CONTROLLER = `
(function () {
  'use strict';
  var card = document.getElementById('watchlist-card');
  if (!card) return;
  function api(method, url, body) {
    return fetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, body: j }; }); });
  }
  var picker = document.getElementById('wl-picker');
  function openPicker() {
    if (!picker) return;
    picker.hidden = false; picker.setAttribute('aria-hidden', 'false');
    var f = document.getElementById('wlp-filter'); if (f) { f.value = ''; runFilter(); setTimeout(function () { f.focus(); }, 50); }
  }
  function closePicker() { if (picker) { picker.hidden = true; picker.setAttribute('aria-hidden', 'true'); } }
  document.querySelectorAll('[data-wl-open]').forEach(function (b) { b.addEventListener('click', openPicker); });
  var closeBtn = document.getElementById('wlp-close'); if (closeBtn) closeBtn.addEventListener('click', closePicker);
  if (picker) picker.addEventListener('click', function (e) { if (e.target === picker) closePicker(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && picker && !picker.hidden) closePicker(); });
  function runFilter() {
    var f = document.getElementById('wlp-filter'); if (!f) return;
    var q = f.value.trim().toLowerCase(); var anyShown = false;
    document.querySelectorAll('.wlp-group').forEach(function (g) {
      var groupShown = false;
      g.querySelectorAll('.wlp-tile').forEach(function (t) {
        var hit = !q || (t.getAttribute('data-name') || '').indexOf(q) !== -1 || (t.getAttribute('data-ticker') || '').toLowerCase().indexOf(q) !== -1;
        t.style.display = hit ? '' : 'none'; if (hit) { groupShown = true; anyShown = true; }
      });
      g.style.display = groupShown ? '' : 'none';
    });
    var empty = document.getElementById('wlp-empty'); if (empty) empty.hidden = anyShown;
  }
  var filterEl = document.getElementById('wlp-filter'); if (filterEl) filterEl.addEventListener('input', runFilter);
  document.querySelectorAll('.wlp-tile').forEach(function (tile) {
    tile.addEventListener('click', function () {
      if (tile.disabled) return; tile.disabled = true;
      api('POST', '/api/watchlist', { ticker: tile.getAttribute('data-ticker') }).then(function (res) {
        if (res.status === 200 && res.body.success) { window.location.reload(); return; }
        tile.disabled = false; alert(res.body.error || 'Could not follow that company.');
      }).catch(function () { tile.disabled = false; });
    });
  });
  card.querySelectorAll('.wl-drop').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var name = btn.getAttribute('data-name') || 'this one';
      if (!window.confirm('Real investors hold through the dips — sure you want to drop ' + name + '?')) return;
      api('DELETE', '/api/watchlist/' + encodeURIComponent(btn.getAttribute('data-ticker'))).then(function (res) {
        if (res.status === 200 && res.body.success) { window.location.reload(); return; }
        if (res.status === 409 && res.body.code === 'cooldown') { alert(res.body.message); return; }
        alert(res.body.error || 'Could not update your companies.');
      });
    });
  });
  card.querySelectorAll('.wl-milestone[data-ticker]').forEach(function (m) {
    api('POST', '/api/watchlist/milestone', { ticker: m.getAttribute('data-ticker'), level: parseInt(m.getAttribute('data-level'), 10) });
  });
  var offer = document.getElementById('wl-offer');
  if (offer) {
    api('POST', '/api/watchlist/offer', { event: 'shown', kind: offer.getAttribute('data-kind') });
    var skip = offer.querySelector('.wl-offer-skip'); var decline = offer.querySelector('.wl-offer-decline');
    if (skip) skip.addEventListener('click', function () { api('POST', '/api/watchlist/offer', { event: 'skipped' }); offer.style.display = 'none'; });
    if (decline) decline.addEventListener('click', function () { api('POST', '/api/watchlist/offer', { event: 'declined' }); offer.style.display = 'none'; });
  }
})();
`;
