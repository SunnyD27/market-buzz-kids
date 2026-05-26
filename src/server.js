// dotenv with override:true so .env always wins, even if launchd/shell
// has a stale empty value for any of our keys (real gotcha on macOS).
import dotenv from 'dotenv';
dotenv.config({ override: true });
import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import cron from 'node-cron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { generateDigest } from './generate.js';
import { buildHTML } from './template.js';
import { storage } from './storage.js';
import { healthCheck as dbHealthCheck, query as dbQuery } from './db.js';
import { getTodaysDigest, todayNY } from './digest-store.js';
import { requireAuth, setSession, clearSession } from './auth.js';
import {
  renderConsentEmail,
  renderVerifyEmail,
  renderWelcomeEmail,
  renderDeletionAckEmail,
  renderDailyTeaserEmail,
  renderPasswordResetEmail,
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

// Phase 7 — signed-cookie parser for the mbk_session cookie. The secret
// signs the cookie value; cookie-parser refuses tampered cookies
// automatically. Fallback only used in local dev — production MUST set
// SESSION_SECRET. We log loudly if it's the fallback, so production
// misconfigurations don't ship silently.
const SESSION_SECRET = process.env.SESSION_SECRET || 'market-buzz-kids-fallback-secret-DEV-ONLY';
if (!process.env.SESSION_SECRET) {
  console.warn('[auth] SESSION_SECRET not set — using insecure dev fallback. SET THIS IN PRODUCTION.');
}
app.use(cookieParser(SESSION_SECRET));

// Phase 7 — static-leak gate. The static middleware below would happily
// serve public/index.html (the rendered digest) and public/digest-data.json
// (its source) at /index.html and /digest-data.json, bypassing the
// /digest auth gate entirely. Redirect those paths to /digest so the
// auth middleware runs.
app.use((req, res, next) => {
  if (req.path === '/index.html' || req.path === '/digest-data.json') {
    return res.redirect('/digest');
  }
  next();
});

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

// `/digest` — the daily digest. Kid-facing surface, linked from the
// daily teaser email + the activation page. PWA start_url points here.
//
// Phase 7 — gated by requireAuth. Logged-out kids → /login.
// Phase 7 — re-renders per request to personalize the greeting in the
//   header. The DB row's content is identical across kids; only the
//   "Hey, Sam!" line differs. We DON'T fast-path from disk anymore
//   because the disk file is baked for a specific kid (whoever caused
//   the last write), and serving it to a different kid would greet
//   them by the wrong name. buildHTML is fast enough (~5ms) that this
//   is fine.
//
// Read-path priority:
//   1. daily_digests row in Postgres → buildHTML with kidName → serve.
//   2. /sample fallback when no row yet — generic, no greeting.
//
// The DB row is still locked via ON CONFLICT DO NOTHING in saveDigest()
// so every kid for the same calendar day sees the same content (modulo
// their own name in the header).
app.get('/digest', requireAuth, async (req, res) => {
  const kidName = req.user?.kid_first_name;

  try {
    const dbDigest = await getTodaysDigest();
    if (dbDigest?.content) {
      const html = buildHTML(dbDigest.content, { kidName });
      return res.status(200).type('html').send(html);
    }
  } catch (err) {
    console.error('[digest] DB lookup failed:', err.message);
    // Fall through to sample so kids on a freshly-deployed container
    // aren't stuck on a brewing page.
  }

  // DB row missing — fall back to the sample (no greeting, no kid name).
  try {
    const samplePath = path.join(__dirname, '..', 'public', 'data', 'sample-digest.json');
    const content = JSON.parse(fs.readFileSync(samplePath, 'utf-8'));
    content.isSample = true;
    return res.status(200).type('html').send(buildHTML(content, { kidName }));
  } catch (err) {
    console.error('[digest] sample fallback also failed:', err.message);
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
// Phase 7 — Auth pages (login / forgot-password / reset-password)
// ============================================================
// All three are static HTML. /login redirects logged-in users straight
// to /digest so it doesn't show as an empty form for already-authenticated
// kids (and the cookie persists for 30 days, so this is common).
app.get('/login', (req, res) => {
  if (req.signedCookies?.mbk_session) return res.redirect('/digest');
  res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});

app.get('/forgot-password', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'forgot-password.html'));
});

app.get('/reset-password', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'reset-password.html'));
});

