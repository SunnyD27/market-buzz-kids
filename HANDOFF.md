# Market Juice — Session Handoff

> **Pick-up doc.** Read this first when resuming work on the project.
> For the production architecture reference (file map, design decisions,
> JSON schemas, exhaustive gotchas), see **`CONTEXT.md`** — that file is the
> canonical source of truth. This doc is the **session log**: what happened
> when, what's open, and how to get back in.

---

## What this project is

**Market Juice** — a daily stock-market digest for kids ages 10–14 and
their parents. Delivered as an email teaser to the parent at 7 AM EST,
which links to a full interactive web digest the kid plays through in ~3
minutes a day. Real investing principles taught through news, games,
streaks, and progressive ranks. **100% free** (privacy policy §3 hedges
the door for future sponsored content with a 30-day parent notice).

- **Repo:** https://github.com/SunnyD27/market-juice (public)
- **Local path:** `~/market-juice`
- **Production:** **https://themarketjuice.com** (Railway service URL is still `market-buzz-kids-production.up.railway.app` until renamed)
- **Deploy:** Railway → GitHub integration. Push to `main` → auto-build → live in ~60s.
- **Branches:** `main` is protected (PR-only). All work happens on `dev`.

---

## Status snapshot

| Phase | Status | Notes |
|---|---|---|
| 1. Core digest refactor | ✅ | `3a2a031` |
| 2. Engagement (XP, ranks, streaks, shields, Perfect Day) | ✅ | `a7584ac` |
| 3. The 6 games + Daily Challenge picker | ✅ | `69cf1e8` |
| 4. PWA setup | ✅ | `73925a1` |
| 5. Landing + signup + COPPA + privacy + deletion | ✅ | `4a8d8e6` |
| **6.1** Neon Postgres | ✅ | |
| **6.2** Resend email (verify, consent, welcome, deletion ack, daily teaser) | ✅ | |
| **6.3** Push notifications | 🔲 **NEXT** | Email-only MVP is live |
| **6.4** Daily Challenge wired into digest template | ✅ | |
| **6.5** Per-game daily content generation (reframers + hydration) | ✅ | |
| **6.6** Real-data verification | ✅ | |
| **6.7** Immutable daily digest (`daily_digests` table) | ✅ | Redeploys don't regenerate |
| **6.8** 5+2 edition system (Weekly Wrap + Week Ahead) | ✅ | Shipped to `main` via PR #3 |
| **6.9** Sunday Challenge — AI-generated rotating weekly game | ✅ | Shipped via PR #4 |
| **7** Kid auth — username/password + 30d session + reset | ✅ | Shipped via PR #5 |
| **8** Rebrand: Market Buzz Kids → **Market Juice** (themarketjuice.com) | ✅ | On `dev`, see session log below |
| **Polish** Model migration → `claude-sonnet-4-6` | ✅ | `10c069e` |
| **Polish** Market-closed note above scoreboard | ✅ | Shipped via PR #3 |
| **Polish** Investing principles expanded 8 → 11 | ✅ | Shipped via PR #3 |
| **Polish** Stories-section heading reflects edition type | ✅ | Shipped via PR #3 |
| **Polish** Week-ahead market-closed copy → "yesterday" | ✅ | Shipped via PR #4 |
| **Polish** Skip post-holiday Week Ahead when holiday is Monday | ✅ | On `dev`, `9b8dbef` |
| Deploy | ✅ | Railway live |

**Recent commits (most recent first):**

| Commit | Branch | What |
|---|---|---|
| `940a955` | `dev` | `fix: week-ahead market-closed copy reads "yesterday" not "today"` |
| `4aac70a` | `dev` | `feat: add Sunday Challenge — AI-generated rotating weekly game` (Phase 6.9) |
| `5fa8834` | `main` | PR #3 merge — ships principles 8→11, dataset remap, edition-aware stories heading |
| `a7c4d25` | `main` | `fix: stories-section heading reflects edition type` |
| `c2f73e1` | `main` | `fix: remap game dataset principles from old 8 to new 11 numbering` |
| `04823cf` | `main` | `feat: expand investing principles from 8 to 11` |
| `0b20c14` | `main` | PR #2 merge — ships Phase 6.8 (5+2 editions) + market-closed note |
| `632309a` | `main` | `feat: market-closed note above scoreboard for weekend/holiday editions` |
| `3454a9d` | `main` | `feat: 5+2 edition system — Weekly Wrap + Week Ahead` (Phase 6.8) |
| `10c069e` | `main` | `fix: migrate Claude model from sonnet-4-20250514 to sonnet-4-6` |

