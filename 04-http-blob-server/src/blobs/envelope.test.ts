import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { encodeHeaderPrefix, readHeaderPrefix } from './envelope';

function tempFilePath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'envelope-test-')), 'blob.blob');
}

test('encodeHeaderPrefix leads with a 4-byte big-endian length matching the metadata byte length', () => {
  const metaContent = JSON.stringify({ headers: { 'content-type': 'text/plain' } });
  const prefix = encodeHeaderPrefix(metaContent);

  assert.equal(prefix.readUInt32BE(0), Buffer.byteLength(metaContent, 'utf8'));
  assert.equal(prefix.length, 4 + Buffer.byteLength(metaContent, 'utf8'));
});

test('readHeaderPrefix round-trips the exact headers written by encodeHeaderPrefix', async () => {
  const headers = { 'content-type': 'application/json', 'x-rebase-owner': 'mirzviz' };
  const metaContent = JSON.stringify({ headers });
  const prefix = encodeHeaderPrefix(metaContent);
  const payload = Buffer.from('the payload bytes');

  const filePath = tempFilePath();
  await fsp.writeFile(filePath, Buffer.concat([prefix, payload]));

  const fh = await fsp.open(filePath, 'r');
  try {
    const decoded = await readHeaderPrefix(fh);
    assert.deepEqual(decoded.headers, headers);
    assert.equal(decoded.payloadOffset, prefix.length);
  } finally {
    await fh.close();
  }
});

test('readHeaderPrefix round-trips an empty headers object', async () => {
  const metaContent = JSON.stringify({ headers: {} });
  const prefix = encodeHeaderPrefix(metaContent);

  const filePath = tempFilePath();
  await fsp.writeFile(filePath, Buffer.concat([prefix, Buffer.from('payload')]));

  const fh = await fsp.open(filePath, 'r');
  try {
    const decoded = await readHeaderPrefix(fh);
    assert.deepEqual(decoded.headers, {});
  } finally {
    await fh.close();
  }
});

test('readHeaderPrefix survives header values that would break a naive delimiter scan', async () => {
  // Quotes, backslashes and a literal newline in a header value are
  // exactly the kind of bytes that would corrupt a hand-rolled splitter -
  // JSON encoding handles them correctly since length-prefixing never
  // has to scan for a boundary inside this content.
  const headers = { 'x-rebase-note': 'a "quoted" value with a backslash \\ and a\nnewline' };
  const metaContent = JSON.stringify({ headers });
  const prefix = encodeHeaderPrefix(metaContent);

  const filePath = tempFilePath();
  await fsp.writeFile(filePath, Buffer.concat([prefix, Buffer.from('payload')]));

  const fh = await fsp.open(filePath, 'r');
  try {
    const decoded = await readHeaderPrefix(fh);
    assert.deepEqual(decoded.headers, headers);
  } finally {
    await fh.close();
  }
});

test('payloadOffset points exactly at the first payload byte, not before or after it', async () => {
  const metaContent = JSON.stringify({ headers: { 'content-type': 'text/plain' } });
  const prefix = encodeHeaderPrefix(metaContent);
  const payload = Buffer.from('PAYLOAD-STARTS-HERE');

  const filePath = tempFilePath();
  await fsp.writeFile(filePath, Buffer.concat([prefix, payload]));

  const fh = await fsp.open(filePath, 'r');
  let payloadOffset: number;
  try {
    payloadOffset = (await readHeaderPrefix(fh)).payloadOffset;
  } finally {
    await fh.close();
  }

  const wholeFile = await fsp.readFile(filePath);
  assert.deepEqual(wholeFile.subarray(payloadOffset), payload);
});
