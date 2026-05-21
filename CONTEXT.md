# Market Buzz Daily — Project Context

A daily kid-friendly stock market digest for a 12-year-old investor (Sunny) who holds VOO. A cron job fetches market data + news, Claude rewrites it in a fun voice, and the result renders as a dark-themed mobile-friendly HTML page suitable for an iPad home-screen app.

- **Repo:** https://github.com/SunnyD27/market-buzz
- **Local:** `~/market-buzz`
- **Live:** https://market-buzz-production.up.railway.app/
- **Deploy:** Railway (Dockerfile, auto-deploys on push to `main`)

---

## Architecture

```
┌──────────────┐    7 AM EST     ┌──────────────────┐
│  node-cron   │ ─────────────── │ generateDigest() │
└──────────────┘                  └──────────────────┘
                                          │
                  ┌───────────────────────┼──────────────────────┐
                  ▼                       ▼                      ▼
         ┌────────────────┐      ┌────────────────┐    ┌────────────────┐
         │  FMP /stable   │      │  Anthropic API │    │   buildHTML()  │
         │  (quotes, news,│      │  (Sonnet 4 +   │    │   src/template │
         │   gainers,     │      │   web_search)  │    │      .js       │
         │   losers)      │      └────────────────┘    └────────────────┘
         └────────────────┘              ▲                      │
                  │                      │                      ▼
                  └──────────────────────┘            public/index.html
                       raw market data                       │
                                                             ▼
                                              Express static serves /
```

Single Node.js process. node-cron triggers `generateDigest()` once a day at 7:00 AM `America/New_York`. The function: pulls market data + news from FMP, sends it to Claude with the web_search tool enabled, parses Claude's JSON response, builds HTML from the JSON, and writes it to `public/index.html`. Express serves that file from `/`.

Three routes:

| Route | Auth | Purpose |
|---|---|---|
| `GET /` | none | Serves `public/index.html`. If the file doesn't exist (first boot, post-restart), returns a placeholder "your first digest is brewing" page. |
| `GET /generate?key=<ADMIN_KEY>` | query param | Manually triggers `generateDigest()`. Used to test changes without waiting for 7 AM. |
| `GET /health` | none | Returns `{status:"ok",lastGenerated:"..."}`. `lastGenerated` is stored in `process.env.LAST_GENERATED` and is in-memory only (resets on restart). |

---

## File map

```
~/market-buzz/
├── Dockerfile              # node:20-slim, npm install --production, runs src/server.js
├── railway.toml            # Tells Railway to use the Dockerfile builder + always-restart policy
├── package.json            # ESM (`"type": "module"`), 3 deps: express, node-cron, @anthropic-ai/sdk
├── .gitignore              # ignores node_modules/, .env, public/index.html (generated, not committed)
├── public/
│   ├── .gitkeep            # so the empty dir is committed (Dockerfile COPYs it)
│   └── index.html          # generated daily; not in git
├── src/
│   ├── server.js           # Express app + cron schedule. Entry point.
│   ├── generate.js         # The pipeline: fetchAllData → generateContent → buildHTML → write file
│   ├── data.js             # FMP /stable API client — quotes, news, gainers, losers
│   ├── ai.js               # Claude API call (with web_search tool) + JSON parsing
│   └── template.js         # Pure function that turns the JSON digest into the HTML page
└── CONTEXT.md              # This file.
```

Each `src/` file has a single responsibility — the pipeline is linear and easy to swap pieces in/out.

---

## Environment variables

Set in the Railway dashboard → Service → Variables tab. **Variable changes require a redeploy** to take effect.

| Var | Required | What it does |
|---|---|---|
| `FMP_API_KEY` | yes | Financial Modeling Prep API key. Must be a **post-Aug 31 2025 subscription** (uses /stable endpoints, not /api/v3). |
| `ANTHROPIC_API_KEY` | yes | Anthropic API key. Web search is a billable add-on (~$10 / 1,000 searches). |
| `ADMIN_KEY` | yes | Secret token gating `GET /generate?key=...`. Pick something URL-safe — avoid `#`, `&`, `+`, `%`, spaces. |
| `PORT` | optional | Defaults to 3000. Railway auto-injects this, so usually unset. |
| `TZ` | optional | Set to `America/New_York` to make log timestamps line up with the 7 AM cron. The cron itself uses an explicit `timezone:` option, so it works regardless. |

---

## How a daily digest is generated (the pipeline)

`src/generate.js#generateDigest()` runs three steps:

### Step 1 — Fetch raw market data from FMP (`src/data.js`)

