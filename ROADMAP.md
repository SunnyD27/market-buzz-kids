# Market Juice — Consolidated Roadmap Spec (June 2026 Review)

> **How to use this doc.** This is the build plan distilled from the June 2026 independent
> product review. It is written to be executed phase-by-phase by Claude Code against the
> existing repo (`~/market-juice`). Read `CONTEXT.md` first — it remains the canonical
> architecture reference. This doc tells you WHAT to build and WHY; CONTEXT.md tells you
> how the codebase works. Phase numbering continues from the existing build history
> (last shipped: Phase 14.1).
>
> Work on `dev`, PR to `main`, follow the existing conventions: boot-idempotent
> migrations, smoke-test scripts in `scripts/`, all CSS in `template.js` tokens,
> PROFANITY_RULE + scrubProfanity in every new prompt, COPPA scrub extended for every
> new user-data table.

---

## Guiding principles (apply to every phase)

1. **Habit, not compulsion.** Max 2 push notifications/day. No guilt copy, ever
   ("Your streak ends at midnight" is fine; "Don't disappoint your streak 😢" is not).
   The Emergency Fund stays generous. Parents are the gatekeepers AND the growth
   channel — anything that would make a parent uneasy is a bug.
2. **Dataset-free games.** New games must generate their content from the daily
   pipeline (Claude + FMP data) or from live market data — never from a hand-curated
   pool that can be exhausted. Deduction over recall.
3. **One shared daily puzzle.** The immutable digest means every kid sees the same
   content all day. New game mechanics should exploit this (same Mystery Mover for
   everyone = talkable at school).
4. **COPPA invariants.** No new PII categories. No public usernames anywhere. No
   social/contact surfaces. Every new user-data table gets added to the
   `recordDeletionRequest()` scrub transaction. Shareable artifacts contain zero
   identifiers.
5. **The week is a story.** Saturday pays out, Sunday celebrates the kid, Monday
   places the bets, Tue–Fri play out. Keep the 7-day cadence — never skip a day.

---

## Priority order

| Phase | What | Effort | Impact | Depends on |
|---|---|---|---|---|
| **15** ✅ | Push notifications (kid-facing trigger) — shipped 2026-06-12 | S–M | **Highest** | — |
| **16** ✅ | Mystery Mover + guest play on /sample + share grid — shipped 2026-06-12 | M | **Highest** | — |
| **17** ✅ | Tomorrow's Call (daily prediction) — shipped 2026-06-12 | S–M | High | — |
| **18** | Generation pipeline hardening (two-pass, validation, retries, sensitive-news rule) | M | High (reliability) | — |
| **19** | "Morning Juice" visual redesign | M | High | — |
| **20** | Weekly rhythm: Weekly Hold + "Your Week in Juice" | M | High | 17 (shares `user_picks`) |
| **21** | Watchlist ("Your Companies") | M | Med-High | — |
| **22** | Game lineup refresh (Panic or Patience, Bigger Fish, Headline or Hoax; retirements) | M | Med | — |
| **23** | MC cosmetic shop (dark mode as unlock) | S–M | Med | 19 (dark theme becomes the unlock) |
| **24** | Parent loop close ("We talked ✓") + referral footer | S | Med | — |

Phases 15–18 can be built in any order relative to each other. Ship 15 first if possible —
every other engagement feature underperforms without a kid-facing trigger.

---

## Phase 15 — Push notifications (complete Phase 6.3, expanded) ✅ SHIPPED

> **Status: built 2026-06-12.** `src/push.js`, `push_log` table, hourly
> timezone-aware morning sweep (7–9 AM local window — NOT generation-time,
> which would buzz west-coast kids at 4 AM; the 8/9 AM ticks catch up after
> late generations, ledger-deduped), streak-at-risk push riding the evening
> recap sweep's nudge fork, 3rd-active-day permission banner in `pwa.js`.
> Deviations are recorded in the HANDOFF.md session entry — notably: the VAPID
> public key is served via `GET /api/push/public-key` instead of baked into
> pwa.js, and interim morning-push copy is used for week-ahead / weekly-wrap
> until Phases 17 / 20 ship (TODOs in those phases below).

