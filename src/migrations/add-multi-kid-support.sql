-- src/migrations/add-multi-kid-support.sql
-- Multi-Kid Support — one parent email can register multiple children.
--
-- The blocker: Phase 5/7 enforced ONE active user per parent email via a
-- partial UNIQUE index. To let siblings share a parent email we drop that
-- uniqueness and replace it with a plain (non-unique) lookup index for the
-- parent-email queries the multi-kid flows lean on.
--
-- We also add a new verification-token purpose 'add_child_consent' for the
-- abbreviated (known-parent) consent flow — the parent clicks a link in an
-- emailed consent message to activate each additional child.
--
-- runBootMigrations() in src/server.js applies this idempotently: it checks
-- information_schema for whether users_parent_email_active is still UNIQUE
-- and, if so, swaps it for the non-unique lookup index + expands the CHECK.

-- 1. Drop the one-active-user-per-email uniqueness.
DROP INDEX IF EXISTS users_parent_email_active;

-- 2. Replace with a plain lookup index (case-insensitive, active rows only).
--    Multi-kid signup / teaser dedup / password-reset / deletion all query
--    by parent email — this keeps those lookups fast without enforcing
--    uniqueness.
CREATE INDEX IF NOT EXISTS idx_users_parent_email
  ON users (LOWER(parent_email))
  WHERE deleted_at IS NULL;

-- 3. New token purpose for the abbreviated known-parent consent flow.
ALTER TABLE verification_tokens DROP CONSTRAINT IF EXISTS verification_tokens_purpose_check;
ALTER TABLE verification_tokens ADD CONSTRAINT verification_tokens_purpose_check
  CHECK (purpose IN ('email_verify', 'parental_consent', 'password_reset', 'add_child_consent'));
