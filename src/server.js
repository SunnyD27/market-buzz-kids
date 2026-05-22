// dotenv with override:true so .env always wins, even if launchd/shell
// has a stale empty value for any of our keys (real gotcha on macOS).
import dotenv from 'dotenv';
dotenv.config({ override: true });
import express from 'express';
import cron from 'node-cron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { generateDigest } from './generate.js';
import { buildHTML } from './template.js';
import { storage } from './storage.js';
import { healthCheck as dbHealthCheck, query as dbQuery } from './db.js';
import {
  renderConsentEmail,
  renderVerifyEmail,
  renderWelcomeEmail,
  renderDeletionAckEmail,
  renderDailyTeaserEmail,
  sendEmail,
} from './emails.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// We sit behind Railway's proxy in production, so req.ip resolves via
// X-Forwarded-For. Local dev doesn't have a proxy — 'trust proxy' tolerates
// both.
app.set('trust proxy', true);

// Parse JSON bodies for /api endpoints (signup, deletion).
app.use(express.json({ limit: '32kb' }));

// Static assets live under /public. This serves CSS, JS, images, manifest,
// service worker — anything explicitly placed in the public dir. NOTE: we
// intentionally do NOT let static middleware claim '/' because we route the
// landing page explicitly below.
app.use(express.static(path.join(__dirname, '..', 'public'), {
  index: false, // don't auto-serve index.html — we route the root manually
}));

// ============================================================
// Routes
// ============================================================

// `/` — parent-facing landing page (Phase 5).
// Phase 5 commit 1 ships a tiny placeholder; commit 2 ships the real UI.
app.get('/', (req, res) => {
  const landingPath = path.join(__dirname, '..', 'public', 'landing.html');
  if (fs.existsSync(landingPath)) {
    res.sendFile(landingPath);
  } else {
    res.status(200).type('html').send(landingPlaceholder());
  }
});

// `/digest` — the daily digest (what `/` used to serve).
// Kid-facing surface. PWA start_url points here. Linked from the daily
// teaser email + the activation page.
//
// Fallback behavior: if public/index.html doesn't exist yet (fresh
// container that hasn't generated today's digest yet, OR cron hasn't
// fired), render the sample so the kid gets immediate value instead of a
// "brewing" placeholder. This is critical UX: a kid who just signed up
// hits /digest right after activation and must see content, not a
// "come back later" message. Once the boot-time generation finishes (or
// the 7 AM cron runs), refreshing serves the real index.html.
app.get('/digest', (req, res) => {
  const digestPath = path.join(__dirname, '..', 'public', 'index.html');
  if (fs.existsSync(digestPath)) {
    return res.sendFile(digestPath);
  }
  try {
    const samplePath = path.join(__dirname, '..', 'public', 'data', 'sample-digest.json');
    const content = JSON.parse(fs.readFileSync(samplePath, 'utf-8'));
    content.isSample = true;
    return res.status(200).type('html').send(buildHTML(content));
  } catch (err) {
    console.error('[digest] fallback render failed:', err.message);
    return res.status(200).type('html').send(digestBrewingPage());
  }
});

// `/sample` — public, static teaser digest. Same template/layout as the
// real digest but rendered from a curated JSON file (public/data/sample-
// digest.json). Visible to anyone before signing up; meant to ENTICE the
// click-through to /#signup, NOT to give away today's actual digest. The
// content.isSample=true flag in the JSON triggers the sample banner +
// SAMPLE chip in the header.
app.get('/sample', (req, res) => {
  try {
    const samplePath = path.join(__dirname, '..', 'public', 'data', 'sample-digest.json');
    const content = JSON.parse(fs.readFileSync(samplePath, 'utf-8'));
    content.isSample = true; // belt-and-suspenders — guarantee the banner shows
    res.status(200).type('html').send(buildHTML(content));
  } catch (err) {
    console.error('[sample] failed to render:', err.message);
    res.status(500).type('html').send('<p>Sample temporarily unavailable.</p>');
  }
});

// `/privacy` — kid-friendly COPPA-compliant privacy policy.
app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'privacy.html'));
});

// `/parent/delete-data` — parent-initiated data deletion form.
app.get('/parent/delete-data', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'parent-delete-data.html'));
});

