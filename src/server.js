import express from 'express';
import cron from 'node-cron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { generateDigest } from './generate.js';
import { storage } from './storage.js';

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
// Kid-facing surface. PWA start_url points here.
app.get('/digest', (req, res) => {
  const digestPath = path.join(__dirname, '..', 'public', 'index.html');
  if (fs.existsSync(digestPath)) {
    res.sendFile(digestPath);
  } else {
    res.status(200).type('html').send(digestBrewingPage());
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

app.post('/api/signup', (req, res) => {
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
  if (storage.findActiveUserByEmail(parent_email)) {
    return res.status(409).json({
      ok: false,
      message: "That email is already signed up. Want to delete and re-sign up? See /parent/delete-data.",
    });
  }

  // ---- Whitelist optional fields ----
  const invest_experience = INVEST_EXPERIENCES.has(body.invest_experience) ? body.invest_experience : null;
  const referral_source   = REFERRAL_SOURCES.has(body.referral_source)     ? body.referral_source   : null;

  // ---- Capture request metadata ----
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 500);

  const { user, tokenRow } = storage.createUserFromSignup({
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
  });

  // Phase 5 stub: the consent / verify URL would be emailed in Phase 6.
  // For now, log it to the server console so the dev can click through.
  const linkPath = tokenRow.purpose === 'parental_consent'
    ? `/api/consent?token=${tokenRow.token}`
    : `/api/verify?token=${tokenRow.token}`;
  const linkURL = `${req.protocol}://${req.get('host')}${linkPath}`;
  console.log(`[signup] ${tokenRow.purpose} link for ${user.parent_email}: ${linkURL}`);

  return res.status(200).json({
    ok: true,
    consent_required: user.consent_required,
    // Don't return the user object — minimize info disclosure.
    message: user.consent_required
      ? 'Parental consent email queued.'
      : 'Verification email queued.',
  });
});

function slice120(v) {
  return typeof v === 'string' ? v.slice(0, 120) : null;
}

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

// ============================================================
// Cron — daily digest at 7 AM EST
// ============================================================
cron.schedule('0 7 * * *', async () => {
  console.log(`[Cron] Starting daily digest generation at ${new Date().toISOString()}`);
  try {
    await generateDigest();
    process.env.LAST_GENERATED = new Date().toISOString();
    console.log('[Cron] Digest generated successfully!');
  } catch (err) {
    console.error('[Cron] Failed to generate digest:', err.message);
  }
}, {
  timezone: 'America/New_York'
});

app.listen(PORT, () => {
  console.log(`📈 Market Buzz Kids running on port ${PORT}`);
  console.log(`   Landing:        /`);
  console.log(`   Digest:         /digest`);
  console.log(`   Signup API:     POST /api/signup`);
  console.log(`   Digest scheduled for 7:00 AM EST daily`);
  console.log(`   Manual trigger: /generate?key=YOUR_ADMIN_KEY`);
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
