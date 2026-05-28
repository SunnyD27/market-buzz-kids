# Market Juice — Project Context

**Market Juice** — your daily squeeze of market smarts. A kid-friendly daily stock-market digest for ages 10–14 and their parents. Delivered as a 7 AM EST email teaser to the parent, linking to a full interactive web digest the kid plays through in ~3 minutes a day. Real investing principles taught through news, games, streaks, and progressive ranks. Free product with future-hedged monetization (privacy policy §3). Branded as "Market Buzz Kids" from launch through May 2026; rebranded to "Market Juice" in late May 2026.

**5+2 edition system:** Tuesday–Saturday digests follow the standard format (previous trading day recap). Sunday is **The Weekly Wrap** (full-week recap + Weekly Challenge card). Monday and the day after any NYSE market holiday is **The Week Ahead** (forward-looking preview of upcoming earnings + economic data). See `src/calendar.js` for the resolver.

- **Repo:** https://github.com/SunnyD27/market-juice (public, `main`)
- **Local:** `~/market-juice`
- **Production:** https://themarketjuice.com (Railway service still at the original `market-buzz-kids-production.up.railway.app` subdomain until the service is renamed in the Railway dashboard; DNS for `themarketjuice.com` points to that subdomain)
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
| `GET /digest` | **session cookie (Phase 7)** | Today's digest (kid-facing, PWA `start_url`). `requireAuth` middleware. Re-renders from the DB row per request with the kid's first name in the greeting. Falls back to `/sample` when no row yet. |
| `GET /sample` | none | Static evergreen sample digest (`public/data/sample-digest.json`). Never auto-regenerates. |
| `GET /login` | none | Login page (`public/login.html`). Redirects already-logged-in kids to `/digest`. |
| `GET /forgot-password` | none | Parent-initiated password reset request page. |
| `GET /reset-password?token=…` | token in query | Form for picking a new password. Token validated on submit. |
| `GET /privacy` | none | COPPA-compliant privacy policy. |
| `GET /parent/delete-data` | none | Parent data deletion request form. |
| `POST /api/signup` | none | Creates user row (incl. username + bcrypt password_hash), sends verification email. **Multi-kid:** if the email already has an active, verified child, takes the *abbreviated* path — pre-verified row + an `add_child_consent` email (no re-verification). Rejects a 6th child per email (cap of 5). |
| `GET /api/add-child-consent?token=…` | token in query | Multi-kid abbreviated-consent link. Consumes the `add_child_consent` token → activates the sibling, `consent_method='known_parent_click'`, sends welcome (with a "didn't set this up?" line). |
| `POST /api/delete-data/children` | parent email in body | Multi-kid lookup for the deletion page. Returns active children (first name + age only — **never usernames**) so the parent can pick which to delete. |
| `GET /api/verify` | token in query | Email verification → triggers consent email to parent. |
| `GET /api/consent` | token in query | Parental consent → activates account, sends welcome email. |
| `POST /api/login` | username + password | Validates credentials, sets `mj_session` cookie, returns `{ success, redirect }`. |
| `POST /api/logout` | none | Clears `mj_session` cookie. |
| `GET /api/check-username?username=…` | none | Real-time availability check for the signup form. Returns `{ available }`. |
| `POST /api/forgot-password` | parent email in body | Always returns 200. If the email matches a user, emails a 1-hour reset link. |
| `POST /api/reset-password` | token + password in body | Validates token, bcrypt-hashes password, marks token used. |
| `POST /api/delete-data` | email in body | **PII scrub + soft-delete** (COPPA compliance). If the parent email matches an active user, the `users` row is updated in one transaction: `deleted_at = NOW()`, `is_active = FALSE`, and the PII columns (`kid_first_name='deleted'`, `kid_age`/`username`/`password_hash`/`parent_email`/`push_subscription` → NULL) are overwritten. The `deletion_requests` audit table keeps the original parent email as proof the request was made. Sends a deletion-acknowledgment email. |
| `POST /api/cron/send-digest` | `X-Cron-Secret` header | External trigger for daily teaser fan-out. |
| `POST /api/cron/send-evening-recap` | `X-Cron-Secret` header | External trigger for the Phase 12 parent recap / nudge fan-out. Same pattern as send-digest. The in-process hourly UTC cron also fires this. |
| `GET /progress` | session cookie | Phase 11 — kid's full engagement profile (rank ladder, badge grid, personal records, Emergency Fund). Server-rendered per request via `src/progress-template.js`. |
| `GET /api/engagement/state` | session cookie | Phase 11 — returns the full server-side engagement state (MC, streak, rank, badges, records, nextRank) for the logged-in user. Consumed by `public/engagement.js` on page load. |
| `POST /api/engagement/track` | session cookie | Phase 11 — records an engagement event. Body: `{ eventType, eventData }`. Validated against the EVENT_TYPES allow-list. Server is the source of truth for MC + progression. Includes duplicate-detection per event type. |
| `GET /generate?key=<ADMIN_KEY>` | query param | Manually triggers `generateDigest()`. |
| `GET /api/health` | none | DB connectivity check. |

