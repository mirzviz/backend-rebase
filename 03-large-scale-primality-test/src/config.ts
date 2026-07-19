/**
 * All the tunable numbers for the algorithm live here, so the reasoning
 * behind each one is in a single place instead of scattered as magic
 * numbers through the code.
 */

/**
 * How many chunks to create per CPU core. Chunk count K must be bigger
 * than the core count for dynamic load balancing to do anything - if
 * K === cores, every worker gets exactly one chunk up front and a worker
 * stuck with a slow chunk (e.g. one with unusually large numbers) leaves
 * the other cores idle once they finish theirs. With K several times the
 * core count, whichever worker finishes first just pulls the next
 * unclaimed chunk, so no core sits idle waiting on another.
 */
export const CHUNKS_PER_CORE = 6;

/**
 * Window size used when scanning forward from a raw chunk-boundary guess
 * to find the next newline (see chunk.ts). 64KB is orders of magnitude
 * bigger than any line in this file (one integer per line), so in
 * practice the first read almost always contains a newline - this is
 * just a safety bound, not a size we expect to loop on.
 */
export const NEWLINE_SCAN_BUFFER_SIZE = 64 * 1024;