// ============================================================
// API — login / logout / username-availability
// ============================================================
// Login looks up by LOWER(username), validates the bcrypt hash, then
// sets the session cookie. Same error message for "user not found" and
// "wrong password" — never reveal which one failed.
app.post('/api/login', async (req, res) => {
  const body = req.body || {};
  const username = String(body.username || '').trim();
  const password = String(body.password || '');

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  let row;
  try {
    const result = await dbQuery(
      `SELECT id, password_hash, is_active
         FROM users
        WHERE LOWER(username) = LOWER($1)
          AND deleted_at IS NULL
        LIMIT 1`,
      [username],
    );
    row = result.rows[0];
  } catch (err) {
    console.error('[login] DB lookup failed:', err.message);
    return res.status(500).json({ error: 'Login is temporarily unavailable.' });
  }

  if (!row || !row.password_hash) {
    return res.status(401).json({ error: 'Wrong username or password.' });
  }

  // Account exists but isn't activated yet — surface a distinct copy so
  // the parent knows to click the email link rather than wonder why
  // their correct password "doesn't work."
  if (!row.is_active) {
    return res.status(401).json({ error: "Account not yet activated. Check your parent's email for the confirmation link." });
  }

  let match;
  try {
    match = await bcrypt.compare(password, row.password_hash);
  } catch (err) {
    console.error('[login] bcrypt failed:', err.message);
    return res.status(500).json({ error: 'Login is temporarily unavailable.' });
  }

  if (!match) {
    return res.status(401).json({ error: 'Wrong username or password.' });
  }

  setSession(res, row.id);
  res.json({ success: true, redirect: '/digest' });
});

app.post('/api/logout', (req, res) => {
  clearSession(res);
  res.json({ success: true, redirect: '/login' });
});

// Real-time availability check from the signup form. Returns
// { available: true|false }. Returns false for any string the server
// would reject (too short, bad chars) so the UI shows red ✗ pre-submit.
app.get('/api/check-username', async (req, res) => {
  const username = String(req.query.username || '').trim();
  if (!username || username.length < 3 || username.length > 20 || !/^[a-zA-Z0-9_]+$/.test(username)) {
    return res.json({ available: false });
  }
  try {
    const { rows } = await dbQuery(
      'SELECT 1 FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1',
      [username],
    );
    return res.json({ available: rows.length === 0 });
  } catch (err) {
    console.error('[check-username] DB lookup failed:', err.message);
    return res.json({ available: false });
  }
});

// ============================================================
// API — password reset (parent-initiated)
// ============================================================
// /api/forgot-password ALWAYS returns 200 — we don't reveal whether the
// email exists. If it does, we issue a 1-hour token and email a reset
// link to the parent.
//
// /api/reset-password validates the token, hashes the new password, and
// marks the token used. Same token table the verify/consent flow uses
// (the CHECK constraint was expanded to accept 'password_reset').
app.post('/api/forgot-password', async (req, res) => {
  const email = String(req.body?.email || '').trim();

  // Always 200, always identical body — even on error. The actual work
  // happens after the response so a slow Resend call doesn't leak a
  // timing signal about whether the email existed.
  res.json({ success: true });

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;

  let rows;
  try {
    const result = await dbQuery(
      `SELECT id, kid_first_name, parent_email, username
         FROM users
        WHERE LOWER(parent_email) = LOWER($1)
          AND deleted_at IS NULL`,
      [email],
    );
    rows = result.rows;
  } catch (err) {
    console.error('[forgot-password] DB lookup failed:', err.message);
    return;
  }
  if (!rows.length) return;

  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  for (const user of rows) {
    if (!user.username) continue; // pre-Phase-7 account, can't reset
    const token = randomBytes(32).toString('hex');
    try {
      await dbQuery(
        `INSERT INTO verification_tokens (token, user_id, purpose, expires_at)
         VALUES ($1, $2, 'password_reset', $3)`,
        [token, user.id, expiresAt],
      );
      const link = `${req.protocol}://${req.get('host')}/reset-password?token=${token}`;
      const payload = renderPasswordResetEmail(user, link);
      sendEmail({ to: user.parent_email, ...payload }).catch(err =>
        console.error('[forgot-password] sendEmail failed:', err.message),
      );
    } catch (err) {
      console.error('[forgot-password] token insert failed:', err.message);
    }
  }
});

