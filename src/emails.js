/**
 * src/emails.js — Email rendering + sending (Phase 6.2 wires real Resend).
 *
 * Renderers (`render*Email`) are PURE — they build a { subject, html, text }
 * payload and never hit the network. That keeps them unit-testable and lets
 * us preview emails by just calling them. The actual network call is
 * isolated to `sendEmail()`.
 *
 * If RESEND_API_KEY is unset, `sendEmail()` logs the payload to console
 * (same behavior as the Phase 5 stub) and resolves successfully — the
 * server still boots and the signup/consent/deletion routes still complete.
 *
 * Email types:
 *   renderVerifyEmail         — ages 13-16, standard email verification
 *   renderConsentEmail        — ages 10-12, COPPA email-plus consent
 *   renderWelcomeEmail        — sent the moment a user becomes is_active
 *   renderDeletionAckEmail    — confirms receipt of a /parent/delete-data request
 *   renderDailyTeaserEmail    — 7 AM teaser linking to today's web digest
 *   renderPasswordResetEmail  — Phase 7, parent-initiated password reset
 */

import { Resend } from 'resend';

// ── Config -------------------------------------------------------------

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'onboarding@resend.dev';
const APP_BASE_URL = (process.env.APP_BASE_URL || 'http://localhost:3199').replace(/\/$/, '');

// One client per process. Only initialized when the key is present so we
// don't accidentally crash inside Resend's constructor.
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

if (!resend) {
  console.warn('[emails] RESEND_API_KEY not set — sends will be logged to console only.');
}

// Helpful for tests / external callers.
export function appUrl(pathname = '/') {
  if (!pathname.startsWith('/')) pathname = '/' + pathname;
  return APP_BASE_URL + pathname;
}

const BRAND = {
  name: 'Market Juice',
  primary: '#0d1117',
  accent: '#bc8cff',
  gold: '#f0c040',
  blue: '#58a6ff',
  green: '#1f7a36',
  greenBg: '#e6f7eb',
  red: '#a02323',
  redBg: '#fdecec',
};

