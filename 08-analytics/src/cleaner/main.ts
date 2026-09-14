import 'dotenv/config';
import { Pool } from 'pg';
import { loadConfig } from '../config';
import { runMigrations } from '../db/migrate';
import { GRACE_PERIOD_MS, runCleanupCycle } from './cycle';

const CYCLE_INTERVAL_MS = 10_000;

async function sleep(ms: number, onCancel: (cancel: () => void) => void): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    onCancel(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = new Pool({ connectionString: config.databaseUrl });
  await runMigrations(pool);

  let stopped = false;
  let wakeEarly: (() => void) | null = null;

  const shutdown = (): void => {
    if (stopped) return;
    stopped = true;
    wakeEarly?.();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  console.log('cleaner started');

  // Stop scheduling new cycles once `stopped` flips, but always let a
  // cycle already in flight run to completion before the loop exits - a
  // routine deploy/restart should never abort mid-cycle.
  while (!stopped) {
    const cutoff = new Date(Date.now() - GRACE_PERIOD_MS);
    try {
      const result = await runCleanupCycle(pool, cutoff);
      console.log(`cleaner cycle done: upserted ${result.upsertedGroups} group(s), deleted ${result.deletedRows} row(s)`);
    } catch (err) {
      console.error('cleaner cycle failed', err);
    }

    if (stopped) break;
    await sleep(CYCLE_INTERVAL_MS, (cancel) => {
      wakeEarly = cancel;
    });
  }

  await pool.end();
  console.log('cleaner stopped');
}

void main();
