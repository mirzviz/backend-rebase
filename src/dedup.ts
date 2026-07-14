import * as fs from 'fs';
import * as readline from 'readline';
import { partitionFile } from './partition';
import { SAFE_LOAD_BYTES, MAX_RECURSION_DEPTH } from './config';

/**
 * Takes one bucket file, removes duplicate lines from it, and appends the
 * survivors to `outputStream`.
 *
 * Why this doesn't need to check other buckets for duplicates: partition.ts
 * guarantees that two identical lines always land in the same bucket (same
 * bytes -> same hash -> same bucket index, every time). So once we're
 * looking at a single bucket in isolation, comparing lines *within it* is
 * enough to catch every duplicate that exists anywhere in the original
 * file.
 *
 * @param seed  which hash seed produced this bucket file - passed through
 *              so that if we need to split it further, we do so with a
 *              *different* seed (see partition.ts's PartitionOptions).
 * @param depth how many times this file has already been re-split, to
 *              enforce MAX_RECURSION_DEPTH.
 */
export async function dedupBucket(
  bucketPath: string,
  outputStream: fs.WriteStream,
  seed: number = 0,
  depth: number = 0
): Promise<void> {
  const { size } = fs.statSync(bucketPath);

  if (size > SAFE_LOAD_BYTES && depth < MAX_RECURSION_DEPTH) {
    // This bucket came out bigger than we're comfortable loading whole.
    // Don't guess about why - just split it again, the same way the
    // original file was split, but into a fresh set of (smaller)
    // sub-buckets using a different seed. Then dedup each of those the
    // same way, recursively.
    const subDir = `${bucketPath}.split`;
    const subBucketPaths = await partitionFile(bucketPath, subDir, {
      seed: seed + 1,
    });
    fs.unlinkSync(bucketPath); // the original oversized bucket is now fully replaced by its sub-buckets
    for (const subPath of subBucketPaths) {
      await dedupBucket(subPath, outputStream, seed + 1, depth + 1);
    }
    fs.rmdirSync(subDir);
    return;
  }

  // The bucket is small enough to dedup directly. Note that we still
  // stream it line-by-line (via readline) rather than reading the whole
  // file into one string - that matters for a case size-based recursion
  // above can't fix: a bucket that's huge on disk purely because it's many
  // copies of the *same* line (true duplicates always hash the same, so no
  // amount of re-splitting spreads them out). Streaming means memory here
  // tracks the number of distinct lines actually seen, not the file's raw
  // byte size - so that case collapses to a `seen` Set of size 1 no matter
  // how large the file on disk is.
  const seen = new Set<string>();
  const rl = readline.createInterface({
    input: fs.createReadStream(bucketPath),
    crlfDelay: Infinity, // treat \r\n as one line ending, not two
  });

  for await (const line of rl) {
    if (line.length === 0) continue;
    if (!seen.has(line)) {
      seen.add(line);
      if (!outputStream.write(line + '\n')) {
        // Same backpressure idea as in partition.ts: if the output file
        // can't be written to as fast as we're producing lines, wait for
        // it to catch up before asking readline for the next line.
        await new Promise<void>((resolve) => outputStream.once('drain', resolve));
      }
    }
  }

  fs.unlinkSync(bucketPath); // done with this bucket's temp file
}
