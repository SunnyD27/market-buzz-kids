# Market Juice — Working Rules for Claude Code

> Project: kid-friendly daily stock-market digest (ages 10–14), themarketjuice.com.
> This file is the session contract. The deep reference docs are:
> - `CONTEXT.md` — canonical architecture reference (file map, schemas, gotchas)
> - `HANDOFF.md` — session log (what happened when, what's open)
> - `ROADMAP.md` — the active build plan (June 2026 product review)

## Session protocol

1. **Always read `CONTEXT.md` and `HANDOFF.md` at session start.** `ROADMAP.md`
   is the active build plan — work **one phase per session**, in the priority
   order listed there.
2. **End every session** by:
   - Appending a session entry to `HANDOFF.md` in the existing format
     (`## Session: <name>` — what changed, files, decisions, deviations,
     what was verified live vs. by code review, open items).
   - Checking off completed work in `ROADMAP.md`.

## Code & workflow rules

- **All work happens on the `dev` branch, PR to `main`.** `main` is protected
  (PR required, no direct pushes). Railway auto-deploys `main`.
- **Migrations must be boot-idempotent.** Every schema change gets: (1) the DDL
  in `src/schema.sql`, (2) a standalone file in `src/migrations/`, (3) an
  idempotent detection-gated block in `runBootMigrations()` in `src/server.js`.
- **Every phase gets a smoke test in `scripts/`** (follow the existing
  `test-*.js` patterns — pure/offline where possible, live-DB where needed).

## Conflict resolution

- **If `ROADMAP.md` conflicts with the actual codebase, the codebase is truth.**
  Follow the code, and record the deviation in the `HANDOFF.md` session entry.

## Do-not-break list

Respect the "Do-not-break list" in `ROADMAP.md` at all times:
immutable daily digest · server-authoritative engagement + dedup gate ·
long-scroll, no onboarding, full-depth content · async opt-in parent loop ·
glossary auto-grow behind admin approval · no public usernames anywhere ·
the curated-75 universe for anything kid-facing · 7-day cadence and the
5+2 edition system.

Also standing invariants (from ROADMAP.md preamble + CONTEXT.md):
- PROFANITY_RULE + `scrubProfanity()` in every new AI prompt.
- Every new user-data table goes into the `recordDeletionRequest()` COPPA scrub
  transaction (`src/storage.js`).
- All digest CSS lives in `src/template.js` tokens.
- Max 2 push notifications/kid/day; no guilt copy, ever.
- New modules must NOT read env vars at import time (macOS launchd gotcha —
  lazy-init like `src/ai.js` / `src/db.js`).

## Local quick facts

- Local port: **3199** (`PORT=3199 npm start`). 3101 belongs to another project.
- Test any date/edition: `DATE_OVERRIDE=YYYY-MM-DD node src/generate.js`
  (delete the test row from `daily_digests` afterward).
- Note: docs sometimes refer to the local path as `~/market-juice`; the actual
  working copy is `~/market-buzz-kids`.
