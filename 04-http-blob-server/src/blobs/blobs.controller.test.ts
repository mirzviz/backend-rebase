import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import request from 'supertest';
import { createTestApp, TestApp } from '../testHelpers';

let ctx: TestApp;

before(async () => {
  ctx = await createTestApp();
});

after(async () => {
  await ctx.cleanup();
});

test('POST then GET round-trips the exact bytes', async () => {
  const payload = Buffer.from('hello world');

  await request(ctx.baseUrl).post('/blobs/greeting').send(payload).expect(204);

  const res = await request(ctx.baseUrl).get('/blobs/greeting').expect(200);
  assert.deepEqual(res.body, payload);
});

test('POST then GET round-trips arbitrary binary bytes, including nulls', async () => {
  const payload = Buffer.from([0x00, 0xff, 0x10, 0x00, 0x7f, 0x80]);

  await request(ctx.baseUrl).post('/blobs/binary-thing').send(payload).expect(204);

  const res = await request(ctx.baseUrl)
    .get('/blobs/binary-thing')
    .buffer(true)
    .parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    })
    .expect(200);

  assert.deepEqual(res.body, payload);
});
