import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { createTestApp, postWithoutContentLength } from '../testHelpers';

test('POST without a Content-Length header is rejected with 400', async (t) => {
  const ctx = await createTestApp();
  t.after(ctx.cleanup);

  const res = await postWithoutContentLength(ctx.baseUrl, '/blobs/no-length', Buffer.from('hello'));
  assert.equal(res.status, 400);
});

test('POST payload exceeding MAX_PAYLOAD_LENGTH is rejected with 413', async (t) => {
  const ctx = await createTestApp({ maxPayloadLength: 10 });
  t.after(ctx.cleanup);

  await request(ctx.baseUrl)
    .post('/blobs/too-big')
    .send(Buffer.alloc(11, 'x'))
    .expect(413);
});

test('POST payload at or under MAX_PAYLOAD_LENGTH is accepted', async (t) => {
  const ctx = await createTestApp({ maxPayloadLength: 10 });
  t.after(ctx.cleanup);

  await request(ctx.baseUrl)
    .post('/blobs/just-fits')
    .send(Buffer.alloc(10, 'x'))
    .expect(204);
});

test('POST with an id containing invalid characters is rejected with 400', async (t) => {
  const ctx = await createTestApp();
  t.after(ctx.cleanup);

  await request(ctx.baseUrl).post('/blobs/bad@id').send(Buffer.from('x')).expect(400);
});

test('POST accepts ids made only of a-zA-Z0-9._-', async (t) => {
  const ctx = await createTestApp();
  t.after(ctx.cleanup);

  await request(ctx.baseUrl)
    .post('/blobs/Weird.id_name-42')
    .send(Buffer.from('x'))
    .expect(204);
});

test('POST with an id longer than MAX_ID_LENGTH is rejected with 400', async (t) => {
  const ctx = await createTestApp({ maxIdLength: 5 });
  t.after(ctx.cleanup);

  await request(ctx.baseUrl).post('/blobs/toolongid').send(Buffer.from('x')).expect(400);
});

test('POST with an id at MAX_ID_LENGTH is accepted', async (t) => {
  const ctx = await createTestApp({ maxIdLength: 5 });
  t.after(ctx.cleanup);

  await request(ctx.baseUrl).post('/blobs/abcde').send(Buffer.from('x')).expect(204);
});
