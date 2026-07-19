import * as fs from 'fs';
import * as os from 'os';
import { computeChunkBoundaries } from './chunk';
import { runPool } from './pool';
import { CHUNKS_PER_CORE } from './config';

/**
 * Counts how many lines in a huge file of integers are prime, using
 * every available CPU core.
 *
 * Phase 1 (this function, main thread only): figure out the byte ranges
 * to hand to workers (computeChunkBoundaries) - a quick, one-time step
 * whose cost doesn't grow with how much of the file still needs to be
 * tested for primality.
 *
 * Phase 2 (runPool): spreads the actual primality testing across all CPU
 * cores, pulling chunks from a shared queue so no core sits idle.
 */
async function run(inputPath: string): Promise<void> {
  const startTime = process.hrtime.bigint();

  const fd = fs.openSync(inputPath, 'r');
  const { size } = fs.fstatSync(fd);

  const numWorkers = os.cpus().length;
  const chunks = computeChunkBoundaries(fd, size, numWorkers * CHUNKS_PER_CORE);
  fs.closeSync(fd); // workers open their own streams by path - this fd was only needed for the boundary scan

  const primeCount = await runPool(inputPath, chunks, numWorkers);

  const elapsedMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;

  console.log(`Prime count: ${primeCount}`);
  console.log(`Elapsed time: ${elapsedMs.toFixed(2)} ms`);
}

const [, , inputPath] = process.argv;
if (!inputPath) {
  console.error('Usage: node dist/index.js <input.txt>');
  process.exit(1);
}

run(inputPath).catch((err) => {
  console.error(err);
  process.exit(1);
});
