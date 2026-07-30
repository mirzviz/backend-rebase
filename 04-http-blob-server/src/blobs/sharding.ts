import { createHash } from 'node:crypto';

// These mirror the assignment's fixed MAX_BLOBS_TOTAL / MAX_BLOBS_IN_FOLDER
// and are deliberately NOT read from BlobLimits. BlobLimits is
// env-overridable (tests inject tiny numbers to exercise other limits),
// but the shard mapping below has no index - it's recomputed from `id` on
// every read/write. If SHARD_PREFIX_LENGTH ever changed while blobs
// already existed under the old value, every existing blob would become
// unreachable (GET/DELETE would look in the new shard and not find it
// there). So it's derived once, from fixed literals, at module load -
// never from a value that could change between runs.
const SPEC_MAX_BLOBS_TOTAL = 1_000_000;
const SPEC_MAX_BLOBS_IN_FOLDER = 1000;

// Smallest number of hex digits n such that 16^n >= SPEC_MAX_BLOBS_TOTAL /
// SPEC_MAX_BLOBS_IN_FOLDER - i.e. enough buckets to keep the *average*
// blobs-per-bucket at or under the cap. At n=3 (4096 buckets) the mean is
// ~244 with a uniform hash, about 48 standard deviations below the
// 1000 cap, so real-world variance across buckets is a non-issue.
export const SHARD_PREFIX_LENGTH = Math.ceil(
  Math.log(SPEC_MAX_BLOBS_TOTAL / SPEC_MAX_BLOBS_IN_FOLDER) / Math.log(16),
);

export function shardFor(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, SHARD_PREFIX_LENGTH);
}
