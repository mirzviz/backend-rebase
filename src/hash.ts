/**
 * A tiny, fast, hand-rolled hash function (FNV-1a) over a line of text.
 *
 * We don't use Node's built-in `crypto` hashes (MD5/SHA) here: those are
 * built for security (hard to reverse, hard to forge), which costs far
 * more CPU per byte than we need. FNV-1a is just a multiply-and-xor loop -
 * fast, fully deterministic, and good enough distribution for the one job
 * it has here: deciding which bucket file a line goes into. Assumes ASCII
 * input, per the assignment's constraints - each character code fits in a
 * byte, same as the bytes FNV-1a normally hashes.
 *
 * IMPORTANT - what this hash is NOT used for: deciding whether two lines
 * are duplicates. Different lines can (rarely) produce the same hash value
 * (a "collision"). If we treated equal hashes as "these are the same
 * line," we'd silently drop unique lines. Actual duplicate detection
 * always compares full line content later, in dedup.ts - this hash only
 * decides *which bucket* a line is routed to, so that identical lines are
 * guaranteed to end up in the same bucket and can be compared there.
 */

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * @param line the line's text (no trailing newline)
 * @param seed changes the output for the same input. Used by partition.ts
 *             to get an independent-looking hash on each recursion level,
 *             so a bucket that's oversized because of an unlucky collision
 *             (not because of true duplicates) actually splits differently
 *             the second time around.
 */
export function fnv1a(line: string, seed: number = 0): number {
  // Start from a fixed constant ("offset basis"), mixed with our seed.
  // `>>> 0` forces the result to be treated as an unsigned 32-bit integer -
  // without it, JS's bitwise ops can produce negative numbers, which would
  // break the `% numBuckets` step later on (negative % in JS can return a
  // negative result, which is not a valid array index).
  let hash = (FNV_OFFSET_BASIS ^ seed) >>> 0;

  for (let i = 0; i < line.length; i++) {
    hash ^= line.charCodeAt(i); // mix in the next character
    // Math.imul does correct 32-bit multiplication (regular `*` would lose
    // precision / behave inconsistently once the product exceeds 2^53).
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }

  return hash >>> 0;
}
