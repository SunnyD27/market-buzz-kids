# Market Buzz Kids — Session Handoff

> **Pick-up doc.** Read this first when resuming work on the project.
> Captures everything built so far, current state, and what's next.

---

## What this project is

**Market Buzz Kids** — a daily stock-market digest for kids ages 10–14 and
their parents. Delivered as an email teaser to the parent at 7 AM EST, which
links to a full interactive web digest the kid plays through in ~3 minutes
a day. Real investing principles, taught through games, streaks, and
progressive ranks. Free. No ads.

- **Repo:** https://github.com/SunnyD27/market-buzz-kids (public, `main`)
- **Local path:** `/Users/sunnysheth/market-buzz-kids`
- **Original spec:** `~/Downloads/market-buzz-kids-phase1-scope-final.md` (Sunny's machine)

---

## Status: Phase 5 of 6 complete

| Phase | Status | Latest commit |
|---|---|---|
| 1. Core digest refactor (VOO removed, Today's Mover, 8 principles, Did You Know) | ✅ | `3a2a031` |
| 2. Engagement systems (XP, ranks, streaks, shields, Perfect Day) | ✅ | `a7584ac` |
| 3. The 6 games + Daily Challenge picker + 3 verified datasets | ✅ | `69cf1e8` |
| 4. PWA setup (manifest, service worker, push scaffolding) | ✅ | `73925a1` |
| 5. Landing page + signup + COPPA + privacy + deletion | ✅ | `4a8d8e6` |
| 6. **Backend** (Neon, Resend, push send, daily generator wiring) | 🔲 **NEXT** | — |
| Beyond | Deploy, polish, real-data verification | 🔲 | — |

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
| `http://localhost:3199/digest` | Daily digest (kid-facing — shows brewing-page placeholder until a digest is generated) |
| `http://localhost:3199/privacy` | Privacy policy |
| `http://localhost:3199/parent/delete-data` | Deletion request form |
| `http://localhost:3199/games-preview.html` | **Best place to see all games end-to-end** — has a "🚀 Today's Challenge" tab that demos the full daily experience |
| `http://localhost:3199/games-preview.html?game=compound` | Individual game previews (`compound`, `match`, `time-machine`, `bull-bear`, `price-is-right`, `today`) |

### Useful one-off commands

```bash
# Kill a stale server on 3199 (I sometimes leave one running during smoke tests)
lsof -ti tcp:3199 | xargs kill

# Trigger digest generation manually (requires FMP_API_KEY + ANTHROPIC_API_KEY env)
curl 'http://localhost:3199/generate?key=YOUR_ADMIN_KEY'

# Tail the server log when testing signup flow — the stub-send email is logged here, INCLUDING the clickable verify/consent URL
tail -f /tmp/mb-server.log

# Check git status / log
git log --oneline -15
```

### Testing the signup flow without email infrastructure

1. Fill out the landing form with a fake email + kid age 11
2. Submit → see "Almost done — one more step" success state
3. **Check the server console** — `sendEmail()` is a Phase 5 stub that logs the full email contents to stdout, including a clickable `http://localhost:3199/api/consent?token=...` URL
4. Copy that URL into your browser → "🎉 Consent confirmed!" page
5. Test age 15 → same flow but `/api/verify?token=...` instead

---

## File map

### Backend (`src/`)
| File | Role |
|---|---|
| `server.js` | Express app. Routes: `/`, `/digest`, `/privacy`, `/parent/delete-data`, `/api/signup`, `/api/verify`, `/api/consent`, `/api/delete-data`, `/generate` (admin), `/health`. Cron at 7 AM EST. |
| `generate.js` | Orchestrates daily digest generation (data → AI → HTML). |
| `data.js` | FMP fetching: indices (S&P/NASDAQ/DOW), news, biggest movers, and `fetchTopMover()` against the curated company list. |
| `ai.js` | Claude API call. Generates digest JSON with web_search. **Updated in Phase 1** to include 8 investing principles + Did You Know + Today's Mover one-liner. Does NOT currently generate per-game content (Phase 6 task). |
| `template.js` | Builds the digest HTML from the AI content. **Phase 4** wires PWA links + engagement engine. **Note:** still uses bare quiz section; doesn't yet render the Daily Challenge picker (Phase 6 task). |
| `companies.js` | 75-company curated kid-recognizable list. Used by `fetchTopMover` + games. |
| `storage.js` | **Phase 5 in-memory user store.** Mirrors `schema.sql` exactly. Swap to Postgres in Phase 6 by replacing these helpers — the API surface stays identical. |
| `emails.js` | Verification + parental consent email templates. `sendEmail()` is a stub that logs to console; Phase 6 swaps in Resend. |
| `schema.sql` | **Neon DDL — Phase 6 runs this file against the Neon database.** Tables: `users`, `verification_tokens`, `deletion_requests`, `engagement`. |

### Frontend (`public/`)
| Path | Role |
|---|---|
| `landing.html` / `.css` / `.js` | Marketing landing + signup form. UTM/timezone capture client-side, COPPA-aware. |
| `privacy.html` | Kid-friendly COPPA-compliant privacy policy. |
| `parent-delete-data.html` | Deletion request UI. |
| `index.html` | Generated daily digest (gitignored — fresh each day). |
| `engagement.js` / `engagement.css` | XP/rank/streak/shield/Perfect Day engine. All localStorage, no backend. Public API: `window.MarketBuzz.recordGamePlayed(type, {correct})`. |
| `games-preview.html` | **Test harness** — load any game with sample data. Best place to demo. |
| `games/shared.js` | Game helpers — `renderReveal()` (enforces principle tag), `animateNumber`, `buildLinePath`, `shuffle`. |
| `games/styles.css` | Shared visual language across all games. |
| `games/compound.js` | Game 4 — slider, 10% annual compound, principle 1. |
| `games/match.js` | Game 5 — tap-to-match, principle 4. |
| `games/time-machine.js` | Game 6 — 4 stocks, $1000, principle varies per scenario (mostly 2). |
| `games/bull-bear.js` | Game 2 — predictive chart, principle varies per scenario. |
| `games/price-is-right.js` | Game 3 — guess share price, principle per-company. |
| `games/daily-challenge.js` | The picker UI. 3 cards/day, deterministic 8-day rotation, Perfect Day handling. **Not yet wired into `src/template.js`** (Phase 6 task). |
| `data/company-models.json` | 37 companies — revenue breakdowns. |
| `data/time-machine-prices.json` | 7 scenarios — verified historical prices (split-adjusted) + outcome multipliers for bankrupt/acquired. |
| `data/historical-charts.json` | 10 scenarios — normalized chart shapes ($100 start) + real % outcomes. |
| `data/README.md` | Documents the two-layer content architecture (static facts + Phase 6 Claude reframing). |
| `manifest.webmanifest` | PWA manifest. `start_url: /digest` so home-screen icon opens the digest, not the marketing page. |
| `sw.js` | Service worker — versioned caches, network-first for digest, push notification handler. |
| `pwa.js` | SW registration, add-to-homescreen banner (iOS Share-button tutorial vs Chromium `beforeinstallprompt`), push subscription (gated on standalone for iOS). |
| `icons/icon.svg` / `icon-maskable.svg` | Brand chart-line icons. |

---

## Important architecture decisions worth remembering

1. **Two-layer content for verified datasets** (Bull or Bear + Time Machine):
   - **Layer 1 (static):** JSON files in `public/data/` hold verified facts — prices, splits, bankruptcies, outcomes. Never invented by AI.
   - **Layer 2 (Phase 6 daily reframing):** Claude picks which scenario today + rewrites `story` / `lessonBody` / `framing` daily. Verified facts stay locked. Documented in `public/data/README.md`.
   - This is the answer to "won't the same 7-10 scenarios get repetitive?" — they will rotate, but the narrative around them is fresh each day.

2. **Pricing approach for Time Machine:** **unadjusted historical close** + `splitFactor`. Matches what news from the era reported, and teaches the kid what a stock split is. Game math: `(1000 / priceThen) × splitFactor × currentPrice`.

3. **Pricing approach for Bull or Bear:** **normalized shapes** starting at $100, scaled by approximate real returns. Chart is unlabeled — kid never sees a specific dollar value tied to a specific ticker until the reveal. Avoids the "fabricated price" trust problem entirely.

4. **Per-company principles in Price is Right** — `data.principle` per company, not hardcoded. Apple → 4 (Services > iPhone), Coke → 1 (dividends since 1920), Nvidia → 6 (AI boom), Roblox/Starbucks → 7 (ownership). Fixes the "always Principle 7" repetition.

5. **URL split:** `/` is **parent-facing** (landing). `/digest` is **kid-facing** (the app). PWA `start_url` is `/digest` so the home-screen icon goes straight to the app, not marketing.

6. **COPPA "email-plus" caveat** (flagged in code): true email-plus per FTC requires a delayed follow-up step. Our single-email-confirmation flow is what most low-risk peers do for kid education products. Worth a legal review before going live — Phase 6 can layer a delayed follow-up if needed.

7. **Engagement engine is fully client-side** (`public/engagement.js`). All XP/streak/shield state lives in localStorage. The `engagement` table in `schema.sql` is a future placeholder for a parent dashboard (Phase 2 of the broader roadmap, not currently in scope).

8. **The 6th game IS the Quiz** — already in the digest template, just wired into `MarketBuzz.recordGamePlayed('quiz', ...)`. The other 5 games are separate JS modules under `public/games/`.

9. **`games-preview.html` has a `MBGames.quiz` inline renderer** so the Daily Challenge picker can render quiz cards in preview. The production quiz still lives in `src/template.js` — when Phase 6 wires the picker into the template, this should be unified.

---

## Phase 6 — what's next

**Backend wiring.** All Phase 5 stubs become real.

### 6.1 — Neon PostgreSQL
- Provision a free-tier Neon project, get the connection string
- Add `DATABASE_URL` to env
- Install `pg` (node-postgres) or Prisma — TBD which one to pick
- Run `src/schema.sql` against the Neon DB
- Rewrite `src/storage.js` helpers to use Postgres — **API surface stays identical** so server.js doesn't change
- Test that the full signup → activate → delete flow works against real Postgres

### 6.2 — Resend email delivery
- Sign up for Resend, get the API key
- Add `RESEND_API_KEY` to env
- Verify a sender domain (or use the dev sandbox for early testing)
- Replace `sendEmail()` stub in `src/emails.js` with a real `fetch` call to Resend
- Test that consent + verify emails actually arrive in the parent's inbox
- Add the **daily digest teaser email** (parent at 7 AM): scoreboard summary, Today's Mover one-liner, top story headline, "Today's games:" preview, big "Read Today's Buzz" button

### 6.3 — Push notification dispatch
- Generate a VAPID key pair (`web-push generate-vapid-keys`)
- Add `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` to env
- Replace the placeholder in `public/pwa.js`
- Add `POST /api/push/subscribe` endpoint that persists the subscription object to the user's `push_subscription` field
- Add a daily 7 AM job that fans out push notifications to all active subscribers with today's mover one-liner

### 6.4 — Daily Challenge wired into digest template
- Update `src/template.js` to render the Daily Challenge picker (3 cards) instead of the bare quiz section
- Include `<script>` tags for all 6 game modules + `daily-challenge.js`
- Update `src/ai.js` to use `MBGames.dailyChallenge.pickGamesForDate(today)` and generate content for each of today's 3 game types
- Update the data shape passed to the template to include the `dataBundle` for the picker

### 6.5 — Per-game daily content generation (in `src/ai.js`)
For each game type the rotation picks today, the AI step needs to produce:
- **quiz** — already done (question/options/correctIndex/explanation/principle)
- **bull-bear** — pick a scenario ID from `historical-charts.json` (biased away from recently-used), Claude rewrites story/lessonBody/lessonHeadline
- **time-machine** — pick a scenario ID from `time-machine-prices.json`, Claude rewrites framing/lessonBody, FMP injects live `priceNow` for active tickers
- **price-is-right** — pick a ticker from `companies.js`, fetch live FMP quote, generate 2 distractors at ±30%, attach the piece-of-business story + per-company principle
- **compound** — Claude generates a fresh scenario (amount + framing text)
- **match** — pick 4 random companies from `company-models.json`

### 6.6 — Real-data verification
- Run a full end-to-end generation against real FMP + Anthropic
- Verify Today's Mover picks something interesting from the curated list
- Verify all game payloads render correctly in the daily digest
- Verify Bull or Bear chart shapes look right with the Claude-reframed stories

---

## Beyond Phase 6 (rough notes, not in current scope)

- **Deploy to Railway** with the existing `Dockerfile` + `railway.toml` — environment vars: `DATABASE_URL`, `RESEND_API_KEY`, `VAPID_*`, `FMP_API_KEY`, `ANTHROPIC_API_KEY`, `ADMIN_KEY`
- Add real **PNG icons** (192 + 512) for older iOS A2HS support (current SVG works for iOS 16+)
- Expand the static datasets (more scenarios for Time Machine, Bull or Bear, Match)
- The eight principles already exist in `engagement.js` as `MBGames.shared.PRINCIPLES` — they're the single source of truth
- Wire `mb_pwa_banner` to **only show on `/digest`**, not on the landing page (currently shows everywhere `pwa.js` loads — minor polish)
- **Phase 2** of the broader product roadmap (per the original spec): parent dashboard, personalized portfolio, leaderboards, paper trading simulator. None in current scope.

---

## Open questions / things deferred

1. **VAPID key generation** — Phase 6. The placeholder in `pwa.js` is `'REPLACE_IN_PHASE_6'`.
2. **PNG icons** — only SVG currently. Modern iOS (16+) and all desktop browsers support SVG icons. Older iOS would need PNG. Deferred.
3. **Email-plus second step** — single email confirmation. A delayed follow-up email could be layered in Phase 6 if legal counsel wants strict FTC compliance.
4. **Daily Challenge in digest template** — picker exists in `games-preview.html` but NOT in `src/template.js` yet. Phase 6 task.
5. **Game datasets repeat** — only ~7-10 verified scenarios per dataset. The Phase 6 Claude reframing layer compensates, but the pools should grow over time.
6. **Standard-tier vs Pro-tier** — none currently. The product is free per spec; pricing is a Phase 2-of-broader-roadmap question.
7. **Anti-spam / captcha** — no protection on `/api/signup` or `/api/delete-data`. Cloudflare Turnstile or simple rate-limiting recommended pre-launch.
8. **Logging / observability** — server logs to console only. No structured logging, no metrics, no error tracking. Phase 6+ polish.

---

## Quick rebuild-the-context cheat sheet

If you're me opening this fresh:

```bash
cd ~/market-buzz-kids
git log --oneline -15                  # see all commits
PORT=3199 npm start                     # boot
# Then in another terminal:
curl http://localhost:3199/health
open http://localhost:3199/             # landing page
open http://localhost:3199/games-preview.html  # game previews
```

Phase 5 is the last shipped phase. Phase 6 = backend.

Recent rabbit holes covered:
- `public/data/README.md` — two-layer content architecture
- `src/schema.sql` — Neon DDL design (read top-to-bottom for the full data model)
- Phase commits are all titled `Phase N (M/X):` for easy filtering — `git log --oneline | grep 'Phase 3'`

---

*Last updated when Phase 5 completed. Sunny called it for the day after `4a8d8e6`.*
