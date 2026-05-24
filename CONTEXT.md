# Market Buzz Kids — Project Context

A daily kid-friendly stock market digest for ages 10–14 and their parents. Delivered as a 7 AM EST email teaser to the parent, linking to a full interactive web digest the kid plays through in ~3 minutes a day. Real investing principles taught through news, games, streaks, and progressive ranks. Free product with future-hedged monetization (privacy policy §3).

- **Repo:** https://github.com/SunnyD27/market-buzz-kids (public, `main`)
- **Local:** `~/market-buzz-kids`
- **Production:** https://market-buzz-kids-production.up.railway.app
- **Deploy:** Railway (Dockerfile, auto-deploys on push to `main`)
- **Port:** 3199 locally (3101 is the a3l-books project)

> **⚠️ This is the product version.** The original personal digest for Sunny lives at `~/market-buzz` with its own CONTEXT.md and repo (`SunnyD27/market-buzz`). They are completely separate projects. Do NOT read or reference `~/market-buzz/CONTEXT.md` when working on this project — it describes an older, simpler architecture (VOO scoreboard, no games, no database, no signup).

---

## Architecture

```
                          7 AM EST cron
                              │
                    ┌─────────▼──────────┐
                    │  generateDigest()   │  ← src/generate.js (idempotent)
                    │  checks daily_      │
                    │  digests DB first   │
                    └─────────┬──────────┘
                              │ (only if no row for today)
          ┌───────────────────┼────────────────────┐
          ▼                   ▼                     ▼
  ┌───────────────┐  ┌────────────────┐   ┌────────────────┐
  │  FMP /stable  │  │ Anthropic API  │   │  src/games.js  │
  │  (quotes,     │  │ (Sonnet 4 +    │   │  (3 daily      │
  │   news,       │  │  web_search)   │   │   challenge    │
  │   gainers,    │  │                │   │   games)       │
  │   losers)     │  │ generateContent│   │                │
  │               │  │ reframeBullBear│   │  deterministic │
  │  per-ticker   │  │ reframeTimeMach│   │  rotation +    │
  │  fan-out      │  │                │   │  AI reframers  │
  └───────┬───────┘  └───────┬────────┘   └───────┬────────┘
          │                  │                     │
          └──────────────────┼─────────────────────┘
                             ▼
                    ┌────────────────┐
                    │  buildHTML()   │  ← src/template.js (pure function)
                    └────────┬───────┘
                             │
                    ┌────────▼───────┐
                    │  saveDigest()  │  ← src/digest-store.js
                    │  INSERT ...    │     (ON CONFLICT DO NOTHING)
                    │  ON CONFLICT   │
                    │  DO NOTHING    │
                    └────────┬───────┘
                             │
                ┌────────────┼────────────┐
                ▼            ▼            ▼
        public/index   public/digest   Neon Postgres
          .html        -data.json      daily_digests
           │                              table
           ▼
    Express serves /digest
```

Single Node.js process. `node-cron` triggers `generateDigest()` at 7:00 AM `America/New_York`. The function is **idempotent** — it checks `daily_digests` in Postgres first; if today's row exists, it just writes the cached content to disk (~0.35s, zero API calls) and returns. Both the boot-time bootstrap AND the 7 AM cron call `generateDigest()`. First one to create the row wins; the other is a no-op.

After generation, `sendDailyTeasers()` emails all active subscribers via Resend.

---

## Routes

| Route | Auth | Purpose |
|---|---|---|
| `GET /` | none | Landing page (`public/landing.html`). Parent-facing signup + CTA to `/sample`. |
| `GET /digest` | none | Today's digest (kid-facing, PWA `start_url`). Read path: disk → DB → sample fallback. |
| `GET /sample` | none | Static evergreen sample digest (`public/data/sample-digest.json`). Never auto-regenerates. |
| `GET /privacy` | none | COPPA-compliant privacy policy. |
| `GET /parent/delete-data` | none | Parent data deletion request form. |
| `POST /api/signup` | none | Creates user row, sends verification email. |
| `GET /api/verify` | token in query | Email verification → triggers consent email to parent. |
| `GET /api/consent` | token in query | Parental consent → activates account, sends welcome email. |
| `POST /api/delete-data` | email in body | Soft-delete user data, sends deletion acknowledgment email. |
| `POST /api/cron/send-digest` | `X-Cron-Secret` header | External trigger for daily teaser fan-out. |
| `GET /generate?key=<ADMIN_KEY>` | query param | Manually triggers `generateDigest()`. |
| `GET /api/health` | none | DB connectivity check. |

