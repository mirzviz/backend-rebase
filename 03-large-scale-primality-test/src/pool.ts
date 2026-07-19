import { Worker } from 'worker_threads';
import * as path from 'path';
import { ByteRange } from './chunk';

/**
 * Runs `chunks` across `numWorkers` long-lived worker threads and returns
 * the total prime count.
 *
 * Pull-based, not statically divided up front: every chunk sits in one
 * queue here on the main thread, and a worker only receives its *next*
 * chunk once it has finished its current one (see assignNext). That's
 * what keeps every core busy until the work truly runs out, rather than
 * one worker idling because it happened to be handed easier chunks while
 * another is still grinding through harder ones.
 *
 * Aggregation needs no lock: each worker keeps its own local count and
 * reports it back once per chunk. Folding that into `total` only ever
 * happens inside this `message` handler, which runs on the single
 * main-thread event loop - so two additions can never interleave.
 */
export function runPool(filePath: string, chunks: ByteRange[], numWorkers: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const workerScript = path.join(__dirname, 'worker.js');
    const queue = [...chunks];

    let total = 0;
    let activeWorkers = 0;

    function assignNext(worker: Worker): void {
      const chunk = queue.shift();
      if (!chunk) {
        worker.terminate();
        return;
      }
      worker.postMessage(chunk);
    }

    for (let i = 0; i < numWorkers; i++) {
      const worker = new Worker(workerScript, { workerData: { filePath } });
      activeWorkers++;

      worker.on('message', (count: number) => {
        total += count;
        assignNext(worker);
      });

      worker.on('error', reject);

      worker.on('exit', () => {
        activeWorkers--;
        if (activeWorkers === 0) resolve(total);
      });

      assignNext(worker);
    }
  });
}
