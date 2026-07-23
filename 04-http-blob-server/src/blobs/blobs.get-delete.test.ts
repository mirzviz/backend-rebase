import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';
import { createTestApp } from '../testHelpers';

test('GET a non-existing blob returns 404', async (t) => {
  const ctx = await createTestApp();
  t.after(ctx.cleanup);

  await request(ctx.baseUrl).get('/blobs/never-existed').expect(404);
});

test('GET falls back to a Content-Type inferred from the id when none was stored', async (t) => {
  const ctx = await createTestApp();
  t.after(ctx.cleanup);

  await request(ctx.baseUrl).post('/blobs/photo.png').send(Buffer.from('fake-png-bytes')).expect(204);

  const res = await request(ctx.baseUrl).get('/blobs/photo.png').expect(200);
  assert.equal(res.headers['content-type'], 'image/png');
});

test('GET falls back to application/octet-stream when the id has no recognizable extension', async (t) => {
  const ctx = await createTestApp();
  t.after(ctx.cleanup);

  await request(ctx.baseUrl).post('/blobs/no-extension-here').send(Buffer.from('bytes')).expect(204);

  const res = await request(ctx.baseUrl).get('/blobs/no-extension-here').expect(200);
  assert.equal(res.headers['content-type'], 'application/octet-stream');
});

test('GET uses the stored Content-Type over any inference, even if it looks unrelated to the id', async (t) => {
  const ctx = await createTestApp();
  t.after(ctx.cleanup);

  await request(ctx.baseUrl)
    .post('/blobs/photo.png')
    .set('Content-Type', 'text/plain')
    .send(Buffer.from('actually just text'))
    .expect(204);

  const res = await request(ctx.baseUrl).get('/blobs/photo.png').expect(200);
  assert.equal(res.headers['content-type'], 'text/plain');
});

test('DELETE removes an existing blob', async (t) => {
  const ctx = await createTestApp();
  t.after(ctx.cleanup);

  await request(ctx.baseUrl).post('/blobs/to-delete').send(Buffer.from('bye')).expect(204);
  await request(ctx.baseUrl).delete('/blobs/to-delete').expect(204);
  await request(ctx.baseUrl).get('/blobs/to-delete').expect(404);
});

test('DELETE on a non-existing blob does not error', async (t) => {
  const ctx = await createTestApp();
  t.after(ctx.cleanup);

  await request(ctx.baseUrl).delete('/blobs/never-existed-either').expect(204);
});
