import express from 'express';
import cron from 'node-cron';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateDigest } from './generate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/', (req, res) => {
  const digestPath = path.join(__dirname, '..', 'public', 'index.html');
  res.sendFile(digestPath, (err) => {
    if (err) {
      res.status(200).send(`
        <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;600;700&display=swap" rel="stylesheet">
          <style>
            body {
              background: #0d1117; color: #e6edf3; font-family: 'Fredoka', sans-serif;
              display: flex; align-items: center; justify-content: center;
              min-height: 100vh; text-align: center; padding: 20px;
            }
            h1 { font-size: 48px; margin-bottom: 12px; }
            p { font-size: 18px; color: #8b949e; }
          </style>
        </head>
        <body>
          <div>
            <h1>📈 Market Buzz</h1>
            <p>Your first digest is brewing! Check back after 7:00 AM EST.</p>
            <p style="font-size: 14px; margin-top: 20px; color: #484f58;">
              The digest generates fresh every morning at 7 AM.
            </p>
          </div>
        </body>
        </html>
      `);
    }
  });
});

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
  console.log(`📈 Market Buzz running on port ${PORT}`);
  console.log(`   Digest scheduled for 7:00 AM EST daily`);
  console.log(`   Manual trigger: /generate?key=YOUR_ADMIN_KEY`);
});
