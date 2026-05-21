/**
 * src/emails.js — Email templates.
 *
 * Each exported renderer returns { subject, html, text } — the shape Resend
 * (and most email providers) expects. Phase 5 logs the rendered output to
 * console for testing; Phase 6 wires the actual send call.
 *
 * Two templates so far:
 *   - renderConsentEmail(user, link)   — ages 10-12, COPPA email-plus consent
 *   - renderVerifyEmail(user, link)    — ages 13-16, standard email verification
 *
 * Templates use inline styles because most email clients strip <style> blocks
 * or ignore external CSS. Dark theme inverted to light for inbox compatibility.
 */

const BRAND = {
  name: 'Market Buzz Kids',
  primary: '#0d1117',
  accent: '#bc8cff',
  gold: '#f0c040',
  blue: '#58a6ff',
  greenBg: '#e6f7eb',
  greenText: '#1f7a36',
};

function escapeHTML(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

/**
 * Layout shared by both emails — branded header, content slot, footer.
 * @param {object} opts
 * @param {string} opts.preheader  Hidden preview text (shows in inbox list)
 * @param {string} opts.body       Inner HTML (already escaped)
 */
function shell({ preheader, body }) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${BRAND.name}</title></head>
<body style="margin:0;padding:0;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1c2030;line-height:1.55;">
  <!-- preheader: hidden but shows in inbox preview -->
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#f5f7fa;">${escapeHTML(preheader)}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f7fa;">
    <tr><td align="center" style="padding:32px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 14px rgba(0,0,0,0.04);">

        <!-- Header bar -->
        <tr><td style="background:${BRAND.primary};padding:20px 28px;color:#fff;">
          <div style="font-size:20px;font-weight:700;letter-spacing:-0.3px;">
            📈 ${BRAND.name}
          </div>
        </td></tr>

        <!-- Content -->
        <tr><td style="padding:28px 28px 12px 28px;">${body}</td></tr>

        <!-- Footer -->
        <tr><td style="padding:24px 28px 28px 28px;border-top:1px solid #eee;color:#8b91a3;font-size:12px;line-height:1.6;">
          You received this because someone signed your kid up for Market Buzz Kids.
          If that wasn't you, you can safely ignore this — no account will be created without your click.
          <br><br>
          Questions or want to delete data? Reply to this email or visit
          <a href="https://example.com/parent/delete-data" style="color:${BRAND.blue};">/parent/delete-data</a>.
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`;
}

// ============================================================
// Parental consent email (ages 10-12, COPPA email-plus)
// ============================================================
export function renderConsentEmail(user, link) {
  const kid = escapeHTML(user.kid_first_name);
  const subject = `Parental consent for ${kid} on Market Buzz Kids`;
  const preheader = `One click to activate ${kid}'s account. We'll explain exactly what we collect and how it's used.`;

  const body = `
    <h1 style="font-size:24px;font-weight:700;color:#1c2030;margin:0 0 12px 0;letter-spacing:-0.5px;">
      One click to activate ${kid}'s account
    </h1>
    <p style="margin:0 0 18px 0;font-size:15px;color:#454a5b;">
      Hi — someone (probably you) just signed up <strong>${kid}</strong>, age ${user.kid_age},
      for <strong>Market Buzz Kids</strong>. Because ${kid} is under 13, U.S. law (COPPA)
      requires us to get your consent before activating their account.
    </p>

    <p style="margin:0 0 22px 0;font-size:15px;color:#454a5b;">
      Here's exactly what we want you to know before you click:
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           style="background:#f7f4ff;border:1px solid #e8defc;border-left:4px solid ${BRAND.accent};border-radius:8px;margin:0 0 24px 0;">
      <tr><td style="padding:16px 18px;">
        <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${BRAND.accent};margin-bottom:10px;">
          What we collect
        </div>
        <ul style="margin:0;padding-left:20px;color:#454a5b;font-size:14px;line-height:1.7;">
          <li>${kid}'s first name and age (you gave us these)</li>
          <li>Engagement data: which games ${kid} plays, quiz answers, XP earned, streak, and Perfect Days</li>
          <li>If ${kid} adds Market Buzz to their home screen and turns on notifications: a push token (no other phone data)</li>
        </ul>

        <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${BRAND.accent};margin:18px 0 10px 0;">
          How we use it
        </div>
        <ul style="margin:0;padding-left:20px;color:#454a5b;font-size:14px;line-height:1.7;">
          <li>Deliver the daily digest at 7&nbsp;AM EST</li>
          <li>Track ${kid}'s learning progress (rank, streak, what they got right/wrong) so the games feel rewarding</li>
          <li>Send you a weekly summary email (you can opt out anytime)</li>
        </ul>

        <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${BRAND.accent};margin:18px 0 10px 0;">
          What we DON'T do
        </div>
        <ul style="margin:0;padding-left:20px;color:#454a5b;font-size:14px;line-height:1.7;">
          <li>Sell or share ${kid}'s data with third parties</li>
          <li>Use ${kid}'s data to train AI models</li>
          <li>Show ads. Ever.</li>
        </ul>

        <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:${BRAND.accent};margin:18px 0 10px 0;">
          Your rights
        </div>
        <ul style="margin:0;padding-left:20px;color:#454a5b;font-size:14px;line-height:1.7;">
          <li>Request all of ${kid}'s data at any time (reply to this email)</li>
          <li>Delete ${kid}'s account and ALL data instantly via <a href="https://example.com/parent/delete-data" style="color:${BRAND.blue};">/parent/delete-data</a></li>
          <li>Refuse further collection — we'll stop immediately if you ask</li>
        </ul>
      </td></tr>
    </table>

    <!-- Consent button -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px 0;">
      <tr><td style="background:linear-gradient(135deg,${BRAND.accent},${BRAND.blue});border-radius:999px;">
        <a href="${escapeHTML(link)}"
           style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;letter-spacing:0.2px;">
          ✅ I'm ${kid}'s parent/guardian — activate the account
        </a>
      </td></tr>
    </table>

    <p style="margin:0 0 4px 0;font-size:13px;color:#8b91a3;">
      Or paste this link into your browser:
    </p>
    <p style="margin:0 0 18px 0;font-size:12px;color:${BRAND.blue};word-break:break-all;">
      ${escapeHTML(link)}
    </p>

    <p style="margin:18px 0 0 0;font-size:13px;color:#8b91a3;">
      This link expires in 7 days. If you didn't sign up, ignore this email — nothing happens until you click.
    </p>
  `;

  return {
    subject,
    html: shell({ preheader, body }),
    text: [
      `Parental consent for ${kid} on Market Buzz Kids`,
      '',
      `Someone signed up ${kid} (age ${user.kid_age}) for Market Buzz Kids.`,
      `Because ${kid} is under 13, U.S. COPPA law requires your consent before we activate their account.`,
      '',
      'WHAT WE COLLECT:',
      `  - ${kid}'s first name and age`,
      `  - Engagement data: games played, quiz answers, XP, streak, Perfect Days`,
      `  - Push token (only if ${kid} turns on notifications)`,
      '',
      'HOW WE USE IT:',
      `  - Deliver the daily digest at 7am EST`,
      `  - Track learning progress for the rank/streak system`,
      `  - Weekly summary email (opt-out anytime)`,
      '',
      'WHAT WE DO NOT DO:',
      `  - Sell or share data with third parties`,
      `  - Train AI on ${kid}'s data`,
      `  - Show ads`,
      '',
      'YOUR RIGHTS:',
      `  - Request all data anytime (reply to this email)`,
      `  - Delete instantly at /parent/delete-data`,
      `  - Stop further collection anytime`,
      '',
      `Click this link to confirm you are ${kid}'s parent/guardian and activate the account:`,
      link,
      '',
      'Link expires in 7 days. Ignore if you did not sign up — nothing happens until you click.',
    ].join('\n'),
  };
}

