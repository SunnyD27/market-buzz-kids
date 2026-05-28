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

  // VAPID public key for push subscription. The Phase 6 backend owns the
  // private key. For now this is a placeholder — the Phase 6 generator will
  // bake the real key into the digest (or expose via /api/push/public-key).
  // Without a real key, subscription will fail gracefully and the rest of
  // the app keeps working.
  const VAPID_PUBLIC_KEY_PLACEHOLDER = 'REPLACE_IN_PHASE_6';

  const SUBSCRIBE_ENDPOINT = '/api/push/subscribe';
  const VISIT_KEY  = 'mj_pwa_visits';
  const DISMISS_KEY = 'mj_pwa_dismissed_at';
  const DISMISS_DURATION_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

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

  function isRecentlyDismissed() {
    try {
      const ts = parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10);
      return ts && (Date.now() - ts) < DISMISS_DURATION_MS;
    } catch { return false; }
  }

  function markDismissed() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* */ }
  }

  // ---- Install banner ---------------------------------------------------

  let deferredPrompt = null; // captured beforeinstallprompt for Chromium

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    // Re-evaluate banner now that we know we CAN prompt.
    maybeShowBanner();
  });

  window.addEventListener('appinstalled', () => {
    hideBanner();
    deferredPrompt = null;
    // Once installed, attempt to subscribe to push (after a brief delay so
    // the install animation finishes).
    setTimeout(() => maybeSubscribePush(), 1500);
  });

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

  function buildBanner({ message, actionLabel, onAction, iconHint }) {
    if (document.getElementById('mj-pwa-banner')) return;
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
      markDismissed();
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

  // ---- Push subscription ------------------------------------------------

  async function maybeSubscribePush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (!isStandalone()) return; // iOS requires this; harmless on Chromium too
    if (VAPID_PUBLIC_KEY_PLACEHOLDER === 'REPLACE_IN_PHASE_6') {
      console.info('[PWA] Push subscription skipped — VAPID key not configured (Phase 6).');
      return;
    }

    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return;

      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing) return; // already subscribed

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY_PLACEHOLDER),
      });

      // POST the subscription to the Phase 6 backend.
      try {
        await fetch(SUBSCRIBE_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sub),
        });
      } catch (e) {
        console.warn('[PWA] subscribe POST failed (backend not ready yet?):', e);
      }
    } catch (e) {
      console.warn('[PWA] push subscription failed:', e);
    }
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
  // If already standalone on load, kick off the push subscribe flow.
  if (isStandalone()) {
    setTimeout(maybeSubscribePush, 2000);
  }

  // Tiny debug surface for inspection in DevTools.
  window.MJPwa = {
    isStandalone, isIOS, isIOSSafari,
    maybeShowBanner, hideBanner,
    _resetVisits: () => localStorage.removeItem(VISIT_KEY),
    _resetDismiss: () => localStorage.removeItem(DISMISS_KEY),
  };
})();
