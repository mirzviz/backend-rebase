import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import request from 'supertest';
import { createTestApp } from '../testHelpers';
import { shardFor } from './sharding';

test('a stored blob is placed under its computed shard folder, not directly in storageDir', async (t) => {
  const ctx = await createTestApp();
  t.after(ctx.cleanup);

  await request(ctx.baseUrl).post('/blobs/my-file.txt').send(Buffer.from('content')).expect(204);

  const shard = shardFor('my-file.txt');
  assert.equal(fs.existsSync(path.join(ctx.storageDir, shard, 'my-file.txt.data')), true);
  assert.equal(fs.existsSync(path.join(ctx.storageDir, shard, 'my-file.txt.meta.json')), true);
  assert.equal(fs.existsSync(path.join(ctx.storageDir, 'my-file.txt.data')), false);
});

test('GET and DELETE resolve to the same shard the blob was written into', async (t) => {
  const ctx = await createTestApp();
  t.after(ctx.cleanup);

  await request(ctx.baseUrl).post('/blobs/round-trip').send(Buffer.from('payload')).expect(204);
  const res = await request(ctx.baseUrl).get('/blobs/round-trip').expect(200);
  assert.deepEqual(res.body, Buffer.from('payload'));

  await request(ctx.baseUrl).delete('/blobs/round-trip').expect(204);
  const shard = shardFor('round-trip');
  assert.equal(fs.existsSync(path.join(ctx.storageDir, shard, 'round-trip.data')), false);
  await request(ctx.baseUrl).get('/blobs/round-trip').expect(404);
});

test('distinct ids land in their own computed shard folders', async (t) => {
  const ctx = await createTestApp();
  t.after(ctx.cleanup);

  const ids = Array.from({ length: 30 }, (_, i) => `blob-${i}`);
  for (const id of ids) {
    await request(ctx.baseUrl).post(`/blobs/${id}`).send(Buffer.from(id)).expect(204);
  }

  const shardsUsed = new Set(fs.readdirSync(ctx.storageDir).filter((name) => name !== '.tmp'));
  assert.ok(shardsUsed.size > 1, 'expected ids to spread across more than one shard folder');
  for (const id of ids) {
    assert.equal(fs.existsSync(path.join(ctx.storageDir, shardFor(id), `${id}.data`)), true);
  }
});

test('overwriting a blob keeps both its files in the same shard, with no leftovers elsewhere', async (t) => {
  const ctx = await createTestApp();
  t.after(ctx.cleanup);

  await request(ctx.baseUrl).post('/blobs/overwrite-me').send(Buffer.from('v1')).expect(204);
  await request(ctx.baseUrl).post('/blobs/overwrite-me').send(Buffer.from('v2-longer')).expect(204);

  const res = await request(ctx.baseUrl).get('/blobs/overwrite-me').expect(200);
  assert.deepEqual(res.body, Buffer.from('v2-longer'));

  const shard = shardFor('overwrite-me');
  const shardFiles = fs.readdirSync(path.join(ctx.storageDir, shard)).sort();
  assert.deepEqual(shardFiles, ['overwrite-me.data', 'overwrite-me.meta.json']);
});

test('a fresh instance correctly sums MAX_BLOBS_TOTAL usage across multiple shard folders left by a previous run', async (t) => {
  const first = await createTestApp();
  const ids = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
  for (const id of ids) {
    await request(first.baseUrl).post(`/blobs/${id}`).send(Buffer.from(`content-${id}`)).expect(204);
  }
  await first.app.close();

  const second = await createTestApp({ maxBlobsTotal: ids.length, storageDir: first.storageDir });
  t.after(second.cleanup);

  // All 5 slots should already be seeded as used by the warm-up scan
  // walking every shard folder - a genuinely new blob must be rejected.
  await request(second.baseUrl).post('/blobs/one-too-many').send(Buffer.from('x')).expect(507);
  // But overwriting an existing id (found via the same shard computation) still works.
  await request(second.baseUrl).post('/blobs/alpha').send(Buffer.from('updated')).expect(204);
});
