/* public/pwa.js — Market Juice PWA client glue.
 *
 * Responsibilities:
 *   1. Register the service worker.
 *   2. Detect whether we're running standalone (added to home screen).
 *   3. Show an unobtrusive add-to-home-screen banner — only when:
 *        - NOT already standalone, AND
 *        - the user has visited >= 2 times, AND
 *        - they haven't dismissed it in the last 14 days.
 *      iOS gets a Share-menu tutorial; Chromium gets a real install button
 *      driven by `beforeinstallprompt`.
 *   4. After homescreen install (or in Chromium after `appinstalled`),
 *      ask for push notification permission and POST the subscription to
 *      the (Phase 6) backend.
 *
 * Push subscription is GATED on standalone mode for iOS — iOS 16.4+ only
 * supports Web Push on home-screen installed PWAs, not regular Safari tabs.
 */
(function () {
  'use strict';

  // ---- Config -----------------------------------------------------------

  // Phase 15: the VAPID public key is fetched from the backend (not baked
  // into this cached shell asset) so key rotation is an env-var change,
  // not a deploy + SW cache bump. 404 = push unconfigured → all push UX
  // skips cleanly and the rest of the app keeps working.
  const PUBLIC_KEY_ENDPOINT = '/api/push/public-key';
  const SUBSCRIBE_ENDPOINT = '/api/push/subscribe';
  const VISIT_KEY  = 'mj_pwa_visits';
  const DISMISS_KEY = 'mj_pwa_dismissed_at';
  const PUSH_DISMISS_KEY = 'mj_push_dismissed_at';
  const DISMISS_DURATION_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

  // Don't ask for push permission before the kid's 3rd active day — they
  // should have demonstrated the habit is worth protecting first. The
  // count comes from the server engagement state (progress.activeDays).
  const PUSH_MIN_ACTIVE_DAYS = 3;

  // ---- Service worker registration --------------------------------------

  if ('serviceWorker' in navigator) {
    // Defer until window loaded so SW registration doesn't compete with
    // first-paint resources.
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .catch(err => console.warn('[PWA] SW registration failed:', err));
    });
  }

  // ---- Standalone detection ---------------------------------------------

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true; // iOS
  }

  function isIOS() {
    const ua = navigator.userAgent || '';
    // iPad with iPadOS 13+ reports as Mac in UA but has touch.
    const macTouch = /Macintosh/.test(ua) && 'ontouchend' in document;
    return /iPhone|iPad|iPod/.test(ua) || macTouch;
  }

  function isIOSSafari() {
    if (!isIOS()) return false;
    const ua = navigator.userAgent || '';
    // Exclude in-app browsers (FBAN, FBAV, Instagram, Line, etc.) where
    // add-to-homescreen doesn't work.
    if (/FBA[NV]|Instagram|Line/i.test(ua)) return false;
    // Safari on iOS reports "Safari" in UA but Chrome/Edge on iOS use the
    // same engine — they actually all support add-to-homescreen, so include.
    return true;
  }

  // ---- Visit counting ---------------------------------------------------

  function bumpVisits() {
    try {
      const n = parseInt(localStorage.getItem(VISIT_KEY) || '0', 10) + 1;
      localStorage.setItem(VISIT_KEY, String(n));
      return n;
    } catch { return 1; }
  }

  function isRecentlyDismissed(key) {
    try {
      const ts = parseInt(localStorage.getItem(key || DISMISS_KEY) || '0', 10);
      return ts && (Date.now() - ts) < DISMISS_DURATION_MS;
    } catch { return false; }
  }

  function markDismissed(key) {
    try { localStorage.setItem(key || DISMISS_KEY, String(Date.now())); } catch { /* */ }
  }

  // ---- Install banner ---------------------------------------------------

  let deferredPrompt = null; // captured beforeinstallprompt for Chromium
  let bannerShownThisVisit = false; // install OR push — only one per visit

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    // Re-evaluate banner now that we know we CAN prompt.
    maybeShowBanner();
  });

  window.addEventListener('appinstalled', () => {
    hideBanner();
    deferredPrompt = null;
    // Once installed, silently restore an existing grant (no prompt — the
    // permission ASK is owned by the 3rd-active-day banner, never install).
    setTimeout(() => subscribePush({ interactive: false }).catch(() => {}), 1500);
  });

  // Could the install banner still appear this visit? The push banner
  // defers to this — the two must never show on the same visit, and
  // install takes priority (a kid can't get iOS push without installing
  // first anyway).
  function installBannerEligible() {
    if (isStandalone()) return false;
    if (isRecentlyDismissed(DISMISS_KEY)) return false;
    const visits = parseInt(localStorage.getItem(VISIT_KEY) || '0', 10);
    return visits >= 2;
  }

  function maybeShowBanner() {
    if (isStandalone()) return;          // already installed
    if (isRecentlyDismissed()) return;   // user said no recently
    const visits = parseInt(localStorage.getItem(VISIT_KEY) || '0', 10);
    if (visits < 2) return;              // be patient — don't ambush on visit 1

    if (deferredPrompt) {
      // Chromium / Android — show button that fires the real install prompt.
      buildBanner({
        message: '📈 Add Market Juice to your home screen for daily reminders.',
        actionLabel: 'Install',
        onAction: async () => {
          if (!deferredPrompt) return;
          deferredPrompt.prompt();
          try { await deferredPrompt.userChoice; } catch { /* */ }
          deferredPrompt = null;
          hideBanner();
        },
      });
    } else if (isIOSSafari()) {
      // iOS — no programmatic install; show share-button tutorial.
      buildBanner({
        message: '📈 Tap the Share button below, then "Add to Home Screen" — get daily reminders for Market Juice.',
        actionLabel: 'Got it',
        onAction: () => { markDismissed(); hideBanner(); },
        iconHint: '⬆️',
      });
    }
  }

  function buildBanner({ message, actionLabel, onAction, iconHint, dismissKey }) {
    if (document.getElementById('mj-pwa-banner')) return;
    bannerShownThisVisit = true;
    const el = document.createElement('div');
    el.id = 'mj-pwa-banner';
    el.innerHTML = `
      <div class="mj-pwa-banner-inner">
        <div class="mj-pwa-banner-icon">${iconHint || '📲'}</div>
        <div class="mj-pwa-banner-msg">${escapeHTML(message)}</div>
        <button type="button" class="mj-pwa-banner-action" id="mj-pwa-action">${escapeHTML(actionLabel)}</button>
        <button type="button" class="mj-pwa-banner-close" id="mj-pwa-close" aria-label="Dismiss">×</button>
      </div>
    `;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('mj-pwa-banner-show'));
    document.getElementById('mj-pwa-action').addEventListener('click', () => {
      try { onAction(); } catch (e) { console.warn('[PWA] banner action failed:', e); }
    });
    document.getElementById('mj-pwa-close').addEventListener('click', () => {
      markDismissed(dismissKey);
      hideBanner();
    });
  }

  function hideBanner() {
    const el = document.getElementById('mj-pwa-banner');
    if (!el) return;
    el.classList.remove('mj-pwa-banner-show');
    setTimeout(() => el.remove(), 350);
  }

  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  }

  // ---- Push subscription (Phase 15) --------------------------------------

  function pushSupported() {
    return 'serviceWorker' in navigator
        && 'PushManager' in window
        && 'Notification' in window
        // iOS only supports Web Push inside an installed (standalone) PWA.
        // Android/desktop Chromium supports it in a plain tab too.
        && (!isIOS() || isStandalone());
  }

  let cachedVapidKey = null; // fetched once per page; null = not yet tried
  async function fetchVapidKey() {
    if (cachedVapidKey) return cachedVapidKey;
    const res = await fetch(PUBLIC_KEY_ENDPOINT);
    if (!res.ok) return null; // 404 = push not configured server-side
    const data = await res.json();
    cachedVapidKey = data.key || null;
    return cachedVapidKey;
  }

  /**
   * Subscribe + register with the backend.
   *   interactive: true  → may fire the native permission prompt (only ever
   *                        called from the kid's tap on the push banner).
   *   interactive: false → silent: only proceeds when permission is ALREADY
   *                        granted (restores a lost subscription after an
   *                        SW update / cache clear / fresh install).
   */
  async function subscribePush({ interactive } = {}) {
    if (!pushSupported()) return false;

    const key = await fetchVapidKey();
    if (!key) {
      console.info('[PWA] Push skipped — server has no VAPID key configured.');
      return false;
    }

    try {
      let perm = Notification.permission;
      if (perm === 'default' && interactive) {
        perm = await Notification.requestPermission();
      }
      if (perm !== 'granted') return false;

      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key),
        });
      }

      const res = await fetch(SUBSCRIBE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(sub),
      });
      if (!res.ok) {
        console.warn('[PWA] subscribe POST rejected:', res.status);
        return false;
      }
      try { localStorage.setItem('mj_push_subscribed', '1'); } catch { /* */ }
      return true;
    } catch (e) {
      console.warn('[PWA] push subscription failed:', e);
      return false;
    }
  }

  /**
   * The permission-ask UX. Deliberately NOT the native prompt on page
   * load: we show our own soft banner first, and the native prompt only
   * fires from the kid's explicit tap. Gates (all must hold):
   *   - push supported on this platform (iOS → standalone required)
   *   - permission not already denied / not already subscribed
   *   - the kid has >= 3 active days (server engagement state — they've
   *     demonstrated the habit is worth protecting)
   *   - not dismissed within the last 14 days
   *   - the install banner hasn't shown AND can't show this visit
   *     (install banner always takes priority; one banner per visit, max)
   */
  async function maybeShowPushBanner(engagementState) {
    if (!pushSupported()) return;
    if (Notification.permission === 'denied') return;
    if (isRecentlyDismissed(PUSH_DISMISS_KEY)) return;
    if (bannerShownThisVisit || document.getElementById('mj-pwa-banner')) return;
    if (installBannerEligible()) return; // install banner owns this visit

    const activeDays = engagementState?.progress?.activeDays || 0;
    if (activeDays < PUSH_MIN_ACTIVE_DAYS) return;

    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        // Already subscribed in the browser — just make sure the server
        // has it (e.g. the row was cleared), then stay quiet.
        subscribePush({ interactive: false }).catch(() => {});
        return;
      }
    } catch { return; }

    // Re-check — the awaits above could have raced the install banner.
    if (bannerShownThisVisit || document.getElementById('mj-pwa-banner')) return;

    buildBanner({
      message: "Want a morning ping when today's Juice is ready? You can turn it off anytime.",
      actionLabel: 'Turn on',
      iconHint: '🔔',
      dismissKey: PUSH_DISMISS_KEY,
      onAction: async () => {
        hideBanner();
        const ok = await subscribePush({ interactive: true });
        if (!ok) markDismissed(PUSH_DISMISS_KEY); // don't re-ask tomorrow if they said no
      },
    });
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  // ---- Boot -------------------------------------------------------------

  bumpVisits();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maybeShowBanner);
  } else {
    maybeShowBanner();
  }

  // Phase 15 — push wiring:
  // (a) Silent re-subscribe when permission was already granted (restores
  //     a lost subscription after SW updates; never prompts).
  if (pushSupported() && Notification.permission === 'granted') {
    setTimeout(() => subscribePush({ interactive: false }).catch(() => {}), 2000);
  }
  // (b) The permission ASK rides the engagement state: engagement.js fires
  //     mj:state-loaded after a successful /api/engagement/state fetch
  //     (logged-in kids on /digest only — exactly where the subscribe
  //     endpoint's session auth works). progress.activeDays gates the ask.
  document.addEventListener('mj:state-loaded', (e) => {
    maybeShowPushBanner(e.detail).catch(() => {});
  });
  // Cover the race where state loaded before this listener attached.
  if (window.MarketJuice && typeof window.MarketJuice.getState === 'function') {
    const s = window.MarketJuice.getState();
    if (s) maybeShowPushBanner(s).catch(() => {});
  }

  // Tiny debug surface for inspection in DevTools.
  window.MJPwa = {
    isStandalone, isIOS, isIOSSafari,
    maybeShowBanner, hideBanner,
    maybeShowPushBanner, subscribePush,
    _resetVisits: () => localStorage.removeItem(VISIT_KEY),
    _resetDismiss: () => localStorage.removeItem(DISMISS_KEY),
    _resetPushDismiss: () => localStorage.removeItem(PUSH_DISMISS_KEY),
  };
})();
