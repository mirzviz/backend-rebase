import * as fs from 'node:fs';
import * as path from 'node:path';
import { Pool } from 'pg';

// Single source of truth for the schema (see ../../docs/design.md) - the
// same file is applied by the api on boot, the cleaner on boot, and the
// test harness, so all three can never drift apart. Statements use
// CREATE TABLE/INDEX IF NOT EXISTS, so running this more than once is
// meant to be a harmless no-op.
//
// Resolved from process.cwd(), not __dirname: __dirname would point into
// dist/src/db after compilation, but migrations/ is plain SQL that's
// never compiled - it's copied to the image/checked out next to
// package.json instead, so the project root (cwd when run via `npm
// start`/`node dist/src/main.js`/the Docker WORKDIR) is the stable anchor.
const MIGRATIONS_DIR = path.join(process.cwd(), 'migrations');

// Arbitrary constant, just needs to be consistent across every process
// that calls this function. `CREATE TABLE/INDEX IF NOT EXISTS` is *not*
// safe against two sessions running it at the same instant - both can
// pass the "does it exist" check before either commits, so Postgres's own
// catalog unique index still raises a duplicate-key error underneath it.
// That race is real here: the api and cleaner containers both migrate on
// boot and can start at the same moment, and this repo's test suite runs
// each test file as its own process, several of which call this
// concurrently too. A session-level advisory lock serializes those
// callers instead of racing them.
const MIGRATION_LOCK_KEY = 728_391_005;

export async function runMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
      for (const file of files) {
        const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
        await client.query(sql);
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}