// ============================================================
// Standard email verification (ages 13-16)
// ============================================================
export function renderVerifyEmail(user, link) {
  const kid = escapeHTML(user.kid_first_name);
  const subject = `Confirm your email — ${BRAND.name}`;
  const preheader = `One click to activate ${kid}'s daily digest.`;

  const body = `
    <h1 style="font-size:24px;font-weight:700;color:#1c2030;margin:0 0 14px 0;letter-spacing:-0.5px;">
      Confirm your email to activate ${kid}'s account
    </h1>
    <p style="margin:0 0 22px 0;font-size:15px;color:#454a5b;">
      Thanks for signing up <strong>${kid}</strong> for <strong>Market Buzz Kids</strong>!
      One click and the daily digest will start arriving tomorrow at 7 AM EST.
    </p>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px 0;">
      <tr><td style="background:linear-gradient(135deg,${BRAND.accent},${BRAND.blue});border-radius:999px;">
        <a href="${escapeHTML(link)}"
           style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;">
          ✅ Confirm my email
        </a>
      </td></tr>
    </table>

    <p style="margin:0 0 4px 0;font-size:13px;color:#8b91a3;">
      Or paste this link into your browser:
    </p>
    <p style="margin:0 0 22px 0;font-size:12px;color:${BRAND.blue};word-break:break-all;">
      ${escapeHTML(link)}
    </p>

    <p style="margin:0 0 0 0;font-size:14px;color:#454a5b;">
      A quick note on what we'll collect: ${kid}'s first name, age, and the engagement data
      from playing the daily games (XP, streak, quiz answers).
      We don't sell or share it with anyone, and you can delete it all at
      <a href="https://example.com/parent/delete-data" style="color:${BRAND.blue};">/parent/delete-data</a>
      anytime.
    </p>

    <p style="margin:18px 0 0 0;font-size:13px;color:#8b91a3;">
      This link expires in 7 days. If you didn't sign up, ignore this email — nothing happens until you click.
    </p>
  `;

  return {
    subject,
    html: shell({ preheader, body }),
    text: [
      `Confirm your email — ${BRAND.name}`,
      '',
      `Thanks for signing up ${kid} for Market Buzz Kids!`,
      `One click and the daily digest starts tomorrow at 7am EST.`,
      '',
      'Click to confirm:',
      link,
      '',
      `What we collect: ${kid}'s first name, age, and engagement data (XP, streak, quiz answers).`,
      `No selling, no sharing. Delete anytime at /parent/delete-data.`,
      '',
      'Link expires in 7 days. Ignore if you did not sign up.',
    ].join('\n'),
  };
}

/**
 * Phase 5 "send" implementation: log the email payload to console so the
 * developer can copy the link out and click it. Phase 6 replaces this with
 * an actual Resend API call (same function signature so the call sites
 * don't change).
 */
export async function sendEmail({ to, subject, html, text }) {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`📧 [stub-send] To: ${to}`);
  console.log(`📧 [stub-send] Subject: ${subject}`);
  console.log('───────────────────────────────────────────────────────────────');
  console.log(text); // text version is shorter and clickable
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  // Always succeed in stub mode.
  return { ok: true, id: 'stub-' + Date.now() };
}
