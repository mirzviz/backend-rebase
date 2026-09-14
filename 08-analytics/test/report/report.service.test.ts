import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Pool } from 'pg';
import { ReportService } from '../../src/report/report.service';
import { getTestPool, uniquePage } from '../testHelpers';

async function seedHour(pool: Pool, page: string, isoHour: string, views: number): Promise<void> {
  await pool.query(
    `INSERT INTO page_view_hourly (page, hour_bucket, views) VALUES ($1, $2, $3)
     ON CONFLICT (page, hour_bucket) DO UPDATE SET views = EXCLUDED.views`,
    [page, isoHour, views],
  );
}

test('zero-fills hours with no data and orders ascending by default', async () => {
  const pool = await getTestPool();
  const service = new ReportService(pool);
  const page = uniquePage();
  const now = '2025-06-02T02:30:00.000Z'; // floors to 2025-06-02T02:00Z

  await seedHour(pool, page, '2025-06-02T00:00:00.000Z', 10);
  await seedHour(pool, page, '2025-06-01T21:00:00.000Z', 5);

  const result = await service.getReport(page, { now });
  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') return;

  // window is [2025-06-01T03:00Z .. 2025-06-02T02:00Z], 24 hours, ascending
  assert.equal(result.data.length, 24);
  assert.equal(result.data[0].h, 3);
  assert.equal(result.data[0].v, 0);

  const hour21 = result.data.find((r) => r.h === 21);
  assert.equal(hour21?.v, 5);
  const hour0 = result.data.find((r) => r.h === 0);
  assert.equal(hour0?.v, 10);
});

test('the 24-hour window rolls over midnight correctly', async () => {
  const pool = await getTestPool();
  const service = new ReportService(pool);
  const page = uniquePage();
  const now = '2025-06-02T00:40:00.000Z'; // floors to 2025-06-02T00:00Z

  await seedHour(pool, page, '2025-06-01T23:00:00.000Z', 7);
  await seedHour(pool, page, '2025-06-02T00:00:00.000Z', 9);

  const result = await service.getReport(page, { now });
  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') return;

  const last = result.data[result.data.length - 1];
  const secondToLast = result.data[result.data.length - 2];
  assert.equal(secondToLast.h, 23);
  assert.equal(secondToLast.v, 7);
  assert.equal(last.h, 0);
  assert.equal(last.v, 9);
});

test('order=desc returns the most recent hour first', async () => {
  const pool = await getTestPool();
  const service = new ReportService(pool);
  const page = uniquePage();
  const now = '2025-06-02T02:00:00.000Z';

  const result = await service.getReport(page, { now, order: 'desc' });
  assert.equal(result.kind, 'ok');
  if (result.kind !== 'ok') return;

  assert.equal(result.data[0].h, 2);
  assert.equal(result.data[result.data.length - 1].h, 3);
});

test('take clamps to [1, 24] and is applied after ordering', async () => {
  const pool = await getTestPool();
  const service = new ReportService(pool);
  const page = uniquePage();
  const now = '2025-06-02T02:00:00.000Z';

  const takeOne = await service.getReport(page, { now, take: '1' });
  if (takeOne.kind === 'ok') {
    assert.equal(takeOne.data.length, 1);
    assert.equal(takeOne.data[0].h, 3, 'take=1 with default order=asc returns the oldest hour');
  } else assert.fail('expected ok');

  const takeDescFive = await service.getReport(page, { now, order: 'desc', take: '5' });
  if (takeDescFive.kind === 'ok') {
    assert.equal(takeDescFive.data.length, 5);
    assert.equal(takeDescFive.data[0].h, 2, 'take=5 with order=desc returns the 5 most recent hours');
  } else assert.fail('expected ok');

  const takeAboveRange = await service.getReport(page, { now, take: '999' });
  if (takeAboveRange.kind === 'ok') assert.equal(takeAboveRange.data.length, 24);
  else assert.fail('expected ok');

  const takeBelowRange = await service.getReport(page, { now, take: '0' });
  if (takeBelowRange.kind === 'ok') assert.equal(takeBelowRange.data.length, 1);
  else assert.fail('expected ok');
});

test('an invalid order value is rejected', async () => {
  const pool = await getTestPool();
  const service = new ReportService(pool);
  const page = uniquePage();

  const result = await service.getReport(page, { order: 'sideways' });
  assert.equal(result.kind, 'invalid');
});
