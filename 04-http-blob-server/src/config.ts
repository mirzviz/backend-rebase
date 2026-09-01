import * as path from 'node:path';

type Env = Partial<Record<string, string>>;

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

function envInt(name: string, fallback: number, env: Env = process.env): number {
  const raw = env[name];
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

// -------------------------------------------------------------------------
// Logz.io shipping (mirrors 06-load-balancer's setup)
// -------------------------------------------------------------------------

export interface LogzioConfig {
  token: string;
  type: string;
  protocol: string;
  port: number;
  host: string;
}

// Logz.io is additive observability, not a boot requirement - unlike a hard
// `throw` when LOGZIO_TOKEN is missing, staying console-only lets the blob
// server run locally/in tests without anyone needing an account first.
export function loadLogzioConfig(env: Env = process.env): LogzioConfig | null {
  const token = env.LOGZIO_TOKEN;
  if (!token) return null;

  return {
    token,
    type: env.LOGZIO_TYPE ?? 'blob-server',
    protocol: env.LOGZIO_PROTOCOL ?? 'https',
    port: envInt('LOGZIO_PORT', 8071, env),
    host: env.LOGZIO_HOST ?? 'listener.logz.io',
  };
}