**Why.** The 7 AM email goes to the PARENT. The kid — whose habit we're building —
currently receives no trigger of any kind. This is the single biggest gap in the
engagement loop.

**Build:**
- Generate VAPID keys; `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` env vars; replace the
  `REPLACE_IN_PHASE_6` placeholder in `public/pwa.js`.
- `POST /api/push/subscribe` (session-cookie auth) → writes subscription JSON to
  `users.push_subscription` (column already exists and is already in the COPPA scrub).
- **Morning push** — after a successful 7 AM generation + teaser fan-out, push to all
  subscribed kids. Copy is edition-aware and vibe-aware:
  - standard: `🟢 Green day — today's Juice is ready` / `🔴 Red day — see what happened`
  - weekly-wrap: `📋 Your Week in Juice is ready — see your stats`
  - week-ahead: `🔮 New week — make your picks`
- **Streak-at-risk push** — ride the existing hourly evening cron (Phase 12 timezone
  sweep). Fire at the user's 7 PM local ONLY IF: streak ≥ 3 AND no engagement event
  today AND no push of this type sent today. Copy: factual, no guilt:
  `Your 12-day streak ends at midnight — 3 minutes saves it.`
- **Caps:** hard maximum 2 pushes per kid per day (morning + at most one streak-at-risk).
  Track sends in a `push_log` table (user_id, kind, sent_at) — also gives the dedup.
