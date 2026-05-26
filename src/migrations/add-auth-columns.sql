-- src/migrations/add-auth-columns.sql
-- Phase 7: kid-facing username/password auth.
--
-- Adds two columns to `users` so we can log kids in directly, plus
-- expands the `verification_tokens.purpose` CHECK constraint so the
-- existing token machinery can carry password-reset tokens too.
--
-- Idempotent — safe to run repeatedly. server.js does run this on
-- boot when it detects the columns are missing, so most deployments
-- will not need to run this file by hand. It exists for documentation
-- and for one-shot manual runs against environments where the boot
-- migration didn't fire.

-- 1. Auth columns on users.
ALTER TABLE users ADD COLUMN IF NOT EXISTS username       VARCHAR(30);
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash  VARCHAR(255);

-- Case-insensitive uniqueness for username. Partial: NULL usernames
-- are common during the migration window (existing rows have NULL).
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_uniq
  ON users (LOWER(username))
  WHERE username IS NOT NULL;

-- 2. Expand verification_tokens.purpose to accept 'password_reset'.
-- Postgres doesn't have ALTER CONSTRAINT for CHECK — drop + add by
-- name. The constraint is auto-named verification_tokens_purpose_check.
ALTER TABLE verification_tokens
  DROP CONSTRAINT IF EXISTS verification_tokens_purpose_check;

ALTER TABLE verification_tokens
  ADD CONSTRAINT verification_tokens_purpose_check
  CHECK (purpose IN ('email_verify', 'parental_consent', 'password_reset'));
