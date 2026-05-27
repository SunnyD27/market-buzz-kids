/* public/engagement-popups.js
 *
 * Phase 11 — celebration layer. engagement.js dispatches structured
 * CustomEvents on document; this module listens and renders the
 * corresponding popup or toast. Loaded after engagement.js so the
 * event dispatchers exist by the time the module wires up.
 *
 * Events handled:
 *   mj:rank-up        — full-screen ceremony with "what's next"
 *   mj:badges-unlocked — queued card per badge tier
 *   mj:new-records    — toasts (queued, top-right)
 *   mj:shield-used    — toast
 *   mj:shield-awarded — toast
 *
 * Accessibility: rank-up modal traps focus, closes on ESC + backdrop.
 * Reduced-motion users get instant transitions (CSS handles that).
 */
(function () {
  'use strict';

  // ---- Generic toast queue ----------------------------------------------

  const toastQueue = [];
  let toastDraining = false;

  function showToast(opts) {
    toastQueue.push(opts);
    drainToasts();
  }

  function drainToasts() {
    if (toastDraining) return;
    const next = toastQueue.shift();
    if (!next) return;
    toastDraining = true;

    const wrap = ensureToastWrap();
    const el = document.createElement('div');
    el.className = 'mj-pop-toast mj-pop-toast-' + (next.kind || 'info');
    el.setAttribute('role', 'status');
    el.innerHTML = `
      <div class="mj-pop-toast-icon">${escapeHTML(next.icon || '✨')}</div>
      <div class="mj-pop-toast-body">
        <div class="mj-pop-toast-title">${escapeHTML(next.title || '')}</div>
        ${next.subtitle ? `<div class="mj-pop-toast-sub">${escapeHTML(next.subtitle)}</div>` : ''}
      </div>
    `;
    wrap.appendChild(el);
    requestAnimationFrame(() => el.classList.add('mj-pop-toast-show'));

    const hold = next.holdMs || 3200;
    setTimeout(() => {
      el.classList.remove('mj-pop-toast-show');
      setTimeout(() => {
        el.remove();
        toastDraining = false;
        drainToasts();
      }, 320);
    }, hold);
  }

  function ensureToastWrap() {
    let wrap = document.getElementById('mj-pop-toasts');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'mj-pop-toasts';
      document.body.appendChild(wrap);
    }
    return wrap;
  }

  // ---- Badge unlock queue ----------------------------------------------
  //
  // Badge unlocks come as an array on a single event. We queue them with a
  // short delay between cards so multi-tier crossings (e.g. a streak that
  // jumps two tiers from a shield rescue) feel like distinct moments rather
  // than a stack of overlapping cards.

  const badgeQueue = [];
  let badgeDraining = false;

  function queueBadgeUnlocks(unlocks, nextMilestones) {
    if (!Array.isArray(unlocks)) return;
    for (const u of unlocks) badgeQueue.push({ unlock: u, nextMilestones });
    drainBadges();
  }

  function drainBadges() {
    if (badgeDraining) return;
    const item = badgeQueue.shift();
    if (!item) return;
    badgeDraining = true;
    renderBadgeCard(item.unlock, item.nextMilestones, () => {
      badgeDraining = false;
      setTimeout(drainBadges, 300);
    });
  }

  function renderBadgeCard(unlock, nextMilestones, onDone) {
    const wrap = ensureBadgeHost();
    const card = document.createElement('div');
    card.className = 'mj-pop-badge';
    card.setAttribute('role', 'status');

    // Find the same family in nextMilestones (if any) for the "next tier"
    // teaser. nextMilestones.nearestBadges may not include this family if
    // it was already maxed by this very unlock.
    const next = (nextMilestones?.nearestBadges || [])
      .find(b => b.family === unlock.family);

    const description = unlock.unit
      ? `${unlock.target} ${unlock.unit}${unlock.target === 1 ? '' : 's'}`
      : `Tier ${unlock.tier}`;

    const nextLine = next
      ? `Next: <strong>${escapeHTML(String(next.target))} ${escapeHTML(unlock.unit || '')}${next.target === 1 ? '' : 's'}</strong> — you're at ${escapeHTML(String(next.progress))}!`
      : `You've maxed out this badge — wow!`;

    card.innerHTML = `
      <div class="mj-pop-badge-icon">${escapeHTML(unlock.icon || '🏅')}</div>
      <div class="mj-pop-badge-body">
        <div class="mj-pop-badge-eyebrow">BADGE UNLOCKED</div>
        <div class="mj-pop-badge-title">${escapeHTML(unlock.familyName || 'Achievement')} · Tier ${unlock.tier}</div>
        <div class="mj-pop-badge-detail">${escapeHTML(description)}</div>
        <div class="mj-pop-badge-next">${nextLine}</div>
      </div>
      <button type="button" class="mj-pop-badge-close" aria-label="Dismiss">Nice! →</button>
    `;
    wrap.appendChild(card);
    requestAnimationFrame(() => card.classList.add('mj-pop-badge-show'));

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      card.classList.remove('mj-pop-badge-show');
      setTimeout(() => { card.remove(); onDone(); }, 320);
    };
    card.querySelector('.mj-pop-badge-close').addEventListener('click', close);
    // Auto-dismiss after 5s so a kid who walks away doesn't have a stack
    // of cards waiting.
    setTimeout(close, 5000);
  }

  function ensureBadgeHost() {
    let wrap = document.getElementById('mj-pop-badge-host');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'mj-pop-badge-host';
      document.body.appendChild(wrap);
    }
    return wrap;
  }

  // ---- Rank-up modal ----------------------------------------------------
  //
  // The big one — full-screen overlay, focus-trapped, ESC + backdrop close.
  // If a badge-unlock event fires while the rank-up is open, we defer the
  // badge queue until after the modal closes so the celebrations don't
  // compete for attention.

  let modalOpen = false;
  let badgeDeferred = false;

  function showRankUpModal(detail) {
    if (modalOpen) return; // shouldn't happen but bail safely
    modalOpen = true;
    // Pause badge queue drain so it doesn't fire under the modal.
    badgeDeferred = true;

    const backdrop = document.createElement('div');
    backdrop.className = 'mj-pop-modal-backdrop';
    backdrop.setAttribute('aria-hidden', 'true');

    const modal = document.createElement('div');
    modal.className = 'mj-pop-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'mj-pop-modal-title');
    modal.tabIndex = -1;

    const next = detail.nextMilestones?.nextRank;
    const nearest = detail.nextMilestones?.nearestBadges || [];

    const nextRankBlock = next
      ? `
        <div class="mj-pop-modal-next">
          <div class="mj-pop-modal-next-label">WHAT'S NEXT</div>
          <div class="mj-pop-modal-next-rank">
            <span class="mj-pop-modal-next-badge">${escapeHTML(next.badge)}</span>
            <span class="mj-pop-modal-next-name">${escapeHTML(next.name)}</span>
          </div>
          <div class="mj-pop-modal-next-remaining">
            <strong>${escapeHTML(String(next.remaining))} MC</strong> to go — keep playing daily!
          </div>
        </div>`
      : `
        <div class="mj-pop-modal-next mj-pop-modal-maxed">
          <div class="mj-pop-modal-next-label">🌟 MAX RANK REACHED</div>
          <div class="mj-pop-modal-next-name">You're a Market Juice Legend!</div>
        </div>`;

    const nearestBlock = nearest.length
      ? `
        <div class="mj-pop-modal-badges">
          <div class="mj-pop-modal-badges-label">BADGES ALMOST UNLOCKED</div>
          ${nearest.map(b => `
            <div class="mj-pop-modal-badge-row">
              <span class="mj-pop-modal-badge-icon">${escapeHTML(b.icon)}</span>
              <span class="mj-pop-modal-badge-name">${escapeHTML(b.familyName)} tier ${b.nextTier}</span>
              <span class="mj-pop-modal-badge-progress">${escapeHTML(String(b.progress))}/${escapeHTML(String(b.target))}</span>
            </div>
          `).join('')}
        </div>`
      : '';

    modal.innerHTML = `
      <div class="mj-pop-modal-celebrate">🎉 PROMOTED!</div>
      <div class="mj-pop-modal-rank">
        <div class="mj-pop-modal-rank-badge">${escapeHTML(detail.newRank.badge)}</div>
        <div class="mj-pop-modal-rank-name" id="mj-pop-modal-title">${escapeHTML(detail.newRank.name)}</div>
      </div>
      ${detail.unlocksMessage ? `<div class="mj-pop-modal-unlock">${escapeHTML(detail.unlocksMessage)}</div>` : ''}
      <div class="mj-pop-modal-divider"></div>
      ${nextRankBlock}
      ${nearestBlock}
      <button type="button" class="mj-pop-modal-cta">KEEP GOING →</button>
    `;

    document.body.appendChild(backdrop);
    document.body.appendChild(modal);
    requestAnimationFrame(() => {
      backdrop.classList.add('mj-pop-modal-backdrop-show');
      modal.classList.add('mj-pop-modal-show');
    });

    spawnConfetti();

    const cta = modal.querySelector('.mj-pop-modal-cta');
    cta.focus();

    // ---- Close handling ----
    const lastActive = document.activeElement;
    let closing = false;
    function close() {
      if (closing) return;
      closing = true;
      modal.classList.remove('mj-pop-modal-show');
      backdrop.classList.remove('mj-pop-modal-backdrop-show');
      document.removeEventListener('keydown', onKey);
      backdrop.removeEventListener('click', close);
      cta.removeEventListener('click', close);
      setTimeout(() => {
        modal.remove();
        backdrop.remove();
        modalOpen = false;
        // Restore focus to whatever the kid was on, if it still exists.
        try { lastActive && lastActive.focus && lastActive.focus(); } catch (_) {}
        // Resume badge queue.
        badgeDeferred = false;
        drainBadges();
      }, 320);
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Tab') {
        // Lightweight focus trap — only one focusable inside, so just
        // re-focus the CTA on any tab.
        e.preventDefault();
        cta.focus();
      }
    }

    document.addEventListener('keydown', onKey);
    backdrop.addEventListener('click', close);
    cta.addEventListener('click', close);
  }

  // ---- Confetti — CSS-only, ~90 particles ------------------------------

  function spawnConfetti() {
    const wrap = document.createElement('div');
    wrap.className = 'mj-pop-confetti';
    document.body.appendChild(wrap);
    const colors = ['#3fb950', '#58a6ff', '#f0c040', '#bc8cff', '#f85149', '#f0883e'];
    for (let i = 0; i < 90; i++) {
      const p = document.createElement('div');
      p.className = 'mj-pop-confetti-piece';
      p.style.left = (Math.random() * 100) + 'vw';
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = (Math.random() * 0.7) + 's';
      p.style.animationDuration = (1.7 + Math.random() * 1.5) + 's';
      p.style.transform = 'rotate(' + (Math.random() * 360) + 'deg)';
      wrap.appendChild(p);
    }
    setTimeout(() => wrap.remove(), 3800);
  }

  // ---- Wire up event listeners -----------------------------------------

  document.addEventListener('mj:rank-up', (e) => {
    showRankUpModal(e.detail);
  });

  document.addEventListener('mj:badges-unlocked', (e) => {
    queueBadgeUnlocks(e.detail.unlocks, e.detail.nextMilestones);
  });

  document.addEventListener('mj:new-records', (e) => {
    const records = e.detail?.records || [];
    for (const r of records) {
      const isFresh = r.oldValue === 0;
      showToast({
        icon: '🏅',
        kind: 'record',
        title: isFresh ? 'First record!' : 'New Personal Record!',
        subtitle: `${r.name}: ${r.newValue}${r.oldValue ? ` (was ${r.oldValue})` : ''}`,
      });
    }
  });

  document.addEventListener('mj:shield-used', (e) => {
    const remaining = e.detail?.shieldsRemaining ?? 0;
    showToast({
      icon: '🪙',
      kind: 'shield',
      title: 'Emergency Fund used!',
      subtitle: `Your streak is safe — ${remaining} left in reserve.`,
      holdMs: 4200,
    });
  });

  document.addEventListener('mj:shield-awarded', (e) => {
    const remaining = e.detail?.shieldsRemaining ?? 0;
    showToast({
      icon: '🪙',
      kind: 'shield-awarded',
      title: 'Emergency Fund earned!',
      subtitle: `Smart investors always keep reserves. ${remaining}/3 saved.`,
      holdMs: 4200,
    });
  });

  // ---- Helpers ---------------------------------------------------------

  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  }

  // ---- Debug / test hook -----------------------------------------------
  //
  // Expose a tiny window helper so the browser-verification step can fire
  // each popup in isolation without driving real events. Removed via a
  // future tree-shake if production size becomes a concern (~1KB).

  window.MJPopupsDebug = {
    rankUp(detail) {
      document.dispatchEvent(new CustomEvent('mj:rank-up', { detail: detail || {
        oldRank: { key: 'rookie', name: 'Rookie', badge: '🟢' },
        newRank: { key: 'stock-scout', name: 'Stock Scout', badge: '🟣' },
        unlocksMessage: "Emergency Funds unlocked! 🪙 You'll earn shields to protect your streak.",
        nextMilestones: {
          nextRank: { key: 'trading-cadet', name: 'Trading Cadet', badge: '🟠', threshold: 350, remaining: 200 },
          nearestBadges: [
            { family: 'streak', familyName: "The Investor's Discipline", icon: '🔥', nextTier: 1, progress: 2, target: 3, remaining: 1 },
            { family: 'games',  familyName: 'Market Player',              icon: '🎮', nextTier: 1, progress: 4, target: 5, remaining: 1 },
          ],
        },
      }}));
    },
    badge(detail) {
      document.dispatchEvent(new CustomEvent('mj:badges-unlocked', { detail: detail || {
        unlocks: [{ family: 'streak', familyName: "The Investor's Discipline", icon: '🔥', tier: 2, target: 7, unit: 'day' }],
        nextMilestones: { nearestBadges: [{ family: 'streak', icon: '🔥', familyName: "The Investor's Discipline", nextTier: 3, progress: 7, target: 14 }] },
      }}));
    },
    record(detail) {
      document.dispatchEvent(new CustomEvent('mj:new-records', { detail: detail || {
        records: [{ key: 'best-day-mc', name: 'Best Day', oldValue: 82, newValue: 95 }],
      }}));
    },
    shieldUsed() {
      document.dispatchEvent(new CustomEvent('mj:shield-used', { detail: { shieldsRemaining: 2 } }));
    },
    shieldAwarded() {
      document.dispatchEvent(new CustomEvent('mj:shield-awarded', { detail: { shieldsRemaining: 1 } }));
    },
  };
})();
