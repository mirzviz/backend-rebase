import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLogger, Logger } from '../../src/logging';
import { NodeRegistry } from '../../src/nodeRegistry';
import { NodesService } from '../../src/nodes/nodes.service';
import { Config } from '../../src/config';

const OPEN_CONFIG: Config = { port: 0, registrationDurationSeconds: 20, logzio: null };

// @Injectable is just metadata - the class itself is a plain TS class, so
// tests can `new` it directly and skip Nest's module/DI machinery entirely.
// That's what keeps these tests instant: a "closed" window is simulated by
// backdating startedAt, not by waiting on a real timer.
function service(overrides: { startedAt?: number; logger?: Logger; registry?: NodeRegistry } = {}): NodesService {
  return new NodesService(
    overrides.registry ?? new NodeRegistry(),
    OPEN_CONFIG,
    overrides.startedAt ?? Date.now(),
    overrides.logger ?? createLogger(null, { log: () => {} }),
  );
}

test('registerNode rejects once the registration window has closed', () => {
  const registry = new NodeRegistry();
  const svc = service({ startedAt: Date.now() - 30_000, registry });

  const result = svc.register({ destination: { host: 'node-1', port: 8080 } });

  assert.equal(result.kind, 'registration-closed');
  assert.deepEqual(svc.list(), []);
});

test('registerNode reports invalid payloads without touching the registry', () => {
  const svc = service();

  const result = svc.register({ destination: { host: 'bad host!', port: 8080 } });

  assert.equal(result.kind, 'invalid');
  assert.equal(result.kind === 'invalid' && typeof result.error, 'string');
  assert.deepEqual(svc.list(), []);
});

test('registerNode stores a valid node and returns it', () => {
  const svc = service();

  const result = svc.register({ destination: { host: 'node-1', port: 8080 }, name: 'primary' });

  assert.equal(result.kind, 'registered');
  assert.ok(result.kind === 'registered' && result.record.id.length > 0);
  assert.equal(svc.list().length, 1);
});

test('registerNode upserts by destination', () => {
  const svc = service();

  const first = svc.register({ destination: { host: 'node-1', port: 8080 }, name: 'a' });
  const second = svc.register({ destination: { host: 'node-1', port: 8080 }, name: 'b' });

  assert.ok(first.kind === 'registered' && second.kind === 'registered');
  if (first.kind === 'registered' && second.kind === 'registered') {
    assert.equal(second.record.id, first.record.id);
    assert.equal(second.record.name, 'b');
  }
  assert.equal(svc.list().length, 1);
});

test('registerNode logs the registration on success, and only then', () => {
  const calls: unknown[] = [];
  const logger: Logger = { log: (...args) => calls.push(args) };

  service({ logger }).register({ destination: { host: 'bad host!', port: 8080 } });
  service({ logger, startedAt: Date.now() - 30_000 }).register({ destination: { host: 'node-1', port: 8080 } });
  assert.equal(calls.length, 0);

  service({ logger }).register({ destination: { host: 'node-1', port: 8080 } });
  assert.equal(calls.length, 1);
});

test('listNodes reflects whatever is in the registry', () => {
  const svc = service();
  svc.register({ destination: { host: 'a', port: 1 } });
  svc.register({ destination: { host: 'b', port: 2 } });

  assert.equal(svc.list().length, 2);
});
