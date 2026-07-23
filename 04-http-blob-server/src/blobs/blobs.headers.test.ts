import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { createTestApp } from '../testHelpers';

test('GET returns the stored Content-Type header', async (t) => {
  const ctx = await createTestApp();
  t.after(ctx.cleanup);

  await request(ctx.baseUrl)
    .post('/blobs/typed')
    .set('Content-Type', 'text/plain')
    .send(Buffer.from('hi'))
    .expect(204);

  const res = await request(ctx.baseUrl).get('/blobs/typed').expect(200);
  assert.equal(res.headers['content-type'], 'text/plain');
});

test('GET returns x-rebase-* headers, stored case-insensitively', async (t) => {
  const ctx = await createTestApp();
  t.after(ctx.cleanup);

  await request(ctx.baseUrl)
    .post('/blobs/tagged')
    .set('X-Rebase-Owner', 'mirzviz')
    .send(Buffer.from('hi'))
    .expect(204);

  const res = await request(ctx.baseUrl).get('/blobs/tagged').expect(200);
  assert.equal(res.headers['x-rebase-owner'], 'mirzviz');
});

test('GET does not return headers outside Content-Type / x-rebase-*', async (t) => {
  const ctx = await createTestApp();
  t.after(ctx.cleanup);

  await request(ctx.baseUrl)
    .post('/blobs/untagged')
    .set('X-Other-Thing', 'should-not-be-stored')
    .send(Buffer.from('hi'))
    .expect(204);

  const res = await request(ctx.baseUrl).get('/blobs/untagged').expect(200);
  assert.equal(res.headers['x-other-thing'], undefined);
});

test('POST with a stored header key exceeding MAX_HEADER_KEY_LENGTH is rejected with 400', async (t) => {
  const ctx = await createTestApp({ maxHeaderKeyLength: 10 });
  t.after(ctx.cleanup);

  await request(ctx.baseUrl)
    .post('/blobs/long-key')
    .set('x-rebase-a-key-way-too-long', 'v')
    .send(Buffer.from('hi'))
    .expect(400);
});

test('POST with a stored header value exceeding MAX_HEADER_VALUE_LENGTH is rejected with 400', async (t) => {
  const ctx = await createTestApp({ maxHeaderValueLength: 5 });
  t.after(ctx.cleanup);

  await request(ctx.baseUrl)
    .post('/blobs/long-value')
    .set('x-rebase-foo', '123456')
    .send(Buffer.from('hi'))
    .expect(400);
});

test('POST with more stored headers than MAX_HEADER_COUNT is rejected with 400', async (t) => {
  const ctx = await createTestApp({ maxHeaderCount: 2 });
  t.after(ctx.cleanup);

  await request(ctx.baseUrl)
    .post('/blobs/too-many-headers')
    .set('x-rebase-a', '1')
    .set('x-rebase-b', '2')
    .set('x-rebase-c', '3')
    .send(Buffer.from('hi'))
    .expect(400);
});

test('POST with exactly MAX_HEADER_COUNT stored headers is accepted', async (t) => {
  const ctx = await createTestApp({ maxHeaderCount: 2 });
  t.after(ctx.cleanup);

  await request(ctx.baseUrl)
    .post('/blobs/just-enough-headers')
    .set('x-rebase-a', '1')
    .set('x-rebase-b', '2')
    .send(Buffer.from('hi'))
    .expect(204);
});
