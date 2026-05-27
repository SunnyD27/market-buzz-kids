/* public/engagement.js
 *
 * Market Juice — Engagement client (Phase 11).
 *
 * Server-synced. The browser drives in-session UI (instant feedback,
 * MC float animation, profile bar) but every state change round-trips
 * through /api/engagement/track. localStorage caches the last-known
 * state as an offline fallback only.
 *
 * Public API (window.MarketJuice):
 *   init()
 *     Called automatically on DOMContentLoaded. Clears legacy storage,
 *     fetches /api/engagement/state, renders the Investor Profile bar,
 *     fires the daily-visit event.
 *
 *   recordEvent(eventType, eventData)
 *     POST /api/engagement/track. On success: optimistic MC float +
 *     profile-bar update from the response payload. On network error:
 *     queue in localStorage and retry on next init.
 *
 *   getState()
 *     Returns the cached state (read-only snapshot, can be stale).
 *
 *   _debugReset()
 *     Wipes localStorage and re-fetches. For local development only.
 *
 * NB: Popups (rank-up, badge unlock, record beat, shield used) are NOT
 * implemented here — that's Batch C. This file emits structured events
 * via document.dispatchEvent('mj:rank-up', etc.) which the popup module
 * will listen for. For now the events fire into the void.
 */
