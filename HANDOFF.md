# Market Buzz Kids — Session Handoff

> **Pick-up doc.** Read this first when resuming work on the project.
> Captures everything built so far, current state, and what's next.

---

## What this project is

**Market Buzz Kids** — a daily stock-market digest for kids ages 10–14 and
their parents. Delivered as an email teaser to the parent at 7 AM EST, which
links to a full interactive web digest the kid plays through in ~3 minutes
a day. Real investing principles, taught through games, streaks, and
progressive ranks. **100% free.** Ad language is hedged for the future
(see `public/privacy.html` §3).

- **Repo:** https://github.com/SunnyD27/market-buzz-kids (public, `main`)
- **Local path:** `/Users/sunnysheth/market-buzz-kids`
- **Production:** **https://market-buzz-kids-production.up.railway.app**
  - Deployed via Railway → GitHub integration. Push to `main` → auto-build → auto-deploy in ~60s.
  - Env vars set in the Railway dashboard (see "Production env vars" below).
- **Original spec:** `~/Downloads/market-buzz-kids-phase1-scope-final.md` (Sunny's machine)

---

## Status: Phase 6 shipped (everything except 6.3 push notifications)

| Phase | Status | Notes |
|---|---|---|
| 1. Core digest refactor (VOO removed, Today's Mover, 8 principles, Did You Know) | ✅ | commit `3a2a031` |
| 2. Engagement systems (XP, ranks, streaks, shields, Perfect Day) | ✅ | commit `a7584ac` |
| 3. The 6 games + Daily Challenge picker + 3 verified datasets | ✅ | commit `69cf1e8` |
| 4. PWA setup (manifest, service worker, push scaffolding) | ✅ | commit `73925a1` |
| 5. Landing page + signup + COPPA + privacy + deletion | ✅ | commit `4a8d8e6` |
| **6.1.** Neon Postgres | ✅ | Today |
| **6.2.** Resend email (verify, consent, welcome, deletion ack, daily teaser) | ✅ | Today |
| **6.3.** Push notifications | 🔲 **NEXT** | Email-only MVP shipped without this |
| **6.4.** Daily Challenge wired into digest template | ✅ | Today |
| **6.5.** Per-game daily content generation (reframers + game hydration) | ✅ | Today |
| **6.6.** Real-data verification | ✅ | Today |
| **6.7.** Immutable daily digest (`daily_digests` table) | ✅ | Today — **the digest no longer regenerates on redeploy** |
| Deploy | ✅ | Railway, live |

**One commit covers all of Phase 6:** `7b4b322` (the big drop), then incremental: `0bdec78` (ad copy), `e3164c8` (sample), `bef1787` (digest fallback), `99816b7` (Phase 6.7 immutable digest).

---

## How to run locally

```bash
cd ~/market-buzz-kids
PORT=3199 npm start
```

**⚠️ Use port 3199, not 3101.** Port 3101 is the a3l-books project's dev port.

### Critical URLs

| URL | What |
|---|---|
| `http://localhost:3199/` | Landing page (parent-facing signup) |
| `http://localhost:3199/digest` | Daily digest (kid-facing — PWA start_url) |
| `http://localhost:3199/sample` | Public evergreen sample digest (linked from landing CTA) |
| `http://localhost:3199/privacy` | Privacy policy |
| `http://localhost:3199/parent/delete-data` | Deletion request form |
| `http://localhost:3199/api/health` | DB connectivity check |
| `http://localhost:3199/games-preview.html` | Game previews end-to-end |

### Env vars (local `.env`, gitignored)

Copy `.env.example` to `.env` and fill in:

| Var | Required for | Notes |
|---|---|---|
| `DATABASE_URL` | All DB-backed routes | Neon connection string with `?sslmode=require` |
| `RESEND_API_KEY` | Real email sending | Falls back to console-log stub if missing |
| `FROM_EMAIL` | Resend `from` field | Default `onboarding@resend.dev` works for testing |
| `CRON_SECRET` | `POST /api/cron/send-digest` header auth | Generate with `openssl rand -hex 32` |
| `APP_BASE_URL` | Absolute URLs in outgoing emails | Local: `http://localhost:3199`. Prod: the Railway URL. |
| `FMP_API_KEY` | `generateDigest()` market data | Free tier 250 req/day is fine |
| `ANTHROPIC_API_KEY` | `generateDigest()` Claude content | |
| `ADMIN_KEY` | `GET /generate?key=…` admin route | Any random string |
| `PORT` | Local override | Production: Railway sets this |

### Useful one-off commands

```bash
# Kill a stale server on 3199
lsof -ti tcp:3199 | xargs kill

# Apply the schema to Neon (idempotent — uses IF NOT EXISTS)
node scripts/run-schema.js

# Inspect current DB state (recent rows across all tables)
node scripts/inspect-db.js

# Hydrate today's daily-challenge games without running the full digest pipeline
node scripts/test-games.js              # dry, no AI / no FMP
node scripts/test-games.js --ai --fmp   # full live hydration

# Trigger digest generation manually (uses FMP + Anthropic keys from .env)
node src/generate.js

# Tail the server log during signup flow tests
tail -f /tmp/mb-server.log
```

### Production env vars (Railway dashboard)

Same set as local minus `PORT` (auto-injected) and `NODE_ENV` (in Dockerfile).

**Critical:** `APP_BASE_URL` on Railway must be the **full https URL** of the deployment (no trailing slash), or outgoing emails will link to `localhost`. Currently set to `https://market-buzz-kids-production.up.railway.app`.

---

## File map

### Backend (`src/`)
| File | Role |
|---|---|
| `server.js` | Express app. Routes, signup/consent flow, cron, bootstrap, daily-teaser fan-out. dotenv loaded with `override:true` so `.env` always wins (macOS launchd gotcha). |
| `generate.js` | **Idempotent** digest generator. Checks `daily_digests` first; if today's row exists, just writes it to disk. Otherwise full pipeline → INSERT row → disk. |
| `data.js` | FMP fetching. `fetchTopMover` and `fetchQuotes` use **per-ticker fan-out** because FMP killed multi-ticker `/stable/quote` on free tier. Tolerates `changePercentage` → `changesPercentage` rename. |
| `ai.js` | Claude API calls. Three exported generators: `generateContent` (main digest), `reframeBullBear`, `reframeTimeMachine`. **Lazy client init** (`new Anthropic()` deferred until first call so dotenv has run). Includes `scrubProfanity()` regex pass on all output. |
| `games.js` | **Phase 6.5 orchestrator.** Deterministic 8-day rotation picker, per-game hydrators, falls back to canned content on AI/FMP failure. Two AI calls max per day (bull-bear + time-machine reframers, parallel). |
| `template.js` | Builds digest HTML. Renders the Daily Challenge picker (Phase 6.4 replaced the bare quiz section). Handles `isSample` flag → SAMPLE chip + sign-up banner. |
| `db.js` | pg Pool, **lazy-initialized** (same dotenv timing issue). Exports `pool` (Proxy), `query`, `getClient`, `healthCheck`. |
| `digest-store.js` | **Phase 6.7.** `todayNY()`, `getDigestForDate()`, `getTodaysDigest()`, `saveDigest()`. The `saveDigest` helper is the lock — `INSERT … ON CONFLICT DO NOTHING` ensures today's row is immutable once written. |
| `storage.js` | Postgres-backed user/token/deletion helpers (Phase 6.1 rewrite). Same exports as the Phase 5 in-memory version. Async throughout. |
| `content-history.js` | Word-of-Day + Did-You-Know rotation guard. Generic `getRecent(kind)` / `record(kind)` API backed by `state/content-history.json`. |
| `emails.js` | Renderers (pure) + `sendEmail` (Resend SDK). Five email types: verify, consent, welcome, deletion-ack, daily teaser. Stub-mode fallback if `RESEND_API_KEY` is missing. |
| `companies.js` | 75-company curated kid-recognizable list. |
| `schema.sql` | Neon DDL. Includes `daily_digests` (Phase 6.7). Apply with `scripts/run-schema.js`. |

### Frontend (`public/`)
| Path | Role |
|---|---|
| `landing.html` / `.css` / `.js` | Landing + signup. CTA points to `/sample`, not `/digest`. |
| `privacy.html` | COPPA-compliant policy. §3 hedged for future sponsored content (30-day notice). |
| `parent-delete-data.html` | Deletion request UI. |
| `index.html` | Generated daily digest (**gitignored** — fresh each day, mirrors `daily_digests` row). |
| `digest-data.json` | JSON payload that `template.js` consumes (**gitignored** — same lifecycle as above). |
| `engagement.js` / `engagement.css` | XP/rank/streak engine. Client-side localStorage. |
| `games-preview.html` | Standalone game test harness. |
| `games/*.js` | The 6 game modules (quiz lives inline in the template; the other 5 are standalone files). |
| `games/daily-challenge.js` | Picker UI + 8-day rotation. The rotation is duplicated in `src/games.js` — keep both in sync. |
| `data/company-models.json` | 37 companies for Match + Price-is-Right. |
| `data/time-machine-prices.json` | 7 verified Time Machine scenarios. |
| `data/historical-charts.json` | 10 verified Bull-or-Bear scenarios. |
| `data/sample-digest.json` | **Static** curated evergreen sample (Phase 6.4 era). Served by `/sample`. Never auto-regenerates. |
| `manifest.webmanifest` | PWA manifest, `start_url: /digest`. |
| `sw.js` / `pwa.js` | Service worker + add-to-homescreen UX. |

### Ops (`scripts/`)
| File | Role |
|---|---|
| `run-schema.js` | Apply `src/schema.sql` to Neon. Idempotent. |
| `inspect-db.js` | Recent rows across all tables. Useful for debugging signup/digest flows. |
| `test-games.js` | Hydrate today's daily-challenge games standalone (no full pipeline). Flags: `--ai`, `--fmp`, `--date YYYY-MM-DD`. |

### Persisted state (gitignored)
- `state/content-history.json` — rotation history for word + fact. On Railway this is ephemeral (resets per container restart). Acceptable for MVP; would move to Postgres if rotation needs to survive deploys.

---

## Important architecture decisions worth remembering

1. **`daily_digests` is the source of truth (Phase 6.7).** One row per NY calendar date, locked via `INSERT … ON CONFLICT DO NOTHING`. The disk files (`public/index.html`, `public/digest-data.json`) are a fast-path cache; if they're missing, `/digest` rebuilds from the DB row. Result: **redeploys never change today's content**. First generation of the day wins; everyone else reads it.

2. **Generation is idempotent.** `generateDigest()` checks the DB first. If today's row exists, it just writes it to disk and returns in ~0.35s (zero API calls). Both the boot-time bootstrap AND the 7 AM cron call it. Whichever fires first creates the canonical row; the other is a no-op.

3. **`/digest` read path (in order):**
   - `public/index.html` on disk (fast `sendFile`)
   - `daily_digests` row in Postgres (re-render via `buildHTML`, warm the disk back up)
   - `/sample` content (last-resort fallback so kids never see "brewing")

4. **`/sample` is genuinely static.** Reads `public/data/sample-digest.json`, never auto-regenerated. To refresh: edit the JSON, commit, push. Same content forever otherwise.

5. **Two AI reframers, not one mega-call.** `src/ai.js` exposes `generateContent` (main digest, has web search), `reframeBullBear` (bull-bear narrative only), `reframeTimeMachine` (time-machine framing only). The reframers run in parallel inside `Promise.all` for any day where those games are picked. Always falls back to canned text in the JSON file on any failure.

6. **Per-game daily content rotation is deterministic + stateless.** `(dayIndex + hash(gameType)) % pool.length` picks the scenario for the day. Since `dayIndex` increases monotonically, consecutive days with the same gameType always land on different scenarios. No DB writes for game rotation. Compound framings + match shuffles are similarly deterministic.

7. **Word/Did-You-Know rotation is stateful** via `state/content-history.json`. 30-day window. Prompt tells Claude "don't pick any of these recent words/facts." Kid never sees déjà-vu within a month.

8. **Kid-safe language: two-layer defense.**
   - Prompt rule (`PROFANITY_RULE` in `src/ai.js`) telling Claude what to avoid.
   - `scrubProfanity()` regex pass over all Claude output as a safety net. Whole-word matches only (`hell → heck`, `damn → darn`, etc.). Walks the full output recursively.

9. **FMP free-tier reality.** Multi-ticker `/stable/quote?symbol=A,B,C` returns `[]` on free tier (batch endpoint is paid-only). All ticker fetches use **per-ticker fan-out in parallel**. `/api/v3/*` is fully deprecated (legacy users only). Field name renamed from `changesPercentage` → `changePercentage`; code tolerates both.

10. **macOS launchd gotcha.** `ANTHROPIC_API_KEY=""` is sometimes set system-wide by launchd, shadowing the `.env` value. Two fixes in place:
    - `dotenv.config({ override: true })` at every entry point (`server.js`, `generate.js`, all scripts).
    - **Lazy client init** in `db.js` (Pool) and `ai.js` (Anthropic) so they don't capture env vars at module load time, before dotenv has run.

11. **`/digest` is publicly accessible.** No auth gate, by design. Signup is for the 7 AM email delivery, not access control. Anyone with the URL can read today's content (good for sharing + SEO). Soft-gate / hard-gate were considered and deferred — see "Open questions" below.

12. **Engagement (XP/ranks/streaks/shields) is fully client-side localStorage.** No server-side identity yet. Kids who clear browser data or switch devices start fresh. This was a deliberate Phase 5 architecture decision; moving to server-side requires identity wiring (which also unlocks per-user content rotation, parent dashboard, push targeting).

13. **`/generate` admin endpoint takes ~60s, hits Railway's 30s proxy timeout.** The browser sees `ERR_CONNECTION_RESET`, but the server completes the work successfully. Known wart; the fix is to refactor it to fire-and-forget with a 202 response. Not done yet — manual-trigger is rarely used now that the boot-bootstrap + cron handle generation reliably.

14. **The cron at 7 AM EST does both generation AND teaser email fan-out.** Single in-process cron in `server.js`. `sendDailyTeasers()` is shared with the `POST /api/cron/send-digest` HTTP endpoint (external scheduler can also trigger it).

---

## Today's session log (Phase 6 in one day)

In rough chronological order:

1. **Phase 6.1 — Neon Postgres.** New `src/db.js` with pg.Pool. Rewrote `src/storage.js` async + Postgres-backed (kept same exports). Added `/api/health` DB check. dotenv override:true. Wrote `scripts/run-schema.js` and `scripts/inspect-db.js`.

2. **Phase 6.2 — Resend email.** Real `sendEmail()` calling Resend, with stub fallback. Added `renderWelcomeEmail`, `renderDeletionAckEmail`, `renderDailyTeaserEmail`. Wired welcome into activation flow; deletion ack into `/api/delete-data`. New `POST /api/cron/send-digest` with `X-Cron-Secret` header. `APP_BASE_URL` env var. `generate.js` now persists `public/digest-data.json` alongside HTML so the teaser email can read it. Live-tested all 4 user-facing emails against Sunny's real inbox.

3. **Phase 6.4 — Daily Challenge in template.** Replaced the bare Pop Quiz section with the 3-card picker. Loads `shared.js`, `daily-challenge.js`, and 5 game modules. Inline `window.MBGames.quiz` renderer (since quiz never had a standalone file). Embeds the daily `dataBundle` as JSON.

4. **Phase 6.5 — Per-game daily content.** New `src/games.js` orchestrator. Added `reframeBullBear` and `reframeTimeMachine` Claude calls (parallel, fail-soft to canned). Added `fetchQuotes` to `data.js`. Lazy Anthropic client (fixed the launchd-empty-var issue mid-session). `scripts/test-games.js` for standalone testing.

5. **Phase 6.6 — Real-data verification.** Converted `fetchTopMover` to per-ticker fan-out (FMP killed multi-ticker batch on free tier). Tolerate `changePercentage` rename. Added dotenv override to `generate.js`. Ran the full live pipeline end-to-end successfully (QCOM +13% top mover, 3 stories with web search, reframed Tesla bull-bear story, live JPM price-is-right).

6. **Polish round 1.**
   - 3 stories default (was 2). Prompt updated.
   - Profanity scrub: `PROFANITY_RULE` in all three AI prompts + `scrubProfanity()` regex over all output.
   - Compound machine framings rewritten to one-time deposits only (the game models a lump sum, not a recurring contribution). Amounts bumped from $5-$100 to $25-$1000.
   - Price-is-Right `piece` = `shortModel + surprise` (concept teaser, not just trivia).

7. **Rotation guards.**
   - Word of Day: 30-day rotation via `state/content-history.json`.
   - Did You Know: same mechanism, same file (after a refactor: `word-history.js` → generic `content-history.js`).
   - Prompt now includes "Avoid these recent words/facts" list.

8. **Deploy to Railway.** Improved Dockerfile (`npm ci`, `NODE_ENV=production`, pre-create `state/`). Added `.dockerignore`. Committed Phase 6 work to GitHub (`7b4b322`). Sunny linked the repo via Railway GitHub integration. Set all 8 env vars in the dashboard. Bootstrapped the first production digest. Confirmed all routes + assets live.

9. **Ad-language softening (privacy + landing).** Replaced flat "We don't show ads" in privacy §3 with forward-looking copy (sponsored-content hedge + 30-day parent notification). Stripped "No ads" / "tracking pixels" / "third-party sharing" claims from landing — privacy policy covers the details. Landing CTA now: "100% free" only.

10. **`/sample` route.** Curated evergreen `public/data/sample-digest.json` (fictional but plausible market day, NVDA top mover, 3 stories, Netflix-Qwikster bull-bear, Nike price-is-right, Compounding word of day). Static — never auto-regenerates. Landing CTA "See a sample" links here. `template.js` learned an `isSample` flag (renders gold "✨ This is a sample digest" banner + SAMPLE chip in the header).

11. **Digest UX after signup.** Found that fresh Railway containers wiped `public/index.html` on every redeploy → new signups saw "brewing" placeholder. Initial fix (`bef1787`) added boot-time bootstrap + fallback-to-sample. Sunny then flagged a bigger problem:

12. **Phase 6.7 — Immutable daily digest.** Sunny pointed out that even with the bootstrap, **different visitors at different times today were seeing different content** (every redeploy regenerated). Architected the proper fix: new `daily_digests` Postgres table with `digest_date` PK, locked via `ON CONFLICT DO NOTHING`. `generateDigest()` is now idempotent (DB cache check first). `/digest` reads disk → DB → sample. Made `db.js` Pool lazy-init (same dotenv timing pattern as the Anthropic client). After this, redeploys complete in ~0.35s with byte-identical content for the rest of the day.

13. **Discussion: /digest access control.** Sunny noticed `/digest` is publicly accessible. Options discussed: leave-open (Substack-style, good for sharing/SEO), soft-gate (banner for visitors without an activation cookie), hard-gate (requires identity wiring). Decided to leave as-is for now. The code-side prep started but was reverted; tracker in "Open questions" below.

---

## Phase 6.3 (push notifications) — still NOT done

The remaining MVP sub-phase. Email-only works fine; push is a nice-to-have.

- Generate VAPID keys (`web-push generate-vapid-keys`)
- Add `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` env vars
- Replace `REPLACE_IN_PHASE_6` placeholder in `public/pwa.js`
- Add `POST /api/push/subscribe` endpoint that persists subscription JSON to `users.push_subscription`
- Daily fan-out alongside the teaser email — same 7 AM cron, same source data

Half a day of work when you're ready.

---

## Open questions / things deferred

1. **Per-user content rotation** — requires identity wiring (token in email link → cookie). Same foundation also unlocks push targeting, parent dashboard, server-side engagement, leaderboards. Estimated 1–2 days. Not in current scope.

2. **`/digest` access control (soft-gate / hard-gate).** Currently public. Soft-gate (banner for drive-by visitors) is a ~10-min change. Hard-gate requires identity wiring. Leaving open for now.

3. **`/generate` admin endpoint times out at 30s on Railway's proxy.** Server completes the work, but the browser sees `ERR_CONNECTION_RESET`. Fix: refactor to 202-and-fire-async. Low priority now that the boot bootstrap is reliable.

4. **`/health` doesn't update `lastGenerated` from manual `/generate` calls** — only the 7 AM cron sets it. Cosmetic.

5. **`state/content-history.json` is ephemeral on Railway.** Container restarts wipe it, so the word/fact rotation guard resets across deploys. Not catastrophic — Claude still picks reasonable variety on each fresh start. Move to Postgres if/when rotation needs to survive restarts (e.g., when daily deploys are happening regularly).

6. **VAPID key generation** — placeholder still in `pwa.js`. Phase 6.3.

7. **PNG icons** — SVG-only. Modern iOS (16+) and desktop browsers are fine; older iOS would need PNG. Deferred.

8. **Anti-spam / captcha** — no protection on `/api/signup` or `/api/delete-data`. Cloudflare Turnstile or rate-limit recommended before scaling.

9. **Email-plus second step (COPPA strict mode)** — current single-click consent is what most low-risk kid-education products do. Layer a delayed follow-up email if legal counsel wants strict FTC compliance.

10. **Game datasets repeat over time.** 10 bull-bear + 7 time-machine scenarios. The Claude reframing layer compensates for now, but the pools should grow.

11. **Structured logging / observability.** Console-only. No Sentry, no metrics. Phase 6+.

12. **`generate.js` admin endpoint security.** If `ADMIN_KEY` is unset, both `key !== process.env.ADMIN_KEY` is `undefined !== undefined` = false, so the endpoint runs unauthenticated. Set `ADMIN_KEY` in production. (Currently is set.)

---

## Quick rebuild-the-context cheat sheet

If you're me opening this fresh:

```bash
cd ~/market-buzz-kids
git log --oneline -15                      # see recent commits
PORT=3199 npm start                         # boot
curl http://localhost:3199/api/health       # check Neon connection
open http://localhost:3199/                 # landing
open http://localhost:3199/sample           # static sample
open http://localhost:3199/digest           # today's real digest (or sample fallback)
open http://localhost:3199/games-preview.html

# Production
open https://market-buzz-kids-production.up.railway.app/
```

To regenerate today's digest manually (only if you've intentionally wiped the row):

```bash
# Step 1: delete today's row from Neon
node -e "import('./src/db.js').then(({query}) => query(\"DELETE FROM daily_digests WHERE digest_date = CURRENT_DATE\")).then(()=>process.exit(0))"

# Step 2: regenerate
node src/generate.js
```

Remember: `INSERT ON CONFLICT DO NOTHING` means once today's row exists, you cannot overwrite it without an explicit delete first. That's the immutability guarantee.

---

*Last updated end-of-day, Phase 6.7 deployed. Production live at https://market-buzz-kids-production.up.railway.app. Phase 6.3 push notifications still TODO.*
