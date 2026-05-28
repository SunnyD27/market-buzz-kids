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
// Normalize APP_BASE_URL: strip trailing slash AND guarantee a scheme.
// A protocol-less value (e.g. APP_BASE_URL=themarketjuice.com set without
// https:// in the Railway dashboard) would otherwise produce unclickable
// links like "themarketjuice.com/login" in emails. If no scheme is
// present, assume https (localhost dev keeps its explicit http://).
function normalizeBaseUrl(raw) {
  let url = (raw || 'http://localhost:3199').trim().replace(/\/$/, '');
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  return url;
}
const APP_BASE_URL = normalizeBaseUrl(process.env.APP_BASE_URL);

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

// Multi-kid name joiners. joinNames → plain Oxford-comma list ("Riley",
// "Riley and Jordan", "Riley, Jordan, and Sam"). possessiveNames appends
// "'s" for subject lines ("Riley and Jordan's"). Callers pass already-safe
// strings or escape downstream.
function joinNames(names) {
  const n = (names || []).filter(Boolean);
  if (n.length === 0) return '';
  if (n.length === 1) return n[0];
  if (n.length === 2) return `${n[0]} and ${n[1]}`;
  return `${n.slice(0, -1).join(', ')}, and ${n[n.length - 1]}`;
}
function possessiveNames(names) {
  const joined = joinNames(names);
  return joined ? `${joined}'s` : '';
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
          Questions or want to delete data? Reply to this email or
          <a href="${escapeHTML(deleteLink)}" style="color:${BRAND.blue};text-decoration:underline;">delete your data here</a>.
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
          <li>A username and a securely hashed password so ${kid} can log in</li>
          <li>Engagement data: games played, quiz answers, Market Coins, streak, Perfect Days</li>
          <li>Standard technical info: device type, timezone, and IP address (for security and to verify your consent)</li>
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
          <li><a href="${escapeHTML(deleteLink)}" style="color:${BRAND.blue};text-decoration:underline;">Delete ${kid}'s account and ALL data</a> anytime</li>
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
// 1b) Add-child consent (multi-kid abbreviated flow)
// ============================================================
// Sent when a KNOWN parent (already has an active, verified child) signs
// up a sibling. The email is the consent gate — we skip re-verifying the
// address (already proven) but the parent still clicks a link in their own
// inbox to activate the child, keeping consent email-gated.
//
// Copy varies by age (D2): full COPPA parent/guardian framing for 10-12,
// a lighter "confirm you're adding" framing for 13-16 (COPPA doesn't apply
// to 13+, but we keep the consistent confirm-by-email UX).
export function renderAddChildConsentEmail(user, link) {
  const kid = escapeHTML(user.kid_first_name);
  const deleteLink = appUrl('/parent/delete-data');
  const isUnder13 = user.kid_age >= 10 && user.kid_age <= 12;

  const subject = `Confirm you're adding ${kid} to Market Juice`;
  const preheader = `One click to add ${kid} to your Market Juice family.`;

  const introLine = isUnder13
    ? `You're adding <strong>${kid}</strong>, age ${user.kid_age}, to your Market Juice family. Because ${kid} is under 13, U.S. law (COPPA) requires your consent before we collect their information.`
    : `You're adding <strong>${kid}</strong>, age ${user.kid_age}, to your Market Juice family. One click confirms it's really you.`;

  const ctaLabel = isUnder13
    ? `✅ I'm ${kid}'s parent/guardian — create their account`
    : `✅ Confirm — create ${kid}'s account`;

  const closingLine = isUnder13
    ? `By clicking, you confirm you are ${kid}'s parent or legal guardian.`
    : `By clicking, you confirm you're adding ${kid} with your permission.`;

  const body = `
    <h1 style="font-size:24px;font-weight:700;color:#1c2030;margin:0 0 12px 0;letter-spacing:-0.5px;">
      Add ${kid} to Market Juice
    </h1>
    <p style="margin:0 0 18px 0;font-size:15px;color:#454a5b;">
      ${introLine}
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           style="background:#f7f4ff;border:1px solid #e8defc;border-left:4px solid ${BRAND.accent};border-radius:8px;margin:0 0 24px 0;">
      <tr><td style="padding:16px 18px;">
        <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${BRAND.accent};margin-bottom:10px;">What we collect for ${kid}</div>
        <ul style="margin:0;padding-left:20px;color:#454a5b;font-size:14px;line-height:1.7;">
          <li>First name and age</li>
          <li>Username and a securely hashed password (for login)</li>
          <li>Quiz answers, game activity, and learning progress (Market Coins, streaks, badges)</li>
          <li>Daily digest interaction data</li>
          <li>Standard technical info: device type, timezone, and IP address (for security and to verify your consent)</li>
        </ul>
        <p style="margin:14px 0 0 0;font-size:13px;color:#6b7280;line-height:1.6;">
          We use this only to deliver the daily digest and track ${kid}'s progress. We don't share it with third parties.
          You can <a href="${escapeHTML(deleteLink)}" style="color:${BRAND.blue};text-decoration:underline;">review or delete ${kid}'s data</a> anytime.
        </p>
      </td></tr>
    </table>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px 0;">
      <tr><td style="background:linear-gradient(135deg,${BRAND.accent},${BRAND.blue});border-radius:999px;">
        <a href="${escapeHTML(link)}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;letter-spacing:0.2px;">
          ${ctaLabel}
        </a>
      </td></tr>
    </table>

    <p style="margin:0 0 4px 0;font-size:13px;color:#8b91a3;">Or paste this link into your browser:</p>
    <p style="margin:0 0 18px 0;font-size:12px;color:${BRAND.blue};word-break:break-all;">${escapeHTML(link)}</p>
    <p style="margin:18px 0 0 0;font-size:13px;color:#8b91a3;">
      ${closingLine} This link expires in 7 days. If you didn't request this, ignore this email — nothing happens until you click.
    </p>
  `;

  return {
    subject,
    html: shell({ preheader, body }),
    text: [
      `Add ${kid} to Market Juice`,
      '',
      isUnder13
        ? `You're adding ${kid} (age ${user.kid_age}). Because ${kid} is under 13, U.S. COPPA law requires your consent before we collect their information.`
        : `You're adding ${kid} (age ${user.kid_age}) to your Market Juice family. One click confirms it's really you.`,
      '',
      `We collect for ${kid}: first name + age, username + a securely hashed password, quiz/game activity and learning progress, daily digest interaction data, and standard technical info (device type, timezone, IP address) for security and consent verification. We don't share it with third parties.`,
      '',
      `Click to confirm and create ${kid}'s account:`,
      link,
      '',
      `${closingLine.replace(/<[^>]+>/g, '')}`,
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
      What we collect: ${kid}'s first name, age, username, and engagement data (Market Coins, streak, quiz answers).
      No selling, no sharing.
      <a href="${escapeHTML(deleteLink)}" style="color:${BRAND.blue};text-decoration:underline;">Delete anytime</a>.
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
export function renderWelcomeEmail(user, opts = {}) {
  const kid = escapeHTML(user.kid_first_name);
  const username = escapeHTML(user.username || '');
  const digestLink = appUrl('/digest');
  const loginLink = appUrl('/login');
  const progressLink = appUrl('/progress');
  const deleteLink = appUrl('/parent/delete-data');
  // Multi-kid: when a known parent adds a sibling, this welcome email
  // doubles as the safety net. A "didn't set this up?" line gives the
  // real parent an immediate undo path (consent was email-gated, so this
  // is belt-and-suspenders rather than the primary safeguard).
  const addChild = opts.addChild === true;
  const subject = addChild
    ? `${kid} has been added to Market Juice`
    : `${kid} is in — today's digest is live!`;
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
      Welcome to <strong>Market Juice</strong>! <strong>Today's digest is live now</strong>
      with real market headlines, today's biggest mover, and 3 short games that teach real
      investing principles. Fresh ones land daily at <strong>7 AM EST</strong>.
    </p>
    ${credentialsBlock}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px 0;">
      <tr><td style="background:linear-gradient(135deg,${BRAND.accent},${BRAND.blue});border-radius:999px;">
        <a href="${escapeHTML(digestLink)}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;">
          See today's digest →
        </a>
      </td></tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           style="background:#f7f4ff;border:1px solid #e8defc;border-left:4px solid ${BRAND.accent};border-radius:8px;margin:0 0 8px 0;">
      <tr><td style="padding:14px 18px;color:#454a5b;font-size:14px;line-height:1.7;">
        <strong>Quick tip:</strong> on iPhone or iPad, tap the share button in Safari and pick
        "Add to Home Screen" so the digest opens like an app each morning.
      </td></tr>
    </table>
    <p style="margin:14px 0 0 0;font-size:14px;color:#454a5b;line-height:1.55;">
      As ${kid} plays, they'll earn <strong>Market Coins</strong>, climb investor ranks,
      and unlock badges. See the full profile any time at
      <a href="${escapeHTML(progressLink)}" style="color:${BRAND.accent};">${escapeHTML(progressLink)}</a>.
    </p>
    ${addChild ? `
    <p style="margin:18px 0 0 0;font-size:13px;color:#8b91a3;">
      Didn't set this up? <a href="${escapeHTML(deleteLink)}" style="color:${BRAND.blue};text-decoration:underline;">Remove ${kid} here</a> — or just reply to this email and we'll take care of it.
    </p>` : ''}
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
      addChild ? `${kid} has been added to Market Juice.` : `${kid} is in! Today's digest is live now.`,
      credentialsText,
      `See today's digest: ${digestLink}`,
      '',
      'On iPhone or iPad: tap the share button in Safari → "Add to Home Screen" so the digest opens like an app.',
      '',
      `As ${kid} plays, they'll earn Market Coins, climb investor ranks, and unlock badges. See the full profile at ${progressLink}.`,
      addChild ? `\nDidn't set this up? Remove ${kid}: ${deleteLink} — or reply to this email.` : '',
      '',
      'Reply to this email any time. We read every message.',
    ].filter(Boolean).join('\n'),
  };
}

// ============================================================
// 4) Deletion acknowledgement
// ============================================================
// Sent for every /api/delete-data submission. When specific kids were
// deleted (multi-kid selection), name them (`kidNames` captured before the
// scrub). When no match existed, the generic copy keeps us from leaking
// existence through the email channel.
export function renderDeletionAckEmail({ parent_email, kidNames }) {
  const email = escapeHTML(parent_email);
  const names = Array.isArray(kidNames) ? kidNames.filter(Boolean) : [];
  const subject = `Your Market Juice deletion request`;
  const preheader = `We received your deletion request.`;

  // When we know which kids were deleted, lead with that — it's clearer
  // and reassuring for the parent. Names are escaped for the HTML body.
  const namesHTML = names.length ? escapeHTML(joinNames(names)) : '';
  const confirmLine = names.length
    ? `<p style="margin:0 0 16px 0;font-size:15px;color:#454a5b;">
         <strong>${namesHTML}</strong>'s Market Juice account${names.length === 1 ? ' has' : 's have'} been deleted. All personal information was removed; we retain only an anonymized record that a deletion request was made, as required for compliance.
       </p>`
    : `<p style="margin:0 0 16px 0;font-size:15px;color:#454a5b;">
         If an account existed at that address, all personal information has been
         deleted. We retain only an anonymized record that a deletion request was
         made, as required for compliance. If no account existed, no further
         action is needed — we logged the request anyway for the same reason.
       </p>`;

  const body = `
    <h1 style="font-size:22px;font-weight:700;color:#1c2030;margin:0 0 14px 0;letter-spacing:-0.3px;">
      Deletion request received
    </h1>
    <p style="margin:0 0 16px 0;font-size:15px;color:#454a5b;">
      We received a request to delete Market Juice ${names.length > 1 ? 'accounts' : 'data'} associated with
      <strong>${email}</strong>.
    </p>
    ${confirmLine}
    <p style="margin:0;font-size:14px;color:#454a5b;">
      Didn't request this? Reply to this email and we'll look into it.
    </p>
  `;

  const confirmText = names.length
    ? `${joinNames(names)}'s Market Juice account${names.length === 1 ? ' has' : 's have'} been deleted. All personal information was removed; we retain only an anonymized compliance record.`
    : 'If an account existed at that address, all personal information has been deleted. We retain only an anonymized record that a deletion request was made, as required for compliance. If no account existed, no further action is needed — we logged the request anyway for the same reason.';

  return {
    subject,
    html: shell({ preheader, body }),
    text: [
      'Deletion request received',
      '',
      `We received a request to delete Market Juice data associated with ${parent_email}.`,
      confirmText,
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
  // Multi-kid: `user.kidNames` (array) when one parent has several kids;
  // falls back to the single `kid_first_name` for the one-kid path.
  const names = Array.isArray(user.kidNames) && user.kidNames.length
    ? user.kidNames
    : [user.kid_first_name];
  const kid = escapeHTML(joinNames(names));   // "Riley" or "Riley and Jordan"
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
      Hey ${kid} — your daily juice is ready. 3 minutes, 3 games, real markets.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;">
      <tr><td style="background:linear-gradient(135deg,${BRAND.accent},${BRAND.blue});border-radius:999px;">
        <a href="${escapeHTML(digestLink)}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;">
          Read today's Juice →
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

// Multi-kid: when a parent email has 2+ children, we send ONE reset email
// listing each child with their own reset link (rather than N separate
// emails, or leaking the child list in an in-browser screen). The parent
// picks the right child inside their own inbox. `resets` is an array of
// { kidName, username, link }.
export function renderMultiKidPasswordResetEmail(resets) {
  const subject = `Reset a password for your Market Juice kids`;
  const preheader = `Pick which child's password to reset. Links expire in 1 hour.`;

  const rows = resets.map(r => {
    const kid = escapeHTML(r.kidName || 'your kid');
    const uname = r.username ? `<span style="color:#8b91a3;font-size:13px;"> (username: ${escapeHTML(r.username)})</span>` : '';
    return `
      <tr><td style="padding:12px 0;border-bottom:1px solid #eef0f4;">
        <div style="font-size:15px;font-weight:600;color:#1c2030;margin-bottom:8px;">${kid}${uname}</div>
        <a href="${escapeHTML(r.link)}" style="display:inline-block;padding:10px 20px;background:linear-gradient(135deg,${BRAND.accent},${BRAND.blue});color:#fff;font-size:14px;font-weight:700;text-decoration:none;border-radius:999px;">
          Reset ${kid}'s password →
        </a>
      </td></tr>`;
  }).join('');

  const body = `
    <h1 style="font-size:22px;font-weight:700;color:#1c2030;margin:0 0 14px 0;letter-spacing:-0.3px;">
      🔐 Reset a password
    </h1>
    <p style="margin:0 0 18px 0;font-size:15px;color:#454a5b;">
      You have more than one child on Market Juice. Pick which account you want to reset:
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      ${rows}
    </table>
    <p style="margin:18px 0 0 0;font-size:13px;color:#8b91a3;">
      Each link expires in 1 hour. If you didn't request this, you can safely ignore this email — all current passwords still work.
    </p>
  `;

  const text = [
    `Reset a password for your Market Juice kids`,
    '',
    'Pick which child to reset:',
    '',
    ...resets.map(r => `- ${r.kidName}${r.username ? ` (username: ${r.username})` : ''}: ${r.link}`),
    '',
    'Each link expires in 1 hour.',
    "If you didn't request this, you can safely ignore this email.",
  ].join('\n');

  return { subject, html: shell({ preheader, body }), text };
}

// ============================================================
// 6b) Data-deletion verification (Fix 5 — token-gated deletion)
// ============================================================
// Sent in response to a parent submitting their email on the deletion page.
// The link carries a single-use 1-hour 'delete_data' token; clicking it
// returns the parent to /parent/delete-data?token=… where they can review
// the child list and confirm deletion. Mirrors the no-leak password-reset
// pattern — the same email is implied for any address, and only a real
// account produces a working link.
export function renderDeleteDataVerifyEmail(link) {
  const subject = `Confirm your data deletion request — Market Juice`;
  const preheader = `Confirm it's you, then review or delete your account data. Link expires in 1 hour.`;

  const body = `
    <h1 style="font-size:22px;font-weight:700;color:#1c2030;margin:0 0 14px 0;letter-spacing:-0.3px;">
      Confirm your data request
    </h1>
    <p style="margin:0 0 14px 0;font-size:15px;color:#454a5b;">
      We received a request to review or delete account data associated with this email on Market Juice.
    </p>
    <p style="margin:0 0 18px 0;font-size:15px;color:#454a5b;">
      If you made this request, click below to continue:
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;">
      <tr><td style="background:linear-gradient(135deg,${BRAND.accent},${BRAND.blue});border-radius:999px;">
        <a href="${escapeHTML(link)}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;">
          Review My Data →
        </a>
      </td></tr>
    </table>
    <p style="margin:0 0 14px 0;font-size:14px;color:#454a5b;">
      Or paste this link into your browser:<br>
      <a href="${escapeHTML(link)}" style="color:${BRAND.blue};word-break:break-all;">${escapeHTML(link)}</a>
    </p>
    <p style="margin:0 0 8px 0;font-size:13px;color:#8b91a3;">
      This link expires in 1 hour. If you didn't make this request, you can safely ignore this email — nothing will be changed.
    </p>
  `;

  return {
    subject,
    html: shell({ preheader, body }),
    text: [
      `Confirm your data deletion request — Market Juice`,
      '',
      `We received a request to review or delete account data associated with this email.`,
      `If you made this request, click to continue:`,
      link,
      '',
      `This link expires in 1 hour. If you didn't make this request, you can safely ignore this email.`,
    ].join('\n'),
  };
}

// ============================================================
// sendEmail — the only function that talks to Resend.
// ============================================================
// Same signature as the Phase 5 stub. Resolves `{ ok, id }` on success or
// `{ ok: false, error }` on failure. Never throws — caller treats this as
// fire-and-forget so a transient send failure doesn't break the request.
export async function sendEmail({ to, subject, html, text, from, kind }) {
  const sender = from || FROM_EMAIL;

  // Stub mode — no API key. Log to console so dev can copy URLs out (matches
  // the Phase 5 behavior exactly).
  if (!resend) {
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`📧 [stub-send] To: ${to}`);
    console.log(`📧 [stub-send] From: ${sender}`);
    console.log(`📧 [stub-send] Subject: ${subject}`);
    if (kind) console.log(`📧 [stub-send] Kind: ${kind}`);
    console.log('───────────────────────────────────────────────────────────────');
    console.log(text);
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');
    return { ok: true, id: 'stub-' + Date.now(), stub: true };
  }

  try {
    // Phase 13: tag every send with its `kind` so the Resend webhook can
    // attribute deliverability events to an email type (teaser, evening-recap,
    // verify, …). Resend tag values must match /^[A-Za-z0-9_-]+$/, which all
    // our kinds satisfy.
    const payload = {
      from: sender,
      to,
      subject,
      html,
      text,
    };
    if (kind) payload.tags = [{ name: 'kind', value: kind }];
    const result = await resend.emails.send(payload);
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

// ============================================================
// 7) Evening parent recap / nudge (Phase 12)
// ============================================================
// Fires at 7 PM local-to-each-user. Two variants:
//   - 'recap': kid engaged today → game summary + conversation starters
//   - 'nudge': kid didn't engage but streak ≥ 3 → light tease + link to /digest
// Cron-side (src/server.js#sendEveningRecaps) picks the variant; renderer
// just builds the email.
//
// Tone: restrained, clean. The kid email is playful; this one is for the
// parent. Plain uppercase eyebrow labels, typographic dashes, the rank
// emoji in the footer + 💬 only next to kid-flagged items. No exclamation
// stacks, no gamification language.

/**
 * Map a section key ("story-0", "big-picture", "word-of-day", "did-you-know",
 * "quiz") to the corresponding parentExplainer object on a digest content
 * payload. Returns null for legacy digests that pre-date Phase 12 — the
 * caller renders a graceful fallback in that case.
 */
function getExplainerForSection(digestContent, section) {
  if (!digestContent || !section) return null;
  if (section.startsWith('story-')) {
    const idx = parseInt(section.split('-')[1], 10);
    const story = digestContent.stories?.[idx];
    return story?.parentExplainer || null;
  }
  const map = {
    'big-picture':  digestContent.bigPictureParentExplainer,
    'word-of-day':  digestContent.wordOfDay?.parentExplainer,
    'did-you-know': digestContent.didYouKnow?.parentExplainer,
    'quiz':         digestContent.quiz?.parentExplainer,
  };
  return map[section] || null;
}

/**
 * Replace the literal "[kid]" placeholder Claude emits in
 * parentExplainer.conversationStarter with the actual kid's first name.
 * Belt-and-suspenders escape so a stray HTML char in the kid's name
 * doesn't leak into the email body.
 */
function fillKidName(starter, kidName) {
  if (!starter) return '';
  return starter.replace(/\[kid\]/g, kidName);
}

/**
 * "Talk About It Tonight" picker. Always emits 2-3 starters from sections
 * the kid likely engaged with today, skipping anything already shown in
 * the kid-flagged 💬 block above.
 *
 * Order (per Sunny's Q1):
 *   1. Quiz       — if the kid played the quiz today (confirmed)
 *   2. Word       — if word-learned fired (confirmed)
 *   3. Backfill   — stories[0..n], big-picture, did-you-know in that order
 * Caps at 3.
 */
function pickTonightStarters({ engagement, digestContent, parentQuestions, kidName, cap }) {
  cap = cap || 3;
  const taken = new Set((parentQuestions || []).map(q => q.section));
  const out = [];

  function add(section) {
    if (out.length >= cap) return;
    if (taken.has(section)) return;
    const ex = getExplainerForSection(digestContent, section);
    if (!ex || !ex.conversationStarter) return;
    taken.add(section);
    out.push({ section, starter: fillKidName(ex.conversationStarter, kidName) });
  }

  // Confirmed engagement first.
  const quizPlayed = (engagement?.games || []).some(g => g.game === 'quiz');
  if (quizPlayed) add('quiz');
  if (engagement?.wordLearned) add('word-of-day');

  // Backfill — stories, then big-picture, then did-you-know.
  const storyCount = digestContent?.stories?.length || 0;
  for (let i = 0; i < storyCount && out.length < cap; i++) add(`story-${i}`);
  add('big-picture');
  add('did-you-know');
  return out;
}

/**
 * Pretty label for a game key. Falls back to the raw key (e.g. unknown
 * game type from a future version) so we never render "undefined".
 */
const GAME_LABELS = {
  'quiz':           'The Quiz',
  'bull-bear':      'Bull or Bear?',
  'price-is-right': 'Price is Right',
  'compound':       'Compound Machine',
  'match':          'Match the Company',
  'time-machine':   'Time Machine Trade',
};
function gameLabel(key) {
  return GAME_LABELS[key] || key || 'Game';
}

/**
 * Friendly date label for the email subject + header. Falls back to the
 * raw digestDate string on parse failure.
 */
function formatDigestDate(digestDate) {
  if (!digestDate) return '';
  try {
    return new Date(digestDate + 'T12:00:00Z')
      .toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'America/New_York' });
  } catch (_) {
    return String(digestDate);
  }
}

/**
 * Main renderer. Caller picks the variant; this just builds subject +
 * html + text. Returns the same shape as the other render* functions.
 */
export function renderEveningRecap({
  kidName,
  engagement,
  digestContent,
  progress,
  parentQuestions,
  digestDate,
  variant,
}) {
  const safeKid = escapeHTML(kidName || 'your kid');
  if (variant === 'nudge') {
    return renderNudge({ kidName: safeKid, digestContent, progress, digestDate });
  }
  return renderRecap({
    kidName: safeKid,
    engagement: engagement || {},
    digestContent: digestContent || {},
    progress: progress || {},
    parentQuestions: parentQuestions || [],
    digestDate,
  });
}

// ---- Recap variant (kid engaged today) ---------------------------------

function renderRecap({ kidName, engagement, digestContent, progress, parentQuestions, digestDate }) {
  const dateLabel = formatDigestDate(digestDate);
  const subject = `${kidName}'s Daily Squeeze — ${dateLabel}`;
  const preheader = `Here's what ${kidName} learned today.`;

  // --- Session summary line ---
  const gameWord = engagement.gamesPlayed === 1 ? 'game' : 'games';
  const sessionBits = [
    `Played ${engagement.gamesPlayed} ${gameWord}`,
    `Earned ${engagement.totalMC} Market Coins`,
  ];
  if (engagement.perfectDay) sessionBits.push('Perfect Day');
  const sessionLine = sessionBits.join(' · ');

  // --- Per-game brief (text-only — bulleted list) ---
  // Non-quiz games don't have parentExplainer in the digest schema; we
  // just list them with correct/participated. Quiz brief shows the
  // parentExplainer.summary since that section DOES carry one.
  const gameRows = (engagement.games || []).map(g => {
    const label = gameLabel(g.game);
    const outcomeRaw = typeof g.correct === 'boolean'
      ? (g.correct ? 'Correct' : 'Played')
      : 'Played';
    let detailLine = '';
    if (g.game === 'quiz') {
      const ex = getExplainerForSection(digestContent, 'quiz');
      if (ex?.summary) {
        detailLine = `<div style="font-size:13px;color:#6b7280;margin-top:2px;line-height:1.5;">${escapeHTML(ex.summary)}</div>`;
      }
    }
    return `
      <div style="padding:8px 0;border-bottom:1px solid #eef0f4;">
        <div style="font-size:14px;color:#1c2030;font-weight:600;">${escapeHTML(label)} <span style="color:#8b91a3;font-weight:400;">— ${escapeHTML(outcomeRaw)}</span></div>
        ${detailLine}
      </div>`;
  }).join('');

  // --- Word of the Day brief ---
  let wordBlock = '';
  if (engagement.wordLearned && digestContent.wordOfDay) {
    const ex = getExplainerForSection(digestContent, 'word-of-day');
    wordBlock = `
      <div style="padding:8px 0;border-bottom:1px solid #eef0f4;">
        <div style="font-size:14px;color:#1c2030;font-weight:600;">Word of the Day: ${escapeHTML(digestContent.wordOfDay.word)}</div>
        ${ex?.summary ? `<div style="font-size:13px;color:#6b7280;margin-top:2px;line-height:1.5;">${escapeHTML(ex.summary)}</div>` : ''}
      </div>`;
  }

  // --- Sunday Challenge brief ---
  let sundayBlock = '';
  if (engagement.sundayChallenge) {
    const type = engagement.sundayChallenge.type || 'challenge';
    const bonus = engagement.sundayChallenge.bonus ? ' · with bonus' : '';
    sundayBlock = `
      <div style="padding:8px 0;border-bottom:1px solid #eef0f4;">
        <div style="font-size:14px;color:#1c2030;font-weight:600;">Sunday Challenge: ${escapeHTML(type)}<span style="color:#8b91a3;font-weight:400;">${escapeHTML(bonus)}</span></div>
      </div>`;
  }

  // --- "RILEY WANTS TO TALK ABOUT" block — kid 💬 taps ---
  let kidFlaggedBlock = '';
  if (parentQuestions.length > 0) {
    const items = parentQuestions.map(q => {
      const ex = getExplainerForSection(digestContent, q.section);
      const topic = q.topic || q.section;
      // Backward-compat: legacy digest rows lack parentExplainer.
      // Show topic + a gentle prompt so the row still has substance.
      const detail = ex?.summary
        ? escapeHTML(ex.summary)
        : `${escapeHTML(kidName)} was curious about this — ask them what they remember.`;
      const starter = ex?.conversationStarter
        ? `<div style="margin-top:6px;font-size:14px;color:#454a5b;font-style:italic;">— ${escapeHTML(fillKidName(ex.conversationStarter, kidName))}</div>`
        : '';
      return `
        <div style="padding:12px 0;border-bottom:1px solid #eef0f4;">
          <div style="font-size:14px;color:#1c2030;font-weight:600;">💬 ${escapeHTML(topic)}</div>
          <div style="font-size:13px;color:#6b7280;margin-top:4px;line-height:1.5;">${detail}</div>
          ${starter}
        </div>`;
    }).join('');
    kidFlaggedBlock = `
      <div style="margin-top:24px;">
        <div style="font-size:11px;letter-spacing:1.5px;color:${BRAND.accent};font-weight:700;text-transform:uppercase;margin-bottom:10px;">${escapeHTML(kidName)} wants to talk about</div>
        ${items}
      </div>`;
  }

  // --- "TALK ABOUT IT TONIGHT" block — always present ---
  const tonight = pickTonightStarters({
    engagement,
    digestContent,
    parentQuestions,
    kidName,
    cap: 3,
  });
  let tonightBlock = '';
  if (tonight.length > 0) {
    const items = tonight.map(t =>
      `<li style="font-size:14px;color:#454a5b;margin:0 0 10px 0;line-height:1.55;padding-left:0;">— ${escapeHTML(t.starter)}</li>`
    ).join('');
    tonightBlock = `
      <div style="margin-top:24px;">
        <div style="font-size:11px;letter-spacing:1.5px;color:${BRAND.accent};font-weight:700;text-transform:uppercase;margin-bottom:10px;">Talk about it tonight</div>
        <ul style="margin:0;padding:0;list-style:none;">
          ${items}
        </ul>
      </div>`;
  }

  // --- Footer chip: streak / MC / rank ---
  const rank = progress?.progress?.rank || { name: 'Rookie', badge: '🟢' };
  const streak = progress?.progress?.currentStreak ?? 0;
  const mc = progress?.progress?.marketCoins ?? 0;
  const footerChip = `
    <div style="margin-top:24px;padding-top:18px;border-top:1px solid #e8eaf0;font-size:13px;color:#6b7280;line-height:1.7;">
      Streak: <strong style="color:#1c2030;">${streak} day${streak === 1 ? '' : 's'}</strong>
      · <strong style="color:#1c2030;">${mc} MC</strong>
      · ${escapeHTML(rank.badge)} <strong style="color:#1c2030;">${escapeHTML(rank.name)}</strong>
    </div>`;

  const body = `
    <p style="margin:0 0 6px 0;font-size:15px;color:#454a5b;">Hey there,</p>
    <p style="margin:0 0 18px 0;font-size:15px;color:#454a5b;">Here's what ${kidName} learned on Market Juice today.</p>

    <div style="font-size:11px;letter-spacing:1.5px;color:${BRAND.accent};font-weight:700;text-transform:uppercase;margin-bottom:8px;">Today's session</div>
    <div style="font-size:14px;color:#1c2030;margin-bottom:14px;">${escapeHTML(sessionLine)}</div>

    <div>${gameRows}${wordBlock}${sundayBlock}</div>

    ${kidFlaggedBlock}
    ${tonightBlock}
    ${footerChip}

    <p style="margin:22px 0 0 0;font-size:12px;color:#8b91a3;">
      Market Juice — your daily squeeze of market smarts.
    </p>
  `;

  // ---- Plain-text fallback ----
  const textLines = [
    `Hey there,`,
    `Here's what ${kidName} learned on Market Juice today.`,
    '',
    `TODAY'S SESSION`,
    sessionLine,
    '',
  ];
  (engagement.games || []).forEach(g => {
    const outcomeRaw = typeof g.correct === 'boolean' ? (g.correct ? 'Correct' : 'Played') : 'Played';
    textLines.push(`- ${gameLabel(g.game)} — ${outcomeRaw}`);
    if (g.game === 'quiz') {
      const ex = getExplainerForSection(digestContent, 'quiz');
      if (ex?.summary) textLines.push(`  ${ex.summary}`);
    }
  });
  if (engagement.wordLearned && digestContent.wordOfDay) {
    const ex = getExplainerForSection(digestContent, 'word-of-day');
    textLines.push(`- Word of the Day: ${digestContent.wordOfDay.word}`);
    if (ex?.summary) textLines.push(`  ${ex.summary}`);
  }
  if (engagement.sundayChallenge) {
    textLines.push(`- Sunday Challenge: ${engagement.sundayChallenge.type}${engagement.sundayChallenge.bonus ? ' (with bonus)' : ''}`);
  }
  if (parentQuestions.length > 0) {
    textLines.push('', `${kidName.toUpperCase()} WANTS TO TALK ABOUT`);
    parentQuestions.forEach(q => {
      const ex = getExplainerForSection(digestContent, q.section);
      textLines.push(`- ${q.topic || q.section}`);
      if (ex?.summary) textLines.push(`  ${ex.summary}`);
      if (ex?.conversationStarter) textLines.push(`  — ${fillKidName(ex.conversationStarter, kidName)}`);
    });
  }
  if (tonight.length > 0) {
    textLines.push('', `TALK ABOUT IT TONIGHT`);
    tonight.forEach(t => textLines.push(`- ${t.starter}`));
  }
  textLines.push('', `Streak: ${streak} day${streak === 1 ? '' : 's'} · ${mc} MC · ${rank.name}`);
  textLines.push('', 'Market Juice — your daily squeeze of market smarts.');

  return {
    subject,
    html: shell({ preheader, body }),
    text: textLines.join('\n'),
  };
}

// ---- Nudge variant (kid didn't engage, streak ≥ 3) ---------------------

function renderNudge({ kidName, digestContent, progress, digestDate }) {
  const subject = `${kidName}'s streak is at risk`;
  const preheader = `${kidName} hasn't squeezed today's juice yet.`;

  const topMover = digestContent?.scoreboard?.topMover;
  const moverLine = topMover
    ? `${escapeHTML(topMover.name)} ${escapeHTML(topMover.direction === 'down' ? 'fell' : 'jumped')} ${escapeHTML(topMover.change)}`
    : null;
  const word = digestContent?.wordOfDay?.word;
  const gameCount = digestContent?.dailyChallenge?.games?.length || 3;

  const streak = progress?.progress?.currentStreak ?? 0;
  const rank = progress?.progress?.rank || { name: 'Rookie', badge: '🟢' };
  const mc = progress?.progress?.marketCoins ?? 0;
  const shields = progress?.progress?.streakShields ?? 0;

  const streakMessage = streak >= 7
    ? `${kidName} has a <strong>${streak}-day streak</strong> going — that's ${mc} Market Coins of progress. ${shields > 0 ? 'Missing today will use an Emergency Fund to save it.' : 'Missing today will break it.'}`
    : streak >= 3
      ? `${kidName}'s <strong>${streak}-day streak</strong> is building. A quick 3-minute session keeps it alive.`
      : `${kidName} hasn't built a streak yet — today's a good day to start.`;

  const digestLink = appUrl('/digest');

  const teaseBits = [];
  if (moverLine) teaseBits.push(`<strong>${moverLine}</strong>`);
  if (word) teaseBits.push(`what "<strong>${escapeHTML(word)}</strong>" means`);
  teaseBits.push(`${gameCount} games to play`);
  const teaseSentence = teaseBits.length > 1
    ? `Today's digest covers ${teaseBits.slice(0, -1).join(', ')}, plus ${teaseBits[teaseBits.length - 1]}.`
    : `Today's digest is ready.`;

  const body = `
    <p style="margin:0 0 6px 0;font-size:15px;color:#454a5b;">Hey there,</p>
    <p style="margin:0 0 18px 0;font-size:15px;color:#454a5b;">${kidName} hasn't opened today's Market Juice yet.</p>

    <p style="margin:0 0 18px 0;font-size:14px;color:#454a5b;line-height:1.6;">${teaseSentence}</p>

    <p style="margin:0 0 22px 0;font-size:14px;color:#454a5b;line-height:1.6;">${streakMessage}</p>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;">
      <tr><td style="background:linear-gradient(135deg,${BRAND.accent},${BRAND.blue});border-radius:999px;">
        <a href="${escapeHTML(digestLink)}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">
          View today's digest →
        </a>
      </td></tr>
    </table>

    <p style="margin:14px 0 0 0;font-size:13px;color:#8b91a3;">
      There's still time — tomorrow's edition drops at 7 AM EST.
    </p>

    <div style="margin-top:24px;padding-top:18px;border-top:1px solid #e8eaf0;font-size:13px;color:#6b7280;line-height:1.7;">
      Streak: <strong style="color:#1c2030;">${streak} day${streak === 1 ? '' : 's'}</strong>
      · <strong style="color:#1c2030;">${mc} MC</strong>
      · ${escapeHTML(rank.badge)} <strong style="color:#1c2030;">${escapeHTML(rank.name)}</strong>
    </div>

    <p style="margin:22px 0 0 0;font-size:12px;color:#8b91a3;">
      Market Juice — your daily squeeze of market smarts.
    </p>
  `;

  const moverLineText = topMover
    ? `${topMover.name} ${topMover.direction === 'down' ? 'fell' : 'jumped'} ${topMover.change}`
    : null;
  const teaseTextBits = [];
  if (moverLineText) teaseTextBits.push(moverLineText);
  if (word) teaseTextBits.push(`what "${word}" means`);
  teaseTextBits.push(`${gameCount} games to play`);
  const teaseText = teaseTextBits.length > 1
    ? `Today's digest covers ${teaseTextBits.slice(0, -1).join(', ')}, plus ${teaseTextBits[teaseTextBits.length - 1]}.`
    : `Today's digest is ready.`;

  const streakText = streak >= 7
    ? `${kidName} has a ${streak}-day streak going — that's ${mc} Market Coins of progress. ${shields > 0 ? 'Missing today will use an Emergency Fund to save it.' : 'Missing today will break it.'}`
    : streak >= 3
      ? `${kidName}'s ${streak}-day streak is building. A quick 3-minute session keeps it alive.`
      : `${kidName} hasn't built a streak yet — today's a good day to start.`;

  const text = [
    `Hey there,`,
    `${kidName} hasn't opened today's Market Juice yet.`,
    '',
    teaseText,
    '',
    streakText,
    '',
    `View today's digest: ${digestLink}`,
    '',
    `Streak: ${streak} day${streak === 1 ? '' : 's'} · ${mc} MC · ${rank.name}`,
    '',
    'Market Juice — your daily squeeze of market smarts.',
  ].join('\n');

  return { subject, html: shell({ preheader, body }), text };
}
