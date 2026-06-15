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

**Morning-run alert (Telegram, `src/notify.js`).** The 7 AM cron sends exactly ONE outcome notification per run: a ✅ success ping on a clean run (`<date> (<edition>) generated · <sent>/<total> teasers sent to <kids> kids`), or a ❌ failure alert if generation threw OR the fan-out was skipped/errored. The failure alert is actionable — date, edition, stage, the error message, and for a JSON parse error the **byte position + a ±60-char snippet** (the thrown error is enriched in `ai.js`'s `jsonParseError`). This is the detection backstop behind three silent morning failures (truncated JSON, stale-disk teaser, trailing prose after JSON): the cron correctly skips the fan-out on failure, but that silence used to look identical to success. Reuses the same Telegram bot + chat as the `railway-health-check` task. **Config:** `TELEGRAM_BOT_TOKEN` (must be set in Railway to enable — inert/no-op if unset), `TELEGRAM_CHAT_ID` (defaults to the ops chat `8618800483`), `ALERT_SUCCESS_PING` (default ON; set `false` to alert only on failures). All sends are wrapped so a notification failure can never crash generation or the fan-out.

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
| `GET /admin?key=<ADMIN_KEY>` | query param | Server-rendered admin dashboard (Phase 13). Includes the **Glossary Nominations** review card (`src/admin.js`). Fails closed when `ADMIN_KEY` is unset. |
| `POST /api/admin/glossary/:id/approve?key=<ADMIN_KEY>` | query param | Approve a `pending_glossary` nomination (optionally editing term/definition/principle via the inline form). Flips `status='approved'`, refreshes the in-process glossary view so the term goes live to kids immediately, redirects back to `/admin`. urlencoded body, parsed route-locally. Same fail-closed `ADMIN_KEY` gate as `/generate`. |
| `POST /api/admin/glossary/:id/reject?key=<ADMIN_KEY>` | query param | Reject a nomination (`status='rejected'`; row kept so it isn't re-nominated into the queue). Redirects back to `/admin`. |
| `GET /api/mystery/today` | none | Phase 16 — today's Mystery Mover clues (never the answer/name/ticker/acceptableAnswers). Public by design: powers guest play on `/sample`. 404 on pre-Phase-16 rows → the client hides the section. |
| `POST /api/mystery/guess` | none | Phase 16 — checks one free-text guess server-side (normalized vs name + ticker + acceptableAnswers). Stateless (nothing stored per guest), rate-limited 30/min/IP. Clue pacing is client-side — the server only protects the ANSWER. |
| `POST /api/picks` | session cookie | Phase 17 — Tomorrow's Call. Body `{choice: green\|red}`; everything else computed server-side: target_date = the BLIND-PICK target (next trading day whose 9:30 AM ET open is still future at POST time — recomputed authoritatively even if the page rendered pre-open; the response carries the real targetLabel). UNIQUE `(user_id, kind, target_date)` = one bet per market close (closes the Sat+Sun double-bet on Monday); duplicate → 409. Fires `prediction-made` server-side on a real insert. |
| `POST /api/weekly-hold` | session cookie | Phase 20a — Weekly Hold. Body `{ticker}`, validated against the digest's 3 server-baked candidates + the blind-pick window (locks at the week's first trading-day open). UNIQUE `(user_id, kind='weekly-hold', target_date=week's-last-trading-day)` = one pick per week. Fires `weekly-hold-pick` on a real insert. |
| `GET /api/push/public-key` | none | Phase 15 — returns `{ key }` (the VAPID public key) or 404 when push is unconfigured. Served from an endpoint (not baked into `pwa.js`) so key rotation is an env-var change, not a deploy + SW cache bump. |
| `POST /api/push/subscribe` | session cookie | Phase 15 — stores the kid's `PushSubscription.toJSON()` in `users.push_subscription` (validates endpoint + keys shape; column already in the COPPA scrub). |
| `POST /api/push/unsubscribe` | session cookie | Phase 15 — clears `users.push_subscription` (explicit in-app opt-out; uninstall/revoke is handled by the 404/410 cleanup in `src/push.js`). |
| `POST /api/cron/send-push` | `X-Cron-Secret` header | Phase 15 — external trigger for the morning push sweep. Safe to re-run: `push_log` dedups per kid per day. The in-process hourly cron (minute 5 UTC) also fires this sweep. |
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
| `generate.js` | **Idempotent** digest generator. Checks `daily_digests` DB first; if today's row exists, writes to disk and returns. Otherwise: full pipeline → INSERT → disk. **Glossary:** on a real INSERT only (never the cached-replay path), persists the filtered `glossaryNominations` via `storage.nominateGlossaryTerm`; both paths call `refreshActiveGlossary()` before building HTML. |
| `data.js` | FMP `/stable/` API client. `fetchMarketData`, `fetchNews`, `fetchMovers`, `fetchPriceSnapshot` (per-ticker fan-out over the curated core — the bulk of daily spend), `pickTopMover` (pure: largest abs % move from a snapshot), `fetchTopMover` (back-compat wrapper), `fetchQuotes`. `fetchAllData` runs the fan-out ONCE and returns both `topMover` and the full `priceSnapshot` (Phase 21 — persisted into `daily_prices`, zero extra calls; runs every day incl. week-ahead Monday). All ticker fetches use **per-ticker fan-out** (FMP free tier doesn't support multi-ticker batch — the cap-pressure cue for the deferred paid tier). Tolerates `changePercentage` ↔ `changesPercentage` field rename. |
| `ai.js` | Claude API calls. Three exports: `generateContent` (main digest with web_search), `reframeBullBear` (bull-bear narrative), `reframeTimeMachine` (time-machine framing). `generateContent` routes between three internal prompt builders (`buildStandardPrompt`, `buildWeeklyWrapPrompt`, `buildWeekAheadPrompt`) based on `opts.edition.editionType` from calendar.js. **Lazy client init** (deferred `new Anthropic()` so dotenv has run). Includes `PROFANITY_RULE` in all prompts + `scrubProfanity()` regex pass on all output. Phase 12 added `PARENT EXPLAINER RULES` to each builder — every content section (stories, bigPicture, wordOfDay, didYouKnow, quiz) carries a `parentExplainer: { summary, conversationStarter }` object consumed by the evening parent recap email. **Glossary auto-grow:** all three builders inject `glossaryNominationBlock()` (current `knownTermList()` + rules) and a `glossaryNominations` schema field; `generateContent` runs the model's nominations through the exported `filterGlossaryNominations()` (drops already-known/malformed, normalizes principle, caps at 5) before returning. Rides the existing call — no extra API request. |
| `calendar.js` | Edition type resolver. NYSE holiday calendar, day-of-week detection, `DATE_OVERRIDE` env-var support for testing. Exports `getEditionType()`, `getEditionDate()`, `isMarketHoliday()`, `getLastTradingDay()`, `getNextTradingDay()` (Phase 17 — next trading day INCLUSIVE of the given date), `getNextTradingOpen()` (Phase 17 — the blind-pick target: next trading day whose 9:30 AM ET open is still future at the given instant), `getFirstTradingDayOfWeek()` / `getLastTradingDayOfWeek()` / `isWeeklyHoldOpen(now, basisDate?)` / `isoWeekMondayMs()` / `weeklyHoldBasis()` (Phase 20 — Weekly Hold week boundaries, honoring holiday-Monday → Tuesday open and Good-Friday → Thursday close; `weeklyHoldBasis` shifts a Sunday date forward to the upcoming Monday so the Sunday-window amendment keys off the active week, and `isWeeklyHoldOpen` takes that basis to gate the lock), `getHolidayName()`, plus `MARKET_HOLIDAYS` for 2026–2027. |
| `games.js` | Daily Challenge orchestrator. Deterministic 8-day rotation picker, per-game hydrators, falls back to canned content on AI/FMP failure. Two AI calls max per day (bull-bear + time-machine reframers, in parallel). |
| `template.js` | Builds digest HTML. **Edition-aware framing** (driven off `content.editionType`): renders an `.edition-framing` subtitle under the `editionLabel` ("Looking back at this past week 📋" on weekly-wrap, "Here's what to watch this coming week 🔮" on week-ahead, nothing on standard) so the backward/forward orientation is unmistakable. **Mover label resolver** (`resolveMoverSpec`): a single function keyed on `editionType` picks the gold scoreboard card's label + data source — `TODAY'S MOVER` / `WEEK'S BIGGEST MOVER` from `scoreboard.topMover` on standard/weekly-wrap; `ONE TO WATCH` from the OPTIONAL `content.oneToWatch` on week-ahead (renders no card at all when `oneToWatch` is absent — quiet-week behavior). Backward `Why X moved:` / forward `Why watch X:` callouts under the vibe bar flow from the same spec. `opts.kidName` (Phase 7) drives a personalized greeting + Log out pill in the header. `opts.digestDate` (Phase 11) injects `window.__digestDate` for event tracking. `opts.isSample` (Phase 12) suppresses the 💬 "Ask my parent" buttons on `/sample`. **Glossary tap-to-reveal:** `makeGlossaryLinker(view)` (exported for tests) wraps the FIRST occurrence of each known term across the whole digest in a tappable tooltip, walking sections in teaching order (big picture → scoreboard prose → stories → did-you-know → word-of-day). Operates on the raw field text and escapes inside the linker (so "S&P 500" matches cleanly and there's no tag-injection path); longest-first matching via the active view's `MATCHABLE_TERMS`; word-of-day self-skip; inline CSS (locked to `glossary-demo.html`) + a vanilla tap/keyboard toggle. Gated off via `opts.glossary === false` (default ON); renders on `/digest` AND `/sample`. The term source is `glossary-runtime.getActiveGlossary()` (seed + approved DB rows). **Scoreboard tiles:** the three index tiles (S&P 500 / Nasdaq / Dow Jones) are ALSO always tappable every digest — `scoreboardGloss(view, term, enabled)` (exported) resolves each tile's definition via the same `view.lookup()`, independent of the prose first-occurrence pass (tiles never touch the linker's seen-set, so tile + prose for the same term both work). Tapping a tile expands a full-width drawer (`.score-gloss-panel`) below the scoreboard row (not the prose `.tip` bubble, which clips on a small tile); affordance is a dotted underline + ⓘ on the index name; lookup-miss → plain tile. One unified client controller (`.gloss, .score-card.tappable`) keeps one-open-at-a-time across tiles AND prose. | Renders Daily Challenge picker, handles `isSample` flag (gold SAMPLE banner + chip), renders `editionLabel` subtitle for Weekly Wrap / Week Ahead editions. Brand-mark PNG lockup in the header (Phase 12 follow-up). 💬 buttons inserted after stories, big-picture, did-you-know, word-of-day (server-rendered) + quiz (client-injected post-answer). On Sunday, mounts the Sunday Challenge container + loads `public/games/sunday-challenge.js`; falls back to the deprecated `weeklyChallenge` card if a cached row predates the Sunday Challenge launch. |
| `progress-template.js` | Phase 11. `buildProgressHTML(state, opts)` renders the `/progress` page — 6 sections: profile header, How Market Coins Work explainer, 12-rank ladder, 6-family badge grid, 4 personal records, Emergency Fund status. Pure function, no DB access — caller supplies the state from `engagement.getProgress()`. Inline CSS, matches the digest design system (Phase 19 "Morning Juice" light theme — Fredoka display / Lexend body / Space Grotesk numerals; same token aliases as `template.js`). |
| `engagement.js` | Phase 11 — **server-side engagement engine**. Exports `ensureProgress(userId)` (idempotent row creation), `getProgress(userId)` (full state for the API + `/progress`), `recordEvent(userId, eventType, eventData)` (the single mutation entry point — handles streak progression, Perfect Day, rank-up detection, badge tier checks, personal record updates, all in one transaction). Phase 12 added the dedup gate (`isDuplicate` — extended for `parent-question`), the `parent-question` event-type fall-through (0 MC, no progression mutations, just logs), and read helpers `getDailyEngagementSummary(userId, digestDate)` + `getParentQuestionsForDate(userId, digestDate)` for the evening recap email. |
| `progression.js` | Phase 11 — canonical constants (RANKS, MC_AWARDS, BADGE_FAMILIES, PERSONAL_RECORDS, SHIELD_CONFIG, EVENT_TYPES). Server is canonical; `public/progression-config.js` mirrors. Helpers `rankForCoins(mc)`, `shieldsUnlocked(rankKey)`. Phase 12 added `'parent-question'` to EVENT_TYPES. |
| `db.js` | pg Pool, **lazy-initialized** (same dotenv timing pattern). Exports `pool` (Proxy), `query`, `getClient`, `healthCheck`. |
| `digest-store.js` | `todayNY()`, `getDigestForDate()`, `getTodaysDigest()`, `saveDigest()`. The `saveDigest` helper is the immutability lock — `INSERT … ON CONFLICT DO NOTHING` ensures today's row can never be overwritten. |
| `storage.js` | Postgres-backed user/token/deletion helpers. Async throughout. `createUserFromSignup` accepts `username` + `password_hash` (Phase 7). `recordDeletionRequest` scrubs PII columns on the matched `users` row in the same transaction as the soft-delete (Phase 10 — COPPA compliance). Phase 11 extended the transaction to also DELETE from `user_progress`, `engagement_events`, `user_badges`, `personal_records` (covers `parent-question` rows too — no separate Phase 12 scrub needed); later phases added `push_log`, `user_picks`, and Phase 21's `user_watchlist` + `user_watchlist_prefs` (`daily_prices` is market data → untouched). **Glossary auto-grow:** `nominateGlossaryTerm` (insert-or-bump via `ON CONFLICT (LOWER(term))`), `getPendingGlossary`, `getGlossaryByStatus`, `approveGlossaryTerm` (edits allowed on approve), `rejectGlossaryTerm`. These rows are market vocabulary, **not PII** — intentionally untouched by the deletion scrub. |
| `glossary.js` | The 44-term kid-facing seed glossary (term → `{ def, principle, aliases }`). Exports `GLOSSARY`, `lookup()`, `isKnownTerm()`, `knownTermList()`, `MATCHABLE_TERMS` (every term + alias, sorted longest-first). Canonical for repo-shipped terms; consumed (never rewritten) by the template, the nomination gate, and the runtime merge. |
| `glossary-runtime.js` | The LIVE merged glossary view = seed + admin-approved `pending_glossary` rows. `getActiveGlossary()` (synchronous — safe on the render path) returns the cached merged `{ MATCHABLE_TERMS, lookup }`; `refreshActiveGlossary()` (async, lazily imports storage) rebuilds the cache out-of-band — on boot, after each real generation, and right after an admin approval. Approved rows ≤14 days old get the "NEW" tag. Seed-only until the first refresh, so tooltips work with no DB. |
| `migrations/add-pending-glossary.sql` | Forward-only migration: creates `pending_glossary` (+ unique index on `LOWER(term)`, status index). `runBootMigrations()` applies it idempotently when the table is absent; also in `schema.sql`. |
| `migrations/add-auth-columns.sql` | Phase 7 forward-only migration: adds `username` + `password_hash` columns to `users`, partial unique index on `LOWER(username)`, expands `verification_tokens.purpose` CHECK to include `password_reset`. server.js runs this on boot if the columns are missing — also kept here for manual one-shots. |
| `migrations/add-engagement-tables.sql` | Phase 11 forward-only migration: drops the never-populated `engagement` placeholder; creates `user_progress`, `engagement_events`, `user_badges`, `personal_records`. server.js' `runBootMigrations()` applies idempotently when it detects `user_progress` is missing. |
| `content-history.js` | Rotation guard for AI picks — kinds `word`, `fact`, `mystery` (Phase 16). Generic `getRecent(kind)` / `record(kind)`, **Postgres-backed as of Phase 16** (`content_history` table — the old `state/content-history.json` wart is gone; survives Railway restarts). Both exports are **async** now. Fails soft: a history hiccup shortens the avoid-list, never fails generation. |
| `mystery.js` | Phase 16 — Mystery Mover engine. `pickMysteryCompany` (deterministic day-seeded pick from the curated 75, 30-day no-repeat), `buildClue5` (the "first letter + ticker length" clue is COMPOSED server-side, never trusted to the model), `validateMysteryMover` (the name-leak HARD GATE — clues 1–4 may not contain any whole-word token of the company name, the 2+-letter ticker, or ANY acceptable answer's words; same logic as the Match-game guardrail via `name-leak.js`), `finalizeMysteryMover` (validate-or-fallback: any failure swaps in a deterministic pick from the 12-puzzle reserve pool — a leaky puzzle can never reach the immutable row), `isCorrectGuess` (normalized free-text matching). |
| `mystery-reserve.json` | Phase 16 — 12 hand-written reserve puzzles spanning 5+ sectors, every one guardrail-validated in `scripts/test-mystery.js`. Lives under `src/` (NOT `public/data/`) because it contains ANSWERS and `public/` is statically served. Reserve-shipped tickers enter rotation history like AI ones. |
| `name-leak.js` | Phase 16 — shared token normalization + leak detection (`nameWords`, `textTokens`, `leakingWords`, `normalizeAnswer`), extracted from `scripts/test-company-models.js` so the Mystery clue gate and the Match dataset test run identical logic. Pure, no I/O. |
| `migrations/add-content-history.sql` | Phase 16 forward-only migration: creates `content_history`. Boot-applied idempotently; also in `schema.sql`. Old state file deliberately not migrated (it was ephemeral). |
| `emails.js` | Email renderers (pure) + `sendEmail` (Resend SDK). Seven types: verify, consent, welcome, deletion-ack, daily teaser, password-reset, **Phase 12 evening recap** (`renderEveningRecap` with `recap` + `nudge` variants). Private helpers `getExplainerForSection`, `fillKidName`, `pickTonightStarters`, `gameLabel`. Stub-mode fallback if `RESEND_API_KEY` is missing. |
| `push.js` | Phase 15 — Web Push engine. Lazy VAPID init (env read at call time, macOS-launchd safe; all keys unset = fully inert). Copy builders `buildMorningPush` (edition- + vibe-aware, incl. mixed) / `buildStreakRiskPush` (factual, no guilt). `tryLogPush` reserves a `push_log` slot BEFORE sending (unique index = per-kind daily dedup; SQL COUNT guard = hard 2/day cap); `deletePushLog` releases the slot on a transient send failure so it isn't consumed. `sendPushToUser` clears `users.push_subscription` on 404/410 (dead subscription). `sendMorningPushes` — hourly timezone sweep over each user's **7–9 AM local window** (NOT generation time — a 7 AM ET blast would hit west-coast kids at 4 AM), gated on today's digest row + a NOT EXISTS check against today's morning ledger row; runs at minute 5 so the 7 AM ET tick never races the 7:00 generation cron. The 8:05/9:05 ticks are catch-up for late generations (Phase 18's 7:10/7:25 retry ladder makes those routine) — the ledger guarantees exactly one morning push per kid per day; past 9 AM local the digest day is simply missed (no mid-morning buzz). Known edge: kids whose whole 7–9 AM local window precedes 7 AM ET generation (e.g. Europe) find no digest row yet and skip that day. `shouldSendStreakRiskPush` (Phase 17) — the push gate, DECOUPLED from the email's "engaged" flag: streak ≥ 3 AND no streak-EXTENDING event today (lastStreakDate !== today; only games + Mystery Mover move it) — a kid who only tapped a Tomorrow's Call pick gets no nudge email but their streak still dies at midnight, so the push still fires. `sendStreakRiskPush` adds the no-push-today gate + cap; called from `sendEveningRecaps`'s loop BEFORE the email variant fork. |
| `migrations/add-push-log.sql` | Phase 15 forward-only migration: creates `push_log` (+ unique index on `(user_id, kind, digest_date)`). `runBootMigrations()` applies it idempotently when the table is absent; also in `schema.sql`. |
| `picks.js` | Phase 17 — Tomorrow's Call engine. `createPick` (server-clock blind-pick target via `calendar.getNextTradingOpen`; `now` injectable for tests), `getPickState` (per-request card payload: currentPick keyed by target_date so Sunday shows Saturday's Monday-bet locked, live targetLabel, caption kind pre-open/post-open/closed, running record, last-trading-day verdict), `resolveTomorrowCalls` (the 7 AM sweep — NEVER throws, runs on BOTH fresh + cached-replay generation paths, fetches its own single ^GSPC quote; resolution is FACTUAL FMP data, not Claude's marketVibe; changePct >= 0 → green; atomic claim via `resolved_at IS NULL`; per-row isolation; straggler fallback via FMP historical EOD, fail-soft), `resolvePicksForDate` (injectable close for tests), best-prediction-streak record updates. pg DATE columns normalized via dateColToString (the String(Date) trap). **Phase 20a also here:** `createWeeklyHoldPick` (blind-pick gate `isWeeklyHoldOpen` — locks at the week's FIRST trading-day open; target = the week's LAST trading day = the one-per-week key), `getWeeklyHoldState` (card phases pick/locked/verdict/closed/null — null for a kid who never picked, no error), `resolveWeeklyHolds` (Saturday sweep, parallel to resolveTomorrowCalls in the same isolated never-throws seam, every path; each candidate's first-trading-day-OPEN → last-trading-day-CLOSE return from FMP full OHLC; +20 if the pick beats BOTH others, else +5), `resolveWeeklyHoldsForTarget` (injectable returns for tests). |
| `watchlist.js` | Phase 21 — Watchlist data + logic. `persistDailyPrices` (upsert the snapshot at generation), `addWatchlist` / `removeWatchlist` (cap-3, curated-membership, baseline price, server-enforced per-company 7-day cooldown keyed off each row's `followed_since`), `recordMilestone` (spoof-proof: re-checks the % server-side, advances `milestone_hit`), `recordOffer` (offer state machine: shown/skipped/declined), `getWatchlistState(userId, digestDate, content)` → the per-request render model (held + 3 learning layers + ghost slots + offer), `matchInNews` (Layer-1 false-positive-safe matcher: structured mover-ticker, else full-NAME word-boundary scan excluding `AMBIGUOUS_TICKERS`). pg DATE cols cast `::text` (the String(Date) trap). No engagement coupling. |
| `watchlist-ui.js` | Phase 21 — shared Watchlist UI (digest + /progress): `watchlistCard(state, esc, principles)`, `watchlistPicker(esc)` (categorized tap-to-select; typeahead FILTERS only — no free text), `WATCHLIST_CSS`, `WATCHLIST_CONTROLLER` (inline, inert when `#watchlist-card` absent → /sample-safe; mutations reload for authoritative re-render). |
| `weekly.js` | Phase 20a — Weekly Hold. `pickWeeklyHoldCandidates` (STATELESS, deterministic by ISO-week index — a fixed shuffle of the curated 75 strided 3/week → ~25-week non-repeating cycle; server-picked like Mystery Mover so the curated-75 + immutability invariants hold), `finalizeWeeklyHold` (merge the 3 candidates with Claude's cases, canned fallback per company), `weeklyHoldBlock` (the prompt block, injected on BOTH the week-ahead and the Sunday weekly-wrap builders). Candidate selection takes the `weeklyHoldBasis(today)` date so Sunday and Monday yield identical candidates. Resolution + card-state (basis-aware) live in `picks.js`. |
| `digest-schema.js` | Phase 18b — zod validation of the AI digest (`validateDigest(content, edition)`), the strict edition-aware gate behind the loose `emit_digest` tool schema. Encodes the codebase rules the ROADMAP spec missed: 2–3 standard stories, optional oneToWatch, `bigPictureParentExplainer`, finalized-mystery shape. Returns human-readable error lines that feed the repair-retry prompt and the Telegram ❌. |
| `morning-run.js` | Phase 18c — `runMorningPipeline`: the 7:00→7:10→7:25 retry ladder. ONE handler (not three cron entries — the fan-out has no per-recipient ledger; a second entry after a 7:00 success would double-email every parent). Fan-out exactly once after the first success; one ✅ (noting the attempt when >1) or one ❌ (listing every attempt's error + validation errors) per morning. All collaborators injectable for the offline smoke test. Trade-off: in-process timers die on container restart — the boot bootstrap is itself a generation retry. |
| `migrations/add-user-picks.sql` | Phase 17 forward-only migration: creates `user_picks` (+ UNIQUE `(user_id, kind, target_date)` + partial unresolved index). Boot-applied idempotently; also in `schema.sql`. |
| `companies.js` | ~81-company curated kid-recognizable core list. Each entry has `ticker`, `name`, `sector`, and a kid-legible `category` (Phase 21 picker bucket). `CURATED_TICKERS` / `lookupCompany(ticker)`; Phase 21 adds `WATCHLIST_CATEGORIES` (ordered picker buckets), `followableCompanies()` / `isFollowable()` / `followableByCategory()`. **Today followable == core** (all entries); the deferred premium tier adds expanded-universe entries flagged `core: false` (editorial keeps using `CURATED_TICKERS`, the picker shows everyone). |
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
| `games/mystery-mover.js` | Phase 16 — Mystery Mover client. Self-mounting (NOT in the Daily Challenge picker — its own section, 7 days/week, on `/digest` AND `/sample`). Hydrates from the public `/api/mystery` endpoints; clue pacing client-side (a wrong guess auto-unlocks the next clue), 5 guesses max; per-day localStorage state (`mj-mystery-<date>`). Logged-in finish → `MarketJuice.recordEvent('mystery-mover-played', {digestDate, solved, cluesUsed})`; on `/sample` → signup CTA instead. Share grid: `🟧×(cluesUsed−1)+🟩` (or `🟥×5`) + date + `themarketjuice.com/sample?src=mm-share` (the `src` is a channel tag, identical for all users — not an identifier). Uses the Web Share API when available (mobile native sheet; a cancelled sheet leaves the button usable) with clipboard copy as the fallback/desktop path. Zero identifiers. Section hides itself on API 404 (pre-Phase-16 rows). |
| `games/sunday-challenge.js` | Sunday Challenge renderer. Single entry point (`window.MJGames.sundayChallenge.render`) dispatches to 4 sub-renderers (trading-floor, ceo, investathon, dilemma) based on `data.type`. Reads `sundayChallenge` from the digest JSON, calls `MarketJuice.recordEvent('sunday-challenge-completed', {type, digestDate, bonus})` on completion. Replay-safe via `mj-sunday-challenge-<date>` localStorage flag. |
| `data/company-models.json` | 57 companies for Match + Price-is-Right. Each `shortModel` (the clue the kid matches to a name) must NOT contain the company's own name or any significant name-word — that would let the kid match by spotting the word instead of reasoning. Enforced by `scripts/test-company-models.js`. |
| `data/time-machine-prices.json` | 7 verified Time Machine scenarios. |
| `data/historical-charts.json` | 10 verified Bull-or-Bear scenarios. |
| `data/sample-digest.json` | Static curated sample. Served by `/sample`. Edit manually to refresh. |
| `manifest.webmanifest` | PWA manifest, `start_url: /digest`. |
| `sw.js` / `pwa.js` | Service worker + add-to-homescreen UX + push (Phase 15). `sw.js`: push handler renders `{title, body, url, tag}` payloads (distinct tags `mj-morning`/`mj-streak` so the kinds don't collapse onto each other); cache prefix `mj-`, version **v6** (Phase 16 added `games/mystery-mover.js` to the shell; v6 = the share-flow follow-up). `pwa.js`: fetches the VAPID key from `/api/push/public-key`; the permission ASK is a soft banner gated on the kid's **3rd active day** (`progress.activeDays` from the `mj:state-loaded` event engagement.js fires) — never the native prompt on load, never on first visit, never the same visit as the install banner (install takes priority). Silent re-subscribe on load when permission is already granted. iOS requires standalone; Android Chrome subscribes in-tab. |
| `icons/logo.png` | Citrus + chart brand mark — transparent-bg PNG, 1024×1024. The hero lockup on `landing.html` references this directly via `<img src="/icons/logo.png">`. Sized in CSS, not pre-resized. |
| `icons/icon.svg` / `icons/icon-maskable.svg` | PWA app icons (the chart-on-navy mark used on home screens). Separate from the brand mark — different concept, different use. |

### Scripts (`scripts/`)

| File | Role |
|---|---|
| `run-schema.js` | Apply `src/schema.sql` to Neon. Idempotent. |
| `inspect-db.js` | Print recent rows across all tables. |
| `test-games.js` | Hydrate daily-challenge games standalone. Flags: `--ai`, `--fmp`, `--date YYYY-MM-DD`. |
| `test-glossary.js` | Glossary smoke test (pure/offline, no DB/secrets). Covers longest-first matching, first-occurrence-only, alias resolution, word-of-day self-skip, principle tie-in, tag/markup safety, the kill-switch, the seed+approved merge, and `filterGlossaryNominations`. |
| `test-company-models.js` | Match-game guardrail (pure/offline). Scans every `company-models.json` entry and fails if a `shortModel` leaks the company's own name or a significant name-word (possessive- and parenthetical-aware, word-boundary token match, not naive substring). The detection logic itself lives in `src/name-leak.js` as of Phase 16 (shared with the Mystery clue gate); this script imports it. Inline `ALLOWLIST` (starts empty) for common-word coincidences. |
| `test-theme.js` | Phase 19 smoke test (pure/offline). Renders the sample fixture through `buildHTML` across all five header states; asserts the vibe wash + pill, SVG section icons (not emoji), starfield gone, fonts (Lexend/Space Grotesk + `display=swap` + preconnect), the preserved `[data-theme="dark"]` block, cream theme-color, and a source-scan that no light `:root` retains stray dark navy hex (guards a half-migration). |
| `test-mystery.js` | Phase 16 smoke test (75 assertions). Pure: guardrail rejects leaky clues (name/possessive/ticker/alias — non-vacuous), clue-5 composer, all 12 reserve puzzles guardrail-clean + sector spread, deterministic rotation pick, finalize/fallback, guess normalization. Live Neon (throwaway users, cleaned up): content_history round-trip + 30-day window, MC by cluesUsed + 99→5 clamping + per-digestDate dedup, mystery extends streak, Perfect Day in BOTH orderings (mystery-third + game-third), and CLASSIC-path regressions (3 games no-mystery fire Perfect Day exactly once; a game still extends the streak). |
| `test-push.js` | Phase 15 smoke test (39 assertions). Pure: copy builders for every edition/vibe (incl. mixed) + no-guilt check. Live Neon (throwaway user, fully cleaned up): push_log dedup + 2/day cap + transient-failure slot release, 404/410 subscription cleanup (injected fake sender — no real push service contacted), `sendStreakRiskPush` gates end-to-end, the morning sweep's 7–9 AM window (late-digest catch-up at 8, no double-send at 9, closed at 10 — drives the REAL gate SQL scoped via `opts.onlyUserId` with simulated Etc/GMT timezones), `activeDays` counting, COPPA scrub covers `push_log` + `push_subscription`. Needs today's digest row (fails loudly with instructions otherwise). |
| `test-picks.js` | Phase 17 smoke test (46 assertions). Pure: the blind-pick matrix (7 AM/9:29/9:31/evening, weekends, holiday Mondays), labels, captions. Live Neon (throwaway users, cleaned up): one-bet-per-close dedup incl. Sat+Sun→same-Monday duplicate and the 9:29/9:31 race producing two targets, resolution with injected closes (+5/0 MC, idempotent re-runs, flat day → green), best-prediction-streak record, pick=engaged-not-streak / resolution=MC-only semantics, getPickState card payload, scrub coverage. |
| `test-watchlist.js` | Phase 21 smoke test (~60 assertions). Pure: curated universe + categories, the Layer-1 matcher battery (Block/Snap/Unity/Reddit/Target/Visa do NOT match free text; distinctive names + exact mover-ticker DO; bare tickers never match), relative-date labels. Live Neon (throwaway users + dated `daily_prices` fixtures, cleaned up): follow cap-3 + membership + baseline, per-company 7-day cooldown + independence, since-% + milestone first-crossing + idempotent re-POST + spoof rejection, the offer state machine (first-run → skip → re-nudge once → cap; declined never re-nudged), empty/1/2/3 render models, COPPA scrub of `user_watchlist` + `user_watchlist_prefs`. |
| `test-weekly.js` | Phase 20 smoke test (65 assertions). Pure: candidate selection (deterministic, no consecutive overlap), finalize (canned fallback), week boundaries (holiday-Monday + Good-Friday edges). Live Neon (throwaway users, cleaned up): one-pick-per-week dedup + blind-pick gate, resolution +20/+5 with all-3-returns + win flag + idempotent re-run, engagement semantics (pick=engaged-not-streak, resolved=MC-only), getWeeklyHoldState phases incl. the no-pick-kid graceful null, getWeekStats incl. the mid-week / 0-of-0 guard, scrub coverage. **Section 10 (Sunday-window amendment):** `weeklyHoldBasis` shift, Sun≡Mon candidates + target_date, lock stays at Monday open, the load-bearing Sun-then-Mon dedup (no double-pick), holiday-Monday week. |

### Ephemeral state (gitignored)

- `state/content-history.json` — **obsolete as of Phase 16** (rotation history moved to the Postgres `content_history` table). A leftover file on disk is simply ignored.

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
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Push notifications (Phase 15) | Generate with `npx web-push generate-vapid-keys`. Unset = push fully inert. |
| `VAPID_SUBJECT` | Push notifications | Optional; defaults to `mailto:hello@themarketjuice.com`. |

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

### Step 2 — Generate content (`src/ai.js#generateContent`) — TWO-PASS as of Phase 18

The three historical morning failures (max_tokens truncation, stale-disk teaser, trailing prose after JSON) shared one root cause: a single call doing research + writing + strict serialization at once. Phase 18a split it:

- **Pass 1 — research** (`runResearchPass`): `claude-sonnet-4-6` + `web_search`, **free-text brief** — no JSON requested, cannot parse-fail. Edition-forked goals (standard: today's top stories; weekly-wrap: the week's arc + Sunday Challenge raw material; week-ahead: scheduled catalysts + oneToWatch candidates) + **Mystery Mover company facts** (pass 2 has no search — clue quality depends on this). Core rule: carry EVERY figure with its source. **Sanity gate** (`assertBriefUsable`, ≥500 chars): a hollow brief is a pass-1 FAILURE that feeds the retry ladder — never handed to pass 2, where it would yield a structurally-valid but substantively-empty digest zod can't catch.
- **Pass 2 — write** (`runWritePass`): **NO web search.** Brief + FMP data + edition rules in; the digest arrives as a **forced `emit_digest` tool call** (`tool_choice: {type:"tool"}`) — the API returns parsed structured input: no fences, no trailing prose, no stray braces. A `max_tokens` stop is an explicit detectable failure. Hard rule in the prompt: use only figures present in the brief. Search-free → the validation repair retry re-runs ONLY this pass.
- **Post-processing**: cite-strip (defensive) + `scrubProfanity` (recursive) + `filterGlossaryNominations` + the Phase 16 `finalizeMysteryMover` (name-leak gate + reserve fallback — puzzle problems are fixed by the cheap deterministic fallback, never by the repair retry).
- **Validation (Phase 18b)**: `src/digest-schema.js#validateDigest` (zod) — the strict edition-aware gate (2–3 stories standard / exactly 2 wrap + ahead, enums, principle 1–11, parentExplainer everywhere incl. the `bigPictureParentExplainer` quirk, finalized mysteryMover shape, sundayChallenge on Sundays, marketClosed on weekend editions, oneToWatch optional-by-design). On failure: ONE repair retry (pass 2 re-run with the errors appended), then throw with `.validationErrors` → retry ladder → Telegram ❌ listing the errors.
- The legacy text-parse path (`parseDigestJSON` / `extractFirstJSONObject` + cite-stripping) survives for the two game reframer calls.
- `opts._test = { research, write }` are injectable seams — the smoke test drives the repair loop offline.

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
  "topMover": {                                                              // standard + weekly-wrap ONLY (NOT week-ahead)
    "name", "ticker", "price", "change", "direction", "vibe", "reason",
    "principle": 1-11
  },
  "oneToWatch": {                                                            // week-ahead ONLY, OPTIONAL (omitted on quiet weeks)
    "name", "ticker", "catalyst", "reason", "principle": 1-11               // forward, catalyst-driven pick (e.g. earnings Wed)
  },
  "stories": [ 2-3 items: { "badge", "badgeLabel", "title", "body", "whyItMatters", "principle": 1-11 } ],
  "didYouKnow": { "fact", "category", "principle": 1-11, "principleConnection" },
  "quiz": { "question", "options": [4], "correctIndex", "explanation", "principle": 1-11 },
  "wordOfDay": { "word", "type", "context", "definition", "principle": 1-11 },
  "mysteryMover": {                                                            // Phase 16 — ALL editions (puzzle runs 7 days/week)
    "ticker", "name", "clues": [5 strings], "acceptableAnswers": [strings]    // company is SERVER-picked (30-day rotation); model writes
  },                                                                           // clues 1-4; clue 5 + validation + fallback in src/mystery.js
  "sundayChallenge": { "type", ...type-specific fields, "principle": 1-11 }   // Sunday weekly-wrap ONLY
                                                                              // type ∈ trading-floor | ceo | investathon | dilemma
                                                                              // Rotates weekly (week-of-year % 4). See src/ai.js#buildWeeklyWrapPrompt
                                                                              // and public/games/sunday-challenge.js for schemas/rendering.
}
```

**Edition variants:**

| editionType | Days | stories count | Story badges | Mover card | Framing subtitle | Special fields |
|---|---|---|---|---|---|---|
| `standard` | Tue–Sat (normal weekdays) | 3 (sometimes 2) | mixed | `TODAY'S MOVER` (from `scoreboard.topMover`) | — | — |
| `weekly-wrap` | Sun | exactly 2 | `WEEK'S BIGGEST`, `ALSO THIS WEEK` | `WEEK'S BIGGEST MOVER` (from `scoreboard.topMover`) | "Looking back at this past week 📋" | `sundayChallenge` (4-type rotation) |
| `week-ahead` | Mon, post-holiday | exactly 2 | `WATCH THIS WEEK`, `ALSO COMING UP` | `ONE TO WATCH` (from `oneToWatch`, **optional** — omitted on quiet weeks) | "Here's what to watch this coming week 🔮" | `oneToWatch` (optional, catalyst-driven) |

**Mover card label resolver (`src/template.js#resolveMoverSpec`):** A single resolver keyed on `editionType` picks the label + data source for the gold scoreboard card. Standard and weekly-wrap pull from the backward `scoreboard.topMover`; week-ahead pulls from the forward `content.oneToWatch` (an OPTIONAL object — when absent, the gold card is omitted entirely rather than falling back to stale Friday data). The same resolver feeds the "Why X moved / Why watch X" callout under the vibe bar.

**The week-ahead `oneToWatch` is conditional by design.** Claude is instructed in `buildWeekAheadPrompt` to populate it ONLY when there's a genuine, specific, scheduled, nameable catalyst in the coming week tied to a kid-recognizable company (a scheduled earnings report, a known product launch, a specific scheduled event). On quiet weeks Claude omits the field entirely — a missing card is correct and expected. The prompt includes GOOD/BAD examples and an explicit "never manufacture a reason to fill it" rule because models over-produce when given an open slot. `fetchTopMover` is skipped on the week-ahead path in `src/generate.js` (no backward `topMover` data feeds the week-ahead prompt). Post-launch watch item: spot-check a few quiet weeks to confirm `oneToWatch` is actually being omitted rather than always filled.

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

Self-contained: all CSS inline, Google Fonts (`Fredoka` + `Lexend` + `Space Grotesk`, `display=swap`), interactive quiz + games via inline scripts. Mobile-first with 600px media query. Apple PWA meta tags for iPad home-screen.

**Theme (Phase 19 "Morning Juice").** Warm-cream light theme. The `:root` holds the canonical palette under the spec's NEW token names (`--surface`/`--ink`/`--citrus`/`--sun`/`--up`/`--down`/`--berry` + four `--vibe-*` header washes); the OLD names the codebase wires through (`--card`/`--text`/`--green`/…) are ALIASED onto them, so every component (incl. `engagement.css`, `games/styles.css`) re-skins with no `var()` churn. **WCAG:** accents that fail as text on cream get darker `-text` variants (`--up-text`/`--down-text`/`--sun-text`/`--citrus-text`); `--green`/`--red` alias to the text variants, fills use the bright `--up`/`--down`. All body + secondary + accent text measured ≥4.5:1 live with the inspector. The header band carries a vibe wash keyed off `editionType`+`marketVibe` (`header--green/red/mixed/ahead`) + a state pill. Section-nav emoji → inline SVG line icons (`sectionIcon()`, citrus-tinted via `currentColor`). The full **dark theme is preserved verbatim under `[data-theme="dark"]`** — only the canonical tokens redeclare; aliases resolve through them — so the Phase 23 "Night Mode" unlock is a one-attribute flip.

**Readability tokens (2026-06 overhaul, fix-up).** Digest body-copy typography is driven off CSS custom properties in `:root`, tuned in ONE place rather than per element: `--body-size: 16.5px`, `--body-leading: 1.72` (line-height — the highest-impact value), `--prose-measure: 64ch` (max line length for flowing prose — Big Picture, story bodies, DYK fact — never scoreboard / challenge / mover layout components; sized to FILL the card content width with no right-side void, and it clamps to the card on narrow screens so mobile is near full-width), `--para-gap: 0.95em` (gap between paragraphs), and `--gloss-underline: rgba(255,122,26,0.45)` (softened dotted glossary underline; `text-underline-offset` stays 3px). The capped prose column is **left-aligned** under the heading.

> ⚠️ History: the first pass used `--prose-measure: 42ch` and did NOT actually break paragraphs, leaving a tall skinny column with a big empty right side. The fix-up widened the measure to 64ch and added real paragraphing (below).

**Paragraphing — word-preserving, two sources.** `makeGlossaryLinker(...).linkProse(field, {prefix})` renders a body field (Big Picture, story `body`, `whyItMatters`, DYK `fact`/`connection`) as one-or-more `<p>`. Paragraph boundaries come from `paragraphizeText()`: (1) if the model emitted blank-line (`\n\n`) breaks they're honored exactly; (2) otherwise a **safe display-time fallback** (`splitSentences()`) groups whole sentences into ~2–3-sentence paragraphs so already-stored rows (which have no `\n\n`) still read well. Both paths are strictly word-preserving — only `<p>` boundaries are inserted, never a word dropped/reordered/reworded. `splitSentences` is conservative: it won't split inside abbreviations (`U.S.`, `a.m.`, `Inc.`, `Dr.` — see `SENTENCE_ABBR`), decimals (`$4.2`), or single initials, and leaves a too-long single sentence whole. The glossary first-occurrence `seen` set spans all paragraphs (term linked in ¶1 stays plain in ¶3). `whyItMatters`/`connection` pass their inline label via `prefix` so it rides the first `<p>`. **New digests** get `\n\n` at generation time via `PARAGRAPH_RULE` in `src/ai.js` (a structure-only authoring directive added to all three edition prompts — same depth/length/voice, just chunked).

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
- **Dedup gate** — `recordEvent` checks `engagement_events` for prior same-day events per type (`(game, digestDate)` for games, `(digestDate)` for word-learned / sunday-challenge / mystery-mover-played / parent-question). Re-taps return `{ duplicate: true, mcAwarded: 0 }` and trigger a friendly "Already earned!" toast.
- **Mystery Mover (Phase 16)** — `mystery-mover-played` plays like a game: MC by clues used (25/20/15/10/5 solved, 0 unsolved — `cluesUsed` is client-reported but server-clamped, same trust model as quiz correctness), bumps `games_played`, extends the streak on the day's first play (shared `applyDailyPlayProgress`), and counts toward Perfect Day as the pseudo-game key `mystery-mover` (shared `checkPerfectDay` counts distinct keys across BOTH event types — whichever event lands the 3rd key fires the bonus). `correct_answers` stays picker-game-only. Counts as "engaged" for the evening recap/nudge fork and the Phase 15 streak-at-risk push gate.

- **Tomorrow's Call (Phase 17)** — `prediction-made` (server-fired by POST /api/picks on a real insert): 0 MC, counts as **engaged** for the recap-vs-nudge email fork (comparable to word-learned), deliberately does NOT extend the streak. `prediction-resolved` (server-initiated during the 7 AM sweep): +5 MC correct / 0 incorrect, NEVER engagement/streak/Perfect Day (the kid is asleep — counting it would suppress that evening's nudge for kids who never visited); the +5 still shows in the evening recap's MC total. Dedup for both keyed on `targetDate` (one bet/payout per market close). New personal record `best-prediction-streak` (5 records now), updated by the resolution sweep. The streak-at-risk push gate is decoupled from "engaged" as of this phase — see `push.js`.

- **Weekly Hold (Phase 20a)** — `weekly-hold-pick` (Mon, kid-initiated): 0 MC, counts as **engaged**, NOT streak (like prediction-made). `weekly-hold-resolved` (Sat, server sweep): **+20 if the held company beats BOTH others over the week, else +5** participation; never engagement/streak/Perfect Day. Dedup keyed on `targetDate` (the week). Resolution rides the same isolated generateDigest seam as Tomorrow's Call, on every path.

**Phase 12 — Parent recap pipeline:**

Each digest section carries a `parentExplainer: { summary, conversationStarter }` object generated by Claude at digest time. Kids tap 💬 buttons under sections they want to discuss with a parent — that fires a `parent-question` event (0 MC, deduped by section). Every hour UTC, a cron sweep finds users whose local time is 7 PM and sends one of two emails:

- **Recap** (kid engaged today) — session summary + game brief + per-section parent explainers for the 💬 taps + "Talk About It Tonight" picker (always present, 2-3 conversation starters from confirmed-engagement sections, skipping anything already in the 💬 block).
- **Nudge** (kid didn't engage AND streak ≥ 3) — light tease of today's digest contents + streak-at-risk language scaled to streak length. Skipped entirely if streak < 3 (don't nag fresh signups).

**Phase 11 carry-overs**: cross-device sync is real now (the server is authoritative). Old localStorage state is wiped on first load (`clearLegacyStorage()`) — no migration. The `/progress` page surfaces the full state at `/progress` (kid auth required).

---

## Glossary tap-to-reveal + auto-grow

Two halves that share one term source.

**1. Tap-to-reveal (kid-facing).** Every digest wraps the FIRST mention of each known glossary term — once across the whole digest — in a tappable tooltip (dotted citrus underline → dark card with the term, a kid-level definition, and a "Ties to: <principle>" line; an optional NEW superscript for freshly auto-grown terms). Visual treatment is locked to `glossary-demo.html`. Implemented in `template.js` (`makeGlossaryLinker`), gated off via `opts.glossary === false` (default ON), live on `/digest` AND `/sample`. The linker walks sections in teaching order (big picture → scoreboard prose → stories → did-you-know → word-of-day; the quiz/Daily Challenge is client-rendered JSON, outside the pass), matches longest-first on the active view's `MATCHABLE_TERMS`, resolves aliases through `lookup()`, skips the word-of-day's own word in its own card, and operates on raw field text (escaping inside the linker) so there is no tag-injection path and `&`-bearing terms like "S&P 500" match cleanly.

The three **scoreboard index tiles** (S&P 500 / Nasdaq / Dow Jones) are additionally **always tappable**, every digest, even on days the index name never appears in prose. They resolve their definition via `scoreboardGloss(view, term, enabled)` — the same `view.lookup()`, **independent of the first-occurrence prose pass** (tiles never consume the linker's seen-set, so a tile and a prose mention of the same term don't suppress each other). Because the prose `.tip` bubble clips on a small tile, tapping a tile instead expands a **full-width drawer** (`.score-gloss-panel`) below the scoreboard row, with the same brand styling (dark surface, citrus-yellow term label, "Ties to:" principle line). Affordance cue: dotted underline + a small ⓘ on the index name; a lookup-miss (or glossary off) renders the tile plain. A single unified client controller wires both `.gloss` terms and `.score-card.tappable` tiles, so "one open at a time" + tap-outside + keyboard (Enter/Space/Escape, focus ring, `aria-expanded`) span both affordances.

**2. AI nomination gate (admin-facing).** During the real generation pass, the digest generator proposes financial terms that appear in the day's content but aren't in the glossary (`ai.js` → `glossaryNominations`, filtered by `filterGlossaryNominations`). Survivors are persisted to `pending_glossary` by `generate.js` (only on a real INSERT — never the cached-replay path). They surface on `/admin` (Glossary Nominations card, sorted by `times_seen`), each row with Approve (editable term/definition/principle) / Reject. Approve flips `status='approved'` and calls `refreshActiveGlossary()`, so the term goes **live to kids with no redeploy** (promotion path **(b)** — `glossary-runtime.js` merges the static seed with approved DB rows at render time, cached per process). Reject keeps the row so the same term isn't re-nominated into the queue.

**`pending_glossary` table** (`src/schema.sql` + `src/migrations/add-pending-glossary.sql`; boot-migrated idempotently in `runBootMigrations()`):

| Column | Notes |
|---|---|
| `id` | UUID PK (`gen_random_uuid()`). |
| `term` / `definition` | NOT NULL. Unique index on `LOWER(term)` → re-nominations dedup via `ON CONFLICT`. |
| `principle` | INT 1–11 or NULL. |
| `status` | `'pending'` \| `'approved'` \| `'rejected'` (CHECK), default `'pending'`. |
| `times_seen` | Bumped on re-nomination so recurring terms float up the review queue. |
| `first_seen_date` / `last_seen_date` | NY date strings (`todayNY()`). |
| `approved_at` | Set on approval; drives the ≤14-day "NEW" tag. |
| `created_at` | TIMESTAMPTZ default `NOW()`. |

**COPPA:** these are AI-generated market-vocabulary rows, **not user PII** — intentionally out of scope for `recordDeletionRequest()`'s scrub. **Token cost:** nominations ride the existing `generateContent` response (one extra JSON field) — no new API call.

---

## Email pipeline

Seven email types, all via Resend (`src/emails.js`):

| Email | Trigger | Purpose |
|---|---|---|
| Verification | `POST /api/signup` | Confirms parent email is real |
| Consent | `GET /api/verify` (after click) | COPPA parental consent request |
| Welcome | `GET /api/consent` (after click) | Account activated, what to expect |
| Daily teaser | 7 AM cron or `POST /api/cron/send-digest` | Preview of today's digest + link. **Edition-aware** (driven off `content.editionType` from the digest row): standard subject `🟢 Today's Juice: <date>`; Sunday weekly-wrap `📋 Market Juice — Your Weekly Wrap (<date>)` framed as a recap of the past week (no "today's mover" — uses "Week's biggest mover"); Monday/post-holiday week-ahead `🔮 Market Juice — The Week Ahead (<date>)` framed as a preview (no "today's mover" — uses "One to watch" when `content.oneToWatch` is present, omits the line entirely on quiet weeks). |
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
| Change cron time / retry ladder | `src/server.js` — the `cron.schedule('0 7 * * *', ...)` call; retry delays in `src/morning-run.js` (`RETRY_DELAYS_MS`) |
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
- ~~**No retries.**~~ Fixed in Phase 18c — the 7:00 handler retries at 7:10 and 7:25 (`src/morning-run.js`), one ✅/❌ per morning, fan-out exactly once.
- **Game datasets are small.** 10 bull-bear + 7 time-machine + 57 company-models scenarios. Kids on 2-week streaks see repeats. Expand pools before growth push.
- ~~**Content rotation ephemeral.**~~ Fixed in Phase 16 — rotation history lives in the Postgres `content_history` table now.
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
| 6.3 | Push notifications | ✅ (completed by Phase 15) |
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
| 15  | **Push notifications (kid-facing trigger; completes Phase 6.3, expanded per the June 2026 roadmap).** New `src/push.js` + `web-push` dep + `push_log` table (`(user_id, kind, digest_date)` unique — ledger written BEFORE send, so all sweeps are idempotent; transient failures release the slot; hard 2/day cap in SQL). Morning push: hourly **timezone-aware** sweep over each kid's 7–9 AM local window (minute 5 UTC, never races the 7:00 ET generation; the 8/9 AM ticks catch up after late generations, ledger-deduped to exactly one per day), gated on today's digest row; edition/vibe-aware copy (green/red/mixed/wrap/ahead — interim wrap+ahead copy until Phases 17/20). Streak-at-risk push: rides `sendEveningRecaps`'s nudge fork (streak ≥ 3, no engagement, 7 PM local) + no-push-today gate. Routes: `GET /api/push/public-key`, `POST /api/push/subscribe` / `unsubscribe` (session auth), `POST /api/cron/send-push`. Dead subscriptions (404/410) auto-cleared. Permission ask: soft banner on the kid's 3rd active day (`activeDays` added to engagement state), install banner always takes priority, never both per visit. `sw.js` v4 (payload `tag` passthrough). COPPA: `push_log` added to the deletion scrub. 31-assertion smoke test (`scripts/test-push.js`). | ✅ |
| 16  | **Mystery Mover — the daily guess-the-company puzzle + guest play on /sample + share grid.** New `src/mystery.js` (server-picked company from the curated 75, 30-day no-repeat via Postgres rotation; server-composed clue 5; name-leak HARD GATE validating clues 1–4 against name/ticker/every acceptable answer; validate-or-fallback to a 12-puzzle reserve under `src/` — a leaky puzzle can never reach the immutable row), `src/name-leak.js` (guardrail logic extracted from `test-company-models.js`, shared), `content_history` table (rotation moved off the ephemeral state file — known wart closed). All 3 edition prompts gained MYSTERY MOVER RULES + schema (rides `generateContent`, no extra API call). Public routes `GET /api/mystery/today` (clues only, never the answer) + `POST /api/mystery/guess` (stateless, 30/min/IP) power guest play on `/sample` with a signup CTA. Client `public/games/mystery-mover.js` (own section, 7 days/week, localStorage per-day state, share grid 🟧🟧🟩 with zero identifiers). Engagement: `mystery-mover-played` event (dedup per digestDate, MC 25/20/15/10/5 by clue, clamped), extends streak + bumps games_played + counts toward Perfect Day via shared `applyDailyPlayProgress`/`checkPerfectDay` helpers (classic 3-game path regression-tested in both orderings). `sw.js` v5. 75-assertion smoke test (`scripts/test-mystery.js`). | ✅ |
| 17  | **Tomorrow's Call — daily S&P green/red prediction.** New `src/picks.js` + `user_picks` table (UNIQUE `(user_id, kind, target_date)` = ONE BET PER MARKET CLOSE; kind also covers Phase 20's weekly-hold). **Blind-pick rule:** target = next trading day whose 9:30 AM ET open is still future at pick time (`calendar.getNextTradingOpen` — server clock, recomputed authoritatively at POST; an evening pick targets tomorrow, weekend picks target Monday, Sat+Sun double-bet impossible). Prediction card at the END of the digest (per-request render, nothing per-user in the immutable row): verdict strip, running record ("7 of 12"), ▲/▼ buttons, locked chip, 3-state lock caption, one-time 5th-grade explainer, always-tappable S&P 500 gloss (`glossTermSpan`). Resolution rides generateDigest on BOTH paths inside an isolated never-throws sweep (own ^GSPC quote; FACTUAL FMP close, not marketVibe; flat day → green; atomic claims; straggler fallback). +5 MC correct / 0 incorrect via `prediction-resolved` (never engagement/streak/Perfect Day); `prediction-made` = engaged but NOT streak. **Streak-at-risk push gate decoupled from "engaged"** (`shouldSendStreakRiskPush`: streak ≥ 3 AND lastStreakDate ≠ today). New personal record `best-prediction-streak`. 46-assertion smoke test (`scripts/test-picks.js`) + updated push/engagement suites. | ✅ |
| 18  | **Generation pipeline hardening.** (a) **Two-pass generation**: pass 1 = research (web_search, free-text brief with source-attributed figures, edition-forked goals + Mystery Mover facts, **sanity-gated** — a hollow brief is a pass-1 failure, never handed to the writer); pass 2 = write (NO search, brief + FMP + edition rules → **forced `emit_digest` tool call** = structured input, no fences/trailing prose/stray braces; both passes STREAM so multi-minute calls can't die to idle-connection ETIMEDOUT — found in pre-ship verification). (b) **zod validation** (`src/digest-schema.js`) before saveDigest — edition-aware (2–3 standard stories per the house rule, optional oneToWatch, both real topMover shapes, finalized mysteryMover) with ONE repair retry (pass-2 re-run with the errors appended) then a Telegram ❌ listing the errors. (c) **Cron retry ladder** 7:00→7:10→7:25 (`src/morning-run.js`, single handler — three cron entries would double-email; fan-out exactly once; ✅ notes the attempt). (d) **SENSITIVE NEWS rule** in all 3 builders + the research prompt. Resolution (17) + morning-push catch-up (15) verified compatible by design. 49-assertion smoke test + live two-pass runs of ALL THREE editions (repair retry + mystery reserve fallback both fired and recovered live). | ✅ |
| 19  | **"Morning Juice" visual redesign.** Dark navy starfield → warm-cream light theme. `:root` token swap with the spec palette under new names + OLD names ALIASED on top (no `var()` churn; `engagement.css`/`games` re-skin free); dark theme preserved under `[data-theme="dark"]` for Phase 23. Vibe-tinted header band + state pill (keyed off editionType+marketVibe — old DB rows tint correctly). Type system: Fredoka display / Lexend body / Space Grotesk numerals (Google Fonts CDN, `display=swap`, preconnect); Space Mono retired. Section-nav emoji → inline SVG line icons (`sectionIcon()`). Starfield removed (digest + landing). Applied across `template.js`, `progress-template.js`, `auth.css`, `landing.css`, `engagement.css` + the auth/landing HTML font links. **WCAG AA verified live with the inspector on real pages** — every body/secondary/accent text ≥4.5:1 (added `-text` dark variants for green/red/sun/citrus, which fail as text on cream). Install-banner light restyle; the "Got it" button was already styled (spec was stale). `sw.js` v6→v7 (engagement.css is a precached shell asset). 33-assertion `scripts/test-theme.js` + 5 header states + 7 surfaces screenshotted before/after. | ✅ |
| 20  | **Weekly rhythm — Weekly Hold + "Your Week in Juice."** 20a: Sunday's weekly-wrap AND Monday's week-ahead both present the SAME 3 SERVER-picked curated companies (`src/weekly.js`, stateless deterministic rotation; Claude writes only the one-line cases, finalize-or-canned-fallback) baked into the immutable row; kid "holds" one. Relaxed pick window Sunday→Monday-pre-open; blind-pick lock STAYS at the week's first trading-day open. `weeklyHoldBasis()` (calendar.js) shifts a Sunday date forward to the upcoming Monday so both editions key off one ISO week → identical candidates + `target_date` + one-pick-per-week dedup (Sun-then-Mon can't double-pick); Sunday no longer shows the just-resolved verdict (that's Saturday) — Sunday = reflect ("Your Week in Juice") + pick ahead. *(Sunday window amended 2026-06-15 — originally Monday-only.)* Saturday sweep (`resolveWeeklyHolds`, parallel to Tomorrow's Call in the same isolated never-throws seam, every path) compares each candidate's first-trading-day-OPEN → last-trading-day-CLOSE return from FMP full OHLC; +20 if the pick beats BOTH others, else +5; reuses `user_picks` kind='weekly-hold' (built forward in Phase 17 — no migration). Holiday weeks handled by `getFirstTradingDayOfWeek`/`getLastTradingDayOfWeek` (holiday-Monday→Tue open, Good-Friday→Thu close). 20b: "Your Week in Juice" Sunday card (`getWeekStats`) — MC/games/prediction-record/streak/rank/one-broken-record this week, built ENTIRELY from existing tables, threaded as `opts.weekStats` per-request (immutability clean; absent on /sample). Engagement: weekly-hold-pick = engaged-not-streak, weekly-hold-resolved = MC-only. Phase 19 tokens (Space Grotesk numerals, --up-text/--down-text returns). Phase 15 weekly-wrap push copy swapped to "Your Week in Juice is ready." 65-assertion smoke test (incl. the Sunday-window section: basis shift, Sun≡Mon candidates/target, Sun-then-Mon dedup) + live OHLC round-trip (AMD +5.5% beat IBM/Oracle → +20, verdict-card screenshot). | ✅ |
| 21  | **Watchlist ("Your Companies").** Follow up to 3 curated companies, render-time only (`getWatchlistState` threaded through `buildHTML` like prediction/weeklyHold; never in `daily_digests`; /sample skips). 3 tables: `daily_prices` (market snapshot from the existing fan-out — ZERO extra FMP calls, now runs week-ahead Monday too), `user_watchlist`, `user_watchlist_prefs` (offer machine). Follow = free/instant; remove/replace = client speed-bump + **server 7-day per-company cooldown** (409 + daysRemaining). **3 learning layers:** (1) in-the-news 📌 jump-link — exact mover-ticker OR full-NAME word-boundary scan (AMBIGUOUS_TICKERS denylist kills Block/Snap/Unity/…); (2) since-following % + first-crossing +10/+25/+50 milestones (spoof-proof server re-check); (3) one personalized principle tie-in/digest (mover preferred). Always-on empty state with faded ghost slots; first-run + one re-nudge offer (reuses Phase 15 `activeDays`; declined≠skipped). **Categorized tap-to-select picker** (no free text; typeahead filters only) shared by digest + /progress (`watchlist-ui.js`). Core expanded ~75→81 (Mattel/Hasbro/Hershey/Crocs/Palantir/SpaceX) + a kid-legible `category` per company. No engagement coupling; no SW bump (controller inline). **Deferred to a paid tier:** the ~150–250 expanded universe + on-demand/batch fetch + higher cap (FMP free tier has no batch; ~200 daily snapshot would breach 250/day under the retry ladder — cost-guard logs at ≥200 tickers). ~60-assertion smoke test. | ✅ |

---

## Future roadmap

- **Leaderboards / weekly seasons** — Duolingo-style ~30-user weekly pool with promotion/demotion. Spec'd in `market-juice-engagement-research.md` Part F. Needs enough active users to fill pools.
- **Parent web dashboard** — beyond the evening recap email; weekly view with engagement history, badge unlock timeline
- **Expanded game datasets** — 30+ bull-bear, 20+ time-machine scenarios
- **Per-user content rotation** — pick word/fact differently per user
- **Retention cleanup jobs** — 12-month inactivity sweep (now unblocked by Phase 11's `last_active_date`) + 7-day incomplete-consent cleanup, promised in privacy policy §4
- **Premium tier** — personalized portfolio, paper trading, ad-free deep dives ($5-8/month)
- **Referral program** — badge/reward unlocks for sharing
- **School partnerships** — curriculum supplement (26 states mandate financial literacy)
