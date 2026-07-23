import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { createTestApp } from '../testHelpers';

test('POST to an existing id overwrites both data and headers (upsert)', async (t) => {
  const ctx = await createTestApp();
  t.after(ctx.cleanup);

  await request(ctx.baseUrl)
    .post('/blobs/mutable')
    .set('x-rebase-version', '1')
    .send(Buffer.from('first'))
    .expect(204);

  await request(ctx.baseUrl)
    .post('/blobs/mutable')
    .set('x-rebase-owner', 'mirzviz')
    .send(Buffer.from('second'))
    .expect(204);

  const res = await request(ctx.baseUrl).get('/blobs/mutable').expect(200);
  assert.deepEqual(res.body, Buffer.from('second'));
  assert.equal(res.headers['x-rebase-owner'], 'mirzviz');
  assert.equal(res.headers['x-rebase-version'], undefined);
});

test('MAX_BLOBS_TOTAL blocks a new blob once the limit is reached', async (t) => {
  const ctx = await createTestApp({ maxBlobsTotal: 2 });
  t.after(ctx.cleanup);

  await request(ctx.baseUrl).post('/blobs/one').send(Buffer.from('a')).expect(204);
  await request(ctx.baseUrl).post('/blobs/two').send(Buffer.from('a')).expect(204);
  await request(ctx.baseUrl).post('/blobs/three').send(Buffer.from('a')).expect(507);
});

test('MAX_BLOBS_TOTAL does not block overwriting an existing blob at the limit', async (t) => {
  const ctx = await createTestApp({ maxBlobsTotal: 2 });
  t.after(ctx.cleanup);

  await request(ctx.baseUrl).post('/blobs/one').send(Buffer.from('a')).expect(204);
  await request(ctx.baseUrl).post('/blobs/two').send(Buffer.from('a')).expect(204);
  await request(ctx.baseUrl).post('/blobs/one').send(Buffer.from('overwritten')).expect(204);
});

test('MAX_DISK_QUOTA rejects a new blob that would push usage over the limit', async (t) => {
  const ctx = await createTestApp({ maxDiskQuota: 40 });
  t.after(ctx.cleanup);

  await request(ctx.baseUrl).post('/blobs/a').send(Buffer.alloc(10, 'x')).expect(204);
  await request(ctx.baseUrl).post('/blobs/b').send(Buffer.alloc(10, 'x')).expect(507);
});

test('MAX_DISK_QUOTA accounts for the blob it is replacing, not just adding on top', async (t) => {
  const ctx = await createTestApp({ maxDiskQuota: 40 });
  t.after(ctx.cleanup);

  await request(ctx.baseUrl).post('/blobs/a').send(Buffer.alloc(10, 'x')).expect(204);
  // Shrinking an overwrite must not be rejected just because the old
  // size briefly overlaps with the new size in a naive additive check.
  await request(ctx.baseUrl).post('/blobs/a').send(Buffer.from('x')).expect(204);
});
