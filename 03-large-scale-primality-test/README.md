# Large Scale Primality Test

Solution for the [Large Scale Primality Test assignment](https://course.ronklein.co.il/03-large-scale-primality-test/): given a text file with one integer per line (files up to ~200 million lines), print how many lines are prime and how long it took.

Constraints the solution has to run within: **single machine, multicore (≥2 cores), ≤500MB RAM, ≤30GB free disk**, no external libraries.

## Approach (Part 1)

The file is too big to load into memory or process on a single core in reasonable time, so the work is split across every CPU core:

1. **Byte-offset chunking ([`src/chunk.ts`](src/chunk.ts))** — before spawning any workers, the main thread picks K evenly-spaced byte offsets into the file and nudges each one forward to the next newline, so every cut lands exactly on a line boundary. K is `cores × 6`, not `cores × 1` — more chunks than cores is what makes load balancing possible in the next step.
2. **Pull-based worker pool ([`src/pool.ts`](src/pool.ts), [`src/worker.ts`](src/worker.ts))** — exactly `os.cpus().length` long-lived workers are spawned once. Chunks sit in a queue on the main thread; a worker is only ever handed its *next* chunk once it reports finishing its current one. Whichever core finishes first just pulls more work, so no core sits idle waiting on another that happened to get a harder chunk.
3. **Aggregation, no locks** — each worker keeps a purely local count for the chunk it's working on and reports it back once per chunk. Folding that into the running total only ever happens inside the main thread's single-threaded `message` handler, so there's nothing to race and nothing to lock.
4. **Primality test ([`src/isPrime.ts`](src/isPrime.ts))** — trial division bounded by `i * i <= n` (no floating-point `sqrt`), skipping even numbers after 2. Deliberately not Miller-Rabin - simpler to verify, and fast enough at this scale once spread across all cores. Uses plain `Number` throughout, not `BigInt` - see Status below.

Each worker streams its byte range with `readline` rather than materializing it as an array, so memory stays proportional to one line at a time, not to chunk size or file size.

## Running it

Requires Node.js >= 18. TypeScript is a dev-only dependency - it compiles to plain JS with no runtime dependencies (the compiled code only touches Node's built-in `fs`, `os`, `readline`, and `worker_threads` modules).

```bash
cd 03-large-scale-primality-test
npm install
npm run build
node dist/index.js <input.txt>
```

### Docker

Two-stage build, same as exercises 01/02: TypeScript is compiled in a `build` stage, and only the compiled `dist/` output is copied into the final image.

```bash
cd 03-large-scale-primality-test
docker build -t large-scale-primality-test .
docker run --rm -v "$(pwd):/data" large-scale-primality-test /data/input.txt
```

To run under the assignment's stated hardware limits, add `--memory=500m` to `docker run` (core count is whatever Docker Desktop exposes to the container).

## Status / known gaps

- **Correctness**: verified against a small hand-built file with a known prime count (8 primes among 19 values), and against the real `nums_50_mil.txt` (450MB, 50,000,000 lines, all ≤ 8 digits) - cross-checked against an independently-built Sieve of Eratosthenes (a different algorithm from trial division). Both agree exactly: **16,912,305 primes**.
- **Number, not BigInt**: the real test file's numbers top out at 8 digits, nowhere near `Number.MAX_SAFE_INTEGER` (~9 quadrillion), so there's a single `Number`-only code path rather than a dual Number/BigInt mode picked at runtime - one less moving part, since the added complexity wasn't earning its keep against the actual data. Trade-off: a future file with a number bigger than ~9 quadrillion would silently lose precision here rather than error.
- **Performance**: `nums_50_mil.txt` finishes in **~7.9s wall time** on this 10-core machine (`user` time ≈ 72.8s, so ≈9.2x parallel speedup - close to the full 10 cores after overhead).
- **Memory**: peak RSS measured at **~486MB** on this file/machine - technically under the 500MB budget, but tight, and worth understanding why: most of it is the fixed baseline cost of the 10 worker threads themselves (each Node worker thread carries its own V8 heap/runtime overhead), not the streaming logic, which stays small regardless of file size. This means the baseline cost scales with **core count**, not file size - a much-higher-core-count grading machine could plausibly push this over budget even though the per-chunk streaming is properly bounded. Flagging this rather than claiming it's proven safe on every machine, per how we handled the same kind of RAM-constraint question in exercise 01.
- **Dedup ratio (relevant to Part 2)**: `nums_50_mil.txt` is only **7.7% unique values** (3,862,559 unique out of 50,000,000 lines - each unique value repeats ~13x on average). Part 2 (dedup-aware counting) would cut the actual primality-testing workload by roughly that same factor, so unlike a mostly-unique file, it looks clearly worth doing here.
- **Part 2**: not yet implemented - the assignment marks it optional, and the plan was to only build it once Part 1 was confirmed correct and the dedup ratio was known. Given the ratio above, it's a good next step.
- **`nums_200_mil.txt`**: not available locally yet; the design doesn't assume a particular file size, but this hasn't been run against it.
