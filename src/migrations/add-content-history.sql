-- Phase 16 — content_history: AI content rotation moves to Postgres.
--
-- Forward-only migration: creates content_history. Applied automatically by
-- runBootMigrations() in src/server.js when the table is absent (detected
-- via information_schema.tables); kept here for manual one-shots. Also in
-- schema.sql so fresh deploys are aligned.
--
-- Replaces state/content-history.json (ephemeral on Railway — wiped on every
-- container restart). Kinds: 'word' (Word of the Day), 'fact' (Did You
-- Know), 'mystery' (Mystery Mover answer tickers, 30-day no-repeat). The old
-- state file is NOT migrated — it was ephemeral anyway; worst case is a
-- short-term word/fact repeat right after this ships.
--
-- COPPA: rotation metadata, not user PII — out of the deletion scrub.

CREATE TABLE IF NOT EXISTS content_history (
  id          BIGSERIAL    PRIMARY KEY,
  kind        TEXT         NOT NULL CHECK (kind IN ('word', 'fact', 'mystery')),
  value       TEXT         NOT NULL,
  used_on     DATE         NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_history_kind_date
  ON content_history (kind, used_on DESC);
