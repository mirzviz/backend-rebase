import { setTimeout as sleep } from 'node:timers/promises';

// Optional feature (assignment's "auto registration" bonus): when
// MASTER_NODE_ADDRESS is set, this blob server announces itself to the load
// balancer's `POST /internal/nodes` endpoint on startup so it doesn't have
// to be registered by hand. Everything here is best-effort - the blob
// server works standalone, so a missing or slow load balancer must never
// block startup or crash the process.

// -------------------------------------------------------------------------
// Configuration
// -------------------------------------------------------------------------

export interface AutoRegistrationConfig {
  // Where the load balancer's internal API lives (its MASTER_NODE_ADDRESS).
  master: { host: string; port: number };
  // How the load balancer should reach *this* server. The port is always
  // the port we actually listen on. The host has to be supplied explicitly
  // (ADVERTISED_HOST) because a process can't reliably know which
  // hostname other machines use to reach it - and the load balancer only
  // accepts `a-zA-Z0-9_-` hosts, so it must be a bare name like `localhost`
  // or a docker service name, never a dotted IP address.
  self: { host: string; port: number; name: string | null };
  // Total wall-clock budget for retrying while the load balancer isn't
  // answering yet (it may simply not be up). Assignment: 30 seconds.
  retryForMs: number;
  // Per-attempt request timeout, and the pause between attempts. Fixed
  // sensible values, exposed only so tests don't wait real seconds.
  attemptTimeoutMs: number;
  retryDelayMs: number;
}

function parseAddress(raw: string): { host: string; port: number } | null {
  // Accept "host:port"; tolerate an "http://" prefix and trailing slashes
  // in case someone sets MASTER_NODE_ADDRESS to a full URL.
  const cleaned = raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const match = cleaned.match(/^(.+):(\d+)$/);
  if (!match) return null;

  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host: match[1], port };
}

function envInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Returns null when MASTER_NODE_ADDRESS is unset - i.e. auto-registration
// is opt-in and simply doesn't happen. Throws only when the feature is
// requested but the address is unparseable, so the caller can log a loud
// config error instead of silently never registering.
export function loadAutoRegistrationConfig(
  env: NodeJS.ProcessEnv,
  listenPort: number,
): AutoRegistrationConfig | null {
  const rawMaster = env.MASTER_NODE_ADDRESS?.trim();
  if (!rawMaster) return null;

  const master = parseAddress(rawMaster);
  if (!master) {
    throw new Error(`MASTER_NODE_ADDRESS must look like "host:port", got "${rawMaster}"`);
  }

  const name = env.NODE_NAME?.trim();
  return {
    master,
    self: {
      host: env.ADVERTISED_HOST?.trim() || 'localhost',
      port: listenPort,
      name: name ? name : null,
    },
    retryForMs: envInt(env, 'SELF_REGISTRATION_RETRY_SECONDS', 30) * 1000,
    attemptTimeoutMs: 5000,
    retryDelayMs: 1000,
  };
}

// -------------------------------------------------------------------------
// Registration
// -------------------------------------------------------------------------

// Kept as an injectable interface (rather than calling console/Nest's
// Logger directly) so tests can capture what would be logged.
export interface RegistrationLogger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export type RegistrationOutcome =
  | { kind: 'registered'; id: string }
  | { kind: 'rejected'; status: number; message: string }
  | { kind: 'gave-up'; attempts: number };

type AttemptResult =
  | { kind: 'registered'; id: string }
  | { kind: 'rejected'; status: number; message: string }
  | { kind: 'retry'; reason: string };

function describeError(err: unknown): string {
  if (err instanceof Error) {
    // AbortSignal.timeout() rejects with a DOMException named 'TimeoutError'.
    if (err.name === 'TimeoutError') return 'timed out';
    // fetch wraps the real cause (e.g. ECONNREFUSED) one level down.
    const code = (err as { cause?: { code?: string } }).cause?.code;
    return code ? `${err.message} (${code})` : err.message;
  }
  return String(err);
}

async function attemptRegistration(
  config: AutoRegistrationConfig,
  fetchImpl: typeof fetch,
): Promise<AttemptResult> {
  const url = `http://${config.master.host}:${config.master.port}/internal/nodes`;
  const payload = {
    destination: { host: config.self.host, port: config.self.port },
    name: config.self.name,
  };

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(config.attemptTimeoutMs),
    });
  } catch (err) {
    // A refused connection or a timeout both mean "the load balancer isn't
    // answering yet" - exactly the case the assignment says to keep
    // retrying for 30 seconds.
    return { kind: 'retry', reason: describeError(err) };
  }

  if (res.status === 200) {
    const body = (await res.json().catch(() => ({}))) as { id?: unknown };
    if (typeof body.id !== 'string' || body.id === '') {
      return { kind: 'retry', reason: '200 response without a usable id' };
    }
    return { kind: 'registered', id: body.id };
  }

  const body = (await res.json().catch(() => ({}))) as { errorMessage?: unknown };
  const message = typeof body.errorMessage === 'string' ? body.errorMessage : `HTTP ${res.status}`;

  // 5xx is transient, so retry. A 4xx means the load balancer actively
  // refused this payload - a bad host/name (400) or a closed registration
  // window (403) - and retrying would just burn the budget for nothing.
  if (res.status >= 500) return { kind: 'retry', reason: message };
  return { kind: 'rejected', status: res.status, message };
}

export async function registerWithMaster(
  config: AutoRegistrationConfig,
  logger: RegistrationLogger,
  fetchImpl: typeof fetch = fetch,
): Promise<RegistrationOutcome> {
  const { host, port } = config.master;
  logger.log(
    `announcing self to load balancer at ${host}:${port} as ` +
      `${config.self.host}:${config.self.port}` +
      (config.self.name ? ` (name: ${config.self.name})` : ''),
  );

  const deadline = Date.now() + config.retryForMs;
  let attempts = 0;

  while (true) {
    attempts += 1;
    const result = await attemptRegistration(config, fetchImpl);

    if (result.kind === 'registered') {
      logger.log(`registered with load balancer, assigned node id ${result.id}`);
      return result;
    }

    if (result.kind === 'rejected') {
      logger.error(
        `load balancer rejected registration (HTTP ${result.status}): ${result.message} - not retrying`,
      );
      return result;
    }

    // result.kind === 'retry' - the load balancer isn't reachable/ready yet.
    if (Date.now() >= deadline) {
      logger.error(
        `gave up registering with load balancer after ${attempts} attempt(s) / ` +
          `${config.retryForMs / 1000}s (last error: ${result.reason})`,
      );
      return { kind: 'gave-up', attempts };
    }

    logger.warn(
      `registration attempt ${attempts} failed (${result.reason}); retrying in ${config.retryDelayMs}ms`,
    );
    await sleep(config.retryDelayMs);
  }
}
