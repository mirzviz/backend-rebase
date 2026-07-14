import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { finished } from 'stream/promises';
import { fnv1a } from './hash';
import { nextPrime } from './primes';
import { TARGET_BUCKET_BYTES, MIN_BUCKETS } from './config';

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

/**
 * Reads `inputPath` once, and writes every line into one of `numBuckets`
 * files under `outputDir`, chosen by `fnv1a(line, seed) % numBuckets`.
 *
 * This is the "spread the data across many small files" half of the
 * algorithm. `readline` reads and yields one line at a time rather than
 * loading the whole file, which is what keeps memory usage here
 * independent of the input file's total size, even in the assignment's
 * ~5GB worst case.
 *
 * Two different lines landing in the same bucket (a hash collision) is
 * completely fine and expected - see hash.ts. What must never happen is
 * two *identical* lines landing in different buckets, because then the
 * dedup step (dedup.ts) would never see them side by side and would treat
 * them as two separate unique lines. Using a deterministic hash guarantees
 * that can't happen: the same text always produces the same hash, always
 * lands in the same bucket.
 */
export async function partitionFile(
  inputPath: string,
  outputDir: string,
  { numBuckets, seed = 0 }: PartitionOptions = {}
): Promise<string[]> {
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

  const rl = readline.createInterface({
    input: fs.createReadStream(inputPath),
    crlfDelay: Infinity, // treat \r\n as one line ending, not two
  });

  for await (const line of rl) {
    if (line.length === 0) continue; // skip blank lines

    const writer = writers[fnv1a(line, seed) % buckets];
    if (!writer.write(line + '\n')) {
      // This writer's internal buffer is full (it can't flush to disk as
      // fast as we're feeding it). Waiting here for its `drain` event
      // pauses the `for await` loop itself - readline won't hand us
      // another line until we ask for one - so we naturally stop reading
      // more input until this specific writer has caught up, without
      // needing to track backpressure across all the other writers too.
      await new Promise<void>((resolve) => writer.once('drain', resolve));
    }
  }

  // Wait for every bucket file to actually finish flushing to disk before
  // returning - the caller (dedup.ts / index.ts) is about to read these
  // files back, so they need to be complete first.
  await Promise.all(
    writers.map((w) => {
      w.end();
      return finished(w);
    })
  );

  return bucketPaths;
}
