import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startTestApp, uniquePage } from '../testHelpers';

test('GET /report/:page zero-fills all 24 hours for a page with no data', async () => {
  const app = await startTestApp();
  try {
    const page = uniquePage();
    const res = await fetch(`${app.baseUrl}/report/${page}?now=2025-06-02T02:00:00.000Z`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.length, 24);
    assert.ok(body.data.every((row: { v: number }) => row.v === 0));
  } finally {
    await app.close();
  }
});

test('GET /report/:page respects order and take query params', async () => {
  const app = await startTestApp();
  try {
    const page = uniquePage();
    const res = await fetch(
      `${app.baseUrl}/report/${page}?now=2025-06-02T02:00:00.000Z&order=desc&take=3`,
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.length, 3);
    assert.equal(body.data[0].h, 2);
  } finally {
    await app.close();
  }
});

test('GET /report/:page with an invalid order returns 400', async () => {
  const app = await startTestApp();
  try {
    const page = uniquePage();
    const res = await fetch(`${app.baseUrl}/report/${page}?order=sideways`);
    assert.equal(res.status, 400);
  } finally {
    await app.close();
  }
});
