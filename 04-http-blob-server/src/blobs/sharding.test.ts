import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SHARD_PREFIX_LENGTH, shardFor } from './sharding';

test('SHARD_PREFIX_LENGTH gives enough buckets to keep MAX_BLOBS_TOTAL/MAX_BLOBS_IN_FOLDER under the cap on average', () => {
  assert.equal(SHARD_PREFIX_LENGTH, 3);
  const buckets = 16 ** SHARD_PREFIX_LENGTH;
  assert.ok(buckets >= 1_000_000 / 1000);
});

test('shardFor returns a fixed-length, lowercase-hex bucket name', () => {
  assert.match(shardFor('some-id'), /^[0-9a-f]{3}$/);
});

test('shardFor is deterministic for the same id', () => {
  assert.equal(shardFor('repeat-me'), shardFor('repeat-me'));
});

test('shardFor pins a known id to a known bucket (regression guard on the hash choice)', () => {
  // sha256('hello.txt') = 734515f5... - locks the algorithm so a future
  // change can't silently move every existing blob to a new shard.
  assert.equal(shardFor('hello.txt'), '734');
});

test('shardFor spreads distinct ids across more than one bucket', () => {
  const shards = new Set(Array.from({ length: 500 }, (_, i) => shardFor(`id-${i}`)));
  assert.ok(shards.size > 50, `expected a wide spread, got ${shards.size} distinct buckets`);
});
