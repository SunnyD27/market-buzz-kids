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
| **6.3** Push notifications | ✅ | Completed by **Phase 15** (June 2026 roadmap) — see the Phase 15 session entry. Shipped to `main` via PR #38. ⚠️ Inert in prod until the VAPID env vars are set in Railway. |
| **16** Mystery Mover — daily puzzle + guest play on /sample + share grid | ✅ | On `dev` awaiting next PR. 75-assertion smoke test + full-suite regression green; live AI generation + browser-driven guest play verified. See the Phase 16 session entry. |
| **6.4** Daily Challenge wired into digest template | ✅ | |
| **6.5** Per-game daily content generation (reframers + hydration) | ✅ | |
| **6.6** Real-data verification | ✅ | |
| **6.7** Immutable daily digest (`daily_digests` table) | ✅ | Redeploys don't regenerate |
| **6.8** 5+2 edition system (Weekly Wrap + Week Ahead) | ✅ | Shipped to `main` via PR #3 |
| **6.9** Sunday Challenge — AI-generated rotating weekly game | ✅ | Shipped via PR #4 |
| **7** Kid auth — username/password + 30d session + reset | ✅ | Shipped via PR #5 |
| **8** Rebrand: Market Buzz Kids → **Market Juice** (themarketjuice.com) | ✅ | Shipped via PR #6 |
| **9** Hero restructure — brand-as-h1 + citrus/chart logo lockup | ✅ | Hero h1 shipped via PR #6 (`09ac7e8`); logo lockup `1251c8f` + `34c1e95` on `dev` awaiting PR #7 |
| **10** COPPA deletion compliance + data retention policy | ✅ | PII scrub in `storage.recordDeletionRequest`, deletion-ack email rewrite, privacy.html §4 "Data retention", boot migration to relax NOT NULL on `parent_email`/`kid_age`. Shipped via PR #12. |
| **11** Server-side engagement overhaul — Market Coins, 4 new tables, 12-rank ladder, 6 badge families, personal records, Emergency Fund, unlock popups, `/progress` page, full namespace sweep `MB*`→`MJ*`. | ✅ | Shipped via PR #13 (`3b4ae9c`). Dedup-gate security fix (replay attack) shipped as follow-up commit `6b78f97` — landed in `dev` after merge. |
| **12** "Ask My Parent" buttons + Evening Parent Recap email — `parentExplainer` on every digest section, 💬 button per section (hidden on `/sample`), evening cron with timezone-bucketed recap/nudge variants. | ✅ | On `dev` awaiting next PR (4 commits: Batch A prompts, Batch B UI, Batch C email pipeline, Batch D polish + docs). |
| **13** Multi-kid support — one parent email, up to 5 children. Dropped the unique parent-email index; known-parent abbreviated consent flow; teaser dedup; consolidated reset email; 2-step deletion picker. | ✅ | On `dev` awaiting next PR. 51 assertions green. Fast-follows: evening-recap dedup, email-gated deletion. |
| **14** Glossary tap-to-reveal + AI nomination gate — first-occurrence tooltips per digest (`template.js` `makeGlossaryLinker`), `glossaryNominations` in all 3 AI builders, `pending_glossary` table + storage helpers + boot migration, `/admin` review card + ADMIN_KEY-gated approve/reject endpoints, live seed+approved merge (`glossary-runtime.js`). | ✅ | Shipped via PR #29 (merged). 36 glossary assertions green; full nomination lifecycle verified against live Neon. |
| **14.1** Follow-up — always-tappable scoreboard index tiles (S&P 500 / Nasdaq / Dow) revealing their glossary definition in a full-width drawer, independent of the prose pass (`template.js` `scoreboardGloss`). | ✅ | On `dev` awaiting next PR. +19 assertions (55 total); verified live on `/sample` incl. an index absent from prose. |
| **Polish** Logo PNG on digest header (was 📈 emoji) | ✅ | On `dev` (`206bae9`). |
| **Polish** Model migration → `claude-sonnet-4-6` | ✅ | `10c069e` |
| **Polish** Market-closed note above scoreboard | ✅ | Shipped via PR #3 |
| **Polish** Investing principles expanded 8 → 11 | ✅ | Shipped via PR #3 |
| **Polish** Stories-section heading reflects edition type | ✅ | Shipped via PR #3 |
| **Polish** Week-ahead market-closed copy → "yesterday" | ✅ | Shipped via PR #4 |
| **Polish** Skip post-holiday Week Ahead when holiday is Monday | ✅ | On `dev`, `9b8dbef` |
| **Polish** Sunday/Monday edition framing + edition-aware mover label + conditional `oneToWatch` | ✅ | On `dev` awaiting next PR. Edition-aware framing subtitle + mover label resolver in `template.js`; week-ahead drops backward `topMover` (skip `fetchTopMover` in `generate.js`) in favor of an OPTIONAL `oneToWatch` (omit-on-quiet-week, high-bar + GOOD/BAD examples in the prompt). Teaser email is now edition-aware (subject + body framing per edition). |
| Deploy | ✅ | Railway live |

**Recent commits (most recent first):**

| Commit | Branch | What |
|---|---|---|
| `206bae9` | `dev` | `fix: use brand PNG mark on digest header (was 📈 emoji)` |
| `6b78f97` | `dev` | `fix: dedup gate prevents replay double-earning of MC` (Phase 11 security follow-up) |
| `49660ed` | `main` | PR #13 merge — ships Phase 11 server-side engagement overhaul |
| `3b4ae9c` | `main` | `feat: Phase 11 — server-side engagement system overhaul` |
| `cc10fe2` | `main` | `Phase 10 follow-up: extend deletion scrub to signup-time metadata` |
| `a838da7` | `main` | `Phase 10: COPPA deletion compliance + data retention policy` |
| `2bfa45b` | `main` | PR #6 merge — ships Phase 8 rebrand + hero restructure |
| `09ac7e8` | `main` | `landing: make Market Juice the hero headline` (Phase 9 step 1) |
| `5aad556` | `main` | `rebrand: Market Buzz Kids → Market Juice` (Phase 8) |
| `491e492` | `main` | `feat: add username/password auth for kids` (Phase 7) |

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

### Resend custom domain — ✅ verified

**themarketjuice.com** is verified on Resend (SPF / DKIM / DMARC all green). `FROM_EMAIL=hello@themarketjuice.com` is set in Railway env. Smoke-tested via a one-shot Node script on 5/26/2026: email arrived in the inbox cleanly, no spam classification, Resend delivery ID logged. All five transactional emails (verify, consent, welcome, password reset, daily teaser) now deliver to any parent — no more `sunny27@gmail.com`-only sandbox restriction.

### Pending on `dev` to merge into `main`

- `6b78f97` — `fix: dedup gate prevents replay double-earning of MC` (Phase 11 security follow-up)
- `206bae9` — `fix: use brand PNG mark on digest header (was 📈 emoji)`
- Phase 12 work (the "Ask My Parent" + evening recap pipeline) — multiple commits to be created during the Phase 12 commit pass

