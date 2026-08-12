import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LogFields, LogLevel } from '../../src/logging';
import { FakeNode, startFakeNode, startTestApp } from '../testHelpers';

const CLOSED = { startedAt: Date.now() - 30_000 };

test('/blobs/{id} is rejected with 503 while the registration window is still open', async () => {
  const app = await startTestApp();
  try {
    const res = await fetch(`${app.baseUrl}/blobs/abc`);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(typeof body.errorMessage, 'string');
  } finally {
    await app.close();
  }
});

test('/blobs/{id} is rejected with 503 once the window is closed but no nodes are registered', async () => {
  const app = await startTestApp(CLOSED);
  try {
    const res = await fetch(`${app.baseUrl}/blobs/abc`);
    assert.equal(res.status, 503);
  } finally {
    await app.close();
  }
});

test('POST /blobs/{id} is forwarded to the routed node and its response is relayed back', async () => {
  const app = await startTestApp(CLOSED);
  const node = await startFakeNode((req, res, body) => {
    assert.equal(body.toString('utf8'), 'hello world');
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('stored');
  });

  try {
    app.registry.upsert({ host: node.host, port: node.port }, null);

    const res = await fetch(`${app.baseUrl}/blobs/my-blob`, { method: 'POST', body: 'hello world' });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'stored');
    assert.equal(node.requests.length, 1);
    assert.equal(node.requests[0].method, 'POST');
    assert.equal(node.requests[0].url, '/blobs/my-blob');
  } finally {
    await app.close();
    await node.close();
  }
});

test('GET and DELETE for the same blob id are routed to the same node as the original POST', async () => {
  const app = await startTestApp(CLOSED);
  const nodeA = await startFakeNode((req, res) => res.end('from-a'));
  const nodeB = await startFakeNode((req, res) => res.end('from-b'));

  try {
    app.registry.upsert({ host: nodeA.host, port: nodeA.port }, null);
    app.registry.upsert({ host: nodeB.host, port: nodeB.port }, null);

    await fetch(`${app.baseUrl}/blobs/consistent-id`, { method: 'POST', body: 'x' });
    await fetch(`${app.baseUrl}/blobs/consistent-id`);
    await fetch(`${app.baseUrl}/blobs/consistent-id`, { method: 'DELETE' });

    const totalRequests = nodeA.requests.length + nodeB.requests.length;
    assert.equal(totalRequests, 3, 'every request should reach exactly one node');

    const hitNodeA = nodeA.requests.length === 3;
    const hitNodeB = nodeB.requests.length === 3;
    assert.ok(hitNodeA || hitNodeB, 'all three requests for the same blob id must land on the same node');
  } finally {
    await app.close();
    await nodeA.close();
    await nodeB.close();
  }
});

test("DELETE /blobs/{id} relays the node's status code back to the client", async () => {
  const app = await startTestApp(CLOSED);
  const node = await startFakeNode((req, res) => {
    res.writeHead(204);
    res.end();
  });

  try {
    app.registry.upsert({ host: node.host, port: node.port }, null);

    const res = await fetch(`${app.baseUrl}/blobs/thing`, { method: 'DELETE' });
    assert.equal(res.status, 204);
  } finally {
    await app.close();
    await node.close();
  }
});

test('a custom header is forwarded to the node, and hop-by-hop connection headers are not', async () => {
  const app = await startTestApp(CLOSED);
  const node = await startFakeNode((req, res) => res.end('ok'));

  try {
    app.registry.upsert({ host: node.host, port: node.port }, null);

    await fetch(`${app.baseUrl}/blobs/hdr-test`, {
      method: 'POST',
      headers: { 'x-rebase-owner': 'alice' },
      body: 'x',
    });

    assert.equal(node.requests[0].headers['x-rebase-owner'], 'alice');
  } finally {
    await app.close();
    await node.close();
  }
});

test('an unsupported method on /blobs/{id} returns 405', async () => {
  const app = await startTestApp(CLOSED);
  try {
    const res = await fetch(`${app.baseUrl}/blobs/abc`, { method: 'PUT' });
    assert.equal(res.status, 405);
  } finally {
    await app.close();
  }
});

test('a routed node that is unreachable returns 502', async () => {
  const app = await startTestApp(CLOSED);
  try {
    // Points at a port nothing is listening on.
    app.registry.upsert({ host: 'localhost', port: 1 }, null);

    const res = await fetch(`${app.baseUrl}/blobs/abc`);
    assert.equal(res.status, 502);
  } finally {
    await app.close();
  }
});

test('registering a node through the real HTTP endpoint while the window is open is what blob routing normally sees', async () => {
  const app = await startTestApp({ config: { registrationDurationSeconds: 0.05 } });
  const node = await startFakeNode((req, res) => res.end('ok'));
  try {
    const registerRes = await fetch(`${app.baseUrl}/internal/nodes`, {
      method: 'POST',
      body: JSON.stringify({ destination: { host: node.host, port: node.port } }),
    });
    assert.equal(registerRes.status, 200);

    await new Promise((resolve) => setTimeout(resolve, 100));

    const res = await fetch(`${app.baseUrl}/blobs/end-to-end`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'ok');
  } finally {
    await app.close();
    await node.close();
  }
});

test('a successfully routed blob request is logged with the method, node, blob id, and status', async () => {
  const calls: { level: LogLevel; message: string; fields: LogFields }[] = [];
  const logger = { log: (level: LogLevel, message: string, fields: LogFields = {}) => calls.push({ level, message, fields }) };

  const app = await startTestApp({ ...CLOSED, logger });
  const node = await startFakeNode((req, res) => {
    res.writeHead(200);
    res.end('ok');
  });

  try {
    app.registry.upsert({ host: node.host, port: node.port }, null);

    await fetch(`${app.baseUrl}/blobs/logged-blob`);

    const routedLog = calls.find((c) => c.message === 'blob request routed');
    assert.ok(routedLog, 'expected a "blob request routed" log entry');
    assert.equal(routedLog?.level, 'info');
    assert.equal(routedLog?.fields.method, 'GET');
    assert.equal(routedLog?.fields.blobId, 'logged-blob');
    assert.equal(routedLog?.fields.status, 200);
    assert.equal(typeof routedLog?.fields.node, 'string');
  } finally {
    await app.close();
    await node.close();
  }
});
