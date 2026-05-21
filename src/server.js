import express from 'express';
import cron from 'node-cron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { generateDigest } from './generate.js';

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