---

## Branch workflow

`main` is **protected** (set up via `gh api`). Direct pushes to `main` are
rejected. Workflow:

```bash
git checkout dev
# … changes …
git add <files>
git commit -m "feat: …"
git push origin dev
# Open PR on GitHub: base:main ← compare:dev → Merge
# Railway auto-deploys main in ~60s
```

The branch protection rule is configured for **PR required, zero
approvers** (it's a solo project), `enforce_admins: false`, no force-push,
no deletion of `main`.

---

## Local dev cheat sheet

```bash
cd ~/market-juice
PORT=3199 npm start                       # boot (3199 to avoid a3l-books on 3101)
curl http://localhost:3199/api/health     # Neon connectivity check

node scripts/run-schema.js                # apply schema.sql idempotently
node scripts/inspect-db.js                # latest rows across all tables
node scripts/test-games.js --ai --fmp     # hydrate today's games (live AI + FMP)
node src/generate.js                      # manual digest (no-op if today's row exists)

# Test the 5+2 edition system on any date — bypasses today's NY date.
DATE_OVERRIDE=2026-05-24 node src/generate.js  # Sunday → weekly-wrap
DATE_OVERRIDE=2026-05-25 node src/generate.js  # Monday → week-ahead
DATE_OVERRIDE=2026-05-26 node src/generate.js  # Tue after holiday → week-ahead (post-holiday)
```

**Critical URLs:** `/` (landing), `/sample` (static teaser), `/digest`
(real daily — falls back to sample if no DB row), `/privacy`,
`/parent/delete-data`, `/api/health` (DB), `/games-preview.html`,
`/generate?key=$ADMIN_KEY` (admin, fire-and-forget — see warts below).

**Env vars** (see `.env.example`): `DATABASE_URL`, `RESEND_API_KEY`,
`FROM_EMAIL`, `CRON_SECRET`, `APP_BASE_URL`, `FMP_API_KEY`,
`ANTHROPIC_API_KEY`, `ADMIN_KEY`, `PORT`. `DATE_OVERRIDE` is testing-only.

---

## Session log (chronological)

**Phase 6 (1-6 + polish) — one long day, commit `7b4b322`**

1. **6.1 Neon Postgres** — `src/db.js`, async `storage.js` rewrite, `/api/health`, `scripts/run-schema.js`, `scripts/inspect-db.js`.
2. **6.2 Resend email** — real `sendEmail()` via Resend, five render functions (verify, consent, welcome, deletion-ack, daily teaser), `POST /api/cron/send-digest`, `APP_BASE_URL`, `generate.js` persists `digest-data.json`. Live-tested all four user-facing emails.
3. **6.4 Daily Challenge in template** — bare quiz section replaced with 3-card picker, inline `MBGames.quiz` renderer, embeds `dataBundle` JSON.
4. **6.5 Per-game content** — `src/games.js` orchestrator, `reframeBullBear` + `reframeTimeMachine` parallel Claude calls, `fetchQuotes` in `data.js`, lazy Anthropic client (fixed the launchd-empty-var issue mid-session). `scripts/test-games.js`.
5. **6.6 Real-data verification** — `fetchTopMover` per-ticker fan-out (FMP killed multi-ticker batch on free tier), `changePercentage` rename tolerated, full live pipeline ran end-to-end.
6. **Polish round 1** — 3 stories default, profanity scrub + `PROFANITY_RULE`, compound machine framings rewritten to one-time-deposits, price-is-right `piece` enriched (shortModel + surprise).
7. **Word/Fact rotation** — `state/content-history.json`, 30-day window, prompt "avoid these recent" lists.
8. **Deploy to Railway** — Dockerfile improved (`npm ci`, `NODE_ENV=production`, pre-create `state/`), `.dockerignore`, env vars set, first prod digest bootstrapped.

**Polish — privacy/landing ad language (`0bdec78`)**

Replaced flat "We don't show ads" with forward-looking copy hedging for sponsored content (30-day parent notice). Landing CTA → "100% free."

**Polish — `/sample` route (`e3164c8`)**

Static evergreen `public/data/sample-digest.json` (NVDA top mover, 3 stories, Netflix-Qwikster bull-bear, Nike price-is-right). Landing CTA "See a sample" links here. `template.js` learned `isSample` → gold banner + chip.

**Bootstrap + fallback (`bef1787`, later superseded by 6.7)**

Fresh Railway containers were wiping `public/index.html` on every redeploy → "brewing" placeholder. Added boot-time bootstrap + `/digest` fallback to `/sample`. Worked but had a bigger problem.

**Phase 6.7 — Immutable daily digest (`99816b7`)**

Sunny flagged that even with the bootstrap, different visitors at different times today were seeing different content (every redeploy regenerated, picked different top movers / reframings). Fix: new `daily_digests` Postgres table, `digest_date` PK, locked via `INSERT … ON CONFLICT DO NOTHING`. `generateDigest()` is now idempotent (DB cache check first). `/digest` read path: disk → DB → sample. Made `db.js` Pool lazy-init for the same dotenv-timing reason as the Anthropic client. **Redeploys complete in ~0.35s with byte-identical content the rest of the day.**

**Discussion: /digest access control (no code change)**

Sunny noticed `/digest` is publicly accessible. Discussed open / soft-gate / hard-gate. **Decided to leave open** for now — signup is for email delivery, not access control. Substack model.

**Cousin's signups didn't get emails — Resend sandbox limit (no code change)**

`hbhagat88@gmail.com` and `harsh@zevacare.com` signed up correctly (both in `users` table, both have valid tokens), but Resend rejected the sends with HTTP 403:

> "You can only send testing emails to your own email address (sunny27@gmail.com). To send emails to other recipients, please verify a domain at resend.com/domains."

**Fix: verify a domain on Resend, then set `FROM_EMAIL=hello@<verified-domain>` on Railway.** Stuck signups can be re-emailed or manually activated once the domain is verified.

**Model migration (`10c069e`)**

`claude-sonnet-4-20250514` was retiring June 15, 2026. Replaced with `claude-sonnet-4-6` in both `generateContent()` (line 243) and `REFRAMER_MODEL` const (line 291). Verified against the live API for both call shapes (with `web_search` tool and reframer-style with `system` prompt).

**Branch workflow setup (no commit)**

Used `gh api` to enable branch protection on `main` (PR required, no approvers, no force-push, no deletion, enforce_admins false). Created `dev` branch, pushed to origin. All subsequent work happens on `dev`.

**Phase 6.8 — 5+2 edition system (`3454a9d`, on `dev`)**

New `src/calendar.js` resolves the edition type for any date in `America/New_York`:

- **Tuesday–Saturday (normal)** → `standard` — covers previous trading day, no change
- **Sunday** → `weekly-wrap` — recap of the full week, 2 stories with `WEEK'S BIGGEST` + `ALSO THIS WEEK` badges, plus a **Weekly Challenge** card
- **Monday** → `week-ahead` — forward-looking preview, 2 stories with `WATCH THIS WEEK` + `ALSO COMING UP` badges
- **Day after a market holiday** → `week-ahead` (same format, `reason: post-holiday`, opens with "Hope you had a great [holiday]!")

Three prompts in `src/ai.js`: `buildStandardPrompt` (extracted verbatim from the old inline string, body byte-identical), `buildWeeklyWrapPrompt`, `buildWeekAheadPrompt`. `generateContent` routes via `opts.edition.editionType`. `template.js` renders `editionLabel` subtitle + `weeklyChallenge` card. NYSE holiday calendar covers 2026–2027.

`DATE_OVERRIDE=YYYY-MM-DD` env var lets you test any date locally without changing the system clock. Calendar.js + the AI prompts honor it via `getEditionDate()`.

Live-tested all 3 new editions against real FMP + Anthropic. All assertions passed (correct edition type, correct badge labels, correct story counts, weeklyChallenge present on Sunday and absent on Monday, "Hope you had a great Memorial Day!" on the post-holiday Tuesday).

**Polish — market-closed note (`632309a`, on `dev`)**

Single muted line above the scoreboard on weekend/holiday editions so kids understand why the numbers haven't moved since Friday:

- Sunday: "📊 Markets were closed this weekend — here's how the week went"
- Monday/post-holiday: "📊 Markets are closed today — here's where things stand heading into the week"
- Tue–Sat normal: nothing rendered

Implemented via a new `marketClosed: true` static field added to both weekend prompt JSON schemas (Claude doesn't decide; the prompt always sets it). `template.js` reads `content.marketClosed` + `content.editionType` and renders the appropriate copy.

---

## What's NOT done

### Phase 6.3 — Push notifications (still on the roadmap)

The remaining MVP sub-phase. Email-only is fine; push is nice-to-have.

- Generate VAPID keys (`web-push generate-vapid-keys`)
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` env vars
- Replace `REPLACE_IN_PHASE_6` placeholder in `public/pwa.js`
- `POST /api/push/subscribe` → write subscription JSON to `users.push_subscription`
- Daily fan-out alongside the 7 AM teaser email

~½ day of work.

### Resend custom domain (blocking real signups beyond Sunny)

Currently in **Resend sandbox mode** — `from: onboarding@resend.dev` can only deliver to `sunny27@gmail.com`. Every other recipient gets HTTP 403 from Resend. **Verify a domain on Resend** (DNS records: SPF, DKIM, DMARC), then update `FROM_EMAIL` on Railway. After that, any signup gets real emails.

### Pending on `dev` to merge into `main`

- Skip post-holiday Week Ahead when holiday is Monday — `9b8dbef`
- Doc refresh through Phase 6.9 — `7715d2d`
- Phase 7 kid auth — landing on the next commit after this doc refresh

When ready: open PR `dev → main` on GitHub, merge, Railway auto-deploys.

> Phase 6.9 Sunday Challenge + market-closed copy fix already shipped to `main` via PR #4. Earlier polish (principles 8→11, dataset remap, edition-aware stories heading) shipped via PR #3.

### Open questions / deferred polish

1. **Per-user content rotation** — requires identity wiring (token in email link → cookie). Same foundation unlocks push targeting, parent dashboard, server-side engagement, leaderboards. ~1-2 days.
2. **`/digest` access control** — currently open. Soft-gate is ~10 min; hard-gate needs identity wiring. Left open by decision.
3. **`/generate` admin endpoint times out at 30s on Railway proxy.** Server completes the work; the browser sees `ERR_CONNECTION_RESET`. Refactor to 202 + fire-async. Low priority now that the boot bootstrap + cron handle generation reliably.
4. **`/health` lastGenerated** isn't updated by manual `/generate` calls — only the 7 AM cron sets it. Cosmetic.
5. **`state/content-history.json` is ephemeral on Railway.** Container restarts wipe word/fact rotation history. Move to Postgres if/when daily deploys cause noticeable repetition.
6. **PNG icons** — SVG-only; modern iOS 16+ is fine, older needs PNG.
7. **Anti-spam / captcha** on `/api/signup` + `/api/delete-data`. Add Cloudflare Turnstile before public launch.
8. **Email-plus second step (strict COPPA)** — current single-click consent is what most low-risk kid products do; layer a delayed follow-up if legal counsel requires.
9. **Game datasets are small** — 10 bull-bear + 7 time-machine. Reframing compensates, but the pools should grow.
10. **Structured logging / Sentry / metrics** — none. Console-only.
11. **`ADMIN_KEY` unset = open `/generate`** — `undefined !== undefined` is `false`, so the guard passes when unset. Always set in prod (currently set).
12. **`node -e` doesn't load dotenv.** The one-liner `node -e "import('./src/db.js')..."` cheat sheet snippet for deleting today's row will silently fail with ECONNREFUSED if `node -e` is used directly. Use `node --input-type=module -e "import dotenv from 'dotenv'; dotenv.config({override:true}); ..."` instead. Updated cheat sheet below.

---

## Pickup cheat sheet — opening this cold

```bash
cd ~/market-juice
git log --oneline -15
git branch --show-current               # should be dev or main
git status

# Make sure you're on dev for any new work
git checkout dev
git pull origin dev

# Local boot
PORT=3199 npm start
curl http://localhost:3199/api/health
open http://localhost:3199/sample       # static — always works
open http://localhost:3199/digest       # today's real digest

# Production
open https://themarketjuice.com/
```

### Force-regenerate today's digest (immutability bypass)

The immutability lock means today's row can't be overwritten without an explicit delete. Use this when you've changed prompts/template and want to see the new output:

```bash
# Step 1 — delete today's row (dotenv loaded so DATABASE_URL resolves)
node --input-type=module -e "
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { query } from './src/db.js';
const r = await query(\"DELETE FROM daily_digests WHERE digest_date = CURRENT_DATE RETURNING digest_date\");
console.log('Deleted:', r.rows.map(x=>x.digest_date.toISOString().slice(0,10)));
process.exit(0);
"

# Step 2 — regenerate
node src/generate.js
```

### Test an arbitrary edition type

```bash
DATE_OVERRIDE=2026-05-24 node src/generate.js   # Sunday weekly-wrap
DATE_OVERRIDE=2026-05-25 node src/generate.js   # Monday week-ahead
DATE_OVERRIDE=2026-05-26 node src/generate.js   # Post-holiday week-ahead

# Clean up test rows when done
node --input-type=module -e "
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { query } from './src/db.js';
const r = await query(\"DELETE FROM daily_digests WHERE digest_date IN ('2026-05-24','2026-05-25','2026-05-26') RETURNING digest_date\");
console.log('Cleaned:', r.rows.map(x=>x.digest_date.toISOString().slice(0,10)));
process.exit(0);
"
```

### See production prompt content

```bash
node --input-type=module -e "
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { getDigestForDate, todayNY } from './src/digest-store.js';
const d = await getDigestForDate(todayNY());
console.log(JSON.stringify(d.content, null, 2));
process.exit(0);
"
```

---

## Pointers

- **Architecture / design decisions / file map** → see `CONTEXT.md` (deeper than this doc)
- **Database schema** → `src/schema.sql`
- **Edition resolver logic** → `src/calendar.js` (`getEditionType()`)
- **AI prompts** → `src/ai.js` (`buildStandardPrompt`, `buildWeeklyWrapPrompt`, `buildWeekAheadPrompt`)
- **HTML rendering** → `src/template.js#buildHTML`
- **Idempotency lock** → `src/digest-store.js#saveDigest` (the `ON CONFLICT DO NOTHING`)

---

*Last updated end-of-Phase-8 (Market Juice rebrand) session. PR #5 (Phase 7 kid auth + calendar fix + landing 11-principles + doc refresh) already shipped to `main`. On `dev` awaiting PR #6: the rebrand commit. themarketjuice.com Resend domain verified ✅ — emails now deliver to any parent. Phase 6.3 push notifications still TODO. Internal JS namespaces (`window.MBGames`, `window.MarketBuzz`, `mbg-` CSS prefix) still carry the old brand abbreviation — deliberate scope; future refactor.*

---

## Session: Principles Expansion (8 → 11)

Expanded the core investing principles from 8 to 11. New principles added:
- 9: Stay consistent — regular investing beats perfect timing
- 10: Know the difference between price and value — expensive isn't always valuable
- 11: Make money while you sleep — own assets, not just stuff

Old principles 1-7 are unchanged. Old principle 8 ("Fees and costs matter") was replaced with "Think like an owner, not a gambler." The entire principle set was reworked based on research from Buffett, Munger, Graham, Housel, Kiyosaki, Naval Ravikant, Corley's millionaire studies, The Richest Man in Babylon, and The Millionaire Next Door.

Changes: src/ai.js (all prompt templates), src/template.js (principle mapping), CONTEXT.md.
All `principle` fields in JSON output now range 1-11 instead of 1-8.

---

## Session: Sunday Challenge Game System

Replaced the simple `weeklyChallenge` text field with a full interactive `sundayChallenge` game system:
- 4 game types rotate on a 4-week cycle (ISO week % 4)
- The Trading Floor: 3-round portfolio sim with real historical stock prices
- CEO for a Day: 3 real business decision scenarios from lesser-known company history
- Invest-a-Thon: 10 rapid-fire trivia questions with 8-second timer
- The Investor's Dilemma: 3 tradeoff scenarios with real math breakdowns on both sides
- All content generated fresh by Claude each Sunday as part of the Weekly Wrap prompt
- Client component: public/games/sunday-challenge.js handles all 4 types
- XP: 50 base + 25 bonus (higher than weekday games)
- Key prompt rules: no obvious/well-known outcomes, real verified data, surprise factor is #1 quality metric

Backward compat: template still renders the old weeklyChallenge card if a cached digest row predates the Sunday Challenge launch, so old DB rows don't suddenly show a blank section.

Changes: src/ai.js (Weekly Wrap prompt), src/template.js (Sunday Challenge section + CSS + script tag),
new public/games/sunday-challenge.js, CONTEXT.md.

---

## Session: Phase 7 — Kid Auth (username + password)

Added kid-facing authentication:
- Login page at `/login` with username + password
- 30-day signed httpOnly cookie session (`mj_session`) via `cookie-parser`
- `/digest` now gated behind `requireAuth` middleware — also re-renders per request to greet the kid by name (was static disk-serve)
- Signup form collects username + password; debounced availability check fires at `/api/check-username` as the parent types
- Password hashed with `bcrypt` (cost factor 10)
- Password reset: parent enters email → 1-hour `password_reset` token → click → set new password → log in
- Real-time username availability + clean 409 error if a username gets sniped between check and submit
- Digest header greets the kid: "Hey, [name]! 👋" with a small Log out pill
- Welcome email now includes the kid's username + login link
- Static-leak gate redirects `/index.html` and `/digest-data.json` (which the static middleware would otherwise serve) to `/digest` so the auth gate always runs

DB migration runs on boot. `verification_tokens.purpose` CHECK constraint was expanded to accept `password_reset` (was: only `email_verify` and `parental_consent`). Existing rows are unaffected.

`SESSION_SECRET` added to `.env.example`. Production MUST set this; local dev falls back to a hardcoded string with a loud warning.

New files: `src/auth.js`, `src/migrations/add-auth-columns.sql`, `public/login.html`, `public/forgot-password.html`, `public/reset-password.html`, `public/auth.css`.
Modified: `src/server.js`, `src/storage.js`, `src/schema.sql`, `src/emails.js` (welcome + new password-reset renderer), `src/template.js` (kidName + greeting/logout), `public/landing.html`, `public/landing.js`, `public/landing.css`, `CONTEXT.md`, `.env.example`.

Known out-of-scope items flagged during this session (NOT addressed):
- `public/landing.html` still references "8 investing principles" in its marketing copy (lines 117-129). Should be updated to the 11-principle framework in a follow-up.
- Server-side engagement (XP/streaks/ranks) is still localStorage-only. Auth provides the identity foundation; persistence is a future task.

---

## Session: Rebrand to Market Juice

Renamed product from "Market Buzz Kids" to "Market Juice."
- Domain: themarketjuice.com
- Updated all HTML pages, email templates, AI prompts, PWA manifest, privacy policy, meta tags, cookie names (mbk_session → mj_session)
- Service worker cache busted (new cache name)
- Old cookie name will not be recognized — existing test users will need to re-login
- No database schema changes needed (product name is not stored in DB)

New tagline: **"Your daily squeeze of market smarts"** (replaces "The daily stock market cheat code for kids"). Hero h1 now reads "Your daily squeeze of / market smarts" with the gradient on the second line. Daily-teaser email subject line: "Today's Juice: [date]" (was "Today's Buzz: [date]"). Logo treatment: "Market <em>Juice</em>" with the second word styled gold (mirrors the previous "Market Buzz <em>Kids</em>" pattern).

Service worker cache prefix changed from `mb-` to `mj-` and version bumped to v2; the activate handler reaps any leftover `mb-*` caches so kids with the PWA installed pre-rebrand get fresh assets on next visit.

**Deliberately left for a follow-up:** internal JS namespaces still use the old brand abbreviations — `window.MBGames`, `window.MarketBuzz`, and CSS classes prefixed `mbg-`. None are user-visible (all internal JS/CSS identifiers) and none literally contain `mbk` or `MarketBuzzKids`, so the spec's strict scope didn't catch them. Renaming them touches every game file + inline scripts in template.js and is best done as a separate atomic refactor.

**Domain caveat:** Railway deployment URL is still `market-buzz-kids-production.up.railway.app` until the service is renamed in the Railway dashboard. DNS for themarketjuice.com points there. Updated docs treat themarketjuice.com as canonical.

Changes: 24 files (HTML pages, email templates, AI prompts, server.js, auth.js, template.js, sw.js, manifest.webmanifest, landing.css, landing.js, CONTEXT.md, HANDOFF.md, package.json, package-lock.json). No DB changes.
