/**
 * Helpers for picking a "nice" number of buckets.
 *
 * We want the bucket count to be prime. Reason: if the bucket count shares
 * a factor with some pattern in the hash's output (e.g. both happen to be
 * even), lines can end up clustering into only a fraction of the buckets
 * instead of spreading out evenly - the modulo operation effectively
 * "loses information" when the modulus and the values being reduced share
 * a common factor. A prime modulus has no small factors to collide with,
 * so it gives the most reliable spread for whatever hash function is
 * feeding it.
 */

function isPrime(n: number): boolean {
  if (n < 2) return false;
  if (n % 2 === 0) return n === 2;
  for (let i = 3; i * i <= n; i += 2) {
    if (n % i === 0) return false;
  }
  return true;
}

/** Smallest prime that is >= n. */
export function nextPrime(n: number): number {
  let candidate = Math.max(2, Math.ceil(n));
  while (!isPrime(candidate)) candidate++;
  return candidate;
}
