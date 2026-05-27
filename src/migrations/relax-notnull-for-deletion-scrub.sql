-- src/migrations/relax-notnull-for-deletion-scrub.sql
-- COPPA deletion compliance: allow PII columns to be NULL on
-- soft-deleted user rows.
--
-- Before this migration the row physically remained but kept every field
-- intact (kid name, age, parent email, password hash, etc.) — which
-- doesn't satisfy COPPA's "delete on request" obligation.
--
-- storage.recordDeletionRequest() now scrubs PII inside the same
-- transaction that sets deleted_at. To make the scrub possible, the
-- NOT NULL constraints on parent_email and kid_age have to go. The
-- CHECK on kid_age stays (CHECK passes on NULL, so it's still satisfied).
-- kid_first_name keeps its NOT NULL because we set it to the sentinel
-- string 'deleted' instead of NULL, so any downstream code that
-- dereferences it without a null guard still gets a string.
--
-- Idempotent — safe to run repeatedly. server.js runs this on boot
-- when it detects the constraint is still in place; this file is kept
-- for documentation and manual one-shot runs.

ALTER TABLE users ALTER COLUMN parent_email DROP NOT NULL;
ALTER TABLE users ALTER COLUMN kid_age      DROP NOT NULL;
