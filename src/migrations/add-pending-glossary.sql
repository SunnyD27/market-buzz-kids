-- src/migrations/add-pending-glossary.sql
-- Glossary auto-grow — AI nomination gate.
--
-- Adds the pending_glossary table: AI-nominated financial terms that appear in
-- a day's digest but aren't in the static seed glossary (src/glossary.js).
-- Proposals land here as 'pending' and surface on /admin for approve / edit /
-- reject. Nothing reaches kids until an adult approves; approved rows are
-- merged with the seed at render time (src/glossary-runtime.js), so the
-- glossary grows live with no redeploy.
--
-- Dedup is on LOWER(term): a re-nominated term bumps times_seen +
-- last_seen_date instead of duplicating, so recurring terms float up the queue.
-- Rejected rows are KEPT (status='rejected') so the same term isn't
-- re-nominated into the queue forever.
--
-- COPPA: these are AI-generated market-vocabulary rows, NOT user PII — out of
-- scope for the deletion scrub in storage.recordDeletionRequest().
--
-- runBootMigrations() in src/server.js applies this idempotently (detects the
-- table's presence). This file is kept for documentation + one-shot manual runs.

CREATE TABLE IF NOT EXISTS pending_glossary (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  term            TEXT         NOT NULL,
  definition      TEXT         NOT NULL,
  principle       INT,
  status          TEXT         NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected')),
  times_seen      INT          NOT NULL DEFAULT 1,
  first_seen_date TEXT,
  last_seen_date  TEXT,
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS pending_glossary_term_lower_uniq
  ON pending_glossary (LOWER(term));

CREATE INDEX IF NOT EXISTS pending_glossary_status_idx
  ON pending_glossary (status, times_seen DESC);
