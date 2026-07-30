import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import request from 'supertest';
import { createTestApp } from '../testHelpers';

test('a fresh instance correctly seeds MAX_BLOBS_TOTAL from blobs left by a previous run', async (t) => {
  const first = await createTestApp({ maxBlobsTotal: 2 });
  await request(first.baseUrl).post('/blobs/pre-existing').send(Buffer.from('already here')).expect(204);
  await first.app.close(); // simulate the process exiting, without touching storageDir

  const second = await createTestApp({ maxBlobsTotal: 2, storageDir: first.storageDir });
  t.after(second.cleanup);

  // One of the two slots is already spoken for by 'pre-existing' - only
  // one more genuinely new blob should fit.
  await request(second.baseUrl).post('/blobs/new-one').send(Buffer.from('second')).expect(204);
  await request(second.baseUrl).post('/blobs/should-not-fit').send(Buffer.from('third')).expect(507);
});

test('a fresh instance correctly seeds MAX_DISK_QUOTA usage from blobs left by a previous run', async (t) => {
  const first = await createTestApp({ maxDiskQuota: 1_000_000 });
  await request(first.baseUrl).post('/blobs/pre-existing').send(Buffer.alloc(10, 'x')).expect(204);
  await first.app.close();

  const second = await createTestApp({ maxDiskQuota: 40, storageDir: first.storageDir });
  t.after(second.cleanup);

  // 'pre-existing' already accounts for ~25 of the 40-byte quota
  // (10 data bytes + a small meta.json) - a second, unrelated blob that
  // would only fit against a *zero* starting usage must be rejected.
  await request(second.baseUrl).post('/blobs/too-much').send(Buffer.alloc(20, 'y')).expect(507);
});

test('overwriting a blob left by a previous run still updates usage correctly', async (t) => {
  const first = await createTestApp();
  await request(first.baseUrl).post('/blobs/carried-over').send(Buffer.alloc(10, 'x')).expect(204);
  await first.app.close();

  // 60 comfortably fits the correct post-overwrite total (~47 bytes: a
  // shrunk 'carried-over' plus a fresh 10-byte 'room-for-this', each with
  // its small envelope header overhead) while still being well under what
  // a buggy implementation would reach if it forgot to subtract the old
  // size on overwrite (~75) - tight enough to catch that regression,
  // without hardcoding the envelope format's exact byte count.
  const second = await createTestApp({ maxDiskQuota: 60, storageDir: first.storageDir });
  t.after(second.cleanup);

  // Shrinking overwrite of the carried-over blob must correctly subtract
  // its old (seeded-at-startup) size, not just add the new size on top.
  await request(second.baseUrl).post('/blobs/carried-over').send(Buffer.from('x')).expect(204);
  await request(second.baseUrl).post('/blobs/room-for-this').send(Buffer.alloc(10, 'y')).expect(204);
});

test('startup wipes any stale .tmp/ garbage left behind by a previous crash', async (t) => {
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blob-server-test-'));
  const tmpDir = path.join(storageDir, '.tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  // A file sitting in .tmp/ before the app has even started is exactly
  // what a process crash mid-upload would leave behind - nothing
  // legitimate is ever supposed to still be there this early.
  fs.writeFileSync(path.join(tmpDir, 'orphaned-from-a-crash.data'), 'leftover garbage');

  const ctx = await createTestApp({ storageDir });
  t.after(ctx.cleanup);

  assert.equal(fs.existsSync(path.join(tmpDir, 'orphaned-from-a-crash.data')), false);
});
