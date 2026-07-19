/**
 * Trial division. A probabilistic test (Miller-Rabin) would be faster on
 * very large numbers, but at this assignment's scale, trial division
 * spread across every CPU core is fast enough and much simpler to verify
 * by hand - no need for the added complexity.
 *
 * The loop bound is `i * i <= n`, not `i <= Math.sqrt(n)` - that avoids
 * floating-point `sqrt()` entirely, so there's no rounding error at the
 * boundary that could let a real factor slip past the check.
 *
 * Assumes every number in the input fits within Number.MAX_SAFE_INTEGER
 * (~9 quadrillion) - confirmed against the real assignment test file,
 * which tops out at 8-digit numbers. A file with a much larger number
 * would silently lose precision here rather than throw, since JS numbers
 * stop being exact integers past 2^53.
 */
export function isPrime(n: number): boolean {
  // A malformed line (non-numeric text) parses to NaN. Without this
  // check, NaN would fail every comparison below, including the loop
  // condition (`i * i <= NaN` is always false) - so the loop would never
  // run and execution would fall through all the way to `return true`,
  // silently counting garbage as prime. Number.isInteger also rejects
  // Infinity and non-integer decimals the same way.
  if (!Number.isInteger(n)) return false;
  if (n < 2) return false;
  if (n === 2) return true;
  if (n % 2 === 0) return false;
  for (let i = 3; i * i <= n; i += 2) {
    if (n % i === 0) return false;
  }
  return true;
}