function escapeHTML(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

/**
 * Layout shared by all transactional emails — branded header, content slot,
 * footer with the working /parent/delete-data link.
 */
function shell({ preheader, body }) {
  const deleteLink = appUrl('/parent/delete-data');
  // Absolute URL — relative paths and localhost don't resolve in an
  // inbox. In prod this points at themarketjuice.com; in local dev the
  // email is stub-logged, so the broken localhost URL is harmless.
  // alt="" matches the landing-page treatment: the wordmark text supplies
  // the brand name to screen readers + acts as the visible fallback when
  // an email client blocks remote images.
  const logoUrl = appUrl('/icons/logo.png');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${BRAND.name}</title></head>
<body style="margin:0;padding:0;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1c2030;line-height:1.55;">
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#f5f7fa;">${escapeHTML(preheader)}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f7fa;">
    <tr><td align="center" style="padding:32px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 14px rgba(0,0,0,0.04);">

        <tr><td style="background:${BRAND.primary};padding:20px 28px;color:#fff;">
          <div style="font-size:20px;font-weight:700;letter-spacing:-0.3px;">
            <img src="${logoUrl}" alt="" width="32" height="32" style="vertical-align:middle;margin-right:10px;display:inline-block;border:0;">
            <span style="vertical-align:middle;">${BRAND.name}</span>
          </div>
        </td></tr>

        <tr><td style="padding:28px 28px 12px 28px;">${body}</td></tr>

        <tr><td style="padding:24px 28px 28px 28px;border-top:1px solid #eee;color:#8b91a3;font-size:12px;line-height:1.6;">
          You received this because someone signed your kid up for Market Juice.
          If that wasn't you, you can safely ignore this — no account will be created without your click.
          <br><br>
          Questions or want to delete data? Reply to this email or visit
          <a href="${escapeHTML(deleteLink)}" style="color:${BRAND.blue};">/parent/delete-data</a>.
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`;
}

// ============================================================
// 1) Parental consent email (ages 10-12, COPPA email-plus)
// ============================================================
export function renderConsentEmail(user, link) {
  const kid = escapeHTML(user.kid_first_name);
  const deleteLink = appUrl('/parent/delete-data');
  const subject = `Parental consent for ${kid} on Market Juice`;
  const preheader = `One click to activate ${kid}'s account. We'll explain exactly what we collect and how it's used.`;

  const body = `
    <h1 style="font-size:24px;font-weight:700;color:#1c2030;margin:0 0 12px 0;letter-spacing:-0.5px;">
      One click to activate ${kid}'s account
    </h1>
    <p style="margin:0 0 18px 0;font-size:15px;color:#454a5b;">
      Hi — someone (probably you) just signed up <strong>${kid}</strong>, age ${user.kid_age},
      for <strong>Market Juice</strong>. Because ${kid} is under 13, U.S. law (COPPA)
      requires us to get your consent before activating their account.
    </p>
    <p style="margin:0 0 22px 0;font-size:15px;color:#454a5b;">
      Here's exactly what we want you to know before you click:
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           style="background:#f7f4ff;border:1px solid #e8defc;border-left:4px solid ${BRAND.accent};border-radius:8px;margin:0 0 24px 0;">
      <tr><td style="padding:16px 18px;">
        <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${BRAND.accent};margin-bottom:10px;">What we collect</div>
        <ul style="margin:0;padding-left:20px;color:#454a5b;font-size:14px;line-height:1.7;">
          <li>${kid}'s first name and age (you gave us these)</li>
          <li>Engagement data: games played, quiz answers, XP, streak, Perfect Days</li>
          <li>Push token only if ${kid} adds Market Juice to home screen and turns on notifications</li>
        </ul>
        <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${BRAND.accent};margin:18px 0 10px 0;">How we use it</div>
        <ul style="margin:0;padding-left:20px;color:#454a5b;font-size:14px;line-height:1.7;">
          <li>Deliver the daily digest at 7&nbsp;AM EST</li>
          <li>Track ${kid}'s learning progress (rank, streak, what they got right/wrong)</li>
          <li>Send you a weekly summary email (opt out anytime)</li>
        </ul>
        <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${BRAND.accent};margin:18px 0 10px 0;">What we DON'T do</div>
        <ul style="margin:0;padding-left:20px;color:#454a5b;font-size:14px;line-height:1.7;">
          <li>Sell or share ${kid}'s data with third parties</li>
          <li>Use ${kid}'s data to train AI models</li>
          <li>Show ads. Ever.</li>
        </ul>
        <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${BRAND.accent};margin:18px 0 10px 0;">Your rights</div>
        <ul style="margin:0;padding-left:20px;color:#454a5b;font-size:14px;line-height:1.7;">
          <li>Request all of ${kid}'s data at any time (reply to this email)</li>
          <li>Delete ${kid}'s account and ALL data at <a href="${escapeHTML(deleteLink)}" style="color:${BRAND.blue};">/parent/delete-data</a></li>
          <li>Refuse further collection — we'll stop immediately if you ask</li>
        </ul>
      </td></tr>
    </table>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px 0;">
      <tr><td style="background:linear-gradient(135deg,${BRAND.accent},${BRAND.blue});border-radius:999px;">
        <a href="${escapeHTML(link)}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;letter-spacing:0.2px;">
          ✅ I'm ${kid}'s parent/guardian — activate the account
        </a>
      </td></tr>
    </table>

    <p style="margin:0 0 4px 0;font-size:13px;color:#8b91a3;">Or paste this link into your browser:</p>
    <p style="margin:0 0 18px 0;font-size:12px;color:${BRAND.blue};word-break:break-all;">${escapeHTML(link)}</p>
    <p style="margin:18px 0 0 0;font-size:13px;color:#8b91a3;">
      This link expires in 7 days. If you didn't sign up, ignore this email — nothing happens until you click.
    </p>
  `;

  return {
    subject,
    html: shell({ preheader, body }),
    text: [
      `Parental consent for ${kid} on Market Juice`,
      '',
      `Someone signed up ${kid} (age ${user.kid_age}) for Market Juice.`,
      `Because ${kid} is under 13, U.S. COPPA law requires your consent before we activate their account.`,
      '',
      `Click to confirm you are ${kid}'s parent/guardian and activate the account:`,
      link,
      '',
      `Delete data anytime: ${deleteLink}`,
      'Link expires in 7 days.',
    ].join('\n'),
  };
}

// ============================================================
// 2) Email verification (ages 13-16)
// ============================================================
export function renderVerifyEmail(user, link) {
  const kid = escapeHTML(user.kid_first_name);
  const deleteLink = appUrl('/parent/delete-data');
  const subject = `Confirm your email — ${BRAND.name}`;
  const preheader = `One click to activate ${kid}'s daily digest.`;

  const body = `
    <h1 style="font-size:24px;font-weight:700;color:#1c2030;margin:0 0 14px 0;letter-spacing:-0.5px;">
      Confirm your email to activate ${kid}'s account
    </h1>
    <p style="margin:0 0 22px 0;font-size:15px;color:#454a5b;">
      Thanks for signing up <strong>${kid}</strong> for <strong>Market Juice</strong>!
      One click and the daily digest will start arriving tomorrow at 7 AM EST.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px 0;">
      <tr><td style="background:linear-gradient(135deg,${BRAND.accent},${BRAND.blue});border-radius:999px;">
        <a href="${escapeHTML(link)}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;">
          ✅ Confirm my email
        </a>
      </td></tr>
    </table>
    <p style="margin:0 0 4px 0;font-size:13px;color:#8b91a3;">Or paste this link into your browser:</p>
    <p style="margin:0 0 22px 0;font-size:12px;color:${BRAND.blue};word-break:break-all;">${escapeHTML(link)}</p>
    <p style="margin:0;font-size:14px;color:#454a5b;">
      What we collect: ${kid}'s first name, age, and engagement data (XP, streak, quiz answers).
      No selling, no sharing. Delete anytime at
      <a href="${escapeHTML(deleteLink)}" style="color:${BRAND.blue};">/parent/delete-data</a>.
    </p>
    <p style="margin:18px 0 0 0;font-size:13px;color:#8b91a3;">
      Link expires in 7 days. If you didn't sign up, ignore this email.
    </p>
  `;

  return {
    subject,
    html: shell({ preheader, body }),
    text: [
      `Confirm your email — ${BRAND.name}`,
      '',
      `Thanks for signing up ${kid} for Market Juice!`,
      'Click to confirm:',
      link,
      '',
      `Delete anytime: ${deleteLink}`,
      'Link expires in 7 days.',
    ].join('\n'),
  };
}

// ============================================================
// 3) Welcome email (fires once on activation)
// ============================================================
export function renderWelcomeEmail(user) {
  const kid = escapeHTML(user.kid_first_name);
  const username = escapeHTML(user.username || '');
  const digestLink = appUrl('/digest');
  const loginLink = appUrl('/login');
  const subject = `${kid} is in! First digest arrives tomorrow at 7 AM`;
  const preheader = `Welcome to Market Juice — here's what to expect.`;

  // Phase 7: include kid's login credentials block when a username is on
  // file (every signup after Phase 7 will have one — older accounts won't).
  const credentialsBlock = username ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           style="background:#f0f7ff;border:1px solid #d6e7ff;border-left:4px solid ${BRAND.blue};border-radius:8px;margin:0 0 18px 0;">
      <tr><td style="padding:14px 18px;color:#1c2030;font-size:14px;line-height:1.7;">
        <strong>Login info for ${kid}:</strong><br>
        Username: <strong style="font-family:'Courier New',monospace;">${username}</strong><br>
        Password: the one you chose during signup<br>
        Log in at: <a href="${escapeHTML(loginLink)}" style="color:${BRAND.blue};">${escapeHTML(loginLink)}</a><br>
        <span style="color:#454a5b;font-size:13px;">Save this email — you'll need the username if they forget it.</span>
      </td></tr>
    </table>
  ` : '';

  const body = `
    <h1 style="font-size:24px;font-weight:700;color:#1c2030;margin:0 0 14px 0;letter-spacing:-0.5px;">
      🎉 ${kid} is in!
    </h1>
    <p style="margin:0 0 18px 0;font-size:15px;color:#454a5b;">
      Welcome to <strong>Market Juice</strong>. Tomorrow at <strong>7 AM EST</strong>,
      ${kid} will get the first daily digest: real market headlines, today's biggest mover,
      and 3 short games that teach real investing principles.
    </p>
    ${credentialsBlock}
    <p style="margin:0 0 22px 0;font-size:15px;color:#454a5b;">
      Want to peek before tomorrow's digest lands?
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px 0;">
      <tr><td style="background:linear-gradient(135deg,${BRAND.accent},${BRAND.blue});border-radius:999px;">
        <a href="${escapeHTML(digestLink)}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;">
          See the digest →
        </a>
      </td></tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           style="background:#f7f4ff;border:1px solid #e8defc;border-left:4px solid ${BRAND.accent};border-radius:8px;margin:0 0 8px 0;">
      <tr><td style="padding:14px 18px;color:#454a5b;font-size:14px;line-height:1.7;">
        <strong>Quick tip:</strong> on iPhone, tap the share button in Safari and pick
        "Add to Home Screen" so the digest opens like an app each morning.
      </td></tr>
    </table>
    <p style="margin:18px 0 0 0;font-size:13px;color:#8b91a3;">
      Reply to this email any time. We read every message.
    </p>
  `;

  const credentialsText = username
    ? `\nLogin info for ${kid}:\n  Username: ${username}\n  Password: the one you chose during signup\n  Log in at: ${loginLink}\nSave this email — you'll need the username if they forget it.\n`
    : '';

  return {
    subject,
    html: shell({ preheader, body }),
    text: [
      `${kid} is in! First digest arrives tomorrow at 7 AM EST.`,
      credentialsText,
      `Want to peek? ${digestLink}`,
      '',
      'On iPhone: tap the share button in Safari → "Add to Home Screen" so the digest opens like an app.',
      '',
      'Reply to this email any time. We read every message.',
    ].join('\n'),
  };
}

// ============================================================
// 4) Deletion acknowledgement
// ============================================================
// Sent for every /api/delete-data submission regardless of whether a match
// existed — same body either way so we never leak existence.
export function renderDeletionAckEmail({ parent_email }) {
  const email = escapeHTML(parent_email);
  const subject = `Your Market Juice deletion request`;
  const preheader = `We received your deletion request.`;

  const body = `
    <h1 style="font-size:22px;font-weight:700;color:#1c2030;margin:0 0 14px 0;letter-spacing:-0.3px;">
      Deletion request received
    </h1>
    <p style="margin:0 0 16px 0;font-size:15px;color:#454a5b;">
      We received a request to delete the Market Juice account associated with
      <strong>${email}</strong>.
    </p>
    <p style="margin:0 0 16px 0;font-size:15px;color:#454a5b;">
      If an account existed at that address, it has been removed along with all
      associated data. If no account existed, no further action is needed — we
      logged the request anyway for compliance.
    </p>
    <p style="margin:0;font-size:14px;color:#454a5b;">
      Didn't request this? Reply to this email and we'll look into it.
    </p>
  `;

  return {
    subject,
    html: shell({ preheader, body }),
    text: [
      'Deletion request received',
      '',
      `We received a request to delete the Market Juice account associated with ${parent_email}.`,
      'If an account existed at that address, it has been removed.',
      'If no account existed, no further action is needed.',
      '',
      "Didn't request this? Reply and we'll look into it.",
    ].join('\n'),
  };
}

// ============================================================
// 5) Daily teaser (7 AM EST)
// ============================================================
// Takes today's digest content (the same shape generateContent() produces in
// src/ai.js + src/generate.js) and renders a short, click-bait-y teaser.
// The teaser is intentionally minimal — its only job is to get the kid into
// the web digest.
export function renderDailyTeaserEmail(user, content) {
  const kid = escapeHTML(user.kid_first_name);
  const digestLink = appUrl('/digest');

  const vibe = content?.marketVibe || 'mixed'; // 'green' | 'red' | 'mixed'
  const vibeEmoji = vibe === 'green' ? '🟢' : vibe === 'red' ? '🔴' : '🟡';
  const vibeWord = vibe === 'green' ? 'green' : vibe === 'red' ? 'red' : 'mixed';
  const vibeColor = vibe === 'green' ? BRAND.green : vibe === 'red' ? BRAND.red : '#8a6a00';
  const vibeBg = vibe === 'green' ? BRAND.greenBg : vibe === 'red' ? BRAND.redBg : '#fff7d6';

  const topMover = content?.scoreboard?.topMover;
  const topMoverLine = topMover
    ? `${escapeHTML(topMover.name)} (${escapeHTML(topMover.ticker)}) — ${escapeHTML(topMover.change)}`
    : null;

  const headline = content?.stories?.[0]?.title || 'Today\'s biggest market story';
  const dateLabel = escapeHTML(content?.date || new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));

  const subject = `${vibeEmoji} Today's Juice: ${dateLabel}`;
  const preheader = topMoverLine
    ? `Today's mover: ${topMoverLine}. Tap to read.`
    : `Today's digest is live — tap to read.`;

  const body = `
    <div style="display:inline-block;background:${vibeBg};color:${vibeColor};font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:6px 12px;border-radius:999px;margin-bottom:14px;">
      ${vibeEmoji}&nbsp; Market vibe: ${vibeWord}
    </div>
    <h1 style="font-size:22px;font-weight:700;color:#1c2030;margin:0 0 10px 0;letter-spacing:-0.3px;">
      ${escapeHTML(headline)}
    </h1>
    ${topMoverLine ? `
      <p style="margin:0 0 18px 0;font-size:14px;color:#454a5b;">
        ⭐ <strong>Today's mover:</strong> ${topMoverLine}
      </p>` : ''}
    <p style="margin:0 0 22px 0;font-size:15px;color:#454a5b;">
      Hey ${kid} — your daily buzz is ready. 3 minutes, 3 games, real markets.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;">
      <tr><td style="background:linear-gradient(135deg,${BRAND.accent},${BRAND.blue});border-radius:999px;">
        <a href="${escapeHTML(digestLink)}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;">
          Read today's Buzz →
        </a>
      </td></tr>
    </table>
    <p style="margin:14px 0 0 0;font-size:12px;color:#8b91a3;">
      A new digest every weekday at 7 AM EST. Keep that streak alive.
    </p>
  `;

  return {
    subject,
    html: shell({ preheader, body }),
    text: [
      `Today's Market Juice — ${dateLabel}`,
      '',
      `Market vibe: ${vibeWord}`,
      headline,
      topMoverLine ? `Today's mover: ${topMoverLine}` : '',
      '',
      `Read it: ${digestLink}`,
    ].filter(Boolean).join('\n'),
  };
}

