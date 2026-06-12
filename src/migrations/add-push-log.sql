-- Phase 15 — push notification ledger.
--
-- Forward-only migration: creates push_log. Applied automatically by
-- runBootMigrations() in src/server.js when the table is absent (detected
-- via information_schema.tables, same pattern as pending_glossary); kept
-- here for manual one-shots and as the documented DDL. Also in schema.sql
-- so fresh deploys are aligned.
--
-- Design notes:
--  - Ledger-before-send: src/push.js#tryLogPush INSERTs here BEFORE
--    delivering, so the hourly sweeps + manual re-triggers are idempotent.
--  - digest_date is the NY product day (todayNY()), the dedup key. The
--    unique index dedups per kind; the COUNT guard in tryLogPush enforces
--    the hard 2-pushes-per-kid-per-day cap.
--  - On a transient send failure the reserved row is deleted so the
--    failure doesn't consume the kid's daily slot.
--  - COPPA: deleted explicitly in storage.recordDeletionRequest()'s scrub
--    transaction (soft-delete means the CASCADE never fires).

CREATE TABLE IF NOT EXISTS push_log (
  id          BIGSERIAL    PRIMARY KEY,
  user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT         NOT NULL CHECK (kind IN ('morning', 'streak-risk')),
  digest_date DATE         NOT NULL,
  sent_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS push_log_user_kind_date_uniq
  ON push_log (user_id, kind, digest_date);