Five concurrent HTTP calls to `https://financialmodelingprep.com/stable/...`:

| Function | Endpoint | What it returns |
|---|---|---|
| `fetchMarketData` | `/quote?symbol=^GSPC` (and `^IXIC`, `^DJI`, `VOO`) | Latest price, change, %change, day high/low, prev close for the 4 scoreboard symbols. Indexes use `^`-prefix symbols. |
| `fetchNews` | `/general-news`, `/stock-news?tickers=...` (4 calls), `/fmp-articles` | Pools headlines from 5 sources, dedups by 50-char title prefix, filters out penny-stock / cannabis / ratings noise / titles under 20 chars. Returns up to 15. |
| `fetchMovers` | `/biggest-gainers`, `/biggest-losers` | Top 3 of each, with price > $5 (filters out penny stocks). |

All FMP requests go through the `fmpFetch` helper which **surfaces `{"Error Message": ...}` bodies in Railway logs**. Without that, FMP errors got silently dropped (this exact issue masked the v3→/stable migration bug on first deploy).

### Step 2 — Generate kid-friendly content (`src/ai.js#generateContent`)

One call to Anthropic's API:

- **Model:** `claude-sonnet-4-20250514`
- **max_tokens:** 8000 (web search responses are longer)
- **tools:** `[{ type: "web_search_20250305", name: "web_search" }]` — server-side tool; Claude runs searches itself and returns results inline. No client-side tool_use loop needed.
- **Prompt:** instructs Claude to (a) search the web for today's top business news first, (b) write in a 12-year-old-friendly voice with strict tone rules, (c) follow strict story-selection rules (front-page-worthy stories, no penny stocks, no generic "market went up" recaps), (d) return ONLY a JSON object matching a specific schema.

The response contains interleaved blocks: `server_tool_use` (search queries Claude ran), `web_search_tool_result` (the search results), and `text` (the final JSON). The code:

1. Logs how many searches ran and their queries (visible in Railway logs as `[AI] web_search ran — ...`).
2. Concatenates all `text` blocks.
3. Strips markdown fences and `<cite ...>` / `<cite ...>` citation tags (web_search Claude sometimes wraps cited phrases in these even when told not to).
4. Parses as JSON. Falls back to extracting the largest `{...}` span if Claude prepended a synthesis paragraph.

**Claude returns this JSON schema:**

```json
{
  "date": "Wednesday, May 20, 2026",
  "tradingDay": "yesterday",
  "marketVibe": "green" | "red" | "mixed",
  "vibeEmoji": "🚀",
  "vibeSummary": "One-sentence summary of the day",
  "vooNote": "What VOO's move means in $/share for HIS holding",
  "bigPicture": "3-4 sentence world-news briefing",
  "scoreboard": {
    "sp500":  { price, change, direction: "up"|"down", vibe },
    "nasdaq": { ... },
    "dow":    { ... },
    "voo":    { ... }
  },
  "stories":  [3 items: { badge, badgeLabel, title, body, whyItMatters }],
  "comingUp": [3 items: { day, title, description, emoji }],
  "quiz":     { question, options: [4], correctIndex, explanation },
  "wordOfDay":{ word, type, context, definition }
}
```

### Step 3 — Build the HTML page (`src/template.js#buildHTML`)

Pure function. Destructures the JSON, applies `escapeHTML` to every user-facing string, and returns a complete `<!DOCTYPE html>` document. Key sections in order:

```
Header (gradient logo, date, tagline)
  ↓
🏆 Market Scoreboard (4-card grid; VOO gets a gold "YOUR FUND" badge)
  ↓
Vibe Bar (green/red/mixed indicator + VOO Watch line)
  ↓
🌎 The Big Picture (blue-gradient card with world-news briefing)
  ↓
🔥 Today's Big Stories (3 cards, each with "Why it matters" callout)
  ↓
📅 Coming Up (3 upcoming events)
  ↓
🧠 Pop Quiz (interactive — clicking shows the answer + explanation)
  ↓
📖 Word of the Day (yellow-themed card)
  ↓
Footer
```

The page is **self-contained** — all CSS is inline, fonts come from Google Fonts (`Fredoka` + `Space Mono`), and the quiz logic + animated starfield are a tiny inline `<script>`. Mobile-first: a 600px media query collapses the scoreboard to 2 columns and the quiz to a single column. Apple PWA meta tags (`apple-mobile-web-app-capable`, etc.) make it work as an iPad home-screen app.