// ============================================================
// 6) Password reset (Phase 7)
// ============================================================
// Parent-initiated. Sent in response to POST /api/forgot-password when an
// account with the supplied parent_email exists. The link contains a
// short-lived (1 hour) token; clicking it lands on /reset-password where
// the parent picks a new password for the kid.
export function renderPasswordResetEmail(user, link) {
  const kid = escapeHTML(user.kid_first_name || 'your kid');
  const subject = `Reset password for ${kid}'s Market Juice account`;
  const preheader = `Set a new password for ${kid}. Link expires in 1 hour.`;

  const body = `
    <h1 style="font-size:22px;font-weight:700;color:#1c2030;margin:0 0 14px 0;letter-spacing:-0.3px;">
      🔐 Reset password
    </h1>
    <p style="margin:0 0 14px 0;font-size:15px;color:#454a5b;">
      Hi! Someone requested a password reset for <strong>${kid}</strong>'s Market Juice account.
      Click the button below to set a new password.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;">
      <tr><td style="background:linear-gradient(135deg,${BRAND.accent},${BRAND.blue});border-radius:999px;">
        <a href="${escapeHTML(link)}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;">
          Reset password →
        </a>
      </td></tr>
    </table>
    <p style="margin:0 0 14px 0;font-size:14px;color:#454a5b;">
      Or paste this link into your browser:<br>
      <a href="${escapeHTML(link)}" style="color:${BRAND.blue};word-break:break-all;">${escapeHTML(link)}</a>
    </p>
    <p style="margin:0 0 8px 0;font-size:13px;color:#8b91a3;">
      This link expires in 1 hour. If you didn't request this, you can safely ignore this email — ${kid}'s current password still works.
    </p>
  `;

  return {
    subject,
    html: shell({ preheader, body }),
    text: [
      `Reset password for ${kid}'s Market Juice account`,
      '',
      `Someone requested a password reset. Click to set a new one:`,
      link,
      '',
      'Link expires in 1 hour.',
      "If you didn't request this, you can safely ignore this email.",
    ].join('\n'),
  };
}

