import assert from 'node:assert/strict';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { test } from 'node:test';
import {
  AutoRegistrationConfig,
  loadAutoRegistrationConfig,
  registerWithMaster,
} from './autoRegistration';

// --- Fake load balancer --------------------------------------------------

interface FakeLb {
  port: number;
  bodies: unknown[];
  close: () => Promise<void>;
}

type LbHandler = (res: http.ServerResponse, attempt: number, body: unknown) => void;

function startFakeLb(handler: LbHandler): Promise<FakeLb> {
  const bodies: unknown[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        // leave as null
      }
      const attempt = bodies.length;
      bodies.push(parsed);
      handler(res, attempt, parsed);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: (server.address() as AddressInfo).port,
        bodies,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

// --- Helpers -----------------------------------------------------------

function configFor(masterPort: number, over: Partial<AutoRegistrationConfig> = {}): AutoRegistrationConfig {
  return {
    master: { host: '127.0.0.1', port: masterPort },
    self: { host: 'localhost', port: 9999, name: null },
    retryForMs: 500,
    attemptTimeoutMs: 200,
    retryDelayMs: 10,
    ...over,
  };
}

function collectingLogger() {
  const lines: string[] = [];
  return {
    lines,
    log: (m: string) => lines.push(`log: ${m}`),
    warn: (m: string) => lines.push(`warn: ${m}`),
    error: (m: string) => lines.push(`error: ${m}`),
  };
}

async function reservedClosedPort(): Promise<number> {
  // Bind to an ephemeral port, read it, then release it - so nothing is
  // listening there when the test connects, forcing ECONNREFUSED.
  const server = http.createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}

// --- loadAutoRegistrationConfig --------------------------------------------

test('loadAutoRegistrationConfig returns null when MASTER_NODE_ADDRESS is unset', () => {
  assert.equal(loadAutoRegistrationConfig({}, 3000), null);
});

test('loadAutoRegistrationConfig parses the master address, advertised host and name', () => {
  const config = loadAutoRegistrationConfig(
    { MASTER_NODE_ADDRESS: 'lb-host:8080', ADVERTISED_HOST: 'node-7', NODE_NAME: 'storage-a' },
    4000,
  );
  assert.deepEqual(config?.master, { host: 'lb-host', port: 8080 });
  assert.deepEqual(config?.self, { host: 'node-7', port: 4000, name: 'storage-a' });
  assert.equal(config?.retryForMs, 30_000);
});

test('loadAutoRegistrationConfig tolerates an http:// prefix and defaults the advertised host', () => {
  const config = loadAutoRegistrationConfig({ MASTER_NODE_ADDRESS: 'http://lb:3000/' }, 4000);
  assert.deepEqual(config?.master, { host: 'lb', port: 3000 });
  assert.equal(config?.self.host, 'localhost');
  assert.equal(config?.self.name, null);
});

test('loadAutoRegistrationConfig throws on an unparseable address', () => {
  assert.throws(() => loadAutoRegistrationConfig({ MASTER_NODE_ADDRESS: 'no-port-here' }, 4000));
});

// --- registerWithMaster --------------------------------------------------

test('registers successfully and sends the expected payload', async () => {
  const lb = await startFakeLb((res) => sendJson(res, 200, { id: 'node-abc' }));
  const logger = collectingLogger();
  try {
    const outcome = await registerWithMaster(
      configFor(lb.port, { self: { host: 'localhost', port: 4321, name: 'blob-1' } }),
      logger,
    );

    assert.deepEqual(outcome, { kind: 'registered', id: 'node-abc' });
    assert.deepEqual(lb.bodies, [
      { destination: { host: 'localhost', port: 4321 }, name: 'blob-1' },
    ]);
    assert.ok(logger.lines.some((l) => l.includes('assigned node id node-abc')));
  } finally {
    await lb.close();
  }
});

test('retries while the load balancer returns 5xx, then succeeds', async () => {
  const lb = await startFakeLb((res, attempt) => {
    if (attempt < 2) {
      sendJson(res, 503, { errorMessage: 'not ready' });
    } else {
      sendJson(res, 200, { id: 'node-xyz' });
    }
  });
  const logger = collectingLogger();
  try {
    const outcome = await registerWithMaster(configFor(lb.port), logger);
    assert.deepEqual(outcome, { kind: 'registered', id: 'node-xyz' });
    assert.equal(lb.bodies.length, 3);
  } finally {
    await lb.close();
  }
});

test('treats a per-attempt timeout as retryable', async () => {
  const lb = await startFakeLb((res, attempt) => {
    if (attempt === 0) return; // hang - client should abort and retry
    sendJson(res, 200, { id: 'node-slow' });
  });
  const logger = collectingLogger();
  try {
    const outcome = await registerWithMaster(
      configFor(lb.port, { attemptTimeoutMs: 40, retryForMs: 2000 }),
      logger,
    );
    assert.deepEqual(outcome, { kind: 'registered', id: 'node-slow' });
    assert.ok(logger.lines.some((l) => l.includes('timed out')));
  } finally {
    await lb.close();
  }
});

test('gives up after the retry budget when the load balancer never answers', async () => {
  const deadPort = await reservedClosedPort();
  const logger = collectingLogger();

  const startedAt = Date.now();
  const outcome = await registerWithMaster(
    configFor(deadPort, { retryForMs: 120, retryDelayMs: 15 }),
    logger,
  );

  assert.equal(outcome.kind, 'gave-up');
  // Budget is real wall-clock time, not an attempt count.
  assert.ok(Date.now() - startedAt >= 120);
  assert.ok(logger.lines.some((l) => l.startsWith('error:') && l.includes('gave up')));
});

test('does not retry when the load balancer rejects the payload with 400', async () => {
  const lb = await startFakeLb((res) => sendJson(res, 400, { errorMessage: 'bad host' }));
  const logger = collectingLogger();
  try {
    const outcome = await registerWithMaster(configFor(lb.port), logger);
    assert.deepEqual(outcome, { kind: 'rejected', status: 400, message: 'bad host' });
    assert.equal(lb.bodies.length, 1);
  } finally {
    await lb.close();
  }
});

test('does not retry when the registration window is already closed (403)', async () => {
  const lb = await startFakeLb((res) =>
    sendJson(res, 403, { errorMessage: 'the request was rejected because registration period is over' }),
  );
  const logger = collectingLogger();
  try {
    const outcome = await registerWithMaster(configFor(lb.port), logger);
    assert.equal(outcome.kind, 'rejected');
    assert.equal(lb.bodies.length, 1);
  } finally {
    await lb.close();
  }
});
