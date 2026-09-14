import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Pool } from 'pg';
import { GRACE_PERIOD_MS, runCleanupCycle } from '../../src/cleaner/cycle';
import { getTestPool, uniquePage } from '../testHelpers';

// Every assertion below is scoped to this test's own unique `page`, never
// to runCleanupCycle's returned totals - the raw/hourly tables are shared
// with every other test file running against the same database, and a
// cycle run here legitimately sweeps up whatever unrelated rows those
// other tests have left lying around (that's correct cleaner behavior,
// not test pollution), so a global count would be flaky by construction.
//
// `cutoff` always leaves the same GRACE_PERIOD_MS margin production code
// does (Date.now() - GRACE_PERIOD_MS), never a bare `new Date()`: other
// test files insert real rows into this same shared table concurrently,
// and a zero-margin cutoff is exactly the "in flight write not yet old
// enough" case this system is designed to protect against - using one
// here would race against those concurrent inserts instead of testing
// the boundary logic.
function testCutoff(): Date {
  return new Date(Date.now() - GRACE_PERIOD_MS);
}

async function insertRaw(pool: Pool, page: string, ts: string, insertedAt: Date): Promise<void> {
  await pool.query('INSERT INTO page_view_raw (page, ts, inserted_at) VALUES ($1, $2, $3)', [
    page,
    ts,
    insertedAt,
  ]);
}

test('aggregates multiple raw rows for the same page/hour into one hourly row', async () => {
  const pool = await getTestPool();
  const page = uniquePage();
  const cutoff = testCutoff();
  const old = new Date(cutoff.getTime() - 60_000);

  await insertRaw(pool, page, '2025-06-01T21:15:00.000Z', old);
  await insertRaw(pool, page, '2025-06-01T21:45:00.000Z', old);
  await insertRaw(pool, page, '2025-06-01T22:05:00.000Z', old);

  await runCleanupCycle(pool, cutoff);

  const { rows } = await pool.query(
    'SELECT hour_bucket, views FROM page_view_hourly WHERE page = $1 ORDER BY hour_bucket',
    [page],
  );
  assert.equal(rows.length, 2);
  assert.equal(new Date(rows[0].hour_bucket).toISOString(), '2025-06-01T21:00:00.000Z');
  assert.equal(Number(rows[0].views), 2);
  assert.equal(new Date(rows[1].hour_bucket).toISOString(), '2025-06-01T22:00:00.000Z');
  assert.equal(Number(rows[1].views), 1);

  const { rows: remaining } = await pool.query(
    'SELECT count(*)::int AS count FROM page_view_raw WHERE page = $1',
    [page],
  );
  assert.equal(remaining[0].count, 0);
});

test('batched delete removes exactly the rows at or before the cutoff and nothing inserted after it', async () => {
  const pool = await getTestPool();
  const page = uniquePage();
  const cutoff = testCutoff();
  const before = new Date(cutoff.getTime() - 1000);
  const after = new Date(cutoff.getTime() + 60_000);

  // More than one DELETE batch's worth (batch size is 5000), inserted in
  // a single bulk statement rather than one round trip per row.
  const oldRowCount = 5010;
  await pool.query(
    `INSERT INTO page_view_raw (page, ts, inserted_at)
     SELECT $1, $2::timestamptz, $3::timestamptz FROM generate_series(1, $4)`,
    [page, '2025-06-01T21:00:00.000Z', before, oldRowCount],
  );
  await insertRaw(pool, page, '2025-06-01T21:00:00.000Z', after);

  await runCleanupCycle(pool, cutoff);

  const { rows: remaining } = await pool.query(
    'SELECT count(*)::int AS count FROM page_view_raw WHERE page = $1',
    [page],
  );
  assert.equal(remaining[0].count, 1, 'only the row inserted after the cutoff should remain');

  const { rows: hourly } = await pool.query('SELECT views FROM page_view_hourly WHERE page = $1', [page]);
  assert.equal(hourly.length, 1);
  assert.equal(Number(hourly[0].views), oldRowCount, 'batching must not silently drop rows past the first 5000');
});

test('a row whose insert is still "in flight" (inserted_at after cutoff) is excluded regardless of its event time or insertion order', async () => {
  const pool = await getTestPool();
  const page = uniquePage();
  const cutoff = testCutoff();
  const before = new Date(cutoff.getTime() - 1000);
  const after = new Date(cutoff.getTime() + 60_000);

  // Inserted first but "commits" (inserted_at) after the cutoff - and its
  // own event ts is older than the other row's. Only inserted_at may
  // decide inclusion.
  await insertRaw(pool, page, '2025-06-01T10:00:00.000Z', after);
  await insertRaw(pool, page, '2025-06-01T21:00:00.000Z', before);

  await runCleanupCycle(pool, cutoff);

  const { rows: hourly } = await pool.query(
    'SELECT hour_bucket FROM page_view_hourly WHERE page = $1',
    [page],
  );
  assert.equal(hourly.length, 1);
  assert.equal(new Date(hourly[0].hour_bucket).toISOString(), '2025-06-01T21:00:00.000Z');

  const { rows: remaining } = await pool.query('SELECT ts FROM page_view_raw WHERE page = $1', [page]);
  assert.equal(remaining.length, 1);
  assert.equal(new Date(remaining[0].ts).toISOString(), '2025-06-01T10:00:00.000Z');
});

test('running a cycle twice against already-cleaned rows is a no-op', async () => {
  const pool = await getTestPool();
  const page = uniquePage();
  const cutoff = testCutoff();
  const before = new Date(cutoff.getTime() - 1000);

  await insertRaw(pool, page, '2025-06-01T21:00:00.000Z', before);
  await runCleanupCycle(pool, cutoff);
  await runCleanupCycle(pool, cutoff); // same cutoff, nothing left to pick up for this page

  const { rows: hourly } = await pool.query('SELECT views FROM page_view_hourly WHERE page = $1', [page]);
  assert.equal(hourly.length, 1);
  assert.equal(Number(hourly[0].views), 1, 'the second cycle must not double-count');

  const { rows: remaining } = await pool.query(
    'SELECT count(*)::int AS count FROM page_view_raw WHERE page = $1',
    [page],
  );
  assert.equal(remaining[0].count, 0);
});
