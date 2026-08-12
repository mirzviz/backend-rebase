import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NodeRegistry } from '../src/nodeRegistry';

test('upsert of a new destination generates an id and stores it', () => {
  const registry = new NodeRegistry();
  const record = registry.upsert({ host: 'node-1', port: 8080 }, null);

  assert.ok(record.id.length > 0);
  assert.deepEqual(record.destination, { host: 'node-1', port: 8080 });
  assert.equal(record.name, null);
});

test('upsert of the same destination keeps the same id and overwrites the name', () => {
  const registry = new NodeRegistry();
  const first = registry.upsert({ host: 'node-1', port: 8080 }, 'original');
  const second = registry.upsert({ host: 'node-1', port: 8080 }, 'renamed');

  assert.equal(second.id, first.id);
  assert.equal(second.name, 'renamed');
  assert.equal(registry.list().length, 1);
});

test('upsert of the same destination with no name can clear a previously set name', () => {
  const registry = new NodeRegistry();
  registry.upsert({ host: 'node-1', port: 8080 }, 'original');
  const second = registry.upsert({ host: 'node-1', port: 8080 }, null);

  assert.equal(second.name, null);
});

test('different destinations get distinct ids and both appear in list()', () => {
  const registry = new NodeRegistry();
  const a = registry.upsert({ host: 'node-1', port: 8080 }, null);
  const b = registry.upsert({ host: 'node-2', port: 8080 }, null);

  assert.notEqual(a.id, b.id);
  assert.equal(registry.list().length, 2);
});

test('same host with a different port is a distinct node', () => {
  const registry = new NodeRegistry();
  const a = registry.upsert({ host: 'node-1', port: 8080 }, null);
  const b = registry.upsert({ host: 'node-1', port: 9090 }, null);

  assert.notEqual(a.id, b.id);
  assert.equal(registry.list().length, 2);
});

test('list() returns empty array for a fresh registry', () => {
  const registry = new NodeRegistry();
  assert.deepEqual(registry.list(), []);
});
