/**
 * All the tunable numbers for the algorithm live here, so the reasoning
 * behind each one is in a single place instead of scattered as magic
 * numbers through the code.
 */

/**
 * How many raw bytes of line text we're willing to route into a single
 * bucket file (see partition.ts for how bucket count is derived from
 * this). It's a *target*, not a hard cap - see SAFE_LOAD_BYTES and
 * dedup.ts for what happens when a bucket still comes out bigger than
 * this despite the target.
 *
 * Why 20MB, when the assignment's RAM budget is 100MB: that 100MB also has
 * to cover (a) Node's own baseline memory just to run at all, and (b) the
 * fact that once text sits in a JS Set of strings, it costs noticeably
 * more than its raw byte count (each string carries some object-header
 * overhead on top of its characters). 20MB of raw text per bucket leaves
 * headroom for both.
 */
export const TARGET_BUCKET_BYTES = 20 * 1024 * 1024;

/**
 * Before loading a bucket file into memory to dedup it, dedup.ts checks
 * its size on disk against this same threshold. If it's bigger, the file
 * isn't loaded directly - it gets partitioned again first, into smaller
 * sub-buckets, and each of those is checked the same way.
 */
export const SAFE_LOAD_BYTES = 20 * 1024 * 1024;

/**
 * Even a small input file still gets split into a handful of buckets. This
 * keeps one code path for every input size, rather than a special case for
 * "small enough to just load directly."
 */
export const MIN_BUCKETS = 11;

/**
 * Re-partitioning (see dedup.ts) only helps when a bucket is oversized
 * because *unrelated* lines happened to collide under the hash - a new
 * seed spreads them out differently. It does NOT help when a bucket is
 * oversized because it holds many copies of the very same line: identical
 * lines hash identically no matter the seed, so they always land back
 * together. That second case is actually fine on its own (dedup.ts streams
 * the file instead of loading it whole, so memory tracks the number of
 * *unique* lines, not the file's raw size) - this cap just stops the first
 * case from recursing forever if the input is unexpectedly pathological.
 */
export const MAX_RECURSION_DEPTH = 6;
