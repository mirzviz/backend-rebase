import * as fs from 'fs';
import * as path from 'path';
import { fnv1a } from './hash';
import { nextPrime } from './primes';
import { TARGET_BUCKET_BYTES, MIN_BUCKETS } from './config';

const NEWLINE = 0x0a; // '\n' byte value
const CR = 0x0d; // '\r' byte value, in case the file uses CRLF line endings
const NEWLINE_BUF = Buffer.from('\n');

export interface PartitionOptions {
  /** Force a specific bucket count instead of deriving one from file size. */
  numBuckets?: number;
  /** Passed to fnv1a - see hash.ts for why this matters on recursive splits. */
  seed?: number;
}

/** How many buckets to use for a file this size - see config.ts for the reasoning. */
export function computeBucketCount(fileSizeBytes: number): number {
  const raw = Math.ceil(fileSizeBytes / TARGET_BUCKET_BYTES);
  return nextPrime(Math.max(MIN_BUCKETS, raw));
}

function stripTrailingCR(buf: Buffer): Buffer {
  if (buf.length > 0 && buf[buf.length - 1] === CR) {
    return buf.subarray(0, buf.length - 1);
  }
  return buf;
}

/**
 * Reads `inputPath` once, and writes every line into one of `numBuckets`
 * files under `outputDir`, chosen by `fnv1a(line, seed) % numBuckets`.
 *
 * This is the "spread the data across many small files" half of the
 * algorithm. It deliberately never holds the whole input in memory: it
 * reads in fixed-size chunks and streams each line straight out to its
 * bucket file as soon as it's found.
 *
 * Two different lines landing in the same bucket (a hash collision) is
 * completely fine and expected - see hash.ts. What must never happen is
 * two *identical* lines landing in different buckets, because then the
 * dedup step (dedup.ts) would never see them side by side and would treat
 * them as two separate unique lines. Using a deterministic hash guarantees
 * that can't happen: the same bytes always produce the same hash, always
 * land in the same bucket.
 */
export function partitionFile(
  inputPath: string,
  outputDir: string,
  { numBuckets, seed = 0 }: PartitionOptions = {}
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const { size } = fs.statSync(inputPath);
    const buckets = numBuckets || computeBucketCount(size);

    fs.mkdirSync(outputDir, { recursive: true });

    // One output file (and one open write stream) per bucket, all open at
    // once for the duration of this pass. `buckets` stays in the low
    // hundreds even for the assignment's worst case, which is well within
    // normal OS file-descriptor limits.
    const bucketPaths: string[] = [];
    const writers: fs.WriteStream[] = [];
    for (let i = 0; i < buckets; i++) {
      const p = path.join(outputDir, `bucket_${i}.tmp`);
      bucketPaths.push(p);
      writers.push(fs.createWriteStream(p));
    }

    // Read the input file 1MB at a time rather than all at once - this is
    // what keeps phase 1's memory usage independent of the input file's
    // total size, even in the assignment's ~5GB worst case.
    const input = fs.createReadStream(inputPath, { highWaterMark: 1 << 20 });

    // A chunk boundary can land in the middle of a line. `leftover` holds
    // the unfinished tail of a line from the previous chunk, to be
    // stitched onto the front of the next one.
    let leftover: Buffer = Buffer.alloc(0);

    let settled = false;

    // Tracks which bucket writers are currently backed up (see the
    // backpressure comment below), so we know when it's safe to resume
    // reading the input file.
    const pendingDrains = new Set<fs.WriteStream>();

    function fail(err: Error): void {
      if (settled) return;
      settled = true;
      input.destroy();
      for (const w of writers) w.destroy();
      reject(err);
    }

    function writeLine(rawLine: Buffer): void {
      const line = stripTrailingCR(rawLine);
      if (line.length === 0) return; // skip blank lines

      const idx = fnv1a(line, seed) % buckets;
      const writer = writers[idx];
      const ok = writer.write(Buffer.concat([line, NEWLINE_BUF]));

      if (!ok) {
        // `write()` returned false: this writer's internal buffer is full
        // (it can't flush to disk as fast as we're feeding it). Pause
        // reading more input until it catches up, so we don't keep piling
        // unwritten data into memory. `pause()` only stops *future* chunk
        // reads - lines already pulled out of the current chunk still get
        // processed below, which is fine since they're already in memory.
        input.pause();
        if (!pendingDrains.has(writer)) {
          pendingDrains.add(writer);
          writer.once('drain', () => {
            pendingDrains.delete(writer);
            // Only resume once *every* backed-up writer has caught up -
            // resuming after just one drain while others are still full
            // would let memory build up again immediately.
            if (pendingDrains.size === 0) input.resume();
          });
        }
      }
    }

    for (const w of writers) w.on('error', fail);
    input.on('error', fail);

    input.on('data', (chunk: Buffer) => {
      const buf = leftover.length ? Buffer.concat([leftover, chunk]) : chunk;
      let start = 0;
      let idx: number;
      while ((idx = buf.indexOf(NEWLINE, start)) !== -1) {
        writeLine(buf.subarray(start, idx));
        start = idx + 1;
      }
      // Whatever's left after the last newline is an incomplete line -
      // carry it over to be prefixed onto the next chunk. Copy it out of
      // `buf` (rather than keeping a subarray reference) so the rest of
      // `buf` can be garbage collected instead of being pinned in memory
      // by a small slice of it.
      leftover = Buffer.from(buf.subarray(start));
    });

    input.on('end', () => {
      if (settled) return;
      if (leftover.length > 0) writeLine(leftover); // the file's last line, if it had no trailing newline

      // Wait for every bucket file to actually finish flushing to disk
      // before resolving - the caller (dedup.ts / index.ts) is about to
      // read these files back, so they need to be complete first.
      Promise.all(
        writers.map(
          (w) =>
            new Promise<void>((res, rej) => {
              w.end();
              w.on('finish', res);
              w.on('error', rej);
            })
        )
      )
        .then(() => {
          settled = true;
          resolve(bucketPaths);
        })
        .catch(fail);
    });
  });
}
