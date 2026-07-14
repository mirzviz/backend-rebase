/**
 * Thrown by `get` for a key that isn't in the map, per the assignment's
 * requirement that `get` fail loudly on a miss (unlike `remove`, which
 * shouldn't fail on one).
 */
export class KeyNotFoundError extends Error {
  constructor(key: string) {
    super(`Key not found: ${key}`);
    this.name = 'KeyNotFoundError';
  }
}

/**
 * Thrown by `put` when it would insert a brand-new key past the
 * assignment's 100,000-entry cap. Upserts of an already-present key never
 * hit this, since they don't grow the entry count.
 */
export class HashMapFullError extends Error {
  constructor(maxEntries: number) {
    super(`HashMap already holds the maximum of ${maxEntries} entries`);
    this.name = 'HashMapFullError';
  }
}
