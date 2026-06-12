-- Phase 17 — user_picks: Tomorrow's Call daily prediction (Phase 20 reuses
-- the table for Weekly Hold via kind='weekly-hold').
--
-- Forward-only migration: creates user_picks. Applied automatically by
-- runBootMigrations() in src/server.js when the table is absent (detected
-- via information_schema.tables); kept here for manual one-shots. Also in
-- schema.sql so fresh deploys are aligned.
--
-- Design notes:
--  - UNIQUE (user_id, kind, digest_date) IS the one-pick-per-digest dedup;
--    POST /api/picks inserts with ON CONFLICT DO NOTHING.
--  - target_date = getNextTradingDay(digest_date), INCLUSIVE of the digest
--    date (Friday's digest asks about Friday's own close; Sat/Sun target
--    Monday; holiday Mondays push to Tuesday).
--  - Resolution (src/picks.js#resolveTomorrowCalls) claims rows atomically
--    via `UPDATE ... WHERE resolved_at IS NULL`, so re-runs are idempotent.
--  - COPPA: deleted explicitly in storage.recordDeletionRequest()'s scrub
--    transaction (soft-delete means the CASCADE never fires).

CREATE TABLE IF NOT EXISTS user_picks (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT         NOT NULL CHECK (kind IN ('tomorrow-call', 'weekly-hold')),
  digest_date DATE         NOT NULL,
  target_date DATE         NOT NULL,
  pick        JSONB        NOT NULL,
  resolved_at TIMESTAMPTZ,
  outcome     JSONB,
  UNIQUE (user_id, kind, target_date)
);

CREATE INDEX IF NOT EXISTS idx_user_picks_unresolved
  ON user_picks (kind, target_date)
  WHERE resolved_at IS NULL;
