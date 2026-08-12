import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLogger } from '../../src/logging';
import { NodeRecord, NodeRegistry } from '../../src/nodeRegistry';
import { BlobsService, pickNode, stripHopByHopHeaders } from '../../src/blobs/blobs.service';
import { Config } from '../../src/config';

const OPEN_CONFIG: Config = { port: 0, registrationDurationSeconds: 20, logzio: null };

function service(overrides: { startedAt?: number; registry?: NodeRegistry } = {}): BlobsService {
  return new BlobsService(
    overrides.registry ?? new NodeRegistry(),
    OPEN_CONFIG,
    overrides.startedAt ?? Date.now() - 30_000,
    createLogger(null, { log: () => {} }),
  );
}

test('route reports not-ready while the registration window is still open', () => {
  const svc = service({ startedAt: Date.now() });
  assert.equal(svc.route('blob-1').kind, 'not-ready');
});

test('route reports no-nodes once the window is closed but nothing is registered', () => {
  assert.equal(service().route('blob-1').kind, 'no-nodes');
});

test('route picks a registered node once the window is closed', () => {
  const registry = new NodeRegistry();
  registry.upsert({ host: 'node-1', port: 8080 }, null);
  const result = service({ registry }).route('blob-1');

  assert.equal(result.kind, 'routed');
  assert.ok(result.kind === 'routed' && result.node.destination.host === 'node-1');
});

test('route is consistent for the same blob id across calls', () => {
  const registry = new NodeRegistry();
  registry.upsert({ host: 'node-1', port: 8080 }, null);
  registry.upsert({ host: 'node-2', port: 8080 }, null);
  const svc = service({ registry });

  assert.deepEqual(svc.route('same-id'), svc.route('same-id'));
});

// pickNode is the pure hash-routing function BlobsService.route delegates
// to - tested directly here since it's exported, without needing a whole
// service/registry around it.
function node(id: string): NodeRecord {
  return { id, destination: { host: `host-${id}`, port: 8080 }, name: null };
}

test('pickNode returns undefined with no nodes to route to', () => {
  assert.equal(pickNode([], 'blob-1'), undefined);
});

test('pickNode is independent of node order, so a POST and a later GET/DELETE agree', () => {
  const nodes = [node('a'), node('b'), node('c')];
  const reordered = [node('c'), node('a'), node('b')];
  assert.equal(pickNode(nodes, 'blob-xyz')?.id, pickNode(reordered, 'blob-xyz')?.id);
});

test('pickNode spreads distinct blob ids across more than one node', () => {
  const nodes = [node('a'), node('b'), node('c'), node('d'), node('e')];
  const chosen = new Set(Array.from({ length: 200 }, (_, i) => pickNode(nodes, `blob-${i}`)?.id));
  assert.ok(chosen.size > 1, `expected more than one distinct node, got ${chosen.size}`);
});

test('stripHopByHopHeaders strips connection-specific headers', () => {
  const filtered = stripHopByHopHeaders({
    connection: 'keep-alive',
    'transfer-encoding': 'chunked',
    upgrade: 'websocket',
  });
  assert.deepEqual(filtered, {});
});

test('stripHopByHopHeaders passes through headers that describe the resource', () => {
  const filtered = stripHopByHopHeaders({ 'content-type': 'application/json', 'x-custom': 'value' });
  assert.deepEqual(filtered, { 'content-type': 'application/json', 'x-custom': 'value' });
});
