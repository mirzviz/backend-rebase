import * as path from 'node:path';

export interface BlobLimits {
  maxPayloadLength: number;
  maxDiskQuota: number;
  maxHeaderKeyLength: number;
  maxHeaderValueLength: number;
  maxHeaderCount: number;
  maxIdLength: number;
  maxBlobsTotal: number;
  storageDir: string;
}

export const BLOB_CONFIG = Symbol('BLOB_CONFIG');

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Defaults match the assignment's stated constants. Every value is
// env-overridable so tests can inject tiny limits instead of writing
// gigabytes of data to exercise the quota/count error paths.
export function defaultBlobLimits(): BlobLimits {
  return {
    maxPayloadLength: envInt('MAX_PAYLOAD_LENGTH', 10 * 1024 * 1024),
    maxDiskQuota: envInt('MAX_DISK_QUOTA', 1024 * 1024 * 1024),
    maxHeaderKeyLength: envInt('MAX_HEADER_KEY_LENGTH', 30),
    maxHeaderValueLength: envInt('MAX_HEADER_VALUE_LENGTH', 400),
    maxHeaderCount: envInt('MAX_HEADER_COUNT', 20),
    maxIdLength: envInt('MAX_ID_LENGTH', 200),
    maxBlobsTotal: envInt('MAX_BLOBS_TOTAL', 1_000_000),
    storageDir: process.env.STORAGE_DIR ?? path.join(process.cwd(), 'storage'),
  };
}
