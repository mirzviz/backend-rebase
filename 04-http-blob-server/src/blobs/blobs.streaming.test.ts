import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import request from 'supertest';
import { createTestApp, postInTwoParts } from '../testHelpers';

test('a partial temp file is visible on disk while an upload is still in flight', async (t) => {
  const ctx = await createTestApp();
  t.after(ctx.cleanup);

  const half = Buffer.alloc(50_000, 'a');
  const full = Buffer.concat([half, Buffer.alloc(50_000, 'b')]);
  let sawPartialTempFile = false;

  await postInTwoParts(ctx.baseUrl, '/blobs/big-upload', {}, full, async () => {
    // Give the server a moment to have actually written the first
    // write() to disk before we inspect it.
    await new Promise((r) => setTimeout(r, 100));
    const tmpDir = path.join(ctx.storageDir, '.tmp');
    const entries = fs.existsSync(tmpDir) ? fs.readdirSync(tmpDir) : [];
    for (const name of entries) {
      const size = fs.statSync(path.join(tmpDir, name)).size;
      // Strictly less than the full payload proves the server is
      // writing incrementally, not buffering the whole body first.
      if (size > 0 && size < full.length) {
        sawPartialTempFile = true;
      }
    }
    // The real, committed file must not exist yet - the rename only
    // happens after the whole upload finishes.
    assert.equal(fs.existsSync(path.join(ctx.storageDir, 'big-upload.data')), false);
  });

  assert.equal(sawPartialTempFile, true);

  const res = await request(ctx.baseUrl).get('/blobs/big-upload').expect(200);
  assert.deepEqual(res.body, full);
});

test('the .tmp staging directory never contains leftovers after a clean upload', async (t) => {
  const ctx = await createTestApp();
  t.after(ctx.cleanup);

  await request(ctx.baseUrl).post('/blobs/clean').send(Buffer.from('done')).expect(204);

  const tmpDir = path.join(ctx.storageDir, '.tmp');
  const entries = fs.existsSync(tmpDir) ? fs.readdirSync(tmpDir) : [];
  assert.deepEqual(entries, []);
});