The function is **pure** — same input always produces same output. Easy to unit-test in isolation (see `node --input-type=module -e "import { buildHTML } ..."` patterns in the commit history).

---

## Local development

```bash
cd ~/market-buzz
npm install
export FMP_API_KEY=...
export ANTHROPIC_API_KEY=...
export ADMIN_KEY=test

# Run the server with the cron job:
npm start
# then open http://localhost:3000

# Or generate the digest once and exit:
npm run generate
# this writes public/index.html — open it directly with `open public/index.html`
```

Syntax-check without running: `node --check src/<file>.js`.

There's no test suite. The HTML generator has been smoke-tested with mock data via inline `node --input-type=module -e` scripts (see the commit messages for examples).

---

## Deployment (Railway)

Railway is connected to the GitHub repo `SunnyD27/market-buzz`. Every push to `main` triggers an auto-deploy via the `Dockerfile`. The `railway.toml` declares the Dockerfile builder and `restartPolicyType = "always"`.

To deploy a change: `git push`. That's it. Railway picks it up in 30–60s.

To trigger a fresh digest after deploy: open `https://market-buzz-production.up.railway.app/generate?key=<ADMIN_KEY>` in a browser. Wait 20–40s (web search adds latency). On success returns `{"success":true,"message":"Digest generated!"}`, then refresh the root URL.

---

## Key design decisions & gotchas

### FMP plan: /stable endpoints only

FMP deprecated all `/api/v3/...` and `/api/v4/...` endpoints for subscriptions started **after Aug 31, 2025**. This project's FMP plan is post-deprecation, so everything in `src/data.js` uses `https://financialmodelingprep.com/stable/...`. Going back to v3 paths (e.g. by pasting code from older FMP docs) will fail with `"Legacy Endpoint : Due to Legacy endpoints being no longer supported"`.

Endpoint mapping if you ever migrate something else:

| Old | New |
|---|---|
| `/api/v3/quote/AAPL` | `/stable/quote?symbol=AAPL` |
| `/api/v3/quote/^GSPC` | `/stable/quote?symbol=^GSPC` (same endpoint for indexes!) |
| `/api/v3/stock_news?tickers=...` | `/stable/stock-news?tickers=...` |
| `/api/v4/general_news` | `/stable/general-news` |
| `/api/v3/stock_market/gainers` | `/stable/biggest-gainers` |
| `/api/v3/stock_market/losers` | `/stable/biggest-losers` |
| `/api/v3/fmp_articles` | `/stable/fmp-articles` (best guess — verify in logs) |

### Ephemeral filesystem

Railway containers don't persist disk across restarts. `public/index.html` is wiped on every redeploy. After a deploy, the root URL shows the placeholder until either (a) the 7 AM cron runs, or (b) you hit `/generate?key=...` manually.

If this becomes annoying, attach a Railway Volume mounted at `/app/public` and the digest survives restarts.

### Cron only fires while the container is running

If Railway's "sleep when idle" setting is on, 7 AM may be skipped on quiet nights (the cron only fires inside a live Node process). Service must be kept always-on. Check Railway → Settings → Sleep/Serverless.

### Web search citation tags leak into JSON

When `web_search_20250305` is enabled, Claude sometimes wraps cited phrases in `<cite index="...">...</cite>` tags inside its JSON string values — even when explicitly told not to. The parser in `src/ai.js#parseDigestJSON` strips both `<cite ...>` and `<cite ...>` forms (open and close, any attributes) before `JSON.parse`. If another stray pattern leaks through (`<sup>`, `[1]`, etc.), add another `cleaned = cleaned.replace(...)` line in that function.

### Web search costs money

Anthropic charges per server-side search (~$10 / 1,000). With ~3–5 searches per digest × 365 days/year, this is ~$11–18/year — fine, but it's a real line item. If you want to cut it, remove the `tools: [...]` parameter and Claude will fall back to using only FMP news.

### ADMIN_KEY URL-safety

`/generate?key=...` is just string-equal to `process.env.ADMIN_KEY`. If your admin key has `&`, `#`, `+`, `%`, or spaces, the browser URL will mis-parse it and you get `{"error":"Unauthorized"}` even with the right key. Use a URL-safe value (alphanumeric + dashes/underscores).

### Empty `public/` dir in git

The Dockerfile has `COPY public/ ./public/`. Git doesn't track empty dirs, so `public/.gitkeep` exists solely to ensure the dir is in the repo (otherwise Docker build fails or skips the COPY).

### Model ID

