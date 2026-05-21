# `public/data/` — curated game datasets

These JSON files are the **source of truth for facts** used by the games:
prices, splits, bankruptcies, revenue models. They are deliberately small
and high-confidence — accuracy matters more than volume here. Kids lose
trust if a number is wrong.

## Two-layer content architecture

For games whose content draws from a curated pool, the production design
splits into two layers:

| Layer | What it owns | Where it lives |
|---|---|---|
| **Static pool** (these files) | Verified facts that never change | committed JSON |
| **Daily Claude reframing** | Picks which scenario to use today, rewrites the framing and lesson body fresh each day | wired in Phase 6 — `src/ai.js` daily generator |

The Claude layer never invents prices or outcomes. It only reframes the
narrative around already-verified facts. So the same Blockbuster-bankruptcy
scenario can power dozens of different daily framings (some days framed
as "streaming wars," some as "why familiar brands feel safe," etc.)
without the underlying numbers ever drifting.

## Files

### `company-models.json`
- Used by: **Match the Company** game.
- Shape: array of `{ ticker, name, emoji, shortModel, surprise, principle }`.
- Daily selection: random 4 from the pool. With 37 entries, 37C4 ≈ 66k
  possible quads — no Claude layer needed for freshness.

### `time-machine-prices.json`
- Used by: **Time Machine Trade** game.
- Shape: array of scenarios. Each scenario has 4 `choices`. Each choice has:
  - `priceThen` — **unadjusted** historical close (matches era news / chart history)
  - `splitFactor` — cumulative splits since (so 1 share then = N shares now)
  - `status` — `active` (use approxNow for preview; production injects live), `bankrupt`, or `acquired`
  - `finalMultiplier` — for non-active stocks: $1 invested then → $finalMultiplier today
- Daily selection: rotate through scenarios. Phase 6: Claude picks based on
  "haven't used this one recently" + day's theme, and rewrites `framing` /
  `lessonBody` fresh each day.

### `historical-charts.json`
- Used by: **Bull or Bear** game.
- Shape: array of scenarios. Each has:
  - `contextShape` / `outcomeShape` — normalized monthly values (start at $100).
    Captures the trajectory of a real historical price move without
    claiming a specific dollar value for a specific ticker on a specific
    day. The chart the kid sees is **unlabeled** — no Y-axis, no dates,
    no ticker.
  - `actualDirection` / `actualReturnPct` — what actually happened in
    the outcome period. These are facts I can verify from memory for
    famous events.
  - `company`, `ticker`, `era`, `story`, `lessonBody`, `principle` —
    revealed only after the kid guesses.
- Daily selection: rotate through scenarios, biased away from
  recently-used. Phase 6: Claude picks + rewrites `story` /
  `lessonHeadline` / `lessonBody` daily; the chart facts stay locked.

## Adding new scenarios

Only add entries you can verify against multiple sources. The "leave it
out rather than guess" rule applies — better small and trustworthy than
big and shaky.

For historical prices, recommended sources:
- Yahoo Finance "Historical Data" tab (unadjusted close)
- Wikipedia article for the company's "Stock history"
- Original news from the era for context
