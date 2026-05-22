/**
 * One-shot: load .env, read src/schema.sql, execute it against the Neon DB,
 * print a summary of created tables/indexes. Safe to run multiple times —
 * schema.sql uses `IF NOT EXISTS` throughout.
 *
 * Usage: node scripts/run-schema.js
 */
import dotenv from 'dotenv';
dotenv.config({ override: true });
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set. Aborting.');
  process.exit(1);
}

const sql = fs.readFileSync(path.join(__dirname, '..', 'src', 'schema.sql'), 'utf8');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const start = Date.now();
try {
  await client.connect();
  console.log(`[schema] connected (${Date.now() - start}ms). Executing schema.sql…`);
  await client.query(sql);
  console.log('[schema] schema.sql executed without error.');

  // Inventory check
  const tables = await client.query(`
    SELECT table_name
      FROM information_schema.tables
     WHERE table_schema = 'public'
     ORDER BY table_name`);
  const indexes = await client.query(`
    SELECT indexname, tablename
      FROM pg_indexes
     WHERE schemaname = 'public'
     ORDER BY tablename, indexname`);

  console.log('\nTables:');
  for (const r of tables.rows) console.log('  -', r.table_name);
  console.log('\nIndexes:');
  for (const r of indexes.rows) console.log(`  - ${r.tablename}.${r.indexname}`);
  console.log('');
  console.log(`Done in ${Date.now() - start}ms.`);
} catch (err) {
  console.error('[schema] FAILED:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
