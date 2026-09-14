import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startTestApp, uniquePage } from '../testHelpers';

test('POST /page-views/single/ happy path returns 200 and persists the row', async () => {
  const app = await startTestApp();
  try {
    const page = uniquePage();
    const res = await fetch(`${app.baseUrl}/page-views/single/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ page, timestamp: '2025-06-01T21:00:00.000Z' }),
    });
    assert.equal(res.status, 200);

    const { rows } = await app.pool.query('SELECT * FROM page_view_raw WHERE page = $1', [page]);
    assert.equal(rows.length, 1);
  } finally {
    await app.close();
  }
});

test('POST /page-views/single/ with an invalid body returns 400', async () => {
  const app = await startTestApp();
  try {
    const res = await fetch(`${app.baseUrl}/page-views/single/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ page: '', timestamp: 'nope' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(typeof body.errorMessage, 'string');
  } finally {
    await app.close();
  }
});

test('POST /page-views/multi/ with a multi-page payload returns 200 and persists all pairs', async () => {
  const app = await startTestApp();
  try {
    const pageA = uniquePage('a');
    const pageB = uniquePage('b');
    const res = await fetch(`${app.baseUrl}/page-views/multi/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        [pageA]: { '2025-06-01_21:00': 103 },
        [pageB]: { '2025-06-01_21:00': 838, '2025-06-01_22:00': 654 },
      }),
    });
    assert.equal(res.status, 200);

    const { rows } = await app.pool.query(
      'SELECT page, views FROM page_view_hourly WHERE page = ANY($1)',
      [[pageA, pageB]],
    );
    assert.equal(rows.length, 3);
  } finally {
    await app.close();
  }
});

test('POST /page-views/multi/ repeated for the same page/hour accumulates over HTTP too', async () => {
  const app = await startTestApp();
  try {
    const page = uniquePage();
    const send = (views: number) =>
      fetch(`${app.baseUrl}/page-views/multi/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [page]: { '2025-06-01_21:00': views } }),
      });

    await send(100);
    await send(25);

    const { rows } = await app.pool.query('SELECT views FROM page_view_hourly WHERE page = $1', [page]);
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].views), 125);
  } finally {
    await app.close();
  }
});