app.post('/api/reset-password', async (req, res) => {
  const token = String(req.body?.token || '').trim();
  const password = String(req.body?.password || '');

  if (!token || !password) {
    return res.status(400).json({ error: 'Token and password are required.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  let tokenRow;
  try {
    const result = await dbQuery(
      `SELECT user_id
         FROM verification_tokens
        WHERE token = $1
          AND purpose = 'password_reset'
          AND expires_at > NOW()
          AND used_at IS NULL
        LIMIT 1`,
      [token],
    );
    tokenRow = result.rows[0];
  } catch (err) {
    console.error('[reset-password] DB lookup failed:', err.message);
    return res.status(500).json({ error: 'Reset is temporarily unavailable.' });
  }

  if (!tokenRow) {
    return res.status(400).json({ error: 'Invalid or expired reset link. Request a new one.' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    await dbQuery('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, tokenRow.user_id]);
    await dbQuery("UPDATE verification_tokens SET used_at = NOW() WHERE token = $1", [token]);
    return res.json({ success: true });
  } catch (err) {
    console.error('[reset-password] update failed:', err.message);
    return res.status(500).json({ error: 'Reset failed. Try again in a moment.' });
  }
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

  // Phase 7 — username + password validation. Mirrors the client-side
  // checks but is authoritative; the client may be bypassed.
  const username = String(body.username || '').trim();
  if (!username) {
    errors.username = 'Pick a username for your kid.';
  } else if (username.length < 3) {
    errors.username = 'Username must be at least 3 characters.';
  } else if (username.length > 20) {
    errors.username = 'Username is too long (max 20 chars).';
  } else if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    errors.username = 'Username can only contain letters, numbers, and underscores.';
  }

  const password = String(body.password || '');
  if (!password) {
    errors.password = 'Pick a password.';
  } else if (password.length < 6) {
    errors.password = 'Password must be at least 6 characters.';
  } else if (password.length > 200) {
    // Hard cap to keep bcrypt happy and prevent slowloris-style payloads.
    errors.password = 'Password is too long.';
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

  // ---- Phase 7: username uniqueness pre-check ----
  // The unique index on LOWER(username) catches races too — that error
  // is mapped to 23505 below and returned as a username-specific
  // 409. The pre-check just gives the parent a cleaner error message
  // in the common case.
  try {
    const { rows: dupRows } = await dbQuery(
      'SELECT 1 FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1',
      [username],
    );
    if (dupRows.length > 0) {
      return res.status(409).json({
        ok: false,
        errors: { username: 'That username is already taken. Try another one!' },
      });
    }
  } catch (err) {
    console.error('[signup] username pre-check failed:', err.message);
    return res.status(500).json({ ok: false, message: 'Signup is temporarily unavailable. Please try again in a moment.' });
  }

  // ---- Phase 7: hash the password ----
  let password_hash;
  try {
    password_hash = await bcrypt.hash(password, 10);
  } catch (err) {
    console.error('[signup] bcrypt failed:', err.message);
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
      username,
      password_hash,
    }));
  } catch (err) {
    // 23505 = unique_violation. Two indexes can fire: parent_email or
    // username. The Postgres error includes the constraint name in
    // err.constraint — use it to give a precise message.
    if (err.code === '23505') {
      if (err.constraint && err.constraint.includes('username')) {
        return res.status(409).json({
          ok: false,
          errors: { username: 'That username is already taken. Try another one!' },
        });
      }
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
  console.log(`[Cron] 7 AM EST daily run at ${new Date().toISOString()}`);
  // generateDigest() is idempotent — if today's row was already created
  // by a boot-time bootstrap (rare on a quiet deploy day), this just
  // reads it back from Postgres and writes it to disk. No double work,
  // no overwriting. The first generation of the day wins.
  let generated = false;
  try {
    await generateDigest();
    process.env.LAST_GENERATED = new Date().toISOString();
    generated = true;
    console.log('[Cron] Digest ready (fresh or cached).');
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
// Boot-time digest bootstrap (Phase 6.7)
// ============================================================
// Now that generateDigest() is itself idempotent (it checks the
// daily_digests Postgres table first and skips the FMP+Claude pipeline
// when today's row exists), this is just a thin wrapper that calls it.
//
// Call sites:
//   - On every container boot (fire-and-forget after app.listen).
//   - From the 7 AM EST cron handler.
//
// If today's row is already in Postgres, generateDigest() just reads it
// back, writes it to disk for fast serving, and returns. No API calls.
// If the row is missing, the full pipeline runs and INSERTs it.
//
// Either way: same content for every visitor for the rest of the day.
async function bootstrapTodaysDigest() {
  // Skip cleanly if generation keys aren't set yet — /digest will fall
  // back to the sample until they are.
  if (!process.env.FMP_API_KEY || !process.env.ANTHROPIC_API_KEY) {
    console.warn(`[Bootstrap] FMP_API_KEY or ANTHROPIC_API_KEY not set — skipping. /digest will fall back to /sample until keys are configured.`);
    return;
  }
  console.log(`[Bootstrap] Checking digest cache for ${todayNY()}...`);
  try {
    await generateDigest();
    console.log('[Bootstrap] ✅ Digest ready on disk.');
  } catch (err) {
    console.error('[Bootstrap] Failed (will retry at 7 AM cron):', err.message);
  }
}

// ============================================================
// Phase 7 — Boot-time DB migration (auth columns + CHECK expansion)
// ============================================================
// Lightweight, idempotent migration runner. We don't ship a real
// migration tool (no Knex / Prisma here) — this is fine because there
// are only a handful of forward-only ALTERs across the project's life
// so far. The runner inspects information_schema and only mutates if
// the change is missing.
async function runBootMigrations() {
  if (!process.env.DATABASE_URL) {
    console.warn('[migrations] DATABASE_URL not set — skipping. (DB-backed routes will error until set.)');
    return;
  }
  try {
    const { rows } = await dbQuery(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'username'",
    );
    if (rows.length === 0) {
      console.log('[migrations] Adding Phase 7 auth columns + expanding verification_tokens.purpose CHECK…');
      await dbQuery(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS username       VARCHAR(30);
        ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash  VARCHAR(255);
        CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_uniq
          ON users (LOWER(username))
          WHERE username IS NOT NULL;
        ALTER TABLE verification_tokens
          DROP CONSTRAINT IF EXISTS verification_tokens_purpose_check;
        ALTER TABLE verification_tokens
          ADD CONSTRAINT verification_tokens_purpose_check
          CHECK (purpose IN ('email_verify', 'parental_consent', 'password_reset'));
      `);
      console.log('[migrations] ✅ Phase 7 auth migration applied.');
    }
  } catch (err) {
    console.error('[migrations] Failed (auth routes may not work until fixed):', err.message);
  }
}

app.listen(PORT, () => {
  console.log(`📈 Market Buzz Kids running on port ${PORT}`);
  console.log(`   Landing:        /`);
  console.log(`   Login:          /login  (kid-facing, gates /digest)`);
  console.log(`   Digest:         /digest  (requires auth; fallback: /sample for un-generated days)`);
  console.log(`   Sample:         /sample`);
  console.log(`   Privacy:        /privacy`);
  console.log(`   Delete data:    /parent/delete-data`);
  console.log(`   Signup API:     POST /api/signup`);
  console.log(`   Login API:      POST /api/login`);
  console.log(`   Delete API:     POST /api/delete-data`);
  console.log(`   Teaser fan-out: POST /api/cron/send-digest (X-Cron-Secret)`);
  console.log(`   Digest scheduled for 7:00 AM EST daily`);
  console.log(`   Manual trigger: /generate?key=YOUR_ADMIN_KEY`);

  // Run migrations FIRST (so routes that depend on the new columns
  // work on the next request after a fresh deploy), then bootstrap the
  // digest. Both are fire-and-forget so a slow DB on boot doesn't block
  // the listener (Railway healthchecks would fail).
  runBootMigrations().then(() => bootstrapTodaysDigest());
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