**Static-leak gate:** the express.static middleware would otherwise serve `public/index.html` and `public/digest-data.json` directly, bypassing the `/digest` auth gate. A small middleware redirects those paths to `/digest` so `requireAuth` always runs.

**Auth model (Phase 7):** signed httpOnly cookie (`mj_session`) holds the user UUID. 30-day expiry, `sameSite=lax`, `secure` in production. Bcrypt cost-factor 10 for password hashing. No JWT, no Redis — every request does a Postgres lookup against the user id in the cookie. See `src/auth.js`.

**Multi-kid model:** one parent email can register **up to 5 children** (siblings). The old one-active-user-per-email UNIQUE index is dropped — `parent_email` is now a non-unique lookup index. Two signup paths:
- **New parent** (no active verified child under the email) → full flow: verification email (13–16) or consent email (10–12), unchanged.
- **Known parent** (`isKnownConsentedParent` — has an active, `email_verified` child) → abbreviated flow: row created `email_verified=true` (email already proven) + an `add_child_consent` token; the parent clicks an emailed consent link to activate each sibling (`consent_method='known_parent_click'`). Consent stays email-gated (same proof level as the first child); only the redundant re-verification step is skipped. COPPA consent is still per-child for under-13s.

Parent-facing flows dedup by email: the morning teaser sends **one email per parent** listing all their kids; password reset sends **one consolidated email** with a per-kid reset link (preserves the no-account-existence-leak property — no in-browser kid list); the deletion page is a 2-step pick-which-kid flow (shows first name + age, **never usernames**). Per-child deletion is ownership-scoped — `recordDeletionRequest(userId)` re-verifies the id belongs to the submitted email. See `src/storage.js` (`getActiveChildrenByParentEmail`, `isKnownConsentedParent`).

---

## File map

### Backend (`src/`)

