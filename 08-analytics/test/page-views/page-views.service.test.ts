import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PageViewsService } from '../../src/page-views/page-views.service';
import { getTestPool, uniquePage } from '../testHelpers';

test('recordSingle inserts one raw row for a valid payload', async () => {
  const pool = await getTestPool();
  const service = new PageViewsService(pool);
  const page = uniquePage();

  const result = await service.recordSingle({ page, timestamp: '2025-06-01T21:00:00.000Z' });
  assert.equal(result.kind, 'recorded');

  const { rows } = await pool.query('SELECT page, ts FROM page_view_raw WHERE page = $1', [page]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].page, page);
  assert.equal(new Date(rows[0].ts).toISOString(), '2025-06-01T21:00:00.000Z');
});

test('recordSingle rejects an invalid payload without touching the database', async () => {
  const pool = await getTestPool();
  const service = new PageViewsService(pool);

  const result = await service.recordSingle({ page: '', timestamp: 'not-a-date' });
  assert.equal(result.kind, 'invalid');
});

test('N concurrent single requests to the same page land as N raw rows with no lost writes', async () => {
  const pool = await getTestPool();
  const service = new PageViewsService(pool);
  const page = uniquePage();
  const concurrentRequests = 50;

  await Promise.all(
    Array.from({ length: concurrentRequests }, (_, i) =>
      service.recordSingle({ page, timestamp: new Date(Date.now() - i * 1000).toISOString() }),
    ),
  );

  const { rows } = await pool.query(
    'SELECT count(*)::int AS count FROM page_view_raw WHERE page = $1',
    [page],
  );
  assert.equal(rows[0].count, concurrentRequests);
});

test('recordMulti accumulates repeated batches for the same page/hour instead of overwriting', async () => {
  const pool = await getTestPool();
  const service = new PageViewsService(pool);
  const page = uniquePage();

  await service.recordMulti({ [page]: { '2025-06-01_21:00': 100 } });
  await service.recordMulti({ [page]: { '2025-06-01_21:00': 50 } });

  const { rows } = await pool.query('SELECT views FROM page_view_hourly WHERE page = $1', [page]);
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].views), 150);
});

test('recordMulti in one call handles a multi-page payload with multiple hours each', async () => {
  const pool = await getTestPool();
  const service = new PageViewsService(pool);
  const pageA = uniquePage('a');
  const pageB = uniquePage('b');

  const result = await service.recordMulti({
    [pageA]: { '2025-06-01_21:00': 10, '2025-06-01_22:00': 20 },
    [pageB]: { '2025-06-01_21:00': 30 },
  });
  assert.equal(result.kind, 'recorded');

  const { rows } = await pool.query(
    'SELECT page, hour_bucket, views FROM page_view_hourly WHERE page = ANY($1) ORDER BY page, hour_bucket',
    [[pageA, pageB]],
  );
  assert.equal(rows.length, 3);
  assert.equal(Number(rows[0].views), 10);
  assert.equal(Number(rows[1].views), 20);
  assert.equal(Number(rows[2].views), 30);
});

test('recordMulti rejects a malformed hour key', async () => {
  const pool = await getTestPool();
  const service = new PageViewsService(pool);
  const page = uniquePage();

  const result = await service.recordMulti({ [page]: { 'not-an-hour-key': 10 } });
  assert.equal(result.kind, 'invalid');
});
