import { parentPort, workerData } from 'worker_threads';
import * as fs from 'fs';
import * as readline from 'readline';
import { isPrime } from './isPrime';
import { ByteRange } from './chunk';

interface WorkerInitData {
  filePath: string;
}

if (!parentPort) {
  throw new Error('worker.ts must be run as a worker_threads worker, not directly');
}

const { filePath }: WorkerInitData = workerData;

/**
 * Counts primes in one byte range of the file. Opens its own read stream
 * per chunk rather than reusing one across chunks - a stream's read
 * cursor isn't something that can be repositioned mid-flight, so "one
 * stream per chunk" sidesteps that entirely.
 *
 * Streams line-by-line via readline instead of loading the range into an
 * array, so memory here stays proportional to one line at a time, not to
 * how large a chunk this worker happened to get. The count is purely
 * local to this call - it's only ever combined with other chunks' counts
 * back on the main thread (see pool.ts), never shared or locked here.
 */
async function countPrimesInRange({ start, end }: ByteRange): Promise<number> {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { start, end }),
    crlfDelay: Infinity,
  });

  let count = 0;
  for await (const line of rl) {
    if (line.length === 0) continue;
    if (isPrime(Number(line))) count++;
  }
  return count;
}

// Pull-based: this worker only reacts to chunks the main thread hands it
// and never asks for work itself, so the main thread's queue is the only
// place that decides how work is split - two workers can never end up
// claiming the same chunk.
parentPort.on('message', (chunk: ByteRange) => {
  countPrimesInRange(chunk).then((count) => {
    parentPort!.postMessage(count);
  });
});