| File | Role |
|---|---|
| `server.js` | Express app. Routes, signup/consent/login flow, cron, boot bootstrap, daily-teaser fan-out, Phase 7 auth migration. `cookieParser` middleware seeded with `SESSION_SECRET`. Static-leak gate redirects `/index.html` and `/digest-data.json` to `/digest`. `dotenv` loaded with `override:true` (macOS launchd gotcha). |
| `auth.js` | Phase 7 session helpers. `requireAuth` middleware (looks up user by signed cookie, attaches `req.user`, redirects to `/login` on miss), `setSession`/`clearSession` cookie writers. 30-day expiry. |
| `generate.js` | **Idempotent** digest generator. Checks `daily_digests` DB first; if today's row exists, writes to disk and returns. Otherwise: full pipeline → INSERT → disk. |
| `data.js` | FMP `/stable/` API client. `fetchMarketData`, `fetchNews`, `fetchMovers`, `fetchTopMover`, `fetchQuotes`. All ticker fetches use **per-ticker fan-out** (FMP free tier doesn't support multi-ticker batch). Tolerates `changePercentage` ↔ `changesPercentage` field rename. |
| `ai.js` | Claude API calls. Three exports: `generateContent` (main digest with web_search), `reframeBullBear` (bull-bear narrative), `reframeTimeMachine` (time-machine framing). `generateContent` routes between three internal prompt builders (`buildStandardPrompt`, `buildWeeklyWrapPrompt`, `buildWeekAheadPrompt`) based on `opts.edition.editionType` from calendar.js. **Lazy client init** (deferred `new Anthropic()` so dotenv has run). Includes `PROFANITY_RULE` in all prompts + `scrubProfanity()` regex pass on all output. Phase 12 added `PARENT EXPLAINER RULES` to each builder — every content section (stories, bigPicture, wordOfDay, didYouKnow, quiz) carries a `parentExplainer: { summary, conversationStarter }` object consumed by the evening parent recap email. |
| `calendar.js` | Edition type resolver. NYSE holiday calendar, day-of-week detection, `DATE_OVERRIDE` env-var support for testing. Exports `getEditionType()`, `getEditionDate()`, `isMarketHoliday()`, `getLastTradingDay()`, `getHolidayName()`, plus `MARKET_HOLIDAYS` for 2026–2027. |
| `games.js` | Daily Challenge orchestrator. Deterministic 8-day rotation picker, per-game hydrators, falls back to canned content on AI/FMP failure. Two AI calls max per day (bull-bear + time-machine reframers, in parallel). |
| `template.js` | Builds digest HTML. `buildHTML(content, opts)` — `opts.kidName` (Phase 7) drives a personalized greeting + Log out pill in the header. `opts.digestDate` (Phase 11) injects `window.__digestDate` for event tracking. `opts.isSample` (Phase 12) suppresses the 💬 "Ask my parent" buttons on `/sample`. Renders Daily Challenge picker, handles `isSample` flag (gold SAMPLE banner + chip), renders `editionLabel` subtitle for Weekly Wrap / Week Ahead editions. Brand-mark PNG lockup in the header (Phase 12 follow-up). 💬 buttons inserted after stories, big-picture, did-you-know, word-of-day (server-rendered) + quiz (client-injected post-answer). On Sunday, mounts the Sunday Challenge container + loads `public/games/sunday-challenge.js`; falls back to the deprecated `weeklyChallenge` card if a cached row predates the Sunday Challenge launch. |
| `progress-template.js` | Phase 11. `buildProgressHTML(state, opts)` renders the `/progress` page — 6 sections: profile header, How Market Coins Work explainer, 12-rank ladder, 6-family badge grid, 4 personal records, Emergency Fund status. Pure function, no DB access — caller supplies the state from `engagement.getProgress()`. Inline CSS, matches digest design system (Fredoka + Space Mono). |
| `engagement.js` | Phase 11 — **server-side engagement engine**. Exports `ensureProgress(userId)` (idempotent row creation), `getProgress(userId)` (full state for the API + `/progress`), `recordEvent(userId, eventType, eventData)` (the single mutation entry point — handles streak progression, Perfect Day, rank-up detection, badge tier checks, personal record updates, all in one transaction). Phase 12 added the dedup gate (`isDuplicate` — extended for `parent-question`), the `parent-question` event-type fall-through (0 MC, no progression mutations, just logs), and read helpers `getDailyEngagementSummary(userId, digestDate)` + `getParentQuestionsForDate(userId, digestDate)` for the evening recap email. |
| `progression.js` | Phase 11 — canonical constants (RANKS, MC_AWARDS, BADGE_FAMILIES, PERSONAL_RECORDS, SHIELD_CONFIG, EVENT_TYPES). Server is canonical; `public/progression-config.js` mirrors. Helpers `rankForCoins(mc)`, `shieldsUnlocked(rankKey)`. Phase 12 added `'parent-question'` to EVENT_TYPES. |
| `db.js` | pg Pool, **lazy-initialized** (same dotenv timing pattern). Exports `pool` (Proxy), `query`, `getClient`, `healthCheck`. |
| `digest-store.js` | `todayNY()`, `getDigestForDate()`, `getTodaysDigest()`, `saveDigest()`. The `saveDigest` helper is the immutability lock — `INSERT … ON CONFLICT DO NOTHING` ensures today's row can never be overwritten. |
| `storage.js` | Postgres-backed user/token/deletion helpers. Async throughout. `createUserFromSignup` accepts `username` + `password_hash` (Phase 7). `recordDeletionRequest` scrubs PII columns on the matched `users` row in the same transaction as the soft-delete (Phase 10 — COPPA compliance). Phase 11 extended the transaction to also DELETE from `user_progress`, `engagement_events`, `user_badges`, `personal_records` (covers `parent-question` rows too — no separate Phase 12 scrub needed). |
| `migrations/add-auth-columns.sql` | Phase 7 forward-only migration: adds `username` + `password_hash` columns to `users`, partial unique index on `LOWER(username)`, expands `verification_tokens.purpose` CHECK to include `password_reset`. server.js runs this on boot if the columns are missing — also kept here for manual one-shots. |
| `migrations/add-engagement-tables.sql` | Phase 11 forward-only migration: drops the never-populated `engagement` placeholder; creates `user_progress`, `engagement_events`, `user_badges`, `personal_records`. server.js' `runBootMigrations()` applies idempotently when it detects `user_progress` is missing. |
| `content-history.js` | Word-of-Day + Did-You-Know rotation guard. Generic `getRecent(kind)` / `record(kind)` backed by `state/content-history.json`. 30-day window. |
| `emails.js` | Email renderers (pure) + `sendEmail` (Resend SDK). Seven types: verify, consent, welcome, deletion-ack, daily teaser, password-reset, **Phase 12 evening recap** (`renderEveningRecap` with `recap` + `nudge` variants). Private helpers `getExplainerForSection`, `fillKidName`, `pickTonightStarters`, `gameLabel`. Stub-mode fallback if `RESEND_API_KEY` is missing. |
| `companies.js` | 75-company curated kid-recognizable list with `lookupCompany(ticker)` helper. |
| `schema.sql` | Neon DDL. Apply with `scripts/run-schema.js`. Idempotent (uses `IF NOT EXISTS`). |

### Frontend (`public/`)

| Path | Role |
|---|---|
| `landing.html` / `.css` / `.js` | Landing + signup. Phase 7: collects username + password during signup, with real-time availability check against `/api/check-username`. CTA links to `/sample`, not `/digest`. |
| `login.html` / `forgot-password.html` / `reset-password.html` | Phase 7 auth pages. Shared `public/auth.css` (matches landing-page design tokens). All three submit via fetch to the corresponding `/api` endpoints. |
| `auth.css` | Shared styles for the 3 auth pages. Self-contained — does not depend on landing.css. |
| `privacy.html` | COPPA-compliant privacy policy. §3 hedged for future sponsored content (30-day notice). |
| `parent-delete-data.html` | Data deletion request UI. |
| `index.html` | Generated daily digest (**gitignored** — rebuilt from DB on each boot). |
| `digest-data.json` | JSON payload consumed by template (**gitignored** — same lifecycle). |
| `engagement.js` / `engagement.css` | Phase 11 rewrite — **server-synced** engagement client. `MarketJuice.init()` clears legacy `mb_*`/`mbg_*` localStorage, hydrates from `GET /api/engagement/state`, renders the Investor Profile bar, fires `daily-visit` once per page load. `MarketJuice.recordEvent(eventType, eventData)` is the single mutation entry point — POSTs to `/api/engagement/track`, animates MC float, dispatches CustomEvents (`mj:rank-up`, `mj:badges-unlocked`, `mj:new-records`, `mj:shield-used`, `mj:shield-awarded`, `mj:duplicate-played`). Offline queue. `MarketJuice.askParent(btn)` (Phase 12) handles the 💬 button taps. `restoreAskParentState()` reattaches sent-state chips on page load from localStorage. CSS hosts profile-bar styles, MC float animation, popup layer, rank-tier cosmetic accents (gold accent at Market Strategist+, gold theme at Market Master+), and the 💬 quiet-link / sent-chip styling. |
| `engagement-popups.js` | Phase 11 — celebration layer. Listens on `document` for the `mj:*` CustomEvents dispatched by engagement.js and renders the matching popup or toast (rank-up modal with focus trap, badge unlock cards queued one-at-a-time, record + shield toasts, friendly "Already earned!" toast on duplicate replays). `window.MJPopupsDebug` exposes manual fire helpers. |
| `progression-config.js` | Phase 11 — client mirror of `src/progression.js`. Loaded via `<script>` tag in the digest template before `engagement.js`. Exposes `window.MJProgression` with RANKS, MC_AWARDS, BADGE_FAMILIES, PERSONAL_RECORDS, SHIELD_CONFIG + `rankForCoins` / `shieldsUnlocked` helpers. Must stay in sync with the server file. |
| `games-preview.html` | Standalone game test harness. |
| `games/*.js` | 5 game modules (quiz is inline in the template). |
| `games/daily-challenge.js` | Picker UI + 8-day rotation. **Rotation logic is duplicated in `src/games.js` — keep both in sync.** |
| `games/sunday-challenge.js` | Sunday Challenge renderer. Single entry point (`window.MJGames.sundayChallenge.render`) dispatches to 4 sub-renderers (trading-floor, ceo, investathon, dilemma) based on `data.type`. Reads `sundayChallenge` from the digest JSON, calls `MarketJuice.recordEvent('sunday-challenge-completed', {type, digestDate, bonus})` on completion. Replay-safe via `mj-sunday-challenge-<date>` localStorage flag. |
| `data/company-models.json` | 37 companies for Match + Price-is-Right. |
| `data/time-machine-prices.json` | 7 verified Time Machine scenarios. |
| `data/historical-charts.json` | 10 verified Bull-or-Bear scenarios. |
| `data/sample-digest.json` | Static curated sample. Served by `/sample`. Edit manually to refresh. |
| `manifest.webmanifest` | PWA manifest, `start_url: /digest`. |
| `sw.js` / `pwa.js` | Service worker + add-to-homescreen UX. Push notification placeholder in `pwa.js` (Phase 6.3 not done). Cache prefix `mj-`, version `v2` (Phase 8 rebrand). |
| `icons/logo.png` | Citrus + chart brand mark — transparent-bg PNG, 1024×1024. The hero lockup on `landing.html` references this directly via `<img src="/icons/logo.png">`. Sized in CSS, not pre-resized. |
| `icons/icon.svg` / `icons/icon-maskable.svg` | PWA app icons (the chart-on-navy mark used on home screens). Separate from the brand mark — different concept, different use. |

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

### Step 0.5 — Edition detection (`src/calendar.js`)

Only runs when Step 0 misses (today's row doesn't exist yet). `getEditionType()` resolves the day-of-week + NYSE holiday calendar to one of three edition types — `standard`, `weekly-wrap`, or `week-ahead` — and threads that through to the AI prompt builder. The edition is baked into the row that Step 5 inserts, so once today's digest is locked in, its edition stays locked too.

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

- **Model:** `claude-sonnet-4-6`
- **max_tokens:** 8000
- **tools:** `[{ type: "web_search_20250305", name: "web_search" }]`
- **Prompt:** STEP 1 tells Claude to web-search for today's top business news. Voice/tone rules enforce kid-friendly language. Story selection rules filter to front-page-worthy stories only. PROFANITY_RULE sets content guardrails. "Avoid these recent words/facts" list from content-history prevents repeats.

Response parsing: concatenate `text` blocks, strip markdown fences + `<cite>` tags, parse JSON (with fallback extraction of largest `{...}` span). Run `scrubProfanity()` on all output.

**Claude returns this JSON schema:**

```json
{
  "date": "Wednesday, May 20, 2026",
  "tradingDay": "yesterday" | "this week" | "last Friday",
  "editionType": "standard" | "weekly-wrap" | "week-ahead",   // Phase 6.8 — present on all editions
  "editionLabel": "The Weekly Wrap 📋" | "The Week Ahead 🔮",  // present on non-standard editions
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
    "principle": 1-11
  },
  "stories": [ 2-3 items: { "badge", "badgeLabel", "title", "body", "whyItMatters", "principle": 1-11 } ],
  "didYouKnow": { "fact", "category", "principle": 1-11, "principleConnection" },
  "quiz": { "question", "options": [4], "correctIndex", "explanation", "principle": 1-11 },
  "wordOfDay": { "word", "type", "context", "definition", "principle": 1-11 },
  "sundayChallenge": { "type", ...type-specific fields, "principle": 1-11 }   // Sunday weekly-wrap ONLY
                                                                              // type ∈ trading-floor | ceo | investathon | dilemma
                                                                              // Rotates weekly (week-of-year % 4). See src/ai.js#buildWeeklyWrapPrompt
                                                                              // and public/games/sunday-challenge.js for schemas/rendering.
}
```

**Edition variants:**

| editionType | Days | stories count | Story badges | Special fields |
|---|---|---|---|---|
| `standard` | Tue–Sat (normal weekdays) | 3 (sometimes 2) | mixed | — |
| `weekly-wrap` | Sun | exactly 2 | `WEEK'S BIGGEST`, `ALSO THIS WEEK` | `sundayChallenge` (4-type rotation) |
| `week-ahead` | Mon, post-holiday | exactly 2 | `WATCH THIS WEEK`, `ALSO COMING UP` | — |

Every content block carries a `principle` field (1-11) tying it to one of the 11 core investing principles:

1. Pay yourself first — save before you spend
2. Make your money work for you — compound growth is a superpower
3. Spend less than you earn — wealth is the gap
4. Understand what you own — invest in what you know
5. Don't put all your eggs in one basket — diversify
6. Be patient — think in years, not days
7. Control your emotions — don't follow the crowd
8. Think like an owner, not a gambler — stocks are real businesses
9. Stay consistent — regular investing beats perfect timing
10. Know the difference between price and value — expensive isn't always valuable
11. Make money while you sleep — own assets, not just stuff

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

Phase 11 moved engagement entirely server-side. The server is the source of truth; `public/engagement.js` is a thin sync client.

**Storage** — four Postgres tables (see `src/migrations/add-engagement-tables.sql`):

| Table | Role |
|---|---|
| `user_progress` | One row per user. The canonical state — `market_coins`, `current_streak`, `longest_streak`, `streak_shields`, `rank_key`, lifetime counters (`games_played`, `correct_answers`, `perfect_days`, `sunday_challenges`, `weeks_active`, `words_learned`), `last_active_date`, `last_streak_date`, `last_iso_week`. |
| `engagement_events` | Append-only audit log. Every `recordEvent()` call writes one row with server-enriched `event_data` (mcAwarded, perfectDay, shieldUsed, shieldAwarded, streakAfter, rankAfter, duplicate flag). The evening recap email queries this table. |
| `user_badges` | One row per (user, badge family). 6 families × up to 10 tiers each. `current_tier`, `progress`, `unlocked_at`. |
| `personal_records` | One row per (user, record_key). 4 records — best-day-mc, best-week-mc, longest-streak, best-perfect-week. Persists across streak resets. |

**Mechanics:**

- **Market Coins (MC)** — earned per game (25 correct / 15 participation), streak bonus `min(streakDays × 2, 30)`, Perfect Day +25, Word of Day +5, Sunday Challenge 50–75.
- **12-rank linear-progressive ladder** — Rookie (0) → Market Watcher (50) → Stock Scout (150) → Trading Cadet (350) → Market Analyst (650) → Wall Street Rookie (1,100) → Portfolio Builder (1,700) → Market Strategist (2,500) → Investment Pro (3,500) → Fund Manager (5,000) → Market Master (7,000) → Wall Street Legend (10,000). Each rank-up triggers a full-screen ceremony with rank-specific unlock copy.
- **6 badge families × 10 tiers** — streak / games / perfectDays / quizzes / consistency / sunday. First tier of each is reachable in week 1; final tier is rare. Multi-tier crossings (e.g. streak that jumps two tiers from a shield rescue) queue badge cards one-at-a-time.
- **4 personal records** — auto-tracked bests. Survive streak resets.
- **Emergency Fund (formerly Shields)** — streak protection. 1 awarded per 7-day streak milestone, capped at 3, gated by Stock Scout rank. Auto-consumed on a single missed day (2-day gap); 3+ day gap resets the streak.
- **Dedup gate** — `recordEvent` checks `engagement_events` for prior same-day events per type (`(game, digestDate)` for games, `(digestDate)` for word-learned / sunday-challenge / parent-question). Re-taps return `{ duplicate: true, mcAwarded: 0 }` and trigger a friendly "Already earned!" toast.

**Phase 12 — Parent recap pipeline:**

Each digest section carries a `parentExplainer: { summary, conversationStarter }` object generated by Claude at digest time. Kids tap 💬 buttons under sections they want to discuss with a parent — that fires a `parent-question` event (0 MC, deduped by section). Every hour UTC, a cron sweep finds users whose local time is 7 PM and sends one of two emails:

- **Recap** (kid engaged today) — session summary + game brief + per-section parent explainers for the 💬 taps + "Talk About It Tonight" picker (always present, 2-3 conversation starters from confirmed-engagement sections, skipping anything already in the 💬 block).
- **Nudge** (kid didn't engage AND streak ≥ 3) — light tease of today's digest contents + streak-at-risk language scaled to streak length. Skipped entirely if streak < 3 (don't nag fresh signups).

**Phase 11 carry-overs**: cross-device sync is real now (the server is authoritative). Old localStorage state is wiped on first load (`clearLegacyStorage()`) — no migration. The `/progress` page surfaces the full state at `/progress` (kid auth required).

---

## Email pipeline

Seven email types, all via Resend (`src/emails.js`):

| Email | Trigger | Purpose |
|---|---|---|
| Verification | `POST /api/signup` | Confirms parent email is real |
| Consent | `GET /api/verify` (after click) | COPPA parental consent request |
| Welcome | `GET /api/consent` (after click) | Account activated, what to expect |
| Daily teaser | 7 AM cron or `POST /api/cron/send-digest` | Preview of today's digest + link |
| Deletion ack | `POST /api/delete-data` | Confirms data removal |
| Password reset | `POST /api/forgot-password` (Phase 7) | 1-hour token + reset link |
| Evening recap / nudge | hourly UTC cron at user's 7 PM local or `POST /api/cron/send-evening-recap` (Phase 12) | Recap of what the kid learned, OR a streak-at-risk nudge. Variant picked per-user from engagement state. |

Stub-mode fallback: if `RESEND_API_KEY` is missing, emails log to console instead of sending. Useful for local development.

**Evening recap details (Phase 12):** the hourly cron query (`EXTRACT(HOUR FROM NOW() AT TIME ZONE COALESCE(u.timezone, 'America/New_York')) = 19`) sweeps every IANA timezone over a 24-hour day. Per-user fork: `engaged → recap` / `!engaged && streak >= 3 → nudge` / otherwise skip. The recap pulls today's digest content from `daily_digests` (one DB read per cron tick, shared across users) and the per-user engagement summary from `engagement_events`. Each section's `parentExplainer.conversationStarter` is filled with the kid's name (replacing the literal `[kid]` placeholder Claude emits). At prelaunch scale a server restart mid-loop could skip a few sends — we don't track an `evening_emails_sent` audit table.

---

## Local development

```bash
cd ~/market-juice
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
| Change Claude's voice or story rules | `src/ai.js` — the three prompt builders. Each edition (standard, weekly-wrap, week-ahead) has its own VOICE & TONE + STORY SELECTION sections. |
| Change edition logic for weekends/holidays | `src/calendar.js` — the `MARKET_HOLIDAYS` map and `getEditionType()` switch |
| Add a market holiday | `src/calendar.js` — add the date string to that year's array in `MARKET_HOLIDAYS` AND add the display name to `HOLIDAY_NAMES` |
| Tweak Weekly Wrap or Week Ahead prompt | `src/ai.js#buildWeeklyWrapPrompt` or `buildWeekAheadPrompt`. The standard prompt is in `buildStandardPrompt`. |
| Test edition logic on a specific date | `DATE_OVERRIDE=YYYY-MM-DD node src/generate.js`. Delete the test row after with `DELETE FROM daily_digests WHERE digest_date = 'YYYY-MM-DD'` |
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
- **Anti-spam on signup** — no rate limiting or captcha on `/api/signup` or `/api/delete-data`. Add Cloudflare Turnstile or rate-limit before scaling.
- **Leaderboards** — Phase 11 moved engagement server-side and ranks are real; ladder pools / weekly seasons are still on the wish list. Spec'd in `market-juice-engagement-research.md` (Part F).
- **Parent dashboard** — current evening recap email is the parent-facing surface. A weekly web dashboard with engagement history would be the next step.
- **Retention-cleanup jobs** (privacy policy §4 promises these — Phase 10 added the TODO comments in `src/server.js` near the cron block; the jobs themselves aren't built):
  - **12-month inactivity sweep.** Find users with no recent activity (now derivable from `user_progress.last_active_date` since Phase 11) and run them through `storage.recordDeletionRequest()`. Unblocked by Phase 11 — just needs the cron written.
  - **7-day incomplete-consent cleanup.** Drop users whose consent token expired without being clicked.
- **Evening-recap dedup audit table.** A server restart mid-cron could skip a few sends. At prelaunch scale (< 50 users) we accept the risk; add a simple `evening_emails_sent` ledger when traffic justifies it.

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
| 1 | Core digest refactor — removed VOO, added Today's Mover, the investing-principles framework (originally 8, now 11), Did You Know | ✅ |
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
| 6.8 | 5+2 edition system — Weekly Wrap (Sun) + Week Ahead (Mon/post-holiday), `src/calendar.js` resolver, DATE_OVERRIDE support | ✅ |
| 6.9 | Sunday Challenge — AI-generated weekly game, 4 rotating types (Trading Floor, CEO for a Day, Invest-a-Thon, Investor's Dilemma), `public/games/sunday-challenge.js` renderer, 4-week rotation derived from `edition.dateStr` | ✅ |
| 7   | Kid-facing auth — username/password signup, bcrypt-hashed, `mj_session` signed httpOnly cookie (30d), `/digest` gated by `requireAuth`, parent-initiated password reset via existing Resend email pipeline. New: `src/auth.js`, `src/migrations/add-auth-columns.sql`, `public/login.html` + `forgot-password.html` + `reset-password.html` + `auth.css`. | ✅ |
| 8   | Rebrand: Market Buzz Kids → **Market Juice** (themarketjuice.com). New tagline: "Your daily squeeze of market smarts." All HTML pages, email templates, AI prompts, PWA manifest, privacy policy, and meta tags updated. Cookie renamed `mbk_session` → `mj_session`. Service worker cache prefix `mb-` → `mj-` + version bump to v2. No schema changes. | ✅ |
| 9   | Hero restructure + brand lockup: "Market Juice" promoted to the page h1 with full gradient (was a small logo at top + separate headline). Tagline demoted to subtitle below. Citrus + chart logo mark added as `public/icons/logo.png` (transparent-bg PNG, 1024×1024) and inlined into the h1 flex container — tight gap with the wordmark so the two read as a single lockup. `flex-wrap: nowrap` keeps the lockup on one line; clamp-sized so it fits cleanly on narrow mobile down through wide desktop. | ✅ |
| 10  | COPPA deletion compliance + data retention policy. `storage.recordDeletionRequest()` now scrubs PII (`kid_first_name='deleted'`, NULLs `kid_age`/`username`/`password_hash`/`parent_email`/`push_subscription`) in the same transaction as the soft-delete. Required dropping NOT NULL on `users.parent_email` + `users.kid_age` (boot migration in `src/migrations/relax-notnull-for-deletion-scrub.sql`, applied automatically by `runBootMigrations` when it detects the columns are still NOT NULL). Deletion-ack email + `public/privacy.html` rewritten — new §4 "Data retention" with retention table, deletion triggers, and "how we delete" copy. Two TODO comments added in `src/server.js` for the 12-month inactivity sweep + 7-day incomplete-consent cleanup that the new privacy section promises (not yet built). | ✅ |
| 11  | **Server-side engagement overhaul.** XP renamed to Market Coins (MC). Four new Postgres tables (`user_progress`, `engagement_events`, `user_badges`, `personal_records`) + boot migration that drops the empty `engagement` placeholder. New `src/engagement.js` engine: ensureProgress / getProgress / recordEvent with full streak/rank/badge/record logic in one transaction, plus dedup gate (`isDuplicate`) preventing replay double-earning of MC. 12-rank linear-progressive ladder, 6 badge families × 10 tiers, 4 personal records, Emergency Fund (renamed shields, max 3, rank-gated). New routes: `GET /api/engagement/state`, `POST /api/engagement/track`, `GET /progress`. `public/engagement.js` fully rewritten — server-synced thin client with offline queue. Celebration popups (`engagement-popups.js`) — rank-up modal with focus trap, badge unlock queue, record/shield toasts, friendly "Already earned!" toast. Rank-tier cosmetic accents (gold accent at Market Strategist+, gold theme at Market Master+). `/progress` page (`src/progress-template.js`) — 6 sections: profile header, How MC Works, rank ladder, badge grid, records, Emergency Fund. Full namespace sweep: `MarketBuzz`/`MBGames`/`mb-*`/`mbg-*` → `MarketJuice`/`MJGames`/`mj-*` (83 distinct identifiers). Passive XP removed — Word-of-Day reveal kept at 5 MC. COPPA deletion scrub extended to all 4 new tables. 49-assertion smoke test (`scripts/test-engagement.js`). | ✅ |
| 13  | **Multi-kid support — one parent email, up to 5 children.** Dropped the one-active-user-per-email UNIQUE index (migration `add-multi-kid-support.sql`) → `parent_email` is now a non-unique lookup index. New `add_child_consent` token purpose. Known-parent abbreviated signup (skip re-verification, email-gated per-child consent, `consent_method='known_parent_click'`). 5-child cap. Morning teaser deduped by parent email (one email naming all kids). Password reset → one consolidated email with per-kid links (preserves no-leak). Deletion page → 2-step pick-which-kid (first name + age, no usernames); `recordDeletionRequest(userId)` ownership-scoped; deletion-ack names the deleted kids. New helpers `getActiveChildrenByParentEmail` + `isKnownConsentedParent`. New email renderers `renderAddChildConsentEmail` (age-aware copy) + `renderMultiKidPasswordResetEmail`. privacy.html "Multiple children" subsection. landing helper text + "add another child" CTA. 51 assertions across `scripts/test-multi-kid.js` + `scripts/test-multi-kid-emails.js`. **Fast-follows:** evening-recap dedup (still per-kid), email-gated deletion (deletion currently gated only by knowing the parent email). | ✅ |
| 12  | **"Ask My Parent" + Evening Parent Recap Email.** Each digest section carries a `parentExplainer: { summary, conversationStarter }` generated by Claude at digest time (PARENT EXPLAINER RULES in all 3 prompt builders). 💬 buttons on `/digest` (hidden on `/sample`) — stories, big-picture, did-you-know, word-of-day server-rendered; quiz client-injected post-answer. Tap → optimistic UI swap to "Your parent will see this tonight!" + server-logged `parent-question` event (0 MC, deduped per `(section, digestDate)`). localStorage persistence across reload. New evening recap email (`renderEveningRecap`) with two variants: **recap** (kid engaged today — game brief + 💬 explainers + always-present "Talk About It Tonight" picker) and **nudge** (kid idle AND streak ≥ 3 — light tease + streak-at-risk language). Hourly UTC cron + `POST /api/cron/send-evening-recap` external trigger; PostgreSQL `EXTRACT(HOUR FROM NOW() AT TIME ZONE …) = 19` gate sweeps every IANA timezone over a 24-hour day; NULL timezone falls back to America/New_York. New helpers: `getDailyEngagementSummary` + `getParentQuestionsForDate` in `src/engagement.js`. 73-assertion smoke test (`scripts/test-evening-email.js`) covers 6 scenarios incl. legacy backward-compat + variant-fork decision matrix. | ✅ |

---

## Future roadmap

- **Push notifications (Phase 6.3)** — VAPID keys, `/api/push/subscribe`, daily fan-out alongside the 7 AM teaser
- **Leaderboards / weekly seasons** — Duolingo-style ~30-user weekly pool with promotion/demotion. Spec'd in `market-juice-engagement-research.md` Part F. Needs enough active users to fill pools.
- **Parent web dashboard** — beyond the evening recap email; weekly view with engagement history, badge unlock timeline
- **Expanded game datasets** — 30+ bull-bear, 20+ time-machine scenarios
- **Content-history to Postgres** — survive Railway restarts
- **Per-user content rotation** — pick word/fact differently per user
- **Retention cleanup jobs** — 12-month inactivity sweep (now unblocked by Phase 11's `last_active_date`) + 7-day incomplete-consent cleanup, promised in privacy policy §4
- **Premium tier** — personalized portfolio, paper trading, ad-free deep dives ($5-8/month)
- **Referral program** — badge/reward unlocks for sharing
- **School partnerships** — curriculum supplement (26 states mandate financial literacy)
