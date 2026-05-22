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

// Lazy pool init — same reasoning as the Anthropic lazy client in ai.js.
// In ESM, modules execute in dependency order: when generate.js imports
// digest-store.js → db.js, db.js's body runs BEFORE generate.js's body
// has had a chance to call dotenv.config(). If we constructed the Pool
// at module load, it'd see DATABASE_URL=undefined. Reading process.env
// at first-query time is safe and has no measurable cost.
let _pool = null;
function getPool() {
  if (_pool) return _pool;
  if (!process.env.DATABASE_URL) {
    console.warn('[db] DATABASE_URL not set — DB-backed routes will error until you set it.');
  }
  _pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  _pool.on('error', (err) => {
    console.error('[db] idle client error:', err.message);
  });
  return _pool;
}

// Backward-compat: a few callers may still reference `pool` directly.
// Make it a getter so the first access still triggers lazy init.
export const pool = new Proxy({}, {
  get(_t, prop) {
    const p = getPool();
    const v = p[prop];
    return typeof v === 'function' ? v.bind(p) : v;
  },
});

export function query(text, params) {
  return getPool().query(text, params);
}

export function getClient() {
  return getPool().connect();
}

export async function healthCheck() {
  const { rows } = await getPool().query('SELECT 1 AS ok');
  return rows[0]?.ok === 1;
}
