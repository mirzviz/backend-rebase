import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startTestApp, TestApp, wait } from '../testHelpers';

let ctx: TestApp;

before(async () => {
  ctx = await startTestApp();
});

after(async () => {
  await ctx.close();
});

test('POST /internal/nodes registers a node and returns a generated id', async () => {
  const res = await fetch(`${ctx.baseUrl}/internal/nodes`, {
    method: 'POST',
    body: JSON.stringify({ destination: { host: 'node-1', port: 8080 } }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(typeof body.id, 'string');
  assert.ok(body.id.length > 0);
});

test('POST /internal/nodes with the same destination twice returns the same id and updates the name', async () => {
  const first = await fetch(`${ctx.baseUrl}/internal/nodes`, {
    method: 'POST',
    body: JSON.stringify({ destination: { host: 'node-2', port: 9090 }, name: 'original' }),
  });
  const firstBody = await first.json();

  const second = await fetch(`${ctx.baseUrl}/internal/nodes`, {
    method: 'POST',
    body: JSON.stringify({ destination: { host: 'node-2', port: 9090 }, name: 'renamed' }),
  });
  const secondBody = await second.json();

  assert.equal(secondBody.id, firstBody.id);

  const list = await (await fetch(`${ctx.baseUrl}/internal/nodes`)).json();
  const entry = list.data.find((n: { id: string }) => n.id === firstBody.id);
  assert.equal(entry.name, 'renamed');
});

test('POST /internal/nodes rejects an invalid payload with 400 and an errorMessage', async () => {
  const res = await fetch(`${ctx.baseUrl}/internal/nodes`, {
    method: 'POST',
    body: JSON.stringify({ destination: { host: 'bad host!', port: 8080 } }),
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(typeof body.errorMessage, 'string');
});

test('POST /internal/nodes rejects malformed JSON with 400', async () => {
  const res = await fetch(`${ctx.baseUrl}/internal/nodes`, { method: 'POST', body: '{not json' });
  assert.equal(res.status, 400);
});

test('POST /internal/nodes rejects a body over the size limit with 413, not 400', async () => {
  const oversized = JSON.stringify({ destination: { host: 'a'.repeat(200_000), port: 8080 } });
  const res = await fetch(`${ctx.baseUrl}/internal/nodes`, { method: 'POST', body: oversized });
  assert.equal(res.status, 413);
  // Comes from express.json()'s own size-limit rejection, not our own
  // validation - Nest's default error shape ({message, error, statusCode})
  // here, not the {errorMessage} shape our own validation errors use.
  const body = await res.json();
  assert.equal(typeof body.message, 'string');
});

test('GET /internal/nodes on a fresh server returns an empty data list', async () => {
  const fresh = await startTestApp();
  try {
    const res = await fetch(`${fresh.baseUrl}/internal/nodes`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { data: [] });
  } finally {
    await fresh.close();
  }
});

test('GET /internal/nodes represents a missing name as null', async () => {
  const fresh = await startTestApp();
  try {
    await fetch(`${fresh.baseUrl}/internal/nodes`, {
      method: 'POST',
      body: JSON.stringify({ destination: { host: 'node-x', port: 1111 } }),
    });

    const list = await (await fetch(`${fresh.baseUrl}/internal/nodes`)).json();
    assert.equal(list.data.length, 1);
    assert.equal(list.data[0].name, null);
    assert.deepEqual(list.data[0].destination, { host: 'node-x', port: 1111 });
  } finally {
    await fresh.close();
  }
});

test('both /internal/nodes and /internal/nodes/ (trailing slash) work', async () => {
  const withSlash = await fetch(`${ctx.baseUrl}/internal/nodes/`);
  assert.equal(withSlash.status, 200);
});

test('an unknown route returns 404', async () => {
  const res = await fetch(`${ctx.baseUrl}/nonsense`);
  assert.equal(res.status, 404);
});

test('POST /internal/nodes is rejected once the registration window has closed', async () => {
  const closed = await startTestApp({ startedAt: Date.now() - 30_000, config: { registrationDurationSeconds: 20 } });
  try {
    const res = await fetch(`${closed.baseUrl}/internal/nodes`, {
      method: 'POST',
      body: JSON.stringify({ destination: { host: 'too-late', port: 8080 } }),
    });

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.errorMessage, 'the request was rejected because registration period is over');
  } finally {
    await closed.close();
  }
});

test('the window actually closes in real time too, not just via backdating', async () => {
  const shortWindow = await startTestApp({ config: { registrationDurationSeconds: 0.05 } });
  try {
    await wait(100);
    const res = await fetch(`${shortWindow.baseUrl}/internal/nodes`, {
      method: 'POST',
      body: JSON.stringify({ destination: { host: 'too-late', port: 8080 } }),
    });
    assert.equal(res.status, 403);
  } finally {
    await shortWindow.close();
  }
});

test('GET /internal/nodes still works after the registration window has closed', async () => {
  const closed = await startTestApp({ startedAt: Date.now() - 30_000 });
  try {
    const res = await fetch(`${closed.baseUrl}/internal/nodes`);
    assert.equal(res.status, 200);
  } finally {
    await closed.close();
  }
});
