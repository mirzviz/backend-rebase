# Hash-Map

Solution for the [Hash-Map assignment](https://course.ronklein.co.il/02-hash-map/): implement a hash-map class with `put` (upsert), `get` (throws on a missing key), and `remove` (never throws), backed by an injectable hash function with a sensible default, and capped at 100,000 key-value pairs.

## Approach

- **Collision handling — separate chaining.** Each bucket is an array of `{ key, value }` entries. A key's bucket is `hash(key) % bucketCount`; two keys landing in the same bucket just means a short linear scan within that bucket, not an overwrite or a crash.
- **Resizing.** Starts at 16 buckets. Once the average entries-per-bucket crosses 0.75 (same default Java's `HashMap` uses), the bucket array doubles and every entry gets rehashed into its new bucket, keeping lookups close to O(1) as the map grows.
- **Default hash function ([`src/hash.ts`](src/hash.ts)).** The assignment points out that common hash functions like MD5 already ship in the standard library, so the default hash uses Node's built-in `crypto` MD5 rather than a hand-rolled algorithm — MD5 being cryptographically broken doesn't matter here, only its bit distribution does. A custom hash function can be injected instead via the constructor.
- **Capacity ([`src/MyHashMap.ts`](src/MyHashMap.ts)).** The 100,000-entry cap is enforced only on inserting a *new* key; upserting an existing key at capacity still works, since it doesn't grow the entry count. A new key past the cap throws `HashMapFullError`.
- **Errors ([`src/errors.ts`](src/errors.ts)).** `KeyNotFoundError` for `get` on a missing key; `HashMapFullError` for `put` past capacity. `remove` never throws, per the spec, even for a key that was never present.
- **Value type.** The class is generic (`MyHashMap<V>`) rather than fixed to `string` values, since the assignment's own usage example stores numbers.

## Running it

Requires Node.js >= 18. TypeScript is a dev-only dependency — it compiles to plain JS with no runtime dependencies (the compiled code only touches Node's built-in `crypto` module).

```bash
cd 02-hash-map
npm install
npm run build
node dist/index.js
```

`src/index.ts` runs the assignment's own example end to end.

### Docker

Two-stage build, same as exercise 01: TypeScript is compiled in a `build` stage, and only the compiled `dist/` output is copied into the final image — no `node_modules`, since the compiled code only touches Node's built-in `crypto` module.

```bash
cd 02-hash-map
docker build -t hash-map .
docker run --rm hash-map
```

## Status / known gaps

- Verified against the assignment's example, plus ad hoc checks for: an injected hash function forcing collisions (chaining still resolves correctly), correctness after several resizes across 20,000 entries, the 100,000-entry cap (including that upserting an existing key at capacity doesn't throw), and both custom error types.
