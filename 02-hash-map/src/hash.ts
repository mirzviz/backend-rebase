import { createHash } from 'crypto';

export type HashFunction = (key: string) => number;

/**
 * Default hash used when the caller doesn't inject one. MD5 already ships
 * in Node's `crypto` module (as the assignment points out), so there's no
 * reason to hand-roll a hash algorithm here - we just need something fast
 * and well-distributed enough to spread keys evenly across buckets. MD5
 * being cryptographically broken doesn't matter for that job; only its
 * distribution quality does.
 */
export function defaultHash(key: string): number {
  const digest = createHash('md5').update(key).digest('hex');
  // MD5 produces 128 bits, far more than fits in a JS safe integer or is
  // useful for indexing a bucket array. Taking the first 8 hex chars (32
  // bits) keeps the value comfortably inside a normal number while still
  // using bits spread across the whole digest.
  return parseInt(digest.slice(0, 8), 16);
}
