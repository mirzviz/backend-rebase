# Large Scale Dedup

Solution for the [Large Scale Dedup assignment](https://course.ronklein.co.il/01-large-scale-dedup/): given a file of up to 5,000,000 lines (each up to 1,000 ASCII characters), produce a file containing only the unique lines. Output order doesn't matter.

Constraints the solution has to run within: **1 CPU, 100MB RAM, 500GB disk**, no external libraries.

## Approach

The whole input can be several GB in the worst case, far too big to hold in memory at once, so this dedups in two streaming passes instead of loading the file:

1. **Partition** — read the input once, and route every line into one of N bucket files on disk, chosen by `hash(line) % N`. Because the hash is deterministic, two identical lines always land in the same bucket. N is derived from the input file's size (not a fixed constant), aiming for roughly 20MB of raw text per bucket, so bucket count scales with how big the input actually is.
2. **Dedup** — process one bucket file at a time: stream its lines into a `Set`, write out only the first occurrence of each. Since identical lines are guaranteed to share a bucket, deduping within each bucket independently is enough to catch every duplicate in the whole file — no cross-bucket comparison needed. If a bucket still comes out bigger than the safe-to-load threshold (e.g. skewed hash distribution), it gets re-partitioned with a different hash seed into smaller sub-buckets before being loaded, recursively.

Buckets are processed one at a time, not concurrently, so peak memory is bounded by one bucket's worth of unique data rather than growing with the number of buckets.

See the comments in [`src/`](src) for the reasoning behind each piece — [`hash.ts`](src/hash.ts) (why routing and duplicate-detection use the hash differently), [`primes.ts`](src/primes.ts) (why bucket count is prime), [`config.ts`](src/config.ts) (why 20MB), [`partition.ts`](src/partition.ts) and [`dedup.ts`](src/dedup.ts) (the two passes themselves).

## Running it

Requires Node.js >= 18. TypeScript is a dev-only dependency — it compiles to plain JS with no runtime dependencies, so the program itself still runs on nothing but Node's built-in modules.

```bash
cd 01-large-scale-dedup
npm install
npm run build
node dist/index.js <input.txt> <output.txt>
```

### Docker

The image is built in two stages: TypeScript is compiled in a `build` stage, and only the compiled `dist/` output is copied into the final image — no `node_modules`, since the compiled code only touches Node's built-in modules.

```bash
cd 01-large-scale-dedup
docker build -t large-scale-dedup .
docker run --rm -v "$(pwd):/data" large-scale-dedup /data/input.txt /data/output.txt
```

`input.txt`/`output.txt` are resolved inside the container, so the volume mount (`-v`) is what makes your local files visible at `/data`. To actually run under the assignment's stated hardware limits, add `--memory=100m --cpus=1` to the `docker run` command.

## Status / known gaps

- Verified correct against a synthetic file with known duplicates, and against a 100MB sample (output matches `sort -u` exactly) — both locally and through the Docker image.
