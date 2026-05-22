/**
 * Quick read-only snapshot of the four tables. Useful for confirming
 * signup/consent flows wrote what we expect. Safe to run anytime.
 *
 * Usage: node scripts/inspect-db.js
 */
import dotenv from 'dotenv';
dotenv.config({ override: true });
import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

async function q(label, sql) {
  const { rows } = await client.query(sql);
  console.log(`\n── ${label} (${rows.length}) ────────────────`);
  for (const r of rows) console.log(r);
}

await q('users', `
  SELECT id, parent_email, kid_first_name, kid_age,
         consent_required, consent_given, email_verified, is_active,
         consent_timestamp, deleted_at, signup_at
    FROM users
   ORDER BY signup_at DESC
   LIMIT 5`);

await q('verification_tokens', `
  SELECT LEFT(token, 12) AS token_prefix, user_id, purpose, used_at, expires_at
    FROM verification_tokens
   ORDER BY created_at DESC
   LIMIT 5`);

await q('deletion_requests', `
  SELECT id, parent_email, matched_user_id, processed_method, requested_at
    FROM deletion_requests
   ORDER BY requested_at DESC
   LIMIT 5`);

await client.end();
