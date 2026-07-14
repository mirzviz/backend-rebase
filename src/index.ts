import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { partitionFile } from './partition';
import { dedupBucket } from './dedup';

/**
 * The whole algorithm in two phases:
 *
 *  Phase 1 (partitionFile): read the input file once, and split it into
 *  many small bucket files on disk, grouped so that identical lines always
 *  end up in the same bucket (see partition.ts).
 *
 *  Phase 2 (dedupBucket): process one bucket file at a time - small enough
 *  to hold in memory - removing duplicates within it and appending the
 *  unique lines to the final output. Buckets are handled one at a time,
 *  not concurrently, so peak memory is bounded by *one* bucket's worth of
 *  unique data rather than growing with the total number of buckets.
 *
 * Since the assignment says output order doesn't matter, there's no need
 * to reassemble buckets in any particular order or track where in the
 * original file a line came from.
 */
async function run(inputPath: string, outputPath: string): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dedup-'));

  const bucketPaths = await partitionFile(inputPath, tmpDir, { seed: 0 });

  const outputStream = fs.createWriteStream(outputPath);
  for (const bucketPath of bucketPaths) {
    await dedupBucket(bucketPath, outputStream, 0);
  }
  await new Promise<void>((resolve, reject) => {
    outputStream.end((err: Error | null | undefined) => (err ? reject(err) : resolve()));
  });

  fs.rmdirSync(tmpDir);
}

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  console.error('Usage: node dist/index.js <input.txt> <output.txt>');
  process.exit(1);
}

run(inputPath, outputPath).catch((err) => {
  console.error(err);
  process.exit(1);
});