// ============================================================
// API — signup
// ============================================================

// Whitelists for the optional dropdowns — anything outside these gets dropped.
const INVEST_EXPERIENCES = new Set(['not_yet','index_funds','individual_stocks','crypto','not_sure']);
const REFERRAL_SOURCES   = new Set(['friend','social','school','news','other']);

// Loose UA-based device classifier. Good enough for analytics — not used for
// any authorization decision.
function classifyDevice(ua) {
  if (!ua) return 'unknown';
  const s = ua.toLowerCase();
  if (/ipad|tablet|android(?!.*mobile)/i.test(s)) return 'tablet';
  if (/mobile|iphone|ipod|android/i.test(s)) return 'mobile';
  if (/windows|macintosh|linux/i.test(s)) return 'desktop';
  return 'unknown';
}

app.post('/api/signup', async (req, res) => {
  const body = req.body || {};
  const errors = {};

  // ---- Validate required fields ----
  const parent_email = String(body.parent_email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parent_email) || parent_email.length > 255) {
    errors.parent_email = 'Please enter a valid email address.';
  }
  const kid_first_name = String(body.kid_first_name || '').trim();
  if (!kid_first_name) {
    errors.kid_first_name = "Kid's first name is required.";
  } else if (kid_first_name.length > 50) {
    errors.kid_first_name = 'Name is too long (max 50 chars).';
  }
  const kid_age = parseInt(body.kid_age, 10);
  if (!Number.isFinite(kid_age) || kid_age < 10 || kid_age > 16) {
    errors.kid_age = 'Please choose an age between 10 and 16.';
  }

  if (Object.keys(errors).length) {
    return res.status(400).json({ ok: false, errors });
  }

  // ---- Duplicate email check ----
  try {
    if (await storage.findActiveUserByEmail(parent_email)) {
      return res.status(409).json({
        ok: false,
        message: "That email is already signed up. Want to delete and re-sign up? See /parent/delete-data.",
      });
    }
  } catch (err) {
    console.error('[signup] duplicate-check failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Signup is temporarily unavailable. Please try again in a moment.' });
  }

  // ---- Whitelist optional fields ----
  const invest_experience = INVEST_EXPERIENCES.has(body.invest_experience) ? body.invest_experience : null;
  const referral_source   = REFERRAL_SOURCES.has(body.referral_source)     ? body.referral_source   : null;

  // ---- Capture request metadata ----
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 500);

  let user, tokenRow;
  try {
    ({ user, tokenRow } = await storage.createUserFromSignup({
      parent_email,
      kid_first_name,
      kid_age,
      invest_experience,
      referral_source,
      utm_source:   slice120(body.utm_source),
      utm_medium:   slice120(body.utm_medium),
      utm_campaign: slice120(body.utm_campaign),
      utm_content:  slice120(body.utm_content),
      utm_term:     slice120(body.utm_term),
      user_agent:   userAgent,
      device_type:  classifyDevice(userAgent),
      timezone:     typeof body.timezone === 'string' ? body.timezone.slice(0, 64) : null,
      signup_ip:    req.ip,
    }));
  } catch (err) {
    // 23505 = unique_violation, e.g. a race against the duplicate pre-check.
    if (err.code === '23505') {
      return res.status(409).json({
        ok: false,
        message: "That email is already signed up. Want to delete and re-sign up? See /parent/delete-data.",
      });
    }
    console.error('[signup] insert failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Signup is temporarily unavailable. Please try again in a moment.' });
  }

  // Build the verify / consent URL and render the email.
  // Phase 5: emails are logged to console by sendEmail() — clickable.
  // Phase 6: same call site, sendEmail() will use Resend.
  const linkPath = tokenRow.purpose === 'parental_consent'
    ? `/api/consent?token=${tokenRow.token}`
    : `/api/verify?token=${tokenRow.token}`;
  const linkURL = `${req.protocol}://${req.get('host')}${linkPath}`;

  const email = tokenRow.purpose === 'parental_consent'
    ? renderConsentEmail(user, linkURL)
    : renderVerifyEmail(user, linkURL);

  // Fire-and-forget — we don't block the response on email delivery, and we
  // don't want a transient send failure to look like a signup failure to the
  // parent. Phase 6 should add a retry queue.
  sendEmail({ to: user.parent_email, ...email }).catch(err =>
    console.error('[signup] sendEmail failed:', err)
  );

  return res.status(200).json({
    ok: true,
    consent_required: user.consent_required,
    // Don't return the user object — minimize info disclosure.
    message: user.consent_required
      ? 'Parental consent email queued.'
      : 'Verification email queued.',
  });
});

