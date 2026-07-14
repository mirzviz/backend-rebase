import { defaultHash, HashFunction } from './hash';
import { KeyNotFoundError, HashMapFullError } from './errors';

const MAX_ENTRIES = 100_000;
const INITIAL_BUCKET_COUNT = 16;
// Standard load-factor threshold (same default Java's HashMap uses): once
// entries-per-bucket crosses this on average, chains get long enough that
// lookups start degrading from O(1) toward O(n), so we double the bucket
// array and redistribute.
const LOAD_FACTOR_THRESHOLD = 0.75;

interface Entry<V> {
  key: string;
  value: V;
}

/**
 * A hash map with separate chaining for collisions: each bucket is an
 * array of entries, and a key's bucket is picked by `hash(key) % bucketCount`.
 * Collisions just mean more than one entry lives in the same bucket array -
 * they're found by a linear scan within that (small) array, not a crash or
 * an overwrite.
 *
 * The value type is generic (`V`) rather than fixed to `string`, since the
 * assignment's own usage example stores numbers.
 */
export class MyHashMap<V = unknown> {
  private buckets: Entry<V>[][];
  private entryCount = 0;

  constructor(private readonly hashFn: HashFunction = defaultHash) {
    this.buckets = MyHashMap.createBuckets<V>(INITIAL_BUCKET_COUNT);
  }

  put(key: string, value: V): void {
    const bucket = this.bucketFor(key);
    const existing = bucket.find((entry) => entry.key === key);
    if (existing) {
      existing.value = value;
      return;
    }

    if (this.entryCount >= MAX_ENTRIES) {
      throw new HashMapFullError(MAX_ENTRIES);
    }

    bucket.push({ key, value });
    this.entryCount++;

    if (this.entryCount / this.buckets.length > LOAD_FACTOR_THRESHOLD) {
      this.resize();
    }
  }

  get(key: string): V {
    const entry = this.bucketFor(key).find((entry) => entry.key === key);
    if (!entry) {
      throw new KeyNotFoundError(key);
    }
    return entry.value;
  }

  remove(key: string): void {
    const bucket = this.bucketFor(key);
    const index = bucket.findIndex((entry) => entry.key === key);
    if (index !== -1) {
      bucket.splice(index, 1);
      this.entryCount--;
    }
  }

  private bucketFor(key: string): Entry<V>[] {
    return this.buckets[this.indexFor(key, this.buckets.length)];
  }

  private indexFor(key: string, bucketCount: number): number {
    // `>>> 0` forces an unsigned 32-bit result before the modulo - an
    // injected hash function isn't guaranteed to return a non-negative
    // number, and JS's `%` keeps the sign of its left operand, which would
    // otherwise produce a negative (invalid) array index.
    return (this.hashFn(key) >>> 0) % bucketCount;
  }

  private resize(): void {
    const newBuckets = MyHashMap.createBuckets<V>(this.buckets.length * 2);
    // Every entry has to be re-bucketed, not just copied over - its bucket
    // index depends on `hash(key) % bucketCount`, which changes now that
    // bucketCount just doubled.
    for (const bucket of this.buckets) {
      for (const entry of bucket) {
        const index = this.indexFor(entry.key, newBuckets.length);
        newBuckets[index].push(entry);
      }
    }
    this.buckets = newBuckets;
  }

  private static createBuckets<V>(count: number): Entry<V>[][] {
    return Array.from({ length: count }, () => []);
  }
}