// ============================================================
// sendEmail — the only function that talks to Resend.
// ============================================================
// Same signature as the Phase 5 stub. Resolves `{ ok, id }` on success or
// `{ ok: false, error }` on failure. Never throws — caller treats this as
// fire-and-forget so a transient send failure doesn't break the request.
export async function sendEmail({ to, subject, html, text, from }) {
  const sender = from || FROM_EMAIL;

  // Stub mode — no API key. Log to console so dev can copy URLs out (matches
  // the Phase 5 behavior exactly).
  if (!resend) {
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`📧 [stub-send] To: ${to}`);
    console.log(`📧 [stub-send] From: ${sender}`);
    console.log(`📧 [stub-send] Subject: ${subject}`);
    console.log('───────────────────────────────────────────────────────────────');
    console.log(text);
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');
    return { ok: true, id: 'stub-' + Date.now(), stub: true };
  }

  try {
    const result = await resend.emails.send({
      from: sender,
      to,
      subject,
      html,
      text,
    });
    if (result?.error) {
      console.error(`[emails] Resend rejected: ${result.error.message || result.error}`);
      return { ok: false, error: result.error.message || String(result.error) };
    }
    const id = result?.data?.id || result?.id;
    console.log(`[emails] sent → ${to} (${subject}) id=${id}`);
    return { ok: true, id };
  } catch (err) {
    console.error(`[emails] send failed → ${to}: ${err.message}`);
    return { ok: false, error: err.message };
  }
}