// ============================================================
// API — verify email (ages 13-16) + parental consent (ages 10-12)
// ============================================================
// Both endpoints are GETs because they're clicked from emails. Both share
// the same activation page (it's HTML, not JSON, since a parent reaches it
// via their browser).

app.get('/api/verify', (req, res) => {
  handleTokenClick(req, res, 'email_verify');
});
app.get('/api/consent', (req, res) => {
  handleTokenClick(req, res, 'parental_consent');
});

async function handleTokenClick(req, res, expectedPurpose) {
  const token = String(req.query.token || '');
  if (!token) {
    return res.status(400).type('html').send(activationPage({ ok: false, reason: 'missing_token' }));
  }
  let result;
  try {
    result = await storage.consumeToken(token, { ip: req.ip });
  } catch (err) {
    console.error('[token] consume failed:', err.message);
    return res.status(500).type('html').send(activationPage({ ok: false, reason: 'server_error' }));
  }
  if (!result.ok) {
    return res.status(400).type('html').send(activationPage({ ok: false, reason: result.reason }));
  }

  // Phase 6.2: send the welcome email the moment a user transitions to active.
  // The first successful token click is exactly that transition.
  if (result.user?.is_active) {
    const welcome = renderWelcomeEmail(result.user);
    sendEmail({ to: result.user.parent_email, ...welcome }).catch(err =>
      console.error('[welcome] sendEmail failed:', err.message)
    );
  }
  // If the token purpose doesn't match the endpoint (e.g. someone hits
  // /api/consent with an email_verify token), still treat it as activation
  // since both endpoints just consume tokens — but log it for visibility.
  if (result.token.purpose !== expectedPurpose) {
    console.warn(`[token] mismatched endpoint: expected ${expectedPurpose}, got ${result.token.purpose}`);
  }
  return res.status(200).type('html').send(activationPage({
    ok: true,
    action: result.action,
    user: result.user,
  }));
}

