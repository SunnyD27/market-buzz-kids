-- src/migrations/add-delete-data-token.sql
-- Token-gated data deletion (security audit Fix 5).
--
-- The parent-initiated deletion flow used to be gated only by knowing the
-- parent email — anyone could enter an email and see/delete that family's
-- child accounts. The flow now requires a single-use, 1-hour 'delete_data'
-- token emailed to the parent before any child data is shown or deleted.
--
-- This adds 'delete_data' to the verification_tokens.purpose CHECK. Postgres
-- has no ALTER CONSTRAINT for CHECKs, so we drop + re-add by name (the
-- constraint is auto-named verification_tokens_purpose_check).
--
-- runBootMigrations() in src/server.js applies this idempotently: it reads the
-- live constraint definition via pg_get_constraintdef() and only rewrites it
-- when 'delete_data' is missing. This file is kept for documentation and
-- one-shot manual runs.

ALTER TABLE verification_tokens DROP CONSTRAINT IF EXISTS verification_tokens_purpose_check;
ALTER TABLE verification_tokens ADD CONSTRAINT verification_tokens_purpose_check
  CHECK (purpose IN ('email_verify', 'parental_consent', 'password_reset', 'add_child_consent', 'delete_data'));