(function () {
  'use strict';

  const STATE_CACHE_KEY = 'mj-engagement-state';
  const LEGACY_CLEAR_FLAG = 'mj-engagement-v2-clean';
  const EVENT_QUEUE_KEY = 'mj-engagement-queue';

  // ---- Legacy storage cleanup ------------------------------------------
  //
  // Phase 11 starts everyone fresh on the server. Pre-Phase-11 localStorage
  // (mb_*, mb-*, mbg-*) is wiped on first load — no migration, no
  // reconciliation. Per Q2: nothing in the old store was worth preserving.

  function clearLegacyStorage() {
    try {
      if (localStorage.getItem(LEGACY_CLEAR_FLAG)) return;
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (key.startsWith('mb_') || key.startsWith('mb-') || key.startsWith('mbg-')) {
          // Don't blow away the just-renamed 'mj-sunday-challenge-…' replay
          // flag — that one starts with 'mj-', not 'mb-'/'mbg-'. The check
          // above naturally excludes it.
          toRemove.push(key);
        }
      }
      toRemove.forEach(k => localStorage.removeItem(k));
      localStorage.setItem(LEGACY_CLEAR_FLAG, '1');
    } catch (_) { /* private mode etc. — silent */ }
  }

  // ---- Cache helpers ---------------------------------------------------

  function loadCache() {
    try {
      const raw = localStorage.getItem(STATE_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }
  function saveCache(state) {
    try { localStorage.setItem(STATE_CACHE_KEY, JSON.stringify(state)); }
    catch (_) { /* quota — silent */ }
  }

  // ---- Offline queue ---------------------------------------------------
  //
  // If /api/engagement/track fails (network blip, server 5xx), queue the
  // event in localStorage. On next init() we flush the queue before
  // hydrating fresh state. Queue capped at 50 events to bound storage.

  function queueOfflineEvent(eventType, eventData) {
    try {
      const queue = JSON.parse(localStorage.getItem(EVENT_QUEUE_KEY) || '[]');
      queue.push({ eventType, eventData, queuedAt: Date.now() });
      if (queue.length > 50) queue.splice(0, queue.length - 50);
      localStorage.setItem(EVENT_QUEUE_KEY, JSON.stringify(queue));
    } catch (_) { /* silent */ }
  }
  async function flushQueue() {
    let queue;
    try { queue = JSON.parse(localStorage.getItem(EVENT_QUEUE_KEY) || '[]'); }
    catch (_) { return; }
    if (!Array.isArray(queue) || queue.length === 0) return;
    // Drop the queue first; failures during flush re-queue individually.
    try { localStorage.removeItem(EVENT_QUEUE_KEY); } catch (_) {}
    for (const item of queue) {
      try {
        await fetch('/api/engagement/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventType: item.eventType, eventData: item.eventData || {} }),
        });
      } catch (_) {
        // Re-queue the still-failing event and bail (don't spin).
        queueOfflineEvent(item.eventType, item.eventData);
        return;
      }
    }
  }

  // ---- State management ------------------------------------------------

  let state = null;        // last known server state, or null if not loaded
  let isSample = false;    // /sample renders a teaser bar, not real data

  async function fetchState() {
    const res = await fetch('/api/engagement/state', { credentials: 'same-origin' });
    if (!res.ok) {
      const err = new Error('engagement/state ' + res.status);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  /**
   * Merge a /api/engagement/track response back into the cached state.
   * We don't get a full state envelope from track — just deltas — so we
   * patch the cached state inline. On reload, the next fetchState() is
   * authoritative.
   */
  function mergeTrackResult(result) {
    if (!state) return;
    state.progress = state.progress || {};
    state.progress.marketCoins  = result.newTotal;
    state.progress.currentStreak = result.streakUpdate.current;
    state.progress.longestStreak = result.streakUpdate.longest;
    state.progress.streakShields = result.streakUpdate.shieldsRemaining;
    if (result.rankUp) {
      state.progress.rank = result.rankUp.newRank;
    }
    if (result.nextMilestones && result.nextMilestones.nextRank !== undefined) {
      state.nextRank = result.nextMilestones.nextRank;
    }
    saveCache(state);
  }

  // ---- Profile bar rendering -------------------------------------------

  function rankInfo(s) {
    if (s.progress && s.progress.rank) return s.progress.rank;
    const p = window.MJProgression;
    return p ? p.rankForCoins(s.progress?.marketCoins || 0).current : { key: 'rookie', name: 'Rookie', badge: '🟢' };
  }

  // Rank keys that unlock cosmetic accents. Kept in sync with the spec's
  // Part 6A unlock-messages table. The CSS for these classes lives in
  // engagement.css under "Rank-tier cosmetic accents".
  const GOLD_ACCENT_RANKS = new Set([
    'market-strategist', 'investment-pro', 'fund-manager',
    'market-master', 'wall-street-legend',
  ]);
  const GOLD_THEME_RANKS = new Set([
    'market-master', 'wall-street-legend',
  ]);

  function applyRankCosmetics(rankKey) {
    const host = document.getElementById('investor-profile');
    if (host) {
      host.classList.toggle('mj-rank-gold-accent', GOLD_ACCENT_RANKS.has(rankKey));
    }
    document.body.classList.toggle('mj-rank-gold-theme', GOLD_THEME_RANKS.has(rankKey));
  }

  function renderProfileBar() {
    const host = document.getElementById('investor-profile');
    if (!host) return;

    if (isSample) {
      host.innerHTML = `
        <div class="ip-row">
          <div class="ip-rank">
            <span class="ip-badge">🟢</span>
            <span class="ip-rank-name">Rookie</span>
          </div>
          <div class="ip-stats">
            <a href="/#signup" class="ip-cta">Sign up to start earning! →</a>
          </div>
        </div>`;
      return;
    }

    if (!state || !state.progress) {
      host.innerHTML = `<div class="ip-row"><div class="ip-rank-name ip-loading">Loading your profile…</div></div>`;
      return;
    }

    const p = state.progress;
    const rank = rankInfo(state);
    applyRankCosmetics(rank.key);
    const next = state.nextRank;
    const cfg = window.MJProgression || {};
    const shieldsShown = p.shieldsUnlocked === true || cfg.shieldsUnlocked?.(rank.key);
    const maxShields = cfg.SHIELD_CONFIG ? cfg.SHIELD_CONFIG.maxShields : 3;

    const pct = next
      ? Math.min(100, Math.max(0,
          ((p.marketCoins - (rank.threshold || 0)) /
            Math.max(1, (next.threshold - (rank.threshold || 0)))) * 100))
      : 100;

    // Emergency Fund icons: filled coin per shield held, hollow for empty slots.
    const shieldHTML = shieldsShown
      ? `<a href="/progress" class="ip-stat ip-shield" title="Emergency Fund — protect your streak when you miss a day">
           ${renderShieldIcons(p.streakShields || 0, maxShields)}
         </a>`
      : `<span class="ip-stat ip-shield ip-locked" title="Emergency Funds unlock at Stock Scout (150 MC)">🪙 🔒</span>`;

    const nextLabel = next
      ? `${p.marketCoins} / ${next.threshold} MC · next: ${escapeHTML(next.name)}`
      : `${p.marketCoins} MC · max rank reached 🏆`;

    host.innerHTML = `
      <a href="/progress" class="ip-link" aria-label="View your full progress">
        <div class="ip-row">
          <div class="ip-rank">
            <span class="ip-badge">${rank.badge}</span>
            <span class="ip-rank-name">${escapeHTML(rank.name)}</span>
          </div>
          <div class="ip-stats">
            <span class="ip-stat ip-coins" title="Market Coins">🪙 ${p.marketCoins} MC</span>
            <span class="ip-stat ip-streak" title="Current daily streak">🔥 ${p.currentStreak}</span>
            ${shieldHTML}
          </div>
        </div>
        <div class="ip-progress">
          <div class="ip-progress-track"><div class="ip-progress-fill" style="width:${pct.toFixed(1)}%"></div></div>
          <div class="ip-progress-label">${escapeHTML(nextLabel)}</div>
        </div>
      </a>
    `;
  }

  function renderShieldIcons(have, max) {
    let html = '';
    for (let i = 0; i < max; i++) {
      html += i < have ? '🪙' : '<span class="ip-shield-empty">🪙</span>';
    }
    return html;
  }

  // ---- MC float animation ----------------------------------------------
  //
  // When a track response comes back with mcAwarded > 0, float a "+N MC"
  // chip up from the profile bar. CSS-only motion; element self-removes.

  function floatMC(amount) {
    if (!amount) return;
    const host = document.getElementById('investor-profile');
    if (!host) return;
    const el = document.createElement('div');
    el.className = 'mj-mc-float';
    el.textContent = '+' + amount + ' MC';
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add('mj-mc-float-show'));
    setTimeout(() => {
      el.classList.remove('mj-mc-float-show');
      setTimeout(() => el.remove(), 600);
    }, 1500);
  }

  // ---- Popup hooks (filled in by Batch C) ------------------------------
  //
  // For now we dispatch structured events so the popup module (Batch C)
  // can hook in without changes here. Failing silently is fine — popups
  // are additive UX.

  function dispatchEngagementEvents(result) {
    try {
      if (result.rankUp) {
        document.dispatchEvent(new CustomEvent('mj:rank-up', { detail: { ...result.rankUp, nextMilestones: result.nextMilestones } }));
      }
      if (Array.isArray(result.badgeUnlocks) && result.badgeUnlocks.length) {
        document.dispatchEvent(new CustomEvent('mj:badges-unlocked', { detail: { unlocks: result.badgeUnlocks, nextMilestones: result.nextMilestones } }));
      }
      if (Array.isArray(result.newRecords) && result.newRecords.length) {
        document.dispatchEvent(new CustomEvent('mj:new-records', { detail: { records: result.newRecords } }));
      }
      if (result.streakUpdate?.shieldUsed) {
        document.dispatchEvent(new CustomEvent('mj:shield-used', { detail: result.streakUpdate }));
      }
      if (result.streakUpdate?.shieldAwarded) {
        document.dispatchEvent(new CustomEvent('mj:shield-awarded', { detail: result.streakUpdate }));
      }
    } catch (_) { /* CustomEvent unsupported in ancient browsers — skip */ }
  }

  // ---- Public surface --------------------------------------------------

  async function recordEvent(eventType, eventData) {
    eventData = eventData || {};
    if (isSample) return null; // /sample is read-only / unauthenticated

    try {
      const res = await fetch('/api/engagement/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ eventType, eventData }),
      });
      if (!res.ok) {
        // 401 = not authenticated. Drop silently — kids on /sample can hit
        // game completion handlers from a stale tab.
        if (res.status !== 401) queueOfflineEvent(eventType, eventData);
        return null;
      }
      const result = await res.json();
      if (result.mcAwarded > 0) floatMC(result.mcAwarded);
      mergeTrackResult(result);
      renderProfileBar();
      dispatchEngagementEvents(result);
      return result;
    } catch (_) {
      queueOfflineEvent(eventType, eventData);
      return null;
    }
  }

  async function init() {
    isSample = !!window.__isSample;
    clearLegacyStorage();

    // Sample mode: render the teaser bar and stop. No fetch, no tracking.
    if (isSample) {
      renderProfileBar();
      return;
    }

    // Optimistic render from cache so the bar isn't blank during the fetch.
    state = loadCache();
    renderProfileBar();

    try {
      state = await fetchState();
      saveCache(state);
      renderProfileBar();
    } catch (err) {
      if (err.status === 401) {
        // Not logged in (e.g. /sample landed users hitting the script).
        return;
      }
      // Other error: keep the cached render, but proceed to queue-flush.
    }

    // Flush any events queued from prior offline sessions (fire-and-forget).
    flushQueue().catch(() => {});

    // Fire daily-visit once per page load. Server is idempotent across the
    // same NY calendar date, so a tab reload at noon doesn't double-bump.
    if (!window.__visitTracked) {
      window.__visitTracked = true;
      recordEvent('daily-visit', { digestDate: window.__digestDate || null })
        .catch(() => {});
    }
  }

  // ---- Misc helpers ----------------------------------------------------

  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  }

  // ---- Export & boot ---------------------------------------------------

  window.MarketJuice = {
    init,
    recordEvent,
    getState() { return state ? JSON.parse(JSON.stringify(state)) : null; },
    _debugReset() {
      try {
        localStorage.removeItem(STATE_CACHE_KEY);
        localStorage.removeItem(LEGACY_CLEAR_FLAG);
        localStorage.removeItem(EVENT_QUEUE_KEY);
      } catch (_) {}
      state = null;
      renderProfileBar();
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init());
  } else {
    init();
  }
})();