When ready: open the next `dev → main` PR on GitHub, merge, Railway auto-deploys. The boot migration in `runBootMigrations()` is already in production (shipped with PR #13) so Phase 12 ships with zero migrations of its own.

> Already shipped: PR #13 brought in Phase 11 server-side engagement overhaul (`3b4ae9c`). PR #12 brought in Phase 10. PR #6 brought in Phase 8 rebrand + Phase 9 hero h1. PR #5 shipped Phase 7 auth. PR #4 shipped Sunday Challenge. PR #3 shipped principles 8→11. PR #2 shipped Phase 6.8 (5+2 editions). PR #1 was the initial Phase 6 backbone.

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

*Last updated end-of-Phase-12 (Ask My Parent buttons + Evening Parent Recap email) session. PR #13 shipped Phase 11 (server-side engagement) to `main`. On `dev` awaiting next PR: Phase 11 dedup security fix (`6b78f97`), digest-header logo PNG fix (`206bae9`), and Phase 12 work. themarketjuice.com Resend domain verified, all 7 transactional emails deliver. Open follow-ups: (1) Phase 6.3 push notifications still TODO. (2) Internal JS namespaces are now fully `MarketJuice` / `MJGames` / `mj-*` — Phase 8 namespace debt cleared in Phase 11. (3) Server-side engagement is live and authoritative (Phase 11); leaderboards / weekly seasons are next on the engagement roadmap. (4) 12-month inactivity sweep is now unblocked by `user_progress.last_active_date` — cron itself not built yet.*

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

Footnote (added later): the rebrand-session hero h1 was a temporary form — **"Your daily squeeze of / market smarts" as the headline.** That was superseded by the Phase 9 work below: "Market Juice" itself is now the page h1.

---

## Session: Phase 9 — Hero restructure + logo lockup

Two-step redesign of the hero based on feedback that "Market Juice" was reading like a nav label instead of the brand. Both already-shipped + pending pieces are part of this phase.

**Step 1 — brand promoted to h1 (`09ac7e8`, shipped via PR #6).** Removed the small `.logo` block above the headline. The `<h1>` now contains "Market Juice" itself, rendered at `clamp(3rem, 8vw, 6rem)` with the full purple→blue→gold gradient on each word (per-word gradients because CSS gradients don't span line breaks naturally — each `.brand-word` owns its own). Old headline "Your daily squeeze of / market smarts" was demoted to a `<p class="hero-tagline">` directly below, at `clamp(1.25rem, 3vw, 2rem)` in solid white. Visual hierarchy is now: brand → tagline → body copy → CTAs.

**Step 2 — citrus + chart logo mark in the lockup (`1251c8f` then `34c1e95`, on `dev`).** First commit dropped in an SVG interpretation I wrote inline (transparent bg, brand palette). Sunny didn't like the SVG and provided a 1024×1024 transparent PNG of the actual designed logo — second commit swapped to that PNG and tuned the lockup sizing.

Final lockup CSS:
- Mark size: `clamp(5.5rem, 16vw, 11rem)` — 88px on small phones through 176px on wide desktops. Slightly heavier than the wordmark cap-height so it reads as the anchor of the lockup.
- Mark↔wordmark gap: `clamp(0.15rem, 0.4vw, 0.3em)` — about 3px on typical viewports. Tight enough that the two read as a single lockup unit.
- `flex-wrap: nowrap` on `.hero-brand` — forces the whole lockup onto a single line. Lowered wordmark font min from 3rem → 2.5rem so the no-wrap constraint still fits on narrow mobile.
- `align-items: center` — mark vertically centered against the wordmark cap-height.
- `filter: drop-shadow(0 6px 18px rgba(188,140,255,0.25))` — subtle purple glow that ties the PNG to the page's gradient theme.

Removed the unused `public/icons/logo-mark.svg` (my earlier SVG interpretation). The PNG at `public/icons/logo.png` is now the authoritative brand mark.

**Other:** added `.claude/` to `.gitignore` (local preview-tool launch config; per-repo only). Phase 9 also picked up a Resend smoke test against `hello@themarketjuice.com` that landed cleanly — see the Resend section above; sandbox restriction is fully lifted.

---

## Session: COPPA Deletion Compliance + Data Retention Policy

- **PII scrub on deletion:** `storage.recordDeletionRequest()` now NULLs/overwrites `kid_first_name`, `kid_age`, `username`, `password_hash`, `parent_email`, `push_subscription` in the same transaction as the soft delete. `deletion_requests` audit table unchanged.
- Updated deletion acknowledgment email to accurately describe what's retained.
- Added Data Retention section to `public/privacy.html` with retention periods and deletion triggers. Existing thin §7 "How long we keep things" was absorbed into the new §4 to avoid redundancy; sections renumbered accordingly.
- **DB migration required.** `users.parent_email` + `users.kid_age` started life as `NOT NULL`. New file `src/migrations/relax-notnull-for-deletion-scrub.sql` documents the ALTER; `runBootMigrations()` in `src/server.js` detects the constraint via `information_schema.columns.is_nullable` and applies the change idempotently on the next boot. Live-tested against Neon — migration ran cleanly, scrub UPDATE succeeded, email + username were both immediately re-usable for a fresh signup. `schema.sql` updated so fresh deploys are aligned.
- **TODO:** Build scheduled job for 12-month inactivity auto-delete (mentioned in privacy policy §4 "When we delete"). Blocked on server-side engagement persistence — XP/streaks are still localStorage as of Phase 9, so there's no "last activity" signal beyond `signup_at` until that lands.
- **TODO:** Build scheduled job for 7-day incomplete-consent cleanup (also mentioned in privacy policy §4). Find users with `consent_required = TRUE AND consent_given = FALSE AND created_at < NOW() - INTERVAL '7 days'`, run them through `storage.recordDeletionRequest()` with `processed_method = 'automatic-consent-expired'`. Both TODO comments live in `src/server.js` just above `bootstrapTodaysDigest`.
- **Out of scope but worth knowing:** `signup_ip`, `consent_ip`, `user_agent`, `device_type`, `timezone`, and `utm_*` columns are NOT scrubbed today. The spec didn't list them and they're arguably operational/audit metadata, but IPs in particular are PII under stricter privacy regimes (GDPR, parts of CCPA). Revisit if regulatory posture tightens.

### Follow-up (same PR): Phase 10 out-of-scope fields addressed

The Phase 10 follow-up extended the PII scrub in `storage.recordDeletionRequest()` to cover the fingerprintable signup-time metadata that the original cut explicitly punted on:

- `signup_ip`, `consent_ip` (both `INET`)
- `user_agent`, `device_type`, `timezone`
- `utm_source`, `utm_medium`, `utm_campaign`

All eight columns were already nullable — no schema change needed, no boot migration required. Live-tested against Neon: backfilled non-null values, ran the scrub, all eight columns came back `NULL`, and the core identity scrub (`parent_email`, `kid_age`, etc.) still works.

Two utm_* columns deliberately kept populated: `utm_content` and `utm_term` — they're tail attribution data, not PII on their own once the identifying fields are gone, and they're useful for product analytics on aggregate signups. Same reasoning for the optional survey fields `invest_experience` and `referral_source`.

---

## Session: Phase 11 — Server-side engagement overhaul

XP renamed to **Market Coins (MC)**, all engagement moved server-side. Four batches, 25 tasks, ~3,800 LOC net added.

**What shipped (PR #13, `3b4ae9c`):**
- Four new Postgres tables: `user_progress` (canonical state per user), `engagement_events` (append-only audit log), `user_badges` (6 families × up to 10 tiers), `personal_records` (4 auto-tracked bests). Boot migration drops the empty `engagement` placeholder + creates the new tables idempotently.
- `src/engagement.js` — the engine. `ensureProgress` / `getProgress` / `recordEvent` do everything in one transaction: streak progression, Perfect Day, rank-up detection, badge tier checks, personal record updates. Audit row written last with server-enriched data (mcAwarded, perfectDay, shieldUsed, shieldAwarded, streakAfter, rankAfter).
- `src/progression.js` — canonical constants. 12-rank linear-progressive ladder (Rookie → Wall Street Legend), MC awards table (25 correct / 15 participation / +25 Perfect Day / +5 Word reveal / 50–75 Sunday / streak bonus `min(streak × 2, 30)`), 6 badge families × 10 tiers each, 4 personal records, Emergency Fund config (max 3, gated by Stock Scout rank).
- `public/engagement.js` rewritten as a server-synced thin client with offline event queue. Old `mb_*` / `mbg-*` localStorage wiped on first load — no migration per Q2 in the spec ("nothing worth preserving").
- `public/engagement-popups.js` — celebration layer. Rank-up modal with focus trap + ESC + backdrop close, badge unlock queue, record + shield toasts. CSS-only confetti for rank-ups. Rank-tier cosmetic accents (gold accent at Market Strategist+, gold theme at Market Master+).
- `src/progress-template.js` + `GET /progress` — kid's full profile page. 6 sections: profile header, How MC Works explainer, 12-rank ladder, 6-family badge grid, 4 personal records, Emergency Fund status.
- Full namespace sweep — `MarketBuzz`/`MBGames`/`mb-*`/`mbg-*` → `MarketJuice`/`MJGames`/`mj-*` across 83 distinct identifiers. The Phase 8 "deliberately left for a follow-up" debt is now cleared.
- Passive XP removed (no more open-digest or scroll-to-bottom MC). Word-of-Day reveal kept at 5 MC via the `word-learned` event.
- COPPA deletion scrub extended to all 4 engagement tables in the same transaction as the user soft-delete.
- 37-assertion smoke test (`scripts/test-engagement.js`) covers every event type + edge cases (streak advance, shield use/award, rank-up, badge tier crossings, multi-tier from shield rescue, etc.).

**Follow-up security fix (`6b78f97`, on `dev` post-merge):** the initial cut had no dedup — a kid could replay the same game 50 times and earn MC each time. Added `isDuplicate()` gate inside `recordEvent`'s transaction that checks `engagement_events` for a prior award per event type (game name + digestDate for games, digestDate alone for word-learned / sunday-challenge / parent-question). Duplicates write an audit row marked `duplicate: true` with `mcAwarded: 0`, skip all state mutations, return `{ duplicate: true }` so the client can show a friendly "Already earned!" toast. 12 additional smoke-test assertions.

**Bugs caught + fixed during checkpoints (all from the smoke test):**
1. `pg` returns DATE columns as `Date` objects; the engine compared them as strings, so every day looked new. Added `normalizeProgressRow()`.
2. Per-day games counter was in-memory only — games 2 and 3 of a day never fired Perfect Day. Replaced with DISTINCT-by-game query against the events log.
3. Audit row was written before MC was computed; personal-record day/week sums missed the current event. Reordered to insert last with enriched data.
4. 7-day shield award ran before rank-up for the same event; an event that crossed Stock Scout AND a 7-day boundary skipped the shield. Moved shield logic to after rank-up.
5. `applyGameCompleted` used `last_active_date` (which `daily-visit` overwrites on every page load) as the "is this a new day for streak?" signal. Switched to `last_streak_date`.
6. `/progress` badge tiles read `progress[snake_case]` but `getProgress()` returns camelCase keys. Added a translation map.

---

## Session: Phase 12 — "Ask My Parent" + Evening Parent Recap Email

Adds a parent-facing surface — kids flag sections they want to discuss, parents get an evening email summarizing the day or nudging when the streak is at risk. Zero new database tables; everything piggybacks on Phase 11's `engagement_events` + `daily_digests`. Four batches, 16 tasks.

**Batch A — Content pipeline.** Extended all 3 AI prompt builders (`buildStandardPrompt`, `buildWeeklyWrapPrompt`, `buildWeekAheadPrompt`) with PARENT EXPLAINER RULES. Every content section (stories[*], bigPicture via `bigPictureParentExplainer`, wordOfDay, didYouKnow, quiz) now carries a `parentExplainer: { summary, conversationStarter }` object. Rules require the conversationStarter to reference *today's specific content* (real companies, numbers, events) — generic finance questions are explicitly forbidden via GOOD/BAD examples in the prompt. `parseDigestJSON` is plain `JSON.parse` + citation stripping, so nested fields pass through cleanly. `scrubProfanity` walks objects recursively, only mutates string leaves. One live regen against today's digest (`2026-05-27`, ~$0.30 in API cost) confirmed Claude follows the rules: starters reference SpaceX's $1.75T valuation, oil dropping $94→$88, Snowflake vs Salesforce, etc.

**Batch B — Digest UI.** `parent-question` event type (0 MC, deduped per `(section, digestDate)`, no progression mutations — just logged). 💬 buttons in `src/template.js`: 4 server-rendered (stories, big-picture, did-you-know, word-of-day) + 1 client-injected (quiz, after answering). Hidden on `/sample` via the `opts.isSample` guard. Tap behavior: optimistic UI swap to "💬 Your parent will see this tonight!" + localStorage persistence across reload + server-logged event via `MarketJuice.recordEvent('parent-question', {section, topic, digestDate})`. `restoreAskParentState()` runs on init before the network fetch so reload is instant. Browser-verified end-to-end: 3 buttons tapped → 3 audit rows in DB → reload restores chips → re-tap returns `{ duplicate: true }`.

**Style note:** the original button design was a bordered pill chip; user feedback (mid-checkpoint) was "looks too fake with the grey background." Rewrote to a quiet text link — no border, no fill, `--text-dim` at 70% opacity, lifts to `--purple` with a soft underline on hover. Post-tap "sent" chip keeps the purple fill because it's an affirmative state.

**Batch C — Evening email.** `getDailyEngagementSummary(userId, digestDate)` + `getParentQuestionsForDate(userId, digestDate)` in `src/engagement.js` — both filter duplicate audit rows so dedup doesn't pollute the recap. `renderEveningRecap({ kidName, engagement, digestContent, progress, parentQuestions, digestDate, variant })` in `src/emails.js` with two variants:

- **Recap** (kid engaged today): subject `${kid}'s Daily Squeeze — ${date}`. Body has session summary (games / MC / Perfect Day), per-game brief (quiz gets its parentExplainer.summary inline; other games just list "Correct/Played"), word-of-day brief, "WANTS TO TALK ABOUT" block (the 💬 taps with topic + parentExplainer.summary + conversationStarter), then always-present "TALK ABOUT IT TONIGHT" picker (2–3 starters from sections the kid engaged with — quiz first, then wordOfDay, then backfill from stories/bigPicture/didYouKnow, skipping anything already in the 💬 block). Footer chip shows streak + MC + rank.
- **Nudge** (kid idle AND streak ≥ 3): subject `${kid}'s streak is at risk`. Light tease of today's digest contents (topMover, wordOfDay, game count) + streak-at-risk language scaled to streak length + CTA to `/digest`.

Cron: hourly UTC sweep + `POST /api/cron/send-evening-recap` external trigger (matches the existing `send-digest` pattern with `X-Cron-Secret`). PostgreSQL `EXTRACT(HOUR FROM NOW() AT TIME ZONE COALESCE(u.timezone, 'America/New_York')) = 19` gate per row — every IANA timezone gets its email at 7 PM local. 100ms sleep between sends. Per-user fork: `engaged → recap`, `!engaged && streak >= 3 → nudge`, otherwise skip (don't nag fresh signups, Q4 in spec). At prelaunch scale a restart mid-loop could skip a few sends; no audit dedup table.

73-assertion smoke test (`scripts/test-evening-email.js`) covers 6 scenarios: engaged recap, idle nudge, sub-threshold skip, legacy digest backward-compat (no parentExplainer fields), full pipeline via real `recordEvent()` calls (catches drift between Phase 11 writer and Phase 12 reader), variant-fork decision matrix.

**Tone of the parent email** (per spec Q9): restrained, clean, no exclamation stacks, no gamification language. Plain uppercase eyebrows (`TODAY'S SESSION`, `TALK ABOUT IT TONIGHT`), typographic dashes, rank emoji only in the footer chip, 💬 only next to kid-flagged questions.

**Backward compatibility:** old `daily_digests` rows (pre-Phase-12) don't have `parentExplainer` fields. `getExplainerForSection()` returns null in that case; the recap email shows the kid-flagged topic with a generic fallback line ("Sky was curious about this — ask them what they remember") and skips the "TALK ABOUT IT TONIGHT" block entirely (no explainers to pick from). Verified in Scenario D.

**No new env vars.** `CRON_SECRET` (Phase 6.2) is reused for the external trigger.

**Open items deferred:**
- Push notifications (Phase 6.3) still TODO — email-only MVP works.
- 12-month inactivity auto-delete is now unblocked by Phase 11's `last_active_date` but the cron itself isn't built yet.
- Evening-recap dedup ledger — not built; accept the risk at prelaunch scale.

---

## Session: Multi-Kid Support (one parent email, up to 5 children)

Lets a single parent email register multiple children (siblings). Five batches.

**The blocker (caught at read-time):** Phase 5/7 enforced one active user per parent email via a partial UNIQUE index `users_parent_email_active`. The original spec's migration didn't drop it — the second sibling's INSERT would have thrown `23505` in production. Migration `src/migrations/add-multi-kid-support.sql` drops it, adds a non-unique `idx_users_parent_email`, and expands `verification_tokens.purpose` with `add_child_consent`. Boot migration in `runBootMigrations()` detects the still-unique index via `pg_index.indisunique` and swaps it idempotently.

**Spec-vs-schema corrections:** the spec referenced a `parent_consent` column (doesn't exist — it's `consent_given`) and used case-sensitive `parent_email = $1` matching (must be `LOWER()` both sides). Both fixed throughout.

**Signup paths** (`isKnownConsentedParent` = has an active, `email_verified` child — deliberately NOT requiring `consent_given`, since 13–16 kids never have it):
- New parent → full flow, unchanged.
- Known parent → abbreviated: row created `email_verified=true`, `add_child_consent` token, **emailed** consent link (decision D3(b) — keeps consent email-gated at the same proof level as kid #1; only skips the redundant re-verification step). On click: `consent_method='known_parent_click'`, activate, welcome email (with a "didn't set this up?" safety line). 5-child cap enforced at the signup route.

**Email dedup:** morning teaser groups recipients by `LOWER(parent_email)` → one email per parent naming all kids (`joinNames` helper). Password reset → one consolidated email with a per-kid reset link (`renderMultiKidPasswordResetEmail`). Deletion-ack names the deleted kids.

**Deletion:** `recordDeletionRequest` now takes an optional `userId` (ownership-scoped — re-verifies the id belongs to the submitted email; a forged id can't delete another family's kid). The deletion page is a 2-step picker: enter email → `POST /api/delete-data/children` returns the kid list (first name + age, **never usernames**) → checkboxes + two-click confirm → `POST /api/delete-data` with `userIds[]`.

**Deviations from the spec (all approved by Sunny):**
- forgot-password: **no in-browser kid-selection screen** — it would regress the endpoint's deliberate no-account-existence-leak property. Consolidated email instead.
- delete-data selection shows **first name + age, not usernames** (a username is half a login credential).
- morning teaser **subject stays date-based** (`🟡 Today's Juice: May 27`); kid names go in the greeting, not the subject.

**Tests:** `scripts/test-multi-kid.js` (24 assertions — known-parent detection, abbreviated signup round-trip, two active kids coexisting under one email [proves the unique index is gone], 5-child cap, abandoned-kid-#1 + all-kids-deleted edge cases) + `scripts/test-multi-kid-emails.js` (27 assertions — teaser dedup greeting, consolidated reset email, deletion-ack name lists, per-kid deletion with sibling intact, **cross-parent delete refused**). All 51 green.

**Fast-follows (HARDENING — do before scaling past soft launch):**
1. **Email-gate deletion.** Deletion is currently gated *only* by knowing the parent email — no token/ownership proof (pre-existing, not introduced here; multi-kid surfaces the child list). Add a confirm-link token to the deletion flow, same pattern as consent. Near-zero risk at ~30 families; required before scaling.
2. **Evening-recap dedup.** The Phase 12 evening recap cron (`sendEveningRecaps`) still sends one email PER KID. Apply the same parent-email grouping as the morning teaser — one evening email per parent with per-kid sections (engaged → recap, idle → nudge). TODO comment is in `src/server.js` near `sendDailyTeasers`.

---

## Session: Security Audit Fixes

Addressed findings from the full codebase security audit (critical + important + minor). All on `dev`. No user-facing signup/login/digest flow changed except the deletion page (now token-gated).

**Critical:**
- **Host-header injection fixed.** Reset / verify / consent links now build from `appUrl()` (`APP_BASE_URL`) instead of `req.get('host')`. `grep "req.get('host')" src/` → zero.
- **Fail-closed secrets.** Server `process.exit(1)` if `SESSION_SECRET` is unset in production (dev keeps the fallback + warning). `/generate` ADMIN_KEY guard now fails closed when `ADMIN_KEY` is unset (`!expected || key !== expected`).
- **Placeholder contact removed.** `hello@example.com` → `hello@themarketjuice.com` in privacy.html + parent-delete-data.html. (Landing form placeholder `you@example.com` → `you@email.com`.)
- **7-day abandoned-consent cleanup BUILT.** `storage.cleanupAbandonedSignups()` scrubs under-13 signups where consent was never given after 7 days (reuses `recordDeletionRequest`, audit method `automatic-consent-expired`). Exposed as `POST /api/cron/cleanup-abandoned` AND an in-process daily cron at 3 AM ET (so it runs even if no external cron is configured). `recordDeletionRequest` now also deletes the user's `verification_tokens` and accepts a `processed_method` override.
- **Token-gated deletion.** New `delete_data` token purpose. Flow: `POST /api/delete-data/request {parent_email}` → emails a 1-hour single-use link (generic no-leak response) → `POST /api/delete-data/children {token}` (validates, does NOT consume) → `POST /api/delete-data {token, userIds}` (validates + consumes, scrubs, ack email). Parent email is derived from the token, never trusted from the client. New `src/migrations/add-delete-data-token.sql` + idempotent boot migration (detects via `pg_get_constraintdef`). `public/parent-delete-data.html` rewritten to a 2-state page (no token → email form; `?token=…` → child list + delete; invalid/expired → "request a new link"). Verified live: invalid token → 400, request → generic 200, delete without valid token → 400.

**Important:**
- **express-rate-limit (^8)** on `/api/login` (10/15min), `/api/signup` (10/hr), `/api/forgot-password` (5/hr), `/api/reset-password` (10/15min), `/api/delete-data/request` (5/hr), `/api/check-username` (30/min). Not on `/digest`, engagement, or the secret-gated crons. In-memory store (fine for single Railway instance).
- **Generic login error.** "Account not yet activated" now returns the same `Wrong username or password.` as bad credentials (no enumeration).
- **Consent disclosures aligned.** Both the under-13 consent email and the add-child consent email now list username + hashed password, device type, timezone, and IP. "XP" → "Market Coins" in privacy.html + the verify email.
- **DB TLS** `rejectUnauthorized: true` in production (relaxed in dev). **`trust proxy` → 1** (Railway single hop).

**Minor:**
- pwa.js `mb_pwa_visits`/`mb_pwa_dismissed_at`/`window.MBPwa` → `mj_*`/`window.MJPwa` (fixes the collision with engagement.js `clearLegacyStorage`). Stale "Buzz" copy removed from emails.js + sw.js.
- Dockerfile drops root (runs as the base image's `node` user; `chown -R node:node /app`). railway.toml gains `healthcheckPath = "/api/health"` + `healthcheckTimeout = 30`.

**Deviations from the fix spec (followed the existing codebase, as instructed):**
- Token purposes are `email_verify` / `parental_consent` / `password_reset` / `add_child_consent` (not `verification`/`consent`); column is `verification_tokens.purpose` (not `type`). Added `delete_data` to that set.
- Reused `recordDeletionRequest(...)` (not a non-existent `deleteUserData`).
- `/api/cron/cleanup-abandoned` accepts **either** the `X-Cron-Secret` header (matching the other cron endpoints) **or** `?secret=` (matching the Railway note below). Both fail closed if `CRON_SECRET` is unset.
- `/api/health` already existed — only railway.toml needed the healthcheck entry.
- Used the base image's built-in `node` user instead of creating `nodeuser`.
- express-rate-limit v8 uses `limit:` (not the deprecated `max:`).

**Action items after deploy:**
1. (Optional) Create a Railway cron for `POST /api/cron/cleanup-abandoned?secret=$CRON_SECRET` (daily 3 AM ET). The in-process cron already covers this; the external one is belt-and-suspenders.
2. Verify the Neon connection works with `rejectUnauthorized:true` in production — if the chain fails, pin Neon's CA via `ssl: { ca: ... }`. (Heads-up: pg warns that `sslmode=require` in `DATABASE_URL` will mean `verify-full` in pg v9; revisit when upgrading pg.)
3. Confirm all env vars are set in Railway: `SESSION_SECRET`, `ADMIN_KEY`, `CRON_SECRET`, `APP_BASE_URL` (the server now refuses to boot in prod without `SESSION_SECRET`).
4. **Tests not added** — the existing `scripts/test-*.js` were not extended for the new endpoints; add coverage for the token-gated delete flow + abandoned cleanup before the next release.
5. Note: booting locally ran the `delete_data` CHECK boot-migration against Neon (idempotent, forward-only — same as a deploy would).

**Still open (not in this pass):** 12-month inactivity sweep (TODO in server.js, now unblocked by `last_active_date`); evening-recap per-parent dedup; the privacy "deleted from all backups within 7 days" claim still doesn't reflect Neon's actual backup retention.

---

## Session: Security Audit Follow-Up

Remaining audit findings (important + minor) addressed. All on `dev`.

**Fix 12 — Sessions invalidated on password reset.** Added `users.session_version` (default 1). The signed `mj_session` cookie value is now `"${userId}:${session_version}"`; `requireAuth` parses both, looks the user up, and rejects the cookie if the versions differ. A password reset bumps `session_version`, so all existing cookies for that kid stop working. Legacy cookies (bare UUID, no `:`) force a one-time re-login.

**Fix 13 — Atomic password-reset token.** The reset handler no longer does SELECT-then-UPDATE. It now runs a single `UPDATE verification_tokens SET used_at=NOW() WHERE token=$1 AND purpose='password_reset' AND expires_at>NOW() AND used_at IS NULL RETURNING user_id` (validate + consume in one statement), then the password update and the `session_version` bump — all inside one transaction (`getClient`/BEGIN/COMMIT). Two concurrent clicks can't both succeed.

**Fix 14 — Backup-deletion overclaim removed.** privacy.html §6 and the deletion page no longer promise "all backups within 7 days." New wording: personal info is removed from active systems immediately; provider backups are purged on their standard retention schedule.

**Fix 15 — Email fan-out failure logging.** The teaser (`sendDailyTeasers`) and evening recap (`sendEveningRecaps`) fan-outs now log per-recipient failures and a summary — using **user/kid ids, never plaintext emails**. Teaser groups by parent, so it logs the affected kid ids per failed parent.

**Fix 16 — Inline-script JSON escape.** `template.js` `__DC_BUNDLE` and `__SC_DATA` now run `JSON.stringify(...).replace(/</g, '\\u003c')` so a stray `</script>` in the (AI-generated) digest data can't break out of the inline `<script>`.

**Fix 17 — 12-month inactivity sweep.** Added `users.last_active_at`, stamped on login and (debounced to once/day) on authenticated digest/progress views in `requireAuth`. New `storage.cleanupInactiveAccounts()` scrubs active, non-deleted users with no activity in 12 months (falls back to `created_at` when `last_active_at` is NULL), via `recordDeletionRequest` with `processed_method='automatic-inactivity'`. Exposed as `POST /api/cron/cleanup-inactive` (header `X-Cron-Secret` OR `?secret=`) plus an in-process weekly cron (Sundays 4 AM ET).

**Migrations:** `runBootMigrations()` adds `session_version` + `last_active_at` idempotently (`ADD COLUMN IF NOT EXISTS`); standalone doc in `src/migrations/add-session-version-and-activity.sql`. schema.sql updated for fresh deploys. (Verified live on boot: columns added against Neon.)

**Deviations from the spec (followed existing codebase, as instructed):**
- Cookie is signed via cookie-parser (not a manual HMAC); `setSession(res, id, version)` builds the `id:version` value and cookie-parser signs it.
- Token purpose column is `verification_tokens.purpose`; reset purpose is `'password_reset'` (matches existing).
- 12-month sweep uses `users.last_active_at` (new), NOT `user_progress.last_active_date` (that's the engagement NY-date field — different semantics). The earlier TODO comment that referenced `user_progress.last_active_date` was corrected.
- `cleanup-inactive` accepts header OR `?secret=` (consistent with `cleanup-abandoned`), both fail closed.

**Fast-follow (not built):**
- Pre-deletion warning email to parents ~7 days before the 12-month mark.
- Automated retry for failed email sends (currently logged only).
- Verified `last_active_at`-on-login and session-version-reject end-to-end logic by code review + unit checks (cookie format, atomic reset 400); a full login→reset→old-cookie-rejected integration test needs a consented test user and wasn't run against prod.

## Session: Security Audit Follow-Up — Gap Fixes

Review of commit `2743e37` found Fix 12/13 were only partially wired; the
session-versioning was effectively a no-op and would have locked users out
after a reset. Closed in `f828422`.

- **Login didn't propagate `session_version`.** `POST /api/login` called
  `setSession(res, row.id)` (defaulting the cookie to version 1) even though it
  already SELECTed `session_version`. Once a reset bumped the DB version, login
  would issue a stale v1 cookie that `requireAuth` rejects → user locked out.
  Now `setSession(res, row.id, row.session_version)`.
- **Reset didn't bump `session_version`.** `POST /api/reset-password` updated
  `password_hash` only, so a reset never actually invalidated old cookies
  (Fix 12D was missing).
- **Reset wasn't atomic.** It still did SELECT-then-UPDATE on the token
  (Fix 13 not applied at the handler).

  Both fixed by new `storage.resetPasswordWithToken(token, hash)`: one
  transaction does an atomic `UPDATE verification_tokens ... RETURNING user_id`
  consume, then `UPDATE users SET password_hash, session_version = session_version + 1`.
  Handler hashes before opening the tx; returns 400 on a missing/expired/used
  token or a deleted target user.
- **Login now stamps `last_active_at`** (fire-and-forget) — Fix 17B had only
  the `requireAuth` debounced write, not the login write.

Not verified end-to-end against a live DB (needs a consented test user +
reset-token flow); `node --check` passes on all three files and the logic was
confirmed by reading the requireAuth/setSession/reset paths together.

## Session: Sunday/Monday edition framing + conditional One to Watch

The Sunday weekly-wrap and Monday week-ahead were reading like normal
"today's" digests on both the web surface and the 7 AM teaser email. Two
concrete bugs were addressed in one PR.

**Diagnostic first (the 2a step).** Confirmed via the cached `daily_digests`
row for `DATE_OVERRIDE=2026-05-25` (Memorial Day Monday → week-ahead):
- `fetchTopMover` was being called unconditionally in `src/data.js#fetchAllData`.
- `buildWeekAheadPrompt` explicitly told Claude to populate `scoreboard.topMover`
  with Friday's biggest curated mover.
- The cached row's `topMover` was **Qualcomm `+11.59%`** — Friday's close —
  and the template rendered it with the gold `TODAY'S MOVER` label. Stale
  Friday data wearing a "today" label, exactly as described.
- No `oneToWatch` field existed yet.

**Changes.**

1. **`src/template.js` — edition-aware framing + mover label resolver.**
   - New framing subtitle `.edition-framing` rendered under `editionLabel`
     on weekly-wrap ("Looking back at this past week 📋") and week-ahead
     ("Here's what to watch this coming week 🔮"). Driven off
     `content.editionType`, not a fresh day-of-week calculation.
   - New `resolveMoverSpec()` — a single resolver keyed on `editionType`
     that picks the gold card's label + data source: `TODAY'S MOVER` (standard)
     / `WEEK'S BIGGEST MOVER` (weekly-wrap) from `scoreboard.topMover`;
     `ONE TO WATCH` from `content.oneToWatch` on week-ahead. Returns null
     when the source data is absent → week-ahead with no catalyst this
     week renders no card at all (no empty card, no fallback to a backward
     mover).
   - Vibe-bar callout flows from the same spec: backward
     "Why X moved: …" on standard/weekly-wrap; forward "Why watch X: …"
     on week-ahead; nothing when there's no spec.
   - Standard editions are byte-identical to the prior output (the literal
     `TODAY'S MOVER` is rendered raw, not escaped, so the apostrophe stays
     a literal `'`).

2. **`src/ai.js` — week-ahead prompt rewritten.**
   - `topMover` parameter ignored on the week-ahead path; the "TODAY'S MOVER"
     section and JSON schema entry removed.
   - New `ONE TO WATCH` section + `oneToWatch` JSON schema field — OPTIONAL,
     omit-on-quiet-week, high-bar. GOOD/BAD examples in the prompt:
     - GOOD: "Nvidia reports earnings Wednesday — its stock often makes a
       big move after it shares how many AI chips it sold." (real catalyst)
     - BAD: "Apple is always worth watching." (manufactured pick — omit)
     - BAD: "Tesla had a big move last Friday." (backward — that's a Today's
       Mover, not a One to Watch.)
   - Explicit rule: "If there is no specific, scheduled, nameable catalyst
     this week, do NOT include a oneToWatch. A missing card is correct and
     expected on quiet weeks. Never manufacture a reason to fill it."

3. **`src/generate.js` + `src/data.js` — skip `fetchTopMover` on week-ahead.**
   `fetchAllData` now takes `opts.skipTopMover` and `generate.js` passes
   `skipTopMover: edition.editionType === 'week-ahead'`. The week-ahead
   prompt no longer receives any backward mover data — Claude picks
   `oneToWatch` from web-search results about upcoming events.

4. **`src/emails.js` — teaser email is edition-aware.** Subject + body
   framing forks on `content.editionType`:
   - standard: `🟢 Today's Juice: <date>` — unchanged
   - weekly-wrap: `📋 Market Juice — Your Weekly Wrap (<date>)` — "A look
     back at this past week", "Week's biggest mover", "Read the Weekly Wrap →"
   - week-ahead: `🔮 Market Juice — The Week Ahead (<date>)` — "Here's
     what to watch this coming week", "One to watch" line only when
     `content.oneToWatch` is present, "Read the Week Ahead →"

**Verified offline** (no API spend) via assertion-based fixture renders +
the four header/scoreboard screenshots: standard / weekly-wrap / week-ahead
with `oneToWatch` / week-ahead quiet-week. Glossary smoke test still
passes (55 assertions). `node --check` clean on all changed files.

**Post-launch watch item:** spot-check a few quiet weeks to confirm
`oneToWatch` is actually being omitted rather than always filled. Models
over-produce on open slots; if Claude starts inventing weak picks, raise
the bar in the prompt (or add a server-side gate that filters out
catalyst-less submissions).

## Session: Phase 13 — Lightweight Admin Dashboard

Single server-rendered `/admin` page (ADMIN_KEY-gated, same query-param pattern
as `/generate`) showing live product health, plus a Resend webhook pipeline for
email deliverability.

New / changed:
- `src/admin.js` (NEW) — `gatherAdminData()` + `buildAdminHTML(data, adminKey)`.
  Sections: Users · Engagement (DAU/WAU/MAU + today detail) · Streaks · Rank
  Distribution (CSS bars, all 12 ranks) · Game Popularity (30d) · Scenario
  Health (low-scenario alerts) · Recent Signups (name+age only, no PII) · Email
  Analytics (from email_events). Inline CSS dark theme, no frameworks/charts,
  auto-refresh meta (5 min), live queries every load (no cache).
- `GET /admin` route + boot-log line in `src/server.js`. Fails closed when
  ADMIN_KEY is unset.
- `email_events` table — added to `src/schema.sql` and an idempotent boot
  migration in `runBootMigrations()`. (Verified live: table created on Neon.)
- `POST /api/webhooks/resend` — Svix signature verification (svix@^1.95) against
  the raw body, inserts events into email_events. 401 on bad/missing signature
  or unset RESEND_WEBHOOK_SECRET; 200 (no retry) on post-verification errors.
- `sendEmail()` now takes `kind` and attaches a Resend `tags:[{name:'kind'}]`.
  All 9 send call sites tagged: verify, consent, add-child-consent, welcome,
  deletion-ack, delete-data-verify, teaser, password-reset, evening-recap.
- COPPA scrub: `recordDeletionRequest()` deletes a parent's email_events rows —
  but only once NO active children remain under that email (multi-kid guarded),
  done post-commit + try/caught so it can never roll back the PII scrub.
- `svix` added to dependencies (the only new package).

Deviations from the spec (followed the codebase, as the spec instructed):
- ESM throughout (project is "type":"module") — the spec's CommonJS
  require()/module.exports would not load.
- "Today" / windows are evaluated in America/New_York (the product's day
  boundary, per engagement.js), not raw CURRENT_DATE (UTC on Neon), which would
  mis-bucket "today" for the evening ET hours.
- Scenario rotation uses the REAL games.js math (dayIndex = floor(epochMs/
  86400000); pickScenario offset = (dayIndex + hashString(gameType)) % count),
  NOT the spec's 2026-01-01 epoch + bare `dayIndex % count`. company-models.json
  is reshuffled daily (stableShuffle), so it's reported "Randomized daily" and
  alerted on raw count < target rather than a rotation runway.
- Webhook raw body is captured via the global express.json `verify` callback;
  a route-level express.raw() can't work because the global JSON parser already
  consumed the stream before any route runs.
- Each admin section getter is individually fault-tolerant: one failing query
  (e.g. email_events missing pre-migration) degrades that card, not the page.
- Game Popularity shows a real correct-% whenever events carry a `correct`
  flag; with live data, compound/time-machine do carry it, so they show a
  percentage rather than "—". "—" still appears only when no correctness is
  tracked for a game.

Verified (live, against Neon): /admin 403 without/with wrong key, 200 with key;
all 8 sections render with real data (24 signups, ranks, game popularity);
scenario health flags Time Machine (7) + Historical Charts (10) LOW, Company
Models (37) Healthy; signed Svix webhook → 200 + row inserted + surfaced in
Email Analytics; bad/again-no-secret signature → 401. Desktop + responsive
layout screenshotted. Test webhook row cleaned up afterward.

### Post-deploy manual steps (Resend webhook) — REQUIRED to populate Email Analytics
1. Resend dashboard → Webhooks → Add Webhook.
2. URL: `https://themarketjuice.com/api/webhooks/resend`
3. Events: select all (sent, delivered, opened, clicked, bounced, complained).
4. Copy the signing secret → set `RESEND_WEBHOOK_SECRET` in Railway env vars.
5. Resend → Domains → your domain → enable Open Tracking and Click Tracking.
6. Verify: send a test email and check `/admin?key=…` for the event.

New env var: `RESEND_WEBHOOK_SECRET` (from the Resend webhook). Until it's set,
the webhook endpoint returns 401 and Email Analytics shows an empty state.

Not done (future): no caching (fine at prelaunch; add a 60s in-memory cache if
slow); no pre-deletion warning emails; spec's "—" assumption for compound/
time-machine correct-rate doesn't hold against live data (see deviation note).

---

## Session: Phase 14 — Glossary tap-to-reveal + AI nomination gate

**Goal:** (1) auto-wrap the first mention of each known glossary term per digest
in a tap-to-reveal tooltip; (2) let the digest generator nominate new financial
terms it used, gated behind admin approval before anything reaches kids.

**Files**
- `src/glossary.js` — the 44-term seed map (provided, **consumed not rewritten**):
  `GLOSSARY`, `lookup()`, `isKnownTerm()`, `knownTermList()`, `MATCHABLE_TERMS`.
- `src/glossary-runtime.js` (new) — the LIVE merged view = seed + approved
  `pending_glossary` rows. `getActiveGlossary()` (sync, render-path safe),
  `refreshActiveGlossary()` (async, lazy storage import). Seed-only until first
  refresh → tooltips work with no DB.
- `src/template.js` — `makeGlossaryLinker(view)` (exported for tests) + inline
  CSS (locked to `glossary-demo.html`) + vanilla tap/keyboard toggle. Wired into
  `buildHTML` via an ordered `lk` block (big picture → scoreboard prose →
  stories → DYK → word-of-day). Gated by `opts.glossary !== false`; on `/digest`
  AND `/sample`. **Design choice:** linker runs on RAW field text and escapes
  inside, so `&`-bearing terms match and there's no tag-injection path (we do
  NOT pass `<…>` spans through — that would undo `escapeHTML`).
- `src/ai.js` — `glossaryNominationBlock()` + `GLOSSARY_NOMINATION_SCHEMA` in all
  three builders; `filterGlossaryNominations()` (exported) drops already-known/
  malformed, normalizes principle, caps at 5. Rides the existing call (no new
  API request).
- `src/storage.js` — `nominateGlossaryTerm` (insert-or-bump via
  `ON CONFLICT (LOWER(term))`), `getPendingGlossary`, `getGlossaryByStatus`,
  `approveGlossaryTerm` (edits on approve), `rejectGlossaryTerm`.
- `src/generate.js` — persists filtered nominations ONLY on a real INSERT (never
  cached replay); `refreshActiveGlossary()` on both paths.
- `src/admin.js` — Glossary Nominations card (pending, sorted by `times_seen`,
  inline approve/edit/reject forms), fault-tolerant getter.
- `src/server.js` — boot migration for `pending_glossary`; ADMIN_KEY-gated
  `POST /api/admin/glossary/:id/approve|reject` (urlencoded, route-local parser,
  fail-closed); boot-time `refreshActiveGlossary()`.
- `src/schema.sql` + `src/migrations/add-pending-glossary.sql` — table DDL.
- `scripts/test-glossary.js` — 36 assertions (pure/offline).

**Promotion path:** option **(b)** — approved rows merge with the seed at render
time (`glossary-runtime`), cached per process, refreshed on generation + on
approval. No redeploy to grow the glossary. (Option (a), codegen into
`glossary.js`, was rejected — it's the manual/redeploy path Sunny doesn't want.)

**Decisions / notes**
- Quiz/Daily Challenge is client-rendered JSON, so it's outside the server-side
  wrapping pass (the task's section order lists "quiz", but it isn't in the
  server HTML here). Tiny per-index scoreboard card blurbs are left plain so a
  tooltip can't overflow a 14px card; the scoreboard "pass" links the vibe-bar
  summary + the "why the mover moved" callout.
- Added an `approved_at` column (not in the original spec's column list) to drive
  the demo's ≤14-day "NEW" superscript and ordering — documented in `schema.sql`.
- `first_seen_date`/`last_seen_date` stored as TEXT NY date strings to match
  `todayNY()` usage.

**Verified**
- `node scripts/test-glossary.js` → 36/36 green (longest-first, first-occurrence
  across sections, alias resolution, word-of-day self-skip, principle tie-in,
  tag/markup safety, kill-switch off-path, seed+approved merge, nomination filter).
- `node --check` on every changed file.
- **Live `/sample`** (port 3199): 11 tooltips render; opened the EARNINGS tip —
  dark card, citrus-yellow label, "Ties to: Think like an owner…" tie-in;
  aliases resolve (`stocks`→Stock, `The Fed`, `rates`→Interest rate). Screenshot
  matches `glossary-demo.html`.
- **Live Neon (end-to-end):** boot DDL creates the canonical table (10 cols, 3
  indexes, clean status CHECK); `nominateGlossaryTerm` insert → re-nominate bumps
  `times_seen` 1→2 + updates `last_seen_date` without overwriting the definition;
  pending list shows it; `approveGlossaryTerm` with edit flips `status='approved'`
  + sets `approved_at`; `refreshActiveGlossary()` makes it live + matchable;
  `rejectGlossaryTerm` keeps the row as `rejected`. Test rows cleaned up; the
  canonical empty table is left in Neon.
- `/admin` card + approve/reject endpoints verified by code review (the live
  Neon box has no `ADMIN_KEY` set, so the gated HTTP path wasn't exercised
  end-to-end — the underlying storage helpers + refresh were, directly).

**Open / future**
- `/admin` approve form clears principle if left blank; the select pre-fills the
  current value so normal approves keep it.
- No pagination on the nominations card (LIMIT 100) — fine at prelaunch.

---

## Session: Phase 14 follow-up — tappable scoreboard index tiles

**Goal:** make the three scoreboard tiles (S&P 500 / Nasdaq / Dow Jones) always
tappable, every digest, revealing that index's glossary definition — even on
days the index name never appears in prose. (The prose linker only links terms
where they show up in a sentence; the tiles were left plain in PR #29.)

**Files**
- `src/template.js` —
  - `scoreboardGloss(view, term, enabled)` (new, exported) — the single
    "is this tile tappable?" decision: resolves via the same `view.lookup()`
    the prose linker uses (seed + approved DB rows), returns null on glossary-off
    or lookup-miss. **No second hardcoded copy of the definitions.**
  - `scoreCard(key, label, term)` now renders a tappable tile (`role=button`,
    `tabindex=0`, `aria-expanded`, `aria-controls`) with a dotted-underline + ⓘ
    affordance on the index name when an entry resolves; plain otherwise.
  - `scoreGlossPanel(...)` renders a full-width `.score-gloss-panel` drawer below
    the scoreboard grid (the prose `.tip` bubble clips on a small tile). Same
    brand styling as the prose tip (dark surface, citrus-yellow term label,
    "Ties to:" principle line under a hairline).
  - **Independence:** tiles call `lookup()` directly, NOT the linker — they never
    touch the first-occurrence seen-set, so a tile and a prose mention of the
    same term don't suppress each other.
  - **Unified client controller:** one IIFE now wires both `.gloss` terms and
    `.score-card.tappable` tiles, so one-open-at-a-time + tap-outside + keyboard
    span both affordances. Panel clicks `stopPropagation` so reading the drawer
    doesn't count as tap-outside. Scope: the 3 index tiles only — TODAY'S MOVER
    is untouched.
- `scripts/test-glossary.js` — Section 10 added (19 assertions): each index tile
  resolves an entry; alias label "DOW"→Dow Jones; lookup-miss → null; kill-switch
  → null; all 3 tiles tappable + 3 panels render with canonical terms; Nasdaq
  tile tappable though absent from prose; S&P 500 prose-linked AND tile tappable
  (no mutual suppression); panel placement below the grid; unified controller
  selector; kill-switch renders plain tiles.

**Decisions**
- Placement = expanding full-width drawer below the scoreboard row (chosen over
  tile-flip / per-tile popover — it has room for the definition + principle line
  and can't overflow a 14px tile).
- Affordance = dotted underline + small ⓘ on the index name (consistent with the
  prose dotted underline; ⓘ makes "tap me" explicit without clutter).

**Verified**
- `node scripts/test-glossary.js` → **all green** (existing 36 + 19 new).
- `node --check src/template.js`.
- **Live `/sample`** (port 3199): all 3 tiles tappable; on that day's sample data
  none of S&P 500 / Nasdaq / Dow appear in prose (`proseGlossTerms` confirmed),
  yet every tile reveals its drawer — the core "works without a prose mention"
  requirement. Drawer fits the container width (left 22 / right 670 within 6–686,
  no clip). One-open-at-a-time verified in all directions (tile↔tile, tile↔prose,
  prose↔tile), tap-outside closes, tap-inside-panel stays open. Keyboard:
  Enter/Space open, Escape closes, `role=button`/`tabindex=0`/`aria-controls`→
  `role=region`, aria-expanded synced. Screenshot of the open S&P 500 tile taken.
- Everything here was verified live; no code-review-only gaps this session.

---

## Session: Big-three glossary defs reworded

Reworded the `def` strings for the three scoreboard indices (`S&P 500`, `Nasdaq`, `Dow Jones`) in `src/glossary.js` for clarity — "a single number that combines N companies… did they do well today?" framing. Content-only; keys/`principle`/`aliases`/helpers untouched. Seed terms, so they ship via deploy (not the live approved-term path). `node --check` + lookups + `scripts/test-glossary.js` (56 assertions) green; `/sample` tile drawers render the new wording without layout breakage.

---

## Session: Match game — fix name-leaks, add guardrail, +20 companies

The Match game (`public/games/match.js`) shows company names on the left and
`shortModel` business-model clues on the right; the kid pairs them by reasoning.
**Bug:** some clues repeated the company's own name, so the kid could match by
spotting the word instead of thinking.

- **`public/data/company-models.json`** — reworded **14** leaking `shortModel`s
  (the 13 named in the task + **Meta**, which the guardrail caught: its display
  name's parenthetical products "Instagram & Facebook" appeared verbatim in the
  clue — the same leak class). Each reworded clue keeps the reasoning challenge
  (describes the money-making mechanism) but drops the name and any significant
  name-word. Only `shortModel` touched; `name`/`surprise` left alone (the
  `surprise` reveal is shown after answering, so the name there is fine).
- **Added 20 new companies** (37 → **57**): Sony, Mattel, Hasbro, Funko, Crocs,
  Lululemon, e.l.f. Beauty, Chewy, PepsiCo, Mondelez, Hershey, Roku, Snap,
  Reddit, Duolingo, Planet Fitness, Garmin, GoPro, Warby Parker, Carvana —
  varied industries, kid-recognizable, each with a non-obvious "how do they make
  money?" reveal. Every new `shortModel` follows the anti-leak rule from the
  start (passes the guardrail with no rewrites); same schema/reading-level/length
  as existing entries.
- **`scripts/test-company-models.js`** (new) — guardrail: scans all 57 entries,
  fails on any `shortModel` that leaks its own name. Name-word extraction strips
  corporate suffixes, splits on whitespace/hyphen, KEEPS brand + parenthetical
  words, and is possessive-aware (drops `'s` so "Costco's"/"Disney's" reduce to
  the stem). Matching uses a normalized whole-word TOKEN SET (not naive
  substring), so it catches "McDonald's collects rent" but never false-matches a
  stem like "ea" inside "team". On a hit it prints entry + offending word + full
  clue; inline `ALLOWLIST` (starts empty) absorbs common-word coincidences
  (e.g. a future clue using "snap" the verb).

**Verified:** JSON parses; `node --check`; the guardrail passes across all 57 and
is non-vacuous (confirmed it flags reconstructed McDonald's/Costco/Coca-Cola/
Meta leaks); existing `test-games.js` + `test-glossary.js` still pass; live in
`games-preview.html?game=match` a round drew Meta/Salesforce/PepsiCo/Planet
Fitness (two new entries + fixed Meta) with no company name in any right-side
clue — screenshot taken. Ships via deploy (static dataset), not the live
approved-term path.

---

## Session: Readability overhaul (body typography — visual only)

**Trigger:** the 10-year-old target reader found the digest body "too crammed —
just a flow of text." A typography/spacing problem, NOT a content problem.

**HARD CONSTRAINT honored:** purely visual. No `src/ai.js` change, no prompt
change, no rewording/shortening. Every word stays. Verified word-for-word
(see below). All changes in `src/template.js`.

**What changed (all token-driven in `:root`):**
- `--body-size: 16.5px` (was ~14–15px), `--body-leading: 1.72` (was ~1.4–1.65),
  `--prose-measure: 42ch`, `--para-gap: 0.95em`, `--gloss-underline:
  rgba(255,122,26,0.45)` (was solid `#FF7A1A`; offset still 3px).
- Applied to body prose: `.story-card p`, `.big-picture p`, `.dyk-fact`,
  `.dyk-connection`, `.why-it-matters`. The 42ch measure is applied to flowing
  prose only (Big Picture, story bodies, DYK fact); the capped column is
  **left-aligned** under the heading (not centered — centering misaligned the
  body from its story heading). Scoreboard, challenge picker, badges, and mover
  card are untouched (`max-width: none`, widths unchanged — verified 4×153px).
- **Multi-`<p>` rendering:** new `makeGlossaryLinker(...).linkProse(field)` splits
  a body field on blank-line (`\n\n`) breaks the model already emitted and emits
  one `<p>` per paragraph, sharing the glossary `seen` set so first-occurrence
  linking spans paragraphs. Wired into `bigPicture` + story `body` (the two
  fields rendered as standalone `<p>`); removed their outer `<p>` wrappers.

**IMPORTANT — paragraph-splitting is a no-op on today's content.** Probed both
`sample-digest.json` and a live digest: NO body field currently contains `\n\n`
(Big Picture ~550–800 chars, story bodies ~180–640 chars are each one block).
Per the no-content-change constraint we did NOT add breaks by rewriting or by
touching the prompt — so `linkProse` renders exactly one `<p>` today. The
readability win on existing/future break-less digests comes entirely from the
size/leading/measure tokens; the splitter only activates if/when a field ships
with real `\n\n`.

**Verified (live + code):** rendered `/sample` in a browser at a tall viewport —
before/after screenshots of Big Picture + a story + the scoreboard. Computed
styles on the live `.big-picture p`: `font-size 16.5px`, `line-height 28.38px`
(=16.5×1.72), `max-width 406.6px` (42ch). Word-preservation proven by rendering
each prose field with glossary OFF and diffing the visible text vs the raw field
— **word-for-word identical, 0 diffs** across both digests. Glossary suite
(`test-glossary.js`) passes (first-occurrence-across-paragraphs + tile-not-
consuming-seen-set both hold); `node --check src/template.js` clean. Live-vs-
code split: typography + word-preservation verified LIVE in-browser; the multi-
`<p>` split path verified by unit assertion (synthetic `\n\n` → 2 `<p>`, 1 gloss
span) since no live content exercises it yet.

---

## Session: Readability fix-up — paragraphs + wider measure

**Why:** the prior readability pass shipped wrong — it applied a hard `42ch`
measure but never broke the long body blocks. Result on wide cards: a tall
skinny column stranded in the left ~55% with a big empty void on the right, and
the text was STILL one unbroken block. This session fixes both.

**Kept from prior pass (these landed right):** `--body-size 16.5px`,
`--body-leading 1.72`, softened glossary underline. Untouched.

**Fix 1 — measure fills the card.** `--prose-measure: 42ch → 64ch`. Verified
live: `.big-picture p` renders at 602px inside a 604px card content box — fills
it, no void. 64ch clamps to card width on narrow screens (mobile stays
near-full-width). Prose-only; scoreboard/challenge/mover/badges untouched
(measured 4×153px, `max-width: none`).

**Fix 2 — real paragraphs (the main fix).** Long body fields now render as
multiple `<p>` from two sources, BOTH word-preserving:
- **New digests:** `PARAGRAPH_RULE` added to all three edition prompts in
  `src/ai.js` — authoring directive to write bigPicture / story body /
  whyItMatters as 2–3 short `\n\n`-separated paragraphs, SAME depth/length/voice
  (structure only, explicitly "do not shorten"). Verified by a real
  `generateContent` run (no DB write): bigPicture + every story body came back
  with `\n\n`.
- **Already-stored digests (no `\n\n`):** new `paragraphizeText()` /
  `splitSentences()` in `src/template.js` — a safe display-time fallback that
  groups whole sentences into ~2–3-sentence paragraphs. Conservative: never
  splits inside `U.S.` / `a.m.` / `Inc.` / `Dr.` / `$4.2` / single initials
  (`SENTENCE_ABBR`), leaves a too-long lone sentence whole. Inserts only `<p>`
  boundaries — no word dropped/reordered/altered.
- `linkProse(field, {prefix})` now drives bigPicture, story body, whyItMatters,
  DYK fact + connection. `prefix` carries the inline label ("💡 Why it matters:",
  "The lesson:") into the first `<p>`. Glossary first-occurrence `seen` set still
  spans all paragraphs.

**No content shortened — proven.** Rendered every prose field (glossary OFF) for
both an old stored digest and the fresh-generated one and diffed visible text vs
source: **word-for-word identical, 0 diffs.** The splitter is a pure render
transform.

**Verified:** `node --check` both files; `test-glossary.js` passes (incl.
first-occurrence-across-paragraphs); splitter unit checks (abbreviations,
decimals, times, word-integrity) all green; live `/sample`-style render
before/after screenshots of Big Picture + a story + scoreboard. Live-vs-code
split: measure-fills-card + paragraphing + word-integrity verified LIVE
in-browser and via real generation; `ai.js` prompt verified by one live
`generateContent` call (not persisted).

---

## Session: Generation fix — robust JSON extraction (trailing prose)

**Symptom:** 2026-06-12 7 AM cron failed to generate again → no digest, no
email. THIRD distinct cause in this saga (after max_tokens truncation and the
stale-disk teaser).

**Root cause (from Railway logs):** `[AI] stop_reason: end_turn` (NOT
max_tokens — the response was COMPLETE), but parse died with
`Unexpected non-whitespace character after JSON at position 16759`. The model
returned a valid JSON object FOLLOWED by a trailing remark, and the parser's
fallback used `lastIndexOf('}')`, which grabbed a stray `}` inside that trailing
prose → the slice had junk after the real object.

**Fix (`src/ai.js`):** new `extractFirstJSONObject()` — scans from the first `{`
and brace-matches (string/escape-aware, so braces & quotes inside JSON string
values don't affect depth) to return the FIRST complete balanced object,
ignoring any preamble before OR commentary after it. `parseDigestJSON()` now
tries: (1) straight `JSON.parse`, (2) `extractFirstJSONObject`, (3) the old
widest-span heuristic as last resort. Exported the helper for unit testing.

**Verified:** unit tests cover the exact failure shape (valid JSON + trailing
prose w/ stray brace), leading preamble, braces/quotes inside strings, nested
objects/arrays, truncated→null, no-object→null — all pass. Regenerated
2026-06-12 live against prod DB (full FMP+Claude pipeline) → parsed cleanly,
row inserted; teaser email sent (3/3, 5 kids). `node --check` clean;
`test-glossary.js` still passes.

**Recurring-failure ledger (all three now fixed):**
1. `max_tokens: 8000` too low → truncated JSON (fixed → 16000 + loud guard).
2. teaser read stale disk file → wrong-day email (fixed → reads DB).
3. trailing prose after JSON → `lastIndexOf('}')` slice broke (fixed →
   brace-matching `extractFirstJSONObject`).

---

## Session: 7 AM morning-run alert (Telegram) — fail loud + success ping

**Why:** three mornings in a row generation broke and was found hours later via a
MISSING email, not an alert. The cron correctly skips the fan-out on failure, but
that correct behavior is SILENT — failures looked identical to a quiet success.
Robust parsing (#37) lowers recurrence odds but can't hit zero; the durable fix is
**detection**.

**Built (`src/notify.js` + cron wiring in `src/server.js`):**
- `sendTelegram(text)` — reuses the railway-health-check bot/chat
  (`TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`, chat defaults to `8618800483`).
  NEVER throws: missing token → logged no-op; network/non-200 → swallowed. Inert
  until the token is set in Railway.
- `buildFailureAlert({date,edition,stage,error})` — ❌ header, date+edition, stage
  (generation | teaser fan-out), error message, and for JSON parse errors the
  **position + ±60-char snippet** (enriched in `ai.js` `jsonParseError`, which
  parses V8's "position N" and slices the offending region onto the thrown error).
  Defensive — never throws on missing fields.
- `buildSuccessPing({date,edition,sent,failed,total,kids})` — one-line ✅ with
  counts from the fan-out result; `failed>0` surfaced.
- Cron observes the FINAL outcome and sends exactly ONE message per run:
  generation-fail → ❌ + return; fan-out fail/threw → ❌; clean → ✅ (gated by
  `ALERT_SUCCESS_PING`, default ON). Every send via a `safeAlert` wrapper so a
  notification bug can't crash the cron.

**Config / env:** `TELEGRAM_BOT_TOKEN` (REQUIRED in Railway to enable),
`TELEGRAM_CHAT_ID` (default `8618800483`), `ALERT_SUCCESS_PING` (default ON).
Documented in `.env.example` + CONTEXT.md ops section. ⚠️ ACTION: set
`TELEGRAM_BOT_TOKEN` in the Railway service env or the alert stays inert.

**Verified:** builder unit tests (parse-fail shows date+position+snippet, generic
error, success counts, never-throw-on-missing-fields) all pass; `parseDigestJSON`
enriches the thrown error (pos+snippet) — asserted end-to-end; `sendTelegram`
fail-safe confirmed (bad token → ok:false no throw; no token → skipped no throw).
**Live send EXERCISED:** one real ✅ and one real ❌ delivered to the ops chat
(both `ok:true`). `node --check` clean on all three files; `test-glossary.js`
passes.

**Recurring-failure ledger — detection backstop now in place:**
1. `max_tokens` truncation (fixed #34) — a future truncation now pings ❌.
2. stale-disk teaser (fixed #34).
3. trailing prose after JSON (fixed #37) — a future novel parse shape pings ❌
   with position+snippet.
→ Any future novel generation/parse failure is now DETECTED at ~7:01 AM, not
   discovered hours later via a missing email.

---

## Session: Phase 15 — Push notifications (kid-facing trigger)

First session of the June 2026 roadmap build cycle (ROADMAP.md). Also session
setup: created `CLAUDE.md` (working rules) and renamed the untracked
`market-juice-roadmap-spec.md` → `ROADMAP.md` so the rules point at a real file.

**Why.** The 7 AM email goes to the PARENT; the kid had no trigger at all.
Completes the long-deferred Phase 6.3, expanded per the roadmap spec.

**Files**
- `src/push.js` (new) — the engine. Lazy VAPID init (env at call time, the
  macOS-launchd pattern; keys unset = fully inert). Copy builders
  `buildMorningPush` (edition + vibe aware) / `buildStreakRiskPush` (factual,
  no guilt). `tryLogPush` / `deletePushLog` (the ledger), `sendPushToUser`
  (404/410 → clears `users.push_subscription`), `sendMorningPushes` (hourly
  sweep), `sendStreakRiskPush` (evening hook).
- `push_log` table — `(user_id, kind ∈ morning|streak-risk, digest_date,
  sent_at)`, UNIQUE `(user_id, kind, digest_date)`. In `schema.sql` +
  `src/migrations/add-push-log.sql` + idempotent `runBootMigrations()` block.
  **Ledger-before-send:** the row is INSERTed before delivering, so every
  sweep/re-trigger is idempotent; on a transient send failure (non-404/410)
  the row is deleted so the failure doesn't consume the kid's daily slot.
  The INSERT carries a COUNT guard enforcing the hard 2/day cap in SQL.
- `src/server.js` — boot migration; `GET /api/push/public-key` (key served
  from an endpoint, NOT baked into pwa.js — rotation is an env change);
  `POST /api/push/subscribe` (session auth, validates endpoint/p256dh/auth
  shape) + `POST /api/push/unsubscribe`; `POST /api/cron/send-push`
  (X-Cron-Secret, re-run-safe); hourly morning-push cron at **minute 5** UTC;
  streak push wired into `sendEveningRecaps`'s nudge fork (own try/catch —
  can never block the parent email; SELECT gained `push_subscription`).
- `src/storage.js` — `DELETE FROM push_log` added to the COPPA scrub
  transaction (`push_subscription` was already scrubbed since Phase 10).
- `src/engagement.js` — `activeDays` added to `getProgress()` (COUNT DISTINCT
  daily-visit days; legacy rows without `digestDate` fall back to the NY date
  of `created_at`). Flows to `/api/engagement/state` automatically.
- `public/pwa.js` — placeholder gone. Permission ask is a soft banner
  ("Want a morning ping when today's Juice is ready?") gated on: push
  supported (iOS → standalone; Android Chrome OK in-tab), permission not
  denied, not subscribed, **activeDays ≥ 3**, not dismissed in 14 days
  (`mj_push_dismissed_at`), and the install banner neither shown NOR eligible
  this visit (install takes priority — never both banners in one visit).
  Native prompt fires only from the kid's tap. Silent re-subscribe on load
  when permission is already granted (restores lost subscriptions);
  `appinstalled` no longer prompts.
- `public/engagement.js` — fires `mj:state-loaded` after a successful state
  fetch (pwa.js consumes it for the activeDays gate).
- `public/sw.js` — push handler honors `payload.tag` (`mj-morning` /
  `mj-streak` so the two kinds don't collapse); VERSION **v3 → v4** (pwa.js +
  engagement.js are precached shell assets).
- `package.json` — `web-push@^3.6.7` (only new dependency).
- `.env` / `.env.example` — `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
  `VAPID_SUBJECT`. Keys generated and set locally.
- `scripts/test-push.js` (new) — 39 assertions, all green.

**Key decisions (incl. review-round changes from Sunny):**
1. **Morning push is timezone-aware, with a 7–9 AM local catch-up window** —
   hourly sweep (same SQL-gate pattern as the Phase 12 evening recap), NOT
   sent at generation time: a 7 AM ET blast would buzz west-coast kids at
   4 AM (habit-not-compulsion). Gate: local hour BETWEEN 7 AND 9 AND no
   'morning' push_log row today (NOT EXISTS in the candidate query) AND
   today's digest row exists. The window is 7–9 rather than == 7 (second
   review round) because the == 7 gate dropped Eastern kids whenever
   generation finished after their 7:05 tick — and Phase 18's planned
   7:10/7:25 retries will make late digests routine. The ledger guarantees
   exactly one morning push per kid per day; past 9 AM local the day is
   simply missed (no mid-morning buzz). Cron runs at minute 5 so the 7 AM
   ET tick never races the 7:00 generation cron.
2. **Transient-failure slot release** — a non-404/410 send error deletes the
   just-reserved push_log row; a 404/410 keeps it (nothing left to retry)
   and clears the dead subscription.
3. **Banner exclusivity** — install banner and push banner never share a
   visit; install wins (a kid can't get iOS push without installing anyway).
4. **Interim copy** — week-ahead "see what's coming" (spec's "make your
   picks" references Phase 17) and weekly-wrap "see how your week went"
   (spec's "Your Week in Juice" is Phase 20). Swap-TODOs recorded in
   ROADMAP.md under Phases 17 and 20. Added a `mixed`-vibe variant the spec
   didn't cover (🟡).
5. The streak push rides the nudge fork because that fork IS the spec's
   first two gates (streak ≥ 3 AND no engagement today); push_log adds the
   third (no push of this kind today) + the cap.

**Deviations from ROADMAP.md (codebase-is-truth rule):**
- Spec said "replace the REPLACE_IN_PHASE_6 placeholder in pwa.js" with the
  key — pwa.js is a static, SW-precached shell asset, so the key is served
  via `GET /api/push/public-key` instead (pwa.js's own comment anticipated
  this). Placeholder removed either way.
- Spec's push_log columns were `(user_id, kind, sent_at)` — added
  `digest_date` (NY day) because a UTC timestamp can't dedup "per day"; the
  unique index on it is what makes the sweeps idempotent.
- Spec's "prompt after the kid's 3rd active day" had no data source — no
  active-day counter existed. Added `activeDays` to the engagement state.
- Doc drift noted: CONTEXT/HANDOFF/ROADMAP say the local repo is
  `~/market-juice`; the actual working copy is `~/market-buzz-kids`.

**Known edges (accepted, documented in code):**
- Kids whose whole 7–9 AM local window lands before the 7 AM ET generation
  (e.g. Europe) find no digest row for the new NY day and skip that day's
  morning push. Fine at prelaunch scale (all current users are US).
- A no-digest day also skips the streak push (the evening sweep bails before
  the per-user loop — nothing to engage with anyway).

**Verified**
- `node scripts/test-push.js` → **39/39 green** against live Neon (pure copy
  builders; ledger dedup/cap/slot-release; 404/410 cleanup + transient-failure
  handling via injected fake senders — no real push service contacted;
  `sendStreakRiskPush` gates end-to-end; **the morning-sweep window via the
  REAL gate SQL** — test user's timezone set to Etc/GMT offsets simulating
  local hours, sweep scoped to the test user via `opts.onlyUserId`: 6 AM
  excluded, 8 AM delivers after a "late" digest, 9 AM doesn't double-send
  (NOT EXISTS removes the kid from the candidate set), 10 AM with a cleared
  ledger is outside the window; activeDays; COPPA scrub covers push_log +
  push_subscription). Throwaway user fully cleaned up, including the
  deletion_requests audit row. The sweep section requires today's
  daily_digests row and fails loudly with instructions if it's missing.
- `node scripts/run-schema.js` → push_log created on Neon (NOTE: like prior
  sessions, booting/schema-applying locally ran the forward-only migration
  against the live DB — additive only).
- Existing suites still green: `test-glossary.js` (55), `test-engagement.js`
  (all checks passed — exercises the extended scrub).
- **Live boot** (port 3199): boot migration no-op (table exists);
  `GET /api/push/public-key` returns the key; `POST /api/cron/send-push` with
  secret → `{ok:true, status:'ok', total:0}` (today's digest row exists, no
  subscribed users yet — correct); 401 without secret; 401 on
  unauthenticated `POST /api/push/subscribe`.
- `node --check` clean on all 7 changed JS files.
- **Code-review-only (not exercised live):** the browser subscribe round-trip
  + banner UX (needs a logged-in kid with ≥ 3 active days on a real
  iOS-PWA/Android device and a configured push service) and an actual
  notification render. The iOS + Android acceptance check from the spec
  should happen on real devices after the Railway env vars are set.

**⚠️ ACTION (deploy):** set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
`VAPID_SUBJECT` in the Railway env (generate a SEPARATE production pair with
`npx web-push generate-vapid-keys` — don't reuse the local dev pair). Until
set, push is inert and everything else works unchanged.

**Open / future:**
- Swap interim morning-push copy when Phases 17 / 20 ship (TODOs in ROADMAP).
- Real-device verification (iOS PWA + Android Chrome) post-deploy.
- The Europe-edge above; revisit if non-US families sign up.

---

## Session: Phase 16 — Mystery Mover (daily puzzle) + guest play on /sample + share grid

The daily Wordle-style mechanic from ROADMAP.md Phase 16 — one mystery company
per day from the curated 75, 5 progressive clues, free-text guessing, playable
by logged-out guests on /sample (the COPPA-safe viral surface), with a
zero-identifier emoji share grid.

**Files**
- `src/mystery.js` (new) — the engine. `pickMysteryCompany` (deterministic
  day-seeded pick, 30-day no-repeat), `buildClue5` (server-COMPOSED "first
  letter + ticker length" clue — never trusted to the model),
  `validateMysteryMover` (the name-leak HARD GATE: clues 1–4 may not contain
  a whole-word token of the company name, the 2+-letter ticker, or ANY word
  of any acceptable answer — anything we'd accept as a guess is by definition
  a giveaway), `finalizeMysteryMover` (validate-or-fallback),
  `isCorrectGuess` (normalized matching: case/punctuation/possessives/
  corporate suffixes; ticker accepted).
- `src/mystery-reserve.json` (new) — **12 hand-written reserve puzzles**
  spanning 5 sectors (consumer/tech/finance/auto/telecom), each
  guardrail-validated in the smoke test. Deliberately under `src/`, NOT
  `public/data/` — it contains answers and `public/` is statically served.
  Reserve-shipped tickers enter rotation history like AI ones, so a
  multi-day generation outage can't repeat within the 30-day window.
- `src/name-leak.js` (new) — token normalization + leak detection extracted
  from `scripts/test-company-models.js`; both the Mystery clue gate and the
  Match dataset test now import identical logic (the 57-entry test stayed
  green through the extraction).
- `src/content-history.js` — REWRITTEN Postgres-backed (`content_history`
  table: kinds word/fact/mystery; ~100-row cap per kind; fails soft). The
  ephemeral state-file wart is closed. **Both exports are async now** — the
  4 call sites in generate.js gained awaits. Old state file deliberately not
  migrated (it was ephemeral anyway; worst case a short-term word/fact
  repeat). schema.sql + `src/migrations/add-content-history.sql` +
  idempotent boot block in `runBootMigrations()`.
- `src/ai.js` — `mysteryMoverBlock(company)` + `MYSTERY_MOVER_SCHEMA`
  injected into ALL THREE edition builders (puzzle runs 7 days/week), the
  glossaryNominationBlock pattern. The SERVER picks the company and the
  prompt names it — Claude never chooses (rotation would be unenforceable).
  Asks for exactly 4 clues with GOOD/BAD examples (oneToWatch style).
  PROFANITY_RULE + recursive scrubProfanity already cover the new field.
- `src/generate.js` — awaits the async history API; picks the company
  (excluding 30 days of answers; deterministic on the date so DATE_OVERRIDE
  reproduces); finalizes/validates after generateContent and BEFORE
  saveDigest (a leaky puzzle can never reach the immutable row); records the
  ACTUALLY-SHIPPED ticker (reserve ticker when the fallback fired).
- `src/engagement.js` — the risky refactor: extracted
  `applyDailyPlayProgress` (streak + weeks_active + streak bonus on the
  day's first qualifying play) and `checkPerfectDay` (distinct game keys
  across BOTH game-completed and mystery-mover-played; mystery contributes
  pseudo-key 'mystery-mover'; double-fire guard spans both types) out of
  `applyGameCompleted`; new `applyMysteryMover` (MC 25/20/15/10/5 by
  clamped cluesUsed, 0 unsolved; bumps games_played; correct_answers stays
  picker-game-only); new isDuplicate branch (per digestDate);
  `mystery-mover-played` counts as "engaged" in getDailyEngagementSummary
  (so the evening nudge email AND the Phase 15 streak-at-risk push skip
  kids who played the puzzle).
- `src/progression.js` + `public/progression-config.js` —
  `MC_AWARDS.mysteryMover` ({byCluesUsed: [25,20,15,10,5], unsolved: 0}),
  EVENT_TYPES + badge-family eventTypes (streak/games/perfectDays/
  consistency gain the mystery event; quizzes stays game-only).
- `src/server.js` — boot migration; PUBLIC `GET /api/mystery/today` (clues
  only — never answer/name/ticker/acceptableAnswers; 404 on pre-Phase-16
  rows) + `POST /api/mystery/guess` (stateless, new mysteryLimiter
  30/min/IP per spec).
- `src/template.js` — Mystery Mover section host (after the Daily
  Challenge, hidden until the client hydrates) + script tag + `.mm-*` CSS
  in the inline style block (all CSS stays in template.js, per the rules).
- `public/games/mystery-mover.js` (new) — self-mounting client (NOT in the
  picker; rotation math untouched). Clue pacing client-side: wrong guess
  auto-unlocks the next clue, manual "Reveal next clue" button, 5 guesses
  max, per-day localStorage state. Logged-in finish →
  recordEvent('mystery-mover-played'); /sample finish → the spec's signup
  CTA. Share grid: `Market Juice Mystery Mover — June 12 / 🟧🟧🟩 (got it
  in 3 clues!) / themarketjuice.com/sample` — zero identifiers.
- `public/sw.js` — v5 (mystery-mover.js joins SHELL_ASSETS).
- `scripts/test-mystery.js` (new) — 75 assertions, all green.

**Deviations from ROADMAP.md (codebase-is-truth rule):**
1. Spec's "guess returns next clue unlock" vs "stores nothing per-guest"
   are contradictory — server-paced unlocks need per-guest state.
   Resolution: /today returns all 5 clues, the CLIENT paces reveals, the
   server protects only the ANSWER (same trust model as the quiz, which
   embeds correctIndex client-side).
2. Spec said 5 clues from Claude — clue 5 is server-composed instead
   (deterministic, removes the only clue allowed to contain the first
   letter from the leak-validation surface). Approved.
3. Reserve pool under `src/` instead of the `public/data/` dataset
   convention (it contains answers). Approved.
4. The spec's "flagship brand words" ban has no data source in
   companies.js — implemented by validating clues against ALL
   acceptableAnswers words (Claude's alias list doubles as the brand list).
5. "Reuse the token-normalization from scripts/test-company-models.js" —
   it was a script, not a module; extracted to `src/name-leak.js`, script
   re-imports.
6. Perfect Day + streak logic lived inline in applyGameCompleted and only
   saw game-completed events — refactored into shared helpers (the
   spec's "counts toward Perfect Day" was otherwise unimplementable).
   Classic path covered by explicit regression assertions (below).
7. cluesUsed is client-reported, server-clamped (1–5), dedup-capped —
   trust model accepted by Sunny (consistent with quiz correctness).

**Verified**
- `node scripts/test-mystery.js` → **75/75 green** vs live Neon: guardrail
  rejects name/possessive/ticker/alias leaks + vague clues (non-vacuous);
  all 12 reserve puzzles guardrail-clean; deterministic rotation + 30-day
  window via Postgres; MC by clue count incl. 99→5 clamping + replay dedup;
  mystery extends the streak; unsolved = 0 MC + streak credit; **classic
  regressions: 3 distinct games (no mystery) fire Perfect Day exactly once
  (a 4th doesn't re-fire), a game (not mystery) still extends the streak**;
  Perfect Day fires in BOTH orderings (mystery-third 2 games→mystery, and
  game-third mystery→2 games).
- Full existing suite green after the refactor: test-engagement (the direct
  applyGameCompleted exerciser), test-glossary, test-company-models (57
  entries, now via name-leak.js), test-push (39), test-evening-email,
  test-multi-kid, test-multi-kid-emails, test-games (dry).
- **Live AI generation** (DATE_OVERRIDE=2026-06-13, ~$0.30): server picked
  META, Claude returned 4 clean progressive clues (clue 3 describes
  Facebook without naming it; "Facebook" correctly in acceptableAnswers and
  validated against), guardrail passed, ticker recorded to rotation. Test
  row + its 3 content_history rows deleted afterward (the run's 3 glossary
  nominations were left in pending_glossary — real terms, admin-gated).
- **Live guest play on /sample** (local :3199, browser-driven): section
  renders in the design system; wrong guess shows feedback + unlocks clue
  2; manual reveal → clue 3; "starbucks corp."/"sbux"/messy-case guesses
  all solve; solve panel shows 🟧🟧🟩 grid + "Sign up to save your streak"
  CTA → /#signup; unsolved path shows 🟥🟥🟥🟥🟥; share button reaches its
  Copied state; localStorage state survives reload. Share text contains no
  PII by construction (date + grid + URL only). Same-puzzle-all-day:
  /api/mystery/today byte-identical across sessions (hash-compared).
  Screenshot taken. API: answer absent from /today payload (grep 0); bad
  body → 400; 31 rapid guesses → 429s after the 30/min window filled.
- **Bug found + fixed during the live pass:** the wrong-guess feedback line
  was written to the pre-render DOM node (render() replaces the card), so
  it never displayed — now rides the re-render (`pendingFeedback`).
  Re-verified live: "Not "Dunkin" — here's another clue." renders.
- `node --check` clean on all 13 changed JS files.
- **Code-review-only (not exercised live):** the logged-in /digest flow's
  MarketJuice.recordEvent call from the game module (needs a consented
  kid login; the recordEvent server path itself is fully covered by the
  smoke test). Spot-check after deploy with a real kid account.

**⚠️ Deliberate immutability exception (flagged):** today's (2026-06-12)
daily_digests row was patched ADDITIVELY via jsonb_set to carry a reserve
puzzle (Starbucks/SBUX, recorded to rotation) — kid-visible content
untouched, and the deployed prod template ignores the unknown field. Done
so guest play could be verified against a real daily row, and so tonight's
kids get a puzzle the moment Phase 16 deploys. From tomorrow, generation
bakes the puzzle in normally.

**Open / future:**
- Glossary nominations from the deleted DATE_OVERRIDE test row remain in
  pending_glossary (3 real terms, admin-gated — harmless).
- Spot-check the logged-in MC award path on prod after deploy.
- Phase 22's Headline-or-Hoax anonymous stat will want the same
  aggregate-events query pattern this phase avoided (nothing blocking).

---

## Session: Phase 16 follow-up — share-grid channel tag + Web Share API

Two small follow-ups to the Mystery Mover share flow (`public/games/
mystery-mover.js`):

1. **`?src=mm-share` appended to the share URL** — a channel tag, identical
   for every user (NOT an identifier), so share-grid arrivals are
   distinguishable in logs/analytics. Share text is otherwise unchanged.
2. **Web Share API first, clipboard fallback** — `navigator.share` when
   available gives mobile the native share sheet with the grid pre-filled
   ("Shared! 🍊" on success); a cancelled sheet (AbortError) leaves the
   button usable; any other share error falls back to the clipboard copy,
   which remains the desktop path.

`public/sw.js` → **v6** (mystery-mover.js is a precached shell asset).
`scripts/test-mystery.js` gained Section 6.5 (3 assertions, now **78
total**): the builder lives in the client IIFE, so the test asserts against
the module source — tagged URL present, Web Share + clipboard fallback both
present, and the share builder's inputs are identifier-free
(label/solved/cluesUsed only).

**Verified live** (preview browser on /sample): clipboard fallback payload
captured via a writeText stub — carries `?src=mm-share`; Web Share branch
exercised via a `navigator.share` stub — cancel (AbortError) leaves the
button usable, success shows "Shared! 🍊" with the tagged text. The v5→v6
SW handoff was also observed working (old cache reaped, new module served
on the next load) — good real-world confirmation of the version-bump
mechanism for installed PWAs. Real mobile share sheet: check on a phone
after deploy (headless has no native sheet).
