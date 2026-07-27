import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import request from 'supertest';
import { createTestApp, postAndAbort } from '../testHelpers';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

test('an aborted upload of a new blob leaves no visible blob', async (t) => {
  const ctx = await createTestApp();
  t.after(ctx.cleanup);

  await postAndAbort(ctx.baseUrl, '/blobs/never-finished', {}, 1000, Buffer.alloc(200, 'x'));
  await sleep(150);

  await request(ctx.baseUrl).get('/blobs/never-finished').expect(404);
});

test('an aborted upload cleans up its temp files', async (t) => {
  const ctx = await createTestApp();
  t.after(ctx.cleanup);

  await postAndAbort(ctx.baseUrl, '/blobs/never-finished', {}, 1000, Buffer.alloc(200, 'x'));
  await sleep(150);

  const tmpDir = path.join(ctx.storageDir, '.tmp');
  const entries = fs.existsSync(tmpDir) ? fs.readdirSync(tmpDir) : [];
  assert.deepEqual(entries, []);
});

test('an aborted overwrite leaves the original blob completely unchanged', async (t) => {
  const ctx = await createTestApp();
  t.after(ctx.cleanup);

  await request(ctx.baseUrl)
    .post('/blobs/stable')
    .set('x-rebase-version', 'original')
    .send(Buffer.from('original content'))
    .expect(204);

  await postAndAbort(
    ctx.baseUrl,
    '/blobs/stable',
    { 'x-rebase-version': 'broken-overwrite' },
    5000,
    Buffer.alloc(500, 'y'),
  );
  await sleep(150);

  const res = await request(ctx.baseUrl).get('/blobs/stable').expect(200);
  assert.deepEqual(res.body, Buffer.from('original content'));
  assert.equal(res.headers['x-rebase-version'], 'original');
});

test('an aborted upload is not counted toward MAX_DISK_QUOTA', async (t) => {
  const ctx = await createTestApp({ maxDiskQuota: 40 });
  t.after(ctx.cleanup);

  // Declares far more than the quota allows and sends a good chunk of it,
  // then dies mid-stream. If those bytes leaked into the usage total,
  // the next request (well within quota on its own) would be rejected.
  await postAndAbort(ctx.baseUrl, '/blobs/wasted-space', {}, 5000, Buffer.alloc(2000, 'z'));
  await sleep(150);

  await request(ctx.baseUrl).post('/blobs/tiny').send(Buffer.from('hi')).expect(204);
});

test('an aborted upload is not counted toward MAX_BLOBS_TOTAL', async (t) => {
  const ctx = await createTestApp({ maxBlobsTotal: 1 });
  t.after(ctx.cleanup);

  await postAndAbort(ctx.baseUrl, '/blobs/never-finished', {}, 1000, Buffer.alloc(200, 'x'));
  await sleep(150);

  // The one slot allowed by MAX_BLOBS_TOTAL must still be available -
  // the aborted upload must not have consumed it.
  await request(ctx.baseUrl).post('/blobs/the-real-one').send(Buffer.from('hi')).expect(204);
});
