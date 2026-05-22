/**
 * src/db.js — Postgres connection pool (Phase 6.1).
 *
 * Single shared `pg.Pool` driven by DATABASE_URL. Neon requires SSL; we
 * pass `rejectUnauthorized: false` because Neon serves a chain that node's
 * default CA store doesn't always validate. That's fine — the connection
 * is still encrypted, we're just not verifying the cert chain.
 *
 * The pool is lazy: it doesn't open a socket until the first query. So
 * the server still boots without DATABASE_URL set — requests that hit
 * the DB will fail with a clear error, but static routes keep working.
 *
 * Helpers:
 *   query(text, params)  — one-shot query (acquires + releases for you)
 *   getClient()          — checkout a client for multi-statement transactions
 *   healthCheck()        — `SELECT 1`, returns true on success
 */

import pg from 'pg';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.warn('[db] DATABASE_URL not set — DB-backed routes will error until you set it.');
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Surface pool-level errors instead of letting them bubble as unhandled.
pool.on('error', (err) => {
  console.error('[db] idle client error:', err.message);
});

export function query(text, params) {
  return pool.query(text, params);
}

export function getClient() {
  return pool.connect();
}

export async function healthCheck() {
  const { rows } = await pool.query('SELECT 1 AS ok');
  return rows[0]?.ok === 1;
}
