import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { createTestApp } from '../testHelpers';

test('two concurrent uploads of different new ids never both slip past MAX_BLOBS_TOTAL', async (t) => {
  const ctx = await createTestApp({ maxBlobsTotal: 1 });
  t.after(ctx.cleanup);

  // Both requests are started without awaiting the first - they race
  // through the real event loop concurrently, the same way two different
  // clients uploading at the same time would.
  const [resA, resB] = await Promise.all([
    request(ctx.baseUrl).post('/blobs/first').send(Buffer.from('a')),
    request(ctx.baseUrl).post('/blobs/second').send(Buffer.from('b')),
  ]);

  const statuses = [resA.status, resB.status].sort();
  assert.deepEqual(statuses, [204, 507]);
});