---

## File map

### Backend (`src/`)

| File | Role |
|---|---|
| `server.js` | Express app. Routes, signup/consent flow, cron, boot bootstrap, daily-teaser fan-out. `dotenv` loaded with `override:true` (macOS launchd gotcha). |
| `generate.js` | **Idempotent** digest generator. Checks `daily_digests` DB first; if today's row exists, writes to disk and returns. Otherwise: full pipeline → INSERT → disk. |
| `data.js` | FMP `/stable/` API client. `fetchMarketData`, `fetchNews`, `fetchMovers`, `fetchTopMover`, `fetchQuotes`. All ticker fetches use **per-ticker fan-out** (FMP free tier doesn't support multi-ticker batch). Tolerates `changePercentage` ↔ `changesPercentage` field rename. |
| `ai.js` | Claude API calls. Three exports: `generateContent` (main digest with web_search), `reframeBullBear` (bull-bear narrative), `reframeTimeMachine` (time-machine framing). **Lazy client init** (deferred `new Anthropic()` so dotenv has run). Includes `PROFANITY_RULE` in all prompts + `scrubProfanity()` regex pass on all output. |
| `games.js` | Daily Challenge orchestrator. Deterministic 8-day rotation picker, per-game hydrators, falls back to canned content on AI/FMP failure. Two AI calls max per day (bull-bear + time-machine reframers, in parallel). |
| `template.js` | Builds digest HTML. Pure function — same input always produces same output. Renders Daily Challenge picker, handles `isSample` flag (gold SAMPLE banner + chip). |
| `db.js` | pg Pool, **lazy-initialized** (same dotenv timing pattern). Exports `pool` (Proxy), `query`, `getClient`, `healthCheck`. |
| `digest-store.js` | `todayNY()`, `getDigestForDate()`, `getTodaysDigest()`, `saveDigest()`. The `saveDigest` helper is the immutability lock — `INSERT … ON CONFLICT DO NOTHING` ensures today's row can never be overwritten. |
| `storage.js` | Postgres-backed user/token/deletion helpers. Async throughout. Same API surface as the Phase 5 in-memory version. |
| `content-history.js` | Word-of-Day + Did-You-Know rotation guard. Generic `getRecent(kind)` / `record(kind)` backed by `state/content-history.json`. 30-day window. |
| `emails.js` | Email renderers (pure) + `sendEmail` (Resend SDK). Five types: verify, consent, welcome, deletion-ack, daily teaser. Stub-mode fallback if `RESEND_API_KEY` is missing. |
| `companies.js` | 75-company curated kid-recognizable list with `lookupCompany(ticker)` helper. |
| `schema.sql` | Neon DDL. Apply with `scripts/run-schema.js`. Idempotent (uses `IF NOT EXISTS`). |

### Frontend (`public/`)

| Path | Role |
|---|---|
| `landing.html` / `.css` / `.js` | Landing + signup. CTA links to `/sample`, not `/digest`. |
| `privacy.html` | COPPA-compliant privacy policy. §3 hedged for future sponsored content (30-day notice). |
| `parent-delete-data.html` | Data deletion request UI. |
| `index.html` | Generated daily digest (**gitignored** — rebuilt from DB on each boot). |
| `digest-data.json` | JSON payload consumed by template (**gitignored** — same lifecycle). |
| `engagement.js` / `engagement.css` | XP/rank/streak/shield engine. Fully client-side localStorage. |
| `games-preview.html` | Standalone game test harness. |
| `games/*.js` | 5 game modules (quiz is inline in the template). |
| `games/daily-challenge.js` | Picker UI + 8-day rotation. **Rotation logic is duplicated in `src/games.js` — keep both in sync.** |
| `data/company-models.json` | 37 companies for Match + Price-is-Right. |
| `data/time-machine-prices.json` | 7 verified Time Machine scenarios. |
| `data/historical-charts.json` | 10 verified Bull-or-Bear scenarios. |
| `data/sample-digest.json` | Static curated sample. Served by `/sample`. Edit manually to refresh. |
| `manifest.webmanifest` | PWA manifest, `start_url: /digest`. |
| `sw.js` / `pwa.js` | Service worker + add-to-homescreen UX. Push notification placeholder in `pwa.js` (Phase 6.3 not done). |

### Scripts (`scripts/`)

| File | Role |
|---|---|
| `run-schema.js` | Apply `src/schema.sql` to Neon. Idempotent. |
| `inspect-db.js` | Print recent rows across all tables. |
| `test-games.js` | Hydrate daily-challenge games standalone. Flags: `--ai`, `--fmp`, `--date YYYY-MM-DD`. |

### Ephemeral state (gitignored)

- `state/content-history.json` — word/fact rotation history. **Ephemeral on Railway** — wiped on container restart. Acceptable for MVP; should move to Postgres before heavy deploy frequency.

---

## Environment variables

### Local (`.env`, gitignored)

Copy `.env.example` to `.env` and fill in:

| Var | Required for | Notes |
|---|---|---|
| `DATABASE_URL` | All DB-backed routes | Neon connection string with `?sslmode=require` |
| `RESEND_API_KEY` | Real email sending | Falls back to console-log stub if missing |
| `FROM_EMAIL` | Resend `from` field | Default `onboarding@resend.dev` for testing |
| `CRON_SECRET` | `POST /api/cron/send-digest` | Generate with `openssl rand -hex 32` |
| `APP_BASE_URL` | Absolute URLs in emails | Local: `http://localhost:3199`. Prod: the Railway URL. |
| `FMP_API_KEY` | `generateDigest()` | Free tier 250 req/day is fine |
| `ANTHROPIC_API_KEY` | `generateDigest()` | Web search is billable (~$10/1,000 searches) |
| `ADMIN_KEY` | `GET /generate?key=…` | Any URL-safe random string (no `#`, `&`, `+`, `%`, spaces) |
| `PORT` | Local override | 3199 locally. Railway auto-injects in prod. |

### Production (Railway dashboard)

Same set minus `PORT` (auto-injected) and `NODE_ENV` (set in Dockerfile).

**Critical:** `APP_BASE_URL` must be the full `https://` URL of the deployment (no trailing slash), or outgoing emails will link to `localhost`.

---

## How a daily digest is generated

`src/generate.js#generateDigest()` — the full pipeline:

### Step 0 — Idempotency check (`src/digest-store.js`)

Check `daily_digests` table for today's date (NY timezone). If a row exists, write its content to disk and return immediately. Zero API calls, ~0.35s. This is why redeploys never change today's content.

### Step 1 — Fetch raw market data (`src/data.js`)

Concurrent calls to `https://financialmodelingprep.com/stable/...`:

| Function | Endpoint | Returns |
|---|---|---|
| `fetchMarketData` | `/quote?symbol=^GSPC` (+ `^IXIC`, `^DJI`) | Price, change, %change for 3 index scoreboard cards. Per-ticker fan-out. |
| `fetchNews` | `/general-news`, `/stock-news?tickers=...`, `/fmp-articles` | Pooled headlines from 5 sources, deduped, filtered (no penny stocks, cannabis, short titles). Up to 15. |
| `fetchMovers` | `/biggest-gainers`, `/biggest-losers` | Top 3 each, price > $5. |
| `fetchTopMover` | `/quote?symbol=<ticker>` for each of 75 curated companies | Largest absolute % mover from the kid-recognizable list. Per-ticker fan-out. |

All requests go through `fmpFetch` helper which surfaces error bodies in logs.

### Step 2 — Generate content (`src/ai.js#generateContent`)

One call to Anthropic:

- **Model:** `claude-sonnet-4-20250514`
- **max_tokens:** 8000
- **tools:** `[{ type: "web_search_20250305", name: "web_search" }]`
- **Prompt:** STEP 1 tells Claude to web-search for today's top business news. Voice/tone rules enforce kid-friendly language. Story selection rules filter to front-page-worthy stories only. PROFANITY_RULE sets content guardrails. "Avoid these recent words/facts" list from content-history prevents repeats.

Response parsing: concatenate `text` blocks, strip markdown fences + `<cite>` tags, parse JSON (with fallback extraction of largest `{...}` span). Run `scrubProfanity()` on all output.

**Claude returns this JSON schema:**

```json
{
  "date": "Wednesday, May 20, 2026",
  "tradingDay": "yesterday",
  "marketVibe": "green" | "red" | "mixed",
  "vibeEmoji": "🚀",
  "vibeSummary": "One-sentence summary",
  "bigPicture": "3-4 sentence world-news briefing",
  "scoreboard": {
    "sp500":  { "price", "change", "direction": "up"|"down", "vibe" },
    "nasdaq": { ... },
    "dow":    { ... }
  },
  "topMover": {
    "name", "ticker", "price", "change", "direction", "vibe", "reason",
    "principle": 1-8
  },
  "stories": [ 2-3 items: { "badge", "badgeLabel", "title", "body", "whyItMatters", "principle": 1-8 } ],
  "didYouKnow": { "fact", "category", "principle": 1-8, "principleConnection" },
  "quiz": { "question", "options": [4], "correctIndex", "explanation", "principle": 1-8 },
  "wordOfDay": { "word", "type", "context", "definition", "principle": 1-8 }
}
```

Every content block carries a `principle` field (1-8) tying it to one of the 8 core investing principles:

1. Start early, let time work for you
2. Diversification protects you
3. Markets go up and down, but mostly up
4. Understand what you own
5. Risk and reward are connected
6. The news moves markets
7. Think like an owner, not a gambler
8. Fees and costs matter

### Step 3 — Hydrate daily games (`src/games.js`)

Deterministic rotation picks 3 games from the pool of 6. For bull-bear and time-machine days, parallel AI reframer calls add narrative context. Falls back to canned text on any failure. Game data is embedded into the digest JSON as `dataBundle`.

### Step 4 — Build HTML (`src/template.js#buildHTML`)

Pure function. Destructures the JSON, applies `escapeHTML` to all user-facing strings, returns complete `<!DOCTYPE html>`. Sections in order:

```
Header (gradient logo, date, tagline, Investor Profile bar)
  ↓
🏆 Market Scoreboard (3 index cards + gold Today's Mover card)
  ↓
Vibe Bar (green/red/mixed indicator + "Why [Company] moved" callout)
  ↓
🌎 The Big Picture (blue-gradient world-news briefing)
  ↓
🔥 Today's Big Stories (2-3 cards, each with "Why it matters" + principle tag)
  ↓
🎮 Daily Challenge (3-card game picker — quiz + 2 rotating games)
  ↓
💡 Did You Know (fact + principle connection)
  ↓
📖 Word of the Day (yellow card)
  ↓
Footer
```

Self-contained: all CSS inline, Google Fonts (`Fredoka` + `Space Mono`), interactive quiz + games via inline scripts. Mobile-first with 600px media query. Apple PWA meta tags for iPad home-screen.

### Step 5 — Persist + serve

`saveDigest()` inserts into `daily_digests` with `ON CONFLICT DO NOTHING`. Writes `public/index.html` and `public/digest-data.json` to disk.

`/digest` read path: disk file → DB row (re-render + warm disk) → `/sample` fallback. Kids never see a "brewing" placeholder.

---

## The engagement system

Fully client-side (localStorage). No server-side identity yet.

- **XP** — earned from quiz answers and game participation (25 XP correct, 15 XP participation)
- **Ranks** — Stock Scout → Trading Cadet → Market Analyst → ... (progressive thresholds)
- **Streaks** — consecutive days of engagement, displayed with 🔥
- **Shields** — protect streaks from breaking (earned at milestones)
- **Perfect Day** — bonus for completing all 3 daily games

Kids who clear browser data or switch devices start fresh. Moving to server-side requires identity wiring (user slugs), which also unlocks parent dashboard, push targeting, cross-device sync, and leaderboards.

---

## Email pipeline

Five email types, all via Resend (`src/emails.js`):

| Email | Trigger | Purpose |
|---|---|---|
| Verification | `POST /api/signup` | Confirms parent email is real |
| Consent | `GET /api/verify` (after click) | COPPA parental consent request |
| Welcome | `GET /api/consent` (after click) | Account activated, what to expect |
| Daily teaser | 7 AM cron or `POST /api/cron/send-digest` | Preview of today's digest + link |
| Deletion ack | `POST /api/delete-data` | Confirms data removal |

Stub-mode fallback: if `RESEND_API_KEY` is missing, emails log to console instead of sending. Useful for local development.

---

## Local development

```bash
cd ~/market-buzz-kids
PORT=3199 npm start
```

```bash
# Kill stale server
lsof -ti tcp:3199 | xargs kill

# Apply schema to Neon (idempotent)
node scripts/run-schema.js

# Inspect DB state
node scripts/inspect-db.js

# Test game hydration (no full pipeline)
node scripts/test-games.js              # dry
node scripts/test-games.js --ai --fmp   # live

# Manual digest generation
node src/generate.js

# Regenerate (requires deleting today's immutable row first)
node -e "import('./src/db.js').then(({query}) => query(\"DELETE FROM daily_digests WHERE digest_date = CURRENT_DATE\")).then(()=>process.exit(0))"
node src/generate.js
```

---

## Key design decisions & gotchas

### FMP: /stable endpoints only

FMP deprecated `/api/v3/` and `/api/v4/` for subscriptions after Aug 31, 2025. This project uses `/stable/` exclusively. Pasting code from older FMP docs will fail with `"Legacy Endpoint"` errors.

Multi-ticker batch (`/stable/quote?symbol=A,B,C`) returns `[]` on the free tier. All ticker fetches use per-ticker fan-out in parallel.

| Old | New |
|---|---|
| `/api/v3/quote/AAPL` | `/stable/quote?symbol=AAPL` |
| `/api/v3/stock_news?tickers=...` | `/stable/stock-news?tickers=...` |
| `/api/v4/general_news` | `/stable/general-news` |
| `/api/v3/stock_market/gainers` | `/stable/biggest-gainers` |
| `/api/v3/stock_market/losers` | `/stable/biggest-losers` |

### Immutable daily digest

`daily_digests` table uses `INSERT … ON CONFLICT DO NOTHING` keyed on `digest_date`. Once today's row exists, it cannot be overwritten without an explicit `DELETE`. This guarantees every visitor sees identical content all day, even through redeploys.

To force a regeneration: delete the row, then run `node src/generate.js`.

### Lazy client initialization

Both `src/ai.js` (Anthropic client) and `src/db.js` (pg Pool) defer initialization until first use. This is because macOS launchd sometimes sets `ANTHROPIC_API_KEY=""` system-wide, shadowing `.env` values. `dotenv.config({ override: true })` at every entry point + lazy init solves this.

**Any new module that reads env vars at import time will break on macOS.** Always defer.

### Web search citation tags

Claude with `web_search_20250305` sometimes leaks `<cite index="...">...</cite>` tags into JSON values. The parser in `ai.js#parseDigestJSON` strips these before `JSON.parse`. If new tag patterns appear (`<sup>`, `[1]`, etc.), add another regex.

### Kid-safe content: two layers

1. `PROFANITY_RULE` in every Claude prompt — tells the model what to avoid
2. `scrubProfanity()` regex pass over all Claude output — whole-word replacements as a safety net

Both layers must be present in any new prompt template.

### Ephemeral filesystem on Railway

Container restarts wipe disk. `public/index.html` and `digest-data.json` are rebuilt from the DB row on boot. `state/content-history.json` (word/fact rotation) is also wiped — Claude picks reasonable variety on fresh starts, but repeated deploys can cause short-term repeats.

### `/digest` is publicly accessible

No auth gate, by design. Signup is for 7 AM email delivery, not access control. Anyone with the URL can read today's content (good for sharing + SEO). Soft-gate / hard-gate deferred until identity wiring is built.

### Game rotation is duplicated

`public/games/daily-challenge.js` (client) and `src/games.js` (server) both contain the 8-day rotation logic. **Keep them in sync.** The server picks games for content hydration; the client picks for the UI picker.

---

## How to make common changes

| Want to… | Edit |
|---|---|
| Change cron time | `src/server.js` — the `cron.schedule('0 7 * * *', ...)` call |
| Change scoreboard symbols | `src/data.js#fetchMarketData` → `src/ai.js` JSON schema → `src/template.js` scorecard calls |
| Add/remove a news source | `src/data.js#fetchNews` — the `Promise.all` block |
| Tighten/loosen news filter | `src/data.js#fetchNews` — `skipTerms` array + `title.length` guard |
| Change Claude's voice or story rules | `src/ai.js` — the prompt template. VOICE & TONE RULES and STORY SELECTION RULES sections. |
| Add a new digest section | 3 places: JSON schema in `src/ai.js`, destructure + render in `src/template.js`, CSS in `template.js` `<style>` block |
| Change page look (colors, fonts, layout) | `src/template.js` `<style>` block. All CSS is inline. |
| Add a curated company | `src/companies.js` — the list + `lookupCompany()` |
| Add a new server route | `src/server.js` — follow the `/generate` or `/health` pattern |
| Disable web search | `src/ai.js` — remove `tools: [...]` from `messages.create` call |
| Change the model | `src/ai.js` — the `model:` field. Re-verify citation stripping afterward. |
| Add game scenarios | `public/data/historical-charts.json` (bull-bear), `public/data/time-machine-prices.json` (time-machine), `public/data/company-models.json` (match + price-is-right) |
| Refresh the sample digest | Edit `public/data/sample-digest.json` manually and commit |

---

## Known limitations & things not yet done

### Not yet built

- **Push notifications (Phase 6.3)** — VAPID key placeholder in `pwa.js`. Email-only MVP works fine.
- **Weekend/holiday editions** — Sunday and Monday digests currently use thin Saturday/Sunday data. A 5+2 edition system (Weekly Wrap on Sunday, Week Ahead on Monday) is spec'd and ready to implement.
- **Server-side engagement** — XP/streaks/ranks are localStorage only. No cross-device sync, no parent dashboard, no leaderboards. Requires identity wiring (user slugs in URL).
- **Engagement persistence** — hybrid PostHog (web analytics) + custom `/api/track` endpoint writing to the `engagement` table in Neon. Table placeholder exists in `schema.sql`. Needed before parent dashboard.
- **Anti-spam on signup** — no rate limiting or captcha on `/api/signup` or `/api/delete-data`. Add Cloudflare Turnstile or rate-limit before scaling.
- **Custom domain** — currently on `railway.app` subdomain. Need a branded domain before public launch.

### Known warts

- **`/generate` admin endpoint times out.** Takes ~60s, hits Railway's 30s proxy timeout. Browser sees `ERR_CONNECTION_RESET` but server completes. Fix: refactor to 202 + fire-async.
- **`ADMIN_KEY` unset = open endpoint.** `undefined !== undefined` evaluates to `false`, so the guard passes. Always set `ADMIN_KEY` in production.
- **No retries.** If FMP or Anthropic is down at 7 AM, the digest skips. Add retry logic (7:00, 7:15, 7:30) before scaling.
- **Game datasets are small.** 10 bull-bear + 7 time-machine + 37 company-models scenarios. Kids on 2-week streaks see repeats. Expand pools before growth push.
- **Content rotation ephemeral.** `state/content-history.json` resets on Railway restart. Move to Postgres when deploy frequency increases.
- **`/health` lastGenerated is in-memory.** Resets on restart. Cosmetic — digest file is still served.

---

## Build history (phases)

| Phase | What | Status |
|---|---|---|
| 1 | Core digest refactor — removed VOO, added Today's Mover, 8 investing principles, Did You Know | ✅ |
| 2 | Engagement systems — XP, ranks, streaks, shields, Perfect Day (client-side localStorage) | ✅ |
| 3 | 6 games + Daily Challenge picker + 3 verified datasets | ✅ |
| 4 | PWA setup — manifest, service worker, push scaffolding | ✅ |
| 5 | Landing page + signup + COPPA privacy + deletion flow | ✅ |
| 6.1 | Neon Postgres — `db.js`, `storage.js` rewrite, `schema.sql` | ✅ |
| 6.2 | Resend email — 5 email types, daily teaser fan-out | ✅ |
| 6.3 | Push notifications | 🔲 |
| 6.4 | Daily Challenge wired into digest template | ✅ |
| 6.5 | Per-game content generation — reframers + hydration | ✅ |
| 6.6 | Real-data verification — end-to-end live pipeline | ✅ |
| 6.7 | Immutable daily digest — `daily_digests` table, idempotent generation | ✅ |

---

## Future roadmap (post-Phase 6)

- **5+2 edition system** — Weekly Wrap (Sunday) + Week Ahead (Monday/post-holiday)
- **User slugs + digest gating** — permanent slug per user, `/digest/k/:slug`, no tokens/cookies
- **Engagement persistence** — PostHog + `/api/track` + Neon `engagement` table
- **Parent dashboard** — weekly email with engagement stats
- **Expanded game datasets** — 30+ bull-bear, 20+ time-machine scenarios
- **Content-history to Postgres** — survive Railway restarts
- **Per-user content rotation** — requires identity wiring
- **Premium tier** — personalized portfolio, paper trading, ad-free deep dives ($5-8/month)
- **Referral program** — badge/reward unlocks for sharing
- **School partnerships** — curriculum supplement (26 states mandate financial literacy)
