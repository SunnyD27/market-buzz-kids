-- src/migrations/add-session-version-and-activity.sql
-- Security audit follow-up (Fix 12 + Fix 17).
--
-- session_version: invalidates old session cookies on password reset. The
--   signed mj_session cookie carries "${userId}:${session_version}"; a reset
--   bumps the column so previously-issued cookies stop validating in
--   requireAuth. See src/auth.js + the reset handler in src/server.js.
--
-- last_active_at: drives the 12-month inactivity sweep
--   (storage.cleanupInactiveAccounts). Stamped on login and, debounced to
--   once/day, on authenticated digest/progress views.
--
-- runBootMigrations() in src/server.js applies these idempotently
-- (ADD COLUMN IF NOT EXISTS). This file is kept for documentation and
-- one-shot manual runs.

ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at  TIMESTAMPTZ;