function activationPage({ ok, reason, action, user }) {
  const isOk = ok === true;
  let title, message, hint;
  if (isOk) {
    if (action === 'consent_granted') {
      title = "🎉 Consent confirmed!";
      message = `Thanks. <strong>${escapeHTML(user.kid_first_name)}</strong>'s account is now active. The first daily digest arrives tomorrow at 7&nbsp;AM EST.`;
      hint = 'You can request data deletion anytime at <a href="/parent/delete-data" style="color:#58a6ff;">/parent/delete-data</a>.';
    } else {
      title = "✅ Email confirmed!";
      message = `Thanks. <strong>${escapeHTML(user.kid_first_name)}</strong>'s account is now active. The first daily digest arrives tomorrow at 7&nbsp;AM EST.`;
      hint = 'You can request data deletion anytime at <a href="/parent/delete-data" style="color:#58a6ff;">/parent/delete-data</a>.';
    }
  } else {
    const reasons = {
      not_found:     'This activation link is invalid or has already been used.',
      already_used:  'This link has already been used. Your account should already be active.',
      expired:       'This activation link has expired (links are valid for 7 days). Please sign up again.',
      user_missing:  'The associated account no longer exists.',
      missing_token: 'No activation token provided.',
      server_error:  'Something went wrong on our side. Please try again in a moment.',
    };
    title = "Couldn't activate";
    message = reasons[reason] || 'Something went wrong.';
    hint = '<a href="/" style="color:#58a6ff;">Return to the signup page →</a>';
  }
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHTML(title.replace(/^[^a-zA-Z]+/, ''))} — Market Buzz Kids</title>
<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  body { background:#0d1117;color:#e6edf3;font-family:'Fredoka',sans-serif;
         display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:20px; }
  .card { max-width:540px;background:#161b22;border:1px solid #21262d;border-radius:20px;padding:36px 28px; }
  h1 { font-size:36px;margin-bottom:14px;color:#fff;letter-spacing:-0.5px; }
  p  { font-size:17px;line-height:1.55;color:#e6edf3;margin-bottom:12px; }
  .hint { font-size:13px;color:#8b949e;margin-top:20px; }
  .cta { display:inline-block;margin-top:18px;padding:12px 22px;border-radius:999px;
         background:linear-gradient(135deg,#bc8cff,#58a6ff);color:#fff;text-decoration:none;font-weight:700;
         min-height:44px; }
  .cta:hover { transform:translateY(-1px); }
</style></head><body>
<div class="card">
  <h1>${title}</h1>
  <p>${message}</p>
  <p class="hint">${hint}</p>
  ${isOk ? '<a class="cta" href="/digest">See today\'s digest →</a>' : ''}
</div>
</body></html>`;
}

function escapeHTML(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

function slice120(v) {
  return typeof v === 'string' ? v.slice(0, 120) : null;
}

// ============================================================
// API — data deletion (parent-initiated)
// ============================================================
// Per privacy policy, we always return success (200) to avoid leaking
// account existence. If the email matches an active user, storage soft-
// deletes it. If not, we still log the request for audit purposes.
app.post('/api/delete-data', async (req, res) => {
  const body = req.body || {};
  const parent_email = String(body.parent_email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parent_email) || parent_email.length > 255) {
    return res.status(400).json({ ok: false, message: 'Please enter a valid email address.' });
  }
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 120) : null;

  let request;
  try {
    request = await storage.recordDeletionRequest({
      parent_email,
      reason,
      requested_ip: req.ip,
      user_agent: String(req.headers['user-agent'] || '').slice(0, 500),
    });
  } catch (err) {
    console.error('[delete-data] failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Deletion is temporarily unavailable. Please try again in a moment.' });
  }

  // Phase 6.2: always send a deletion-ack email — same body whether matched
  // or not, so we never leak account existence through the email channel.
  const ack = renderDeletionAckEmail({ parent_email });
  sendEmail({ to: parent_email, ...ack }).catch(err =>
    console.error('[delete-ack] sendEmail failed:', err.message)
  );

  // We don't return the matched_user_id — that would leak existence.
  // We return `matched: true/false` only for the UX confirmation copy.
  return res.status(200).json({
    ok: true,
    matched: !!request.matched_user_id,
    message: request.matched_user_id
      ? 'Account found and deletion processed.'
      : 'Deletion request logged.',
  });
});

// ============================================================
// Shared: daily teaser fan-out (used by HTTP endpoint AND in-process cron)
// ============================================================
// Loads today's digest content + every active+verified user, sends each one
// the teaser via Resend, returns counts. Single source of truth — the
// /api/cron/send-digest endpoint and the 7 AM cron handler both call this.
//
// Returns an object { ok, sent, failed, total, started_at, finished_at,
// error?, status? } — status is 'no_content' | 'malformed_content' |
// 'db_error' | 'ok'.
async function sendDailyTeasers() {
  const started_at = new Date().toISOString();
  const dataPath = path.join(__dirname, '..', 'public', 'digest-data.json');
  if (!fs.existsSync(dataPath)) {
    return { ok: false, status: 'no_content', started_at, finished_at: new Date().toISOString(),
             error: 'digest-data.json missing — run /generate first.' };
  }
  let content;
  try {
    content = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  } catch (err) {
    return { ok: false, status: 'malformed_content', started_at, finished_at: new Date().toISOString(),
             error: 'digest-data.json malformed: ' + err.message };
  }

  let recipients;
  try {
    const { rows } = await dbQuery(
      `SELECT id, parent_email, kid_first_name, kid_age
         FROM users
        WHERE is_active = TRUE
          AND email_verified = TRUE
          AND deleted_at IS NULL`
    );
    recipients = rows;
  } catch (err) {
    console.error('[send-digest] DB query failed:', err.message);
    return { ok: false, status: 'db_error', started_at, finished_at: new Date().toISOString(),
             error: err.message };
  }

  console.log(`[send-digest] starting · ${recipients.length} recipient(s)`);

  let sent = 0;
  let failed = 0;
  for (const user of recipients) {
    const email = renderDailyTeaserEmail(user, content);
    const result = await sendEmail({ to: user.parent_email, ...email });
    if (result.ok) sent++;
    else failed++;
    // Small spacing between sends to stay under Resend's free-tier rate
    // limit (10 req/sec). 100ms is comfortably under that.
    await new Promise(r => setTimeout(r, 100));
  }

  const finished_at = new Date().toISOString();
  console.log(`[send-digest] done · sent=${sent} failed=${failed} total=${recipients.length}`);

  return {
    ok: true,
    status: 'ok',
    sent,
    failed,
    total: recipients.length,
    started_at,
    finished_at,
  };
}

// ============================================================
// API — daily teaser fan-out (Phase 6.2)
// ============================================================
// External callers (Railway cron, GitHub Action, manual curl) hit this to
// fire teaser emails on demand. Protected by CRON_SECRET via X-Cron-Secret
// header. For the standard daily flow you don't need to call this — the
// in-process 7 AM cron below does both generation and fan-out.
app.post('/api/cron/send-digest', async (req, res) => {
  const expected = process.env.CRON_SECRET || '';
  const got = req.header('x-cron-secret') || '';
  if (!expected || got !== expected) {
    return res.status(401).json({ ok: false, message: 'Unauthorized.' });
  }
  const result = await sendDailyTeasers();
  const httpStatus = result.status === 'ok' ? 200
    : result.status === 'no_content' ? 503
    : result.status === 'malformed_content' ? 500
    : result.status === 'db_error' ? 500
    : 500;
  return res.status(httpStatus).json(result);
});

// Admin: trigger digest generation manually.
app.get('/generate', async (req, res) => {
  const key = req.query.key;
  if (key !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  try {
    console.log('[Manual] Triggering digest generation...');
    await generateDigest();
    res.json({ success: true, message: 'Digest generated!' });
  } catch (err) {
    console.error('[Manual] Generation failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', lastGenerated: process.env.LAST_GENERATED || 'never' });
});

// /api/health — Phase 6.1: confirms Postgres connectivity.
app.get('/api/health', async (req, res) => {
  try {
    const ok = await dbHealthCheck();
    return res.json({ status: ok ? 'ok' : 'fail', db: ok ? 'connected' : 'unknown' });
  } catch (err) {
    return res.status(503).json({ status: 'fail', db: 'disconnected', error: err.message });
  }
});

// ============================================================
// Cron — daily digest + teaser fan-out at 7 AM EST
// ============================================================
// Two steps, sequential: (1) generate today's digest HTML + JSON, then
// (2) email the teaser to every active+verified user. If step 1 fails we
// SKIP step 2 — don't want to spam yesterday's stale digest. Both steps
// share their own try/catch so a failure in one logs cleanly without
// taking the process down.
cron.schedule('0 7 * * *', async () => {
  console.log(`[Cron] Starting daily digest generation at ${new Date().toISOString()}`);
  let generated = false;
  try {
    await generateDigest();
    process.env.LAST_GENERATED = new Date().toISOString();
    generated = true;
    console.log('[Cron] Digest generated successfully.');
  } catch (err) {
    console.error('[Cron] Generation failed — SKIPPING teaser fan-out to avoid sending stale content:', err.message);
  }

  if (!generated) return;

  try {
    const result = await sendDailyTeasers();
    if (result.ok) {
      console.log(`[Cron] Teaser fan-out done · sent=${result.sent} failed=${result.failed} total=${result.total}`);
    } else {
      console.error(`[Cron] Teaser fan-out failed (${result.status}): ${result.error}`);
    }
  } catch (err) {
    console.error('[Cron] Teaser fan-out threw:', err.message);
  }
}, {
  timezone: 'America/New_York',
});

// ============================================================
// Boot-time digest bootstrap
// ============================================================
// Railway containers wipe public/index.html on every redeploy (it's
// gitignored), so without this, the digest is missing for hours after
// each deploy until the 7 AM cron fires. This checks at boot whether
// today's digest exists in NY time; if not, fires generateDigest() in
// the background. Fire-and-forget — never blocks server startup, and
// failures just log (the 7 AM cron is still the safety net).
async function bootstrapTodaysDigest() {
  const dataPath = path.join(__dirname, '..', 'public', 'digest-data.json');
  const todayNY = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());

  if (fs.existsSync(dataPath)) {
    try {
      const content = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
      const gen = content?.generated_at ? new Date(content.generated_at) : null;
      if (gen && !isNaN(gen)) {
        const genDay = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(gen);
        if (genDay === todayNY) {
          console.log('[Bootstrap] Today\'s digest already present — skipping.');
          return;
        }
      }
      console.log('[Bootstrap] Existing digest is stale — regenerating.');
    } catch {
      console.log('[Bootstrap] digest-data.json malformed — regenerating.');
    }
  } else {
    console.log('[Bootstrap] No digest found — generating today\'s for the first time.');
  }

  // Require both keys before attempting — otherwise generateDigest throws
  // synchronously and the unhandled rejection is noisy.
  if (!process.env.FMP_API_KEY || !process.env.ANTHROPIC_API_KEY) {
    console.warn('[Bootstrap] FMP_API_KEY or ANTHROPIC_API_KEY not set — skipping. /digest will fall back to /sample until keys are configured.');
    return;
  }

  try {
    await generateDigest();
    process.env.LAST_GENERATED = new Date().toISOString();
    console.log('[Bootstrap] ✅ Initial digest generated.');
  } catch (err) {
    console.error('[Bootstrap] Initial generation failed (will retry at 7 AM cron):', err.message);
  }
}

app.listen(PORT, () => {
  console.log(`📈 Market Buzz Kids running on port ${PORT}`);
  console.log(`   Landing:        /`);
  console.log(`   Digest:         /digest  (fallback: /sample when index.html missing)`);
  console.log(`   Sample:         /sample`);
  console.log(`   Privacy:        /privacy`);
  console.log(`   Delete data:    /parent/delete-data`);
  console.log(`   Signup API:     POST /api/signup`);
  console.log(`   Delete API:     POST /api/delete-data`);
  console.log(`   Teaser fan-out: POST /api/cron/send-digest (X-Cron-Secret)`);
  console.log(`   Digest scheduled for 7:00 AM EST daily`);
  console.log(`   Manual trigger: /generate?key=YOUR_ADMIN_KEY`);

  // Fire-and-forget bootstrap. If anything fails, the 7 AM cron will recover.
  bootstrapTodaysDigest();
});

// ============================================================
// Placeholder pages (commit-1 fallbacks)
// ============================================================

function landingPlaceholder() {
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;600;700&display=swap" rel="stylesheet">
<title>Market Buzz Kids</title>
<style>
  body{background:#0d1117;color:#e6edf3;font-family:'Fredoka',sans-serif;
       display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:20px;}
  h1{font-size:48px;margin-bottom:12px;
     background:linear-gradient(135deg,#58a6ff,#bc8cff,#f0c040);
     -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;}
  p{font-size:18px;color:#8b949e;max-width:480px;margin:8px auto;}
  a{color:#58a6ff;}
</style>
</head><body>
<div>
  <h1>📈 Market Buzz Kids</h1>
  <p>Landing page coming up in commit 2.</p>
  <p style="font-size:14px;margin-top:20px;color:#484f58;">
    Want to see the digest? <a href="/digest">View today's digest →</a>
  </p>
</div>
</body></html>`;
}

function digestBrewingPage() {
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;600;700&display=swap" rel="stylesheet">
<title>Market Buzz Kids</title>
<style>
  body{background:#0d1117;color:#e6edf3;font-family:'Fredoka',sans-serif;
       display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:20px;}
  h1{font-size:48px;margin-bottom:12px;}
  p{font-size:18px;color:#8b949e;}
</style></head><body>
<div>
  <h1>📈 Market Buzz</h1>
  <p>Your first digest is brewing! Check back after 7:00 AM EST.</p>
  <p style="font-size:14px;margin-top:20px;color:#484f58;">
    The digest generates fresh every morning at 7 AM.
  </p>
</div>
</body></html>`;
}