- Permission ask UX: do NOT prompt on first visit. Prompt after the kid's 3rd active
  day (they've demonstrated the habit is worth protecting) with kid-appropriate copy.

**Acceptance:** subscribe round-trip works on iOS PWA + Android Chrome; morning push
arrives within 5 min of generation; streak-at-risk respects all three gates; 2/day cap
holds; unsubscribing kid receives nothing; deletion scrub covers `push_log`.

---

## Phase 16 — Mystery Mover (the daily Wordle) + guest play + share grid ✅ SHIPPED

> **Status: built 2026-06-12.** `src/mystery.js` + `src/name-leak.js` +
> 12-puzzle reserve pool, `content_history` Postgres table (the state-file
> wart is closed), public `/api/mystery/*` routes, `public/games/
> mystery-mover.js`, `mystery-mover-played` engagement event. Deviations
> recorded in the HANDOFF.md session entry — notably: the server picks the
> company (not Claude), clue 5 is server-composed, the reserve pool lives
> under `src/` (it contains answers; `public/` is statically served), and
> clue pacing is client-side because server-paced unlocks would require
> per-guest state this spec forbids.

**Why.** Proven daily-ritual mechanic, exploits the immutable digest (same puzzle for
everyone), and the shareable emoji grid is the only COPPA-safe viral channel available
to this product.

**Game design:**
- One mystery company per day, drawn from `src/companies.js` (the curated 75) so every
  answer is kid-recognizable. Rotation must avoid repeats within 30 days (reuse the
  `content-history.js` pattern; move that history to Postgres while you're in there —
  it's a known wart).
- 5 progressive clues, revealed one at a time on demand:
  1. Industry / what they sell (vague)
  2. Founding decade + headquarters region
  3. A famous product or service (no brand names that give it away)
  4. A surprising fact (the `surprise` field style from company-models.json)
  5. First letter + ticker length
- Guessing: free-text input matched against name + aliases (normalize case, strip
  punctuation/suffixes — reuse the token-normalization approach from
  `scripts/test-company-models.js`). 5 guesses max.
- **MC awards:** solved on clue 1 → 25, clue 2 → 20, clue 3 → 15, clue 4 → 10,
  clue 5 → 5, unsolved → 0 (but still logs participation). Add to
  `MC_AWARDS` in `src/progression.js` + mirror in `public/progression-config.js`.
- New event type `mystery-mover-played` (dedup key: digestDate). Counts toward
  Perfect Day.

**Content generation:**
- New digest JSON field `mysteryMover: { ticker, name, clues: [5 strings],
  acceptableAnswers: [strings] }` generated inside the existing `generateContent` call
  (all 3 edition builders — the puzzle runs 7 days/week).
- **Name-leak guardrail (server-side, hard gate):** before persisting, validate every
  clue with the same possessive-aware, whole-word token logic as
  `test-company-models.js` — no clue may contain the company's name words, ticker, or
  flagship brand words until clue 5's first letter. On validation failure, fall back to
  a deterministic canned puzzle from a small reserve pool (never ship a leaky puzzle).
- Prompt rules need GOOD/BAD clue examples (follow the `oneToWatch` GOOD/BAD pattern —
  it works):
  - GOOD clue 3: "Their most famous product lets you build entire worlds out of
    virtual blocks with friends." (Roblox — descriptive, no names)
  - BAD clue 3: "They make the Roblox app." (name leak)
  - BAD clue 1: "A company." (uselessly vague — each clue must narrow the field)

**Guest play on /sample (the growth half — do not skip):**
- Public route `GET /api/mystery/today` returns clues only (never the answer).
- Public `POST /api/mystery/guess` checks a guess server-side, returns
  correct/incorrect + next clue unlock. Rate-limit by IP (reuse express-rate-limit,
  e.g. 30/min). Stores nothing per-guest.
- `/sample` renders the playable puzzle for logged-out visitors. After solving (or
  failing): "Nice! Sign up to save your streak and earn Market Coins →" CTA to the
  landing signup. This converts a kid who clicked a friend's share into a signup pull
  on their parent.

**Share grid:**
- After playing, offer "Share your result" → copies a text block to clipboard:
  ```
  Market Juice Mystery Mover — June 15
  🟧🟧🟩 (got it in 3 clues!)
  themarketjuice.com/sample
  ```
  🟧 per clue used, 🟩 on solve, 🟥 row if unsolved. ZERO identifiers — no username,
  no name, no streak. The link goes to /sample where the same puzzle is playable.

**Acceptance:** same puzzle all day for all users (verified across two sessions);
guardrail rejects a deliberately leaky clue in a unit test; guest can play end-to-end
on /sample with no account; share text contains no PII; MC awards + dedup verified via
smoke test; deletion scrub unaffected (no new per-user tables in this phase).

---

## Phase 17 — Tomorrow's Call (daily prediction) ✅ SHIPPED

> **Status: built 2026-06-12** with the approved integrity addendum:
> **blind-pick rule** (target = next trading day whose 9:30 AM ET open is
> still future at pick time — an evening pick targets tomorrow) and the
> dedup constraint changed to UNIQUE `(user_id, kind, target_date)` — one
> bet per market close, which also closes the Sat+Sun double-bet on Monday
> (verified compatible with Phase 20's weekly-hold: its target is the
> week's last trading day → one per week). Engagement semantics: pick =
> engaged (no nudge email) but NOT streak; the streak-at-risk push gate is
> DECOUPLED from "engaged" (fires on streak ≥ 3 + no streak-extending play,
> so a pick-only kid still gets warned); resolution = +5/0 MC only. Flat
> day (0.00%) resolves green. Other deviations in the HANDOFF entry.

> **TODO (from Phase 15): DONE** — week-ahead push copy swapped to
> "🔮 New week — make your picks" when this phase shipped.

**Why.** The purest open loop available: today's tap is resolved by tomorrow's open.
It is also a stealth lesson — a kid's hit rate converging on a coin flip teaches
Principles 6 and 7 better than any paragraph.

**Build:**
- New table `user_picks`:
  ```sql
  CREATE TABLE user_picks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    kind TEXT NOT NULL CHECK (kind IN ('tomorrow-call','weekly-hold')),
    digest_date DATE NOT NULL,          -- the digest the pick was made on
    target_date DATE NOT NULL,          -- the trading day it resolves against
    pick JSONB NOT NULL,                -- {"choice":"green"} or {"ticker":"NKE"}
    resolved_at TIMESTAMPTZ,
    outcome JSONB,                      -- {"correct":true,"actual":"green","changePct":1.75}
    UNIQUE (user_id, kind, digest_date)
  );
  ```
  Add to schema.sql + idempotent boot migration. **Add to the COPPA deletion scrub.**
- **The question is always about the next trading day** — resolve it with
  `calendar.js#getLastTradingDay` logic inverted (a `getNextTradingDay()` helper).
  Friday's digest asks about Friday's close (resolves in Saturday's digest); Saturday's
  and Sunday's ask about Monday (resolve Tuesday).
- UI: a card at the END of the digest (last thing the kid sees = tomorrow, not "done").
  Two buttons: ▲ Green / ▼ Red for the S&P 500. One pick per digest date (UNIQUE
  constraint is the dedup). `POST /api/picks` (session auth).
- **Resolution:** during the next trading day's 7 AM generation, after FMP data is
  fetched, resolve all unresolved `tomorrow-call` rows whose `target_date` now has a
  close. Award via `recordEvent('prediction-resolved', ...)`: **+5 MC correct, 0
  incorrect** (participation is its own reward — the kid comes back to find out).
- The NEXT digest renders the verdict at the top of the prediction card: "You called
  it! 🎯 +5 MC" / "Not this time — the S&P finished red."
- New personal record: `best-prediction-streak`. New badge family is optional —
  defer unless trivial.
- **The kid's running record (`7 of 12`) renders on the card** — this is the
  identity stat.

**Acceptance:** pick → resolve → verdict round-trip across two generated days
(use DATE_OVERRIDE); weekend targeting verified (Sat/Sun picks resolve Tuesday);
double-pick rejected; MC awarded once; scrub covers user_picks.

---

## Phase 18 — Generation pipeline hardening

**Why.** Three distinct morning failures shared one root cause: a single API call doing
research + writing + strict serialization simultaneously. Patches (brace-matcher,
Telegram alert) are in place; this phase removes the failure class structurally and
adds the missing safety rule.

**18a — Two-pass generation (`src/ai.js`):**
- **Pass 1 (research):** Claude + `web_search`, free-text output. Prompt: gather
  today's top business stories with kid-relevance notes, and CARRY EVERY FIGURE WITH
  ITS SOURCE ("raised $75B — from Reuters"). No JSON requested → cannot parse-fail.
- **Pass 2 (write):** NO web search. Input = pass-1 brief + FMP data + edition rules.
  Output via a **forced tool call** — define an `emit_digest` tool whose input schema
  IS the digest schema, set `tool_choice: {type:"tool", name:"emit_digest"}`. The API
  returns structured `input` — no fences, no trailing prose, no stray braces.
  Rule in the prompt: "use only figures present in the research brief."
- Keep `extractFirstJSONObject` + cite-stripping as fallback for the reframer calls
  and for cite tags inside string values.
- Pass 2 is cheap → on failure it can be retried WITHOUT re-searching.

**18b — Schema validation (zod):**
- Validate the parsed digest before `saveDigest()`: required fields per edition,
  enums (`marketVibe` ∈ green|red|mixed), story counts (3 standard / 2 wrap / 2 ahead),
  `principle` ∈ 1–11, parentExplainer present on every section, mysteryMover passes
  the name-leak gate (Phase 16), clue/answer shapes.
- On validation failure: ONE repair retry — re-run pass 2 with the validation errors
  appended ("your previous output failed these checks: …"). Then fail loud (existing
  Telegram ❌ path, enriched with the validation errors).

**18c — Cron retries:** 7:00 → on failure retry 7:10 → 7:25 → only then ❌ alert.
The ✅ ping notes which attempt succeeded.

**18d — SENSITIVE NEWS rule (all 3 prompt builders, alongside PROFANITY_RULE):**
> When covering war, conflict, violence, disasters, deaths, or mass layoffs: state
> facts without graphic detail; never dwell on casualties or suffering; frame through
> the economic lens; acknowledge seriousness without alarm ("this is a serious
> situation that markets are watching"); never speculate about worst cases; end such
> sections on what's known, not what's feared.

**Acceptance:** simulated trailing-prose and truncation shapes cannot reach kids;
a deliberately invalid digest triggers exactly one repair retry then alerts; retries
verified via forced failure; sensitive-news rule present in all 3 builders; a full
live generation produces a valid digest end-to-end.

---

## Phase 19 — "Morning Juice" visual redesign

**Why.** The dark starfield is the default fintech/AI aesthetic and fights the
morning-ritual brand. All CSS lives in `template.js` tokens, so this is contained.

**19a — Token swap (`template.js :root`):**
```css
--bg: #FFF8EF;            /* warm cream page */
--surface: #FFFFFF;       /* cards */
--surface-border: #F0E4D3;
--ink: #2B2118;           /* body text */
--ink-soft: #6E6258;      /* secondary */
--citrus: #FF7A1A;        /* primary brand */
--sun: #FFC233;           /* accent / mover card */
--up: #1E9E5A;            /* green day / gains */
--down: #E5484D;          /* red day / losses */
--berry: #5B4FC7;         /* quiz, lesson boxes, parent links */
--vibe-green: #E7F3E6;    /* header wash, green day */
--vibe-red: #FBEAEA;      /* header wash, red day */
--vibe-mixed: #FBF1DC;    /* header wash, mixed + weekend/closed */
--vibe-ahead: #EFEDFA;    /* header wash, week-ahead Monday */
```
Remove the starfield. Keep dark-theme CSS in a `[data-theme="dark"]` block — it
becomes the Phase 23 unlockable.

**19b — Vibe-tinted header.** The header band's background is picked from
`content.marketVibe` (green/red/mixed) on trading-day editions, `--vibe-mixed` on
weekly-wrap, `--vibe-ahead` on week-ahead. A small pill states it: "Green day ▲".

**19c — Type system.** Google Fonts: keep **Fredoka** (500/600) for display/headers/
wordmark; **Lexend** (400/500/600) for ALL body copy and UI labels; **Space Grotesk**
(500/700) for every number (scoreboard, MC, percentages). Retire Space Mono except
tickers if desired. Body: 17px / 1.7. Drop the letterspaced all-caps mono labels —
labels become Lexend 600, sentence case or small pills.

**19d — Icons.** Replace section-header emoji (🌍🔥🤓📖🚀🏆) with inline SVG line
icons tinted `--citrus` (source from Lucide/Tabler outline paths, inlined — no new
runtime deps). Emoji stays welcome INSIDE content copy; it just stops being the
navigation system.

**19e — Two bug fixes:**
- PWA install banner: anchor to viewport bottom, never overlap content mid-page,
  show at most once per 7 days, persist dismissal in localStorage (`mj_pwa_dismissed_at`
  already exists — honor it properly).
- Style the "Got it" button on the Ask-my-parent explainer (currently an unstyled
  native button).

**Acceptance:** all editions render in the new theme (standard green/red/mixed, wrap,
ahead) — screenshot each; WCAG AA contrast on body + secondary text; glossary
underlines/tooltips restyled and legible; /progress + auth pages + landing get the
token swap too (auth.css + landing.css share the palette); old digests in the DB
re-render cleanly (the template is a pure function — no content migration needed).

---

## Phase 20 — Weekly rhythm: Weekly Hold + "Your Week in Juice"

> **TODO (from Phase 15):** when 20b ships, swap the weekly-wrap morning-push
> copy in `src/push.js#buildMorningPush` from the interim
> "📋 Weekly Wrap is ready — see how your week went" to the spec's
> "📋 Your Week in Juice is ready — see your stats" (it references the 20b card).
> Update the matching assertion in `scripts/test-push.js`.

**Why.** Gives each closed-market day a JOB: Saturday pays out, Sunday celebrates the
kid, Monday places the bets. Fixes Sunday's low-novelty problem with the one thing
that's brand new every week — the kid's own stats.

**20a — Weekly Hold (uses `user_picks`, kind `weekly-hold`):**
- Monday's week-ahead digest presents 3 companies from the curated 75 (Claude picks
  them in the week-ahead prompt with one-line cases for each; same name-leak hygiene
  not needed — names are shown). Kid picks one to "hold" for the week.
- Resolution: Saturday's digest (Friday close vs Monday open, from FMP) shows all
  three results: "Your pick Nike +2.1% 🏆 — beat Netflix (+0.4%) and McDonald's
  (−1.2%)."
- MC: **+20 if the pick beats both others, +5 participation otherwise.** Event types
  `weekly-hold-pick` / `weekly-hold-resolved`, dedup per ISO week.
- Holiday weeks: target_date = last trading day of the week (calendar.js handles it).

**20b — "Your Week in Juice" (Sunday weekly-wrap card):**
- Server-rendered card near the top of Sunday's digest, built from `engagement_events`
  + `user_progress` + `user_picks` (all existing or Phase-17 data — zero new
  collection):
  - MC earned this week · games played/won · prediction record (e.g. 4 of 5) ·
    current streak · rank progress bar · ONE highlighted personal best if any record
    was broken this week ("Longest streak ever! 🎉").
- Pure addition to `template.js` (needs `opts.weekStats` threaded from the /digest
  render path — per-user, so it renders on the DB-row re-render path, not the static
  disk file). Skip the card gracefully for logged-out /sample.
- Tone: celebration, never comparison ("you vs you", no percentile here).

**Acceptance:** Monday pick → Saturday verdict verified with DATE_OVERRIDE across a
synthetic week; Sunday card matches a hand-computed week of events; sample page
unaffected; scrub covers user_picks (done in 17).

---

## Phase 21 — Watchlist ("Your Companies")

- New table `user_watchlist (user_id, ticker, added_at, PRIMARY KEY (user_id, ticker))`,
  cap 3 tickers, **restricted to the curated 75** (so quotes are already fetched by the
  `fetchTopMover` fan-out — zero extra FMP cost). Add to deletion scrub.
- Picker UI: first visit after ship (and from /progress): "Pick up to 3 companies you
  care about." Grid of the 75 with logos/names. `POST /api/watchlist`.
- Digest renders a "Your Companies" row under the scoreboard (per-user render path,
  same as kidName). Each chip: name + day change. Tap → that company's glossary-style
  drawer if a story mentions it, else just the quote.
- Generation note: thread the day's watchlist-popular tickers NOWHERE — content stays
  identical for everyone (immutability). Personalization is render-time only.

**Acceptance:** pick/persist/render round-trip; cap enforced; non-curated ticker
rejected; scrub verified; /sample unaffected.

---

## Phase 22 — Game lineup refresh

**Retire:** Price is Right (pure guessing — no reasoning path) and Sunday's
Invest-a-Thon (the 8-second timer rewards speed; the product teaches patience).
Remove from both rotation copies (`src/games.js` + `public/games/daily-challenge.js` —
keep them in sync, known gotcha) and the Sunday 4-type rotation (now 3 types).

**Keep:** Quiz (anchors today's content), Match (best reasoner — keep the guardrail),
Time Machine (as occasional treat; expand its pool opportunistically).

**Add (in order):**

**22a — Panic or Patience** (evolves Bull-or-Bear; reuses + extends
`historical-charts.json`):
- 3-step simulation per scenario: Day 1 ("your stock drops 8% on this news — SELL or
  HOLD?") → Day 30 → Day 90 → reveal what actually happened and what each path was
  worth. Add `steps: [{day, news, priceChange}]` to each scenario entry.
- MC: +25 if the kid's final position beats the panic path, +15 participation.
- Teaches Principle 7 by making the kid FEEL the urge to bail.

**22b — Bigger Fish** (dataset-free):
- "Which is worth more?" market-cap higher/lower chain from the curated 75 (market
  caps via the existing quote fan-out — add marketCap to `fetchQuotes` fields).
- Chain continues until wrong; MC = min(2 × chain length, 30). Same daily company
  sequence for everyone (seed the shuffle with digestDate — talkable).

**22c — Headline or Hoax** (dataset-free, rides generation):
- Digest JSON gains `headlineOrHoax: { real, fake, explanation }` — Claude writes a
  plausible fake alongside one real headline from the research brief. Kid spots the
  real one. +15 correct / +5 participation.
- After answering, show the anonymous stat when available: "The fake fooled 61% of
  kids today" (aggregate query over engagement_events; only show when today's players
  ≥ 20 — never render silly small-sample stats).

**Acceptance:** rotation math still deterministic and synced client/server; retired
games absent from picker; each new game has a smoke test in `scripts/`; canned
fallbacks exist for AI-generated game content (follow games.js's existing pattern).

---

## Phase 23 — MC cosmetic shop (dark mode as the first unlock)

- **Split earned vs spendable MC.** Rank must stay keyed to LIFETIME earned MC
  (`rankForCoins` unchanged). Add `user_progress.mc_spent INT DEFAULT 0`; spendable
  balance = market_coins − mc_spent. Spending never demotes a rank.
- `user_progress.cosmetics JSONB DEFAULT '{}'` — owned items + equipped state.
- Shop section on /progress. Launch catalog (keep tiny): **Night Mode** (the retired
  dark theme, 500 MC — the marquee item), 3 header accent colors (150 MC each),
  2 profile-bar styles (200 MC).
- `POST /api/shop/buy` + `POST /api/shop/equip` (session auth, server-validated
  balance, event-logged). Equipped theme renders via `data-theme` attr on /digest +
  /progress.
- Add cosmetics + mc_spent to the deletion scrub (they ride user_progress, already
  scrubbed — verify).

**Acceptance:** buy/equip/persist round-trip; balance math correct after spend; rank
unaffected by spending; Night Mode renders the preserved dark CSS.

---

## Phase 24 — Parent loop close + referral footer

**24a — "We talked ✓":**
- Evening recap email: each conversation-starter block gains a one-click link
  ("We talked about it ✓") → `GET /api/parent/talked?token=…`. Token = signed,
  single-use, scoped to (userId, digestDate); reuse the verification_tokens table
  with a new `parent_talked` purpose (CHECK-constraint migration, same pattern as
  `add-auth-columns.sql`).
- On click: record `parent-talked` event (dedup per digestDate), award **+10 MC**,
  simple "Thanks — [kid] gets a little bonus tomorrow morning" confirmation page.
- Next morning's digest opens with a small banner: "You and your parent talked about
  SpaceX last night 💬 +10 MC".

**24b — Referral footer:**
- Evening recap + morning teaser gain one quiet footer line: "Know a family who'd
  love this? → themarketjuice.com" with `utm_source=parent-referral` (utm columns
  already exist on signup).
- New badge family `referrals` (tiers at 1/3/5 families joined via the kid's family's
  link) — defer the attribution plumbing if it exceeds a day; the footer link alone
  ships first.

**Acceptance:** token single-use + expiry verified; +10 MC dedup per day; banner
renders next morning only for that kid; footer present in both emails; no PII in any
new surface.

---

## Cross-cutting checklists

**New event types** (add to EVENT_TYPES in `src/progression.js` + client mirror):
`mystery-mover-played`, `prediction-made`, `prediction-resolved`, `weekly-hold-pick`,
`weekly-hold-resolved`, `headline-hoax-played`, `bigger-fish-played`,
`panic-patience-played`, `parent-talked`, `shop-purchase`.

**New tables → COPPA scrub:** `user_picks`, `user_watchlist`, `push_log`
(+ verify cosmetics ride user_progress). Extend `scripts/` smoke tests accordingly.

**MC award additions** (progression.js + progression-config.js, keep in sync):
Mystery Mover 25/20/15/10/5 by clue · Tomorrow's Call +5 correct · Weekly Hold +20
win / +5 play · Panic or Patience +25/+15 · Bigger Fish min(2×chain, 30) ·
Headline or Hoax +15/+5 · parent-talked +10.

**Do-not-break list (protect these):** immutable daily digest · server-authoritative
engagement + dedup gate · long-scroll, no onboarding, full-depth content · async
opt-in parent loop · glossary auto-grow behind admin approval · no public usernames
anywhere · the curated-75 universe for anything kid-facing · 7-day cadence and the
5+2 edition system.

**Anonymous comparison stat (small, fits anywhere):** one line, aggregate-only,
rendered only when daily actives ≥ 20: "You earned more MC than most kids today."
Never named, never ranked, never shown below-average framing.

**Explicitly deferred:** global leaderboard (never), weekly leaderboard pools (revisit
at 100+ active kids — spec exists in market-juice-engagement-research.md Part F),
sibling/family leaderboard (cheap + safe, build opportunistically after Phase 20),
parent web dashboard, paper-trading premium tier, teacher/classroom dashboard
(but ADD a "For teachers" section to the landing page copy any time — zero code).
