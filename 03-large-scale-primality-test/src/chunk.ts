import * as fs from 'fs';
import { NEWLINE_SCAN_BUFFER_SIZE } from './config';

export interface ByteRange {
  start: number;
  end: number; // inclusive - matches what fs.createReadStream({start, end}) expects
}

/**
 * Finds the first newline at or after `position`, and returns the byte
 * offset right after it (the start of the next line). Scans forward in
 * fixed-size windows instead of reading from `position` all the way to
 * EOF - in practice `position` is already close to a newline, so this
 * usually resolves within the very first window.
 *
 * Example: in "...101\n9973...", a `position` landing on the "1" in
 * "101" scans forward, finds the "\n" right after it, and returns the
 * byte just past that "\n" - the "9" that starts "9973".
 */
function findNextLineStart(fd: number, position: number, fileSize: number): number {
  const buffer = Buffer.alloc(NEWLINE_SCAN_BUFFER_SIZE);
  let scanPos = position;

  while (scanPos < fileSize) {
    const bytesToRead = Math.min(NEWLINE_SCAN_BUFFER_SIZE, fileSize - scanPos);
    const bytesRead = fs.readSync(fd, buffer, 0, bytesToRead, scanPos);
    const newlineIndex = buffer.subarray(0, bytesRead).indexOf(0x0a); // '\n'
    if (newlineIndex !== -1) {
      return scanPos + newlineIndex + 1;
    }
    scanPos += bytesRead;
  }

  return fileSize; // no newline found before EOF - treat EOF itself as the next "line start"
}

/**
 * Picks `k - 1` internal cut points, evenly spaced by raw byte offset,
 * and nudges each one forward to the next line boundary (findNextLineStart
 * above). Together with the file's start (0) and true end (fileSize),
 * that's `k + 1` points marking off `k` chunks.
 */
function computeCutPoints(fd: number, fileSize: number, k: number): number[] {
  const cuts: number[] = [0];
  for (let i = 1; i < k; i++) {
    const rawGuess = Math.floor((fileSize * i) / k);
    cuts.push(findNextLineStart(fd, rawGuess, fileSize));
  }
  cuts.push(fileSize);
  return cuts;
}

/**
 * Turns a list of cut points into the ranges between each consecutive
 * pair. Two neighboring cuts can land on the exact same point (only
 * possible when the file has far fewer lines than the requested chunk
 * count) - that range would be empty, so it's skipped rather than handed
 * to a worker as a zero-byte chunk.
 *
 * `end` is *inclusive* here, matching `fs.createReadStream`'s own `end`
 * option - hence `end - 1` below, not `end`. An exclusive convention
 * instead would make every worker read one extra byte - the first digit
 * of the next range's first number - silently tacking a stray
 * single-digit "line" onto its own count rather than throwing anything.
 */
function rangesBetweenCuts(cuts: number[]): ByteRange[] {
  const ranges: ByteRange[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const start = cuts[i];
    const end = cuts[i + 1];
    if (end > start) {
      ranges.push({ start, end: end - 1 });
    }
  }
  return ranges;
}

/**
 * Splits the file behind `fd` into up to `k` non-overlapping byte ranges,
 * each containing only whole lines - no line is ever split across two
 * ranges or counted in both. Two steps, in order: find the cut points
 * (computeCutPoints), then turn consecutive cuts into ranges
 * (rangesBetweenCuts).
 */
export function computeChunkBoundaries(fd: number, fileSize: number, k: number): ByteRange[] {
  const cuts = computeCutPoints(fd, fileSize, k);
  return rangesBetweenCuts(cuts);
}