`claude-sonnet-4-20250514` (Sonnet 4, May 2025). Newer Sonnet 4.x models exist (e.g. `claude-sonnet-4-6`) — they'd likely work as drop-in replacements, but haven't been tested with this prompt. If you bump the model, also re-verify the citation-tag stripping (newer models may use different citation formats).

---

## How to make common changes

| Want to… | Edit |
|---|---|
| Change cron time | `src/server.js`, line ~77, the `'0 7 * * *'` cron expression and `timezone:` option |
| Change which symbols are on the scoreboard | `src/data.js#fetchMarketData` — the `symbols` array — AND `src/ai.js` JSON schema (the `scoreboard` keys) AND `src/template.js#scoreCard` calls in the HTML output |
| Add/remove a news source | `src/data.js#fetchNews` — the `Promise.all` block |
| Tighten/loosen news filtering | `src/data.js#fetchNews` — `skipTerms` array + `title.length < 20` guard |
| Change Claude's voice / story selection | `src/ai.js` — the `prompt` template literal. VOICE & TONE RULES and STORY SELECTION RULES sections. |
| Add a new section to the digest | 3 places: add a field to the JSON schema in `src/ai.js`; destructure + render it in `src/template.js`; (optionally) add CSS for the new section in `src/template.js` `<style>` block. See commit `bf57c35` ("Add 'The Big Picture' section") for the pattern. |
| Change the page look (colors, fonts, layout) | `src/template.js` `<style>` block. All CSS is inline. |
| Add a new server route | `src/server.js` — follow the `/generate` or `/health` pattern |
| Disable web search | `src/ai.js` — remove the `tools: [...]` parameter from the `messages.create` call |
| Change the model | `src/ai.js` — the `model:` field |

---

## Commit history (the journey)

| Commit | What it did |
|---|---|
| `5eb40fc` | **Initial commit.** Full app: server, cron, FMP v3 client, Claude integration, HTML generator, Dockerfile, railway.toml. |
| `f7035c0` | **Migrate FMP from v3 → /stable endpoints.** v3 was deprecated for post-Aug-2025 subscriptions, blocking all data fetches. Also added `fmpFetch` helper that logs FMP error bodies (instead of silently dropping them, which had masked this bug). |
| `67a7dc8` | **Broaden news sources + tighten story-selection prompt.** fetchNews now pulls from 5 FMP endpoints (general news, multi-ticker stock news, FMP articles), dedups, filters low-signal titles. Added STORY SELECTION RULES to the Claude prompt to avoid "market went up" recap stories. |
| `bf57c35` | **Add "The Big Picture" section.** New `bigPicture` field in the JSON schema, new blue-gradient card in the HTML between the Vibe Bar and the Stories section. 3–4 sentence world-news briefing. |
| `ebd9622` | **Enable Claude web_search tool.** Server-side `web_search_20250305` tool added so Claude pulls actual top headlines from the open web rather than relying solely on FMP. Prompt now has STEP 1 telling it to search first. max_tokens bumped 4000→8000. Added logging of search queries + stop_reason for Railway visibility. Made JSON extraction defensive against synthesis paragraphs prepended to the JSON. |
| `e82d9c8` | **Strip web_search citation tags before JSON parse.** Claude was leaking `<cite index="...">...</cite>` tags into JSON string values. Two regex strips in parseDigestJSON handle the open/close forms of both `<cite>` and `<cite>`. Belt-and-suspenders prompt directive also tells Claude not to emit them. |

---

## Known limitations / things to monitor

- **`/stable/fmp-articles` endpoint is a best guess.** If it 404s, you'll see `[Data] fmp-articles FMP error: ...` in Railway logs and the digest will still build (just without that source). Easy fix when the time comes.
- **Web search isn't deterministic** — Claude may decide not to call it on a given run. The logs say `[AI] web_search did NOT run` when this happens. Rare in practice with the explicit STEP 1 in the prompt.
- **No retries.** If FMP or Anthropic is briefly down at 7 AM, the digest skips for the day. The error gets logged; the next 7 AM tries again.
- **`lastGenerated` in `/health` is in-memory.** Resets to `"never"` on every restart even if a digest file exists on disk. Cosmetic; the actual digest file is still served.
- **No abuse protection on `/generate`.** It's gated by `ADMIN_KEY` only — anyone with the key can trigger as many generations as they want (each one costs an Anthropic call + ~3–5 web searches). Don't put the key in screenshots or commits.
- **Cron-only freshness.** If the market does something big at 11 AM you want reflected in the digest, you have to hit `/generate?key=...` manually. The digest is a once-a-day snapshot.
