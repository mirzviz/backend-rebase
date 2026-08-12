export interface LogzioConfig {
  token: string;
  type: string;
  protocol: string;
  port: number;
  host: string;
}

export interface Config {
  port: number;
  registrationDurationSeconds: number;
  logzio: LogzioConfig | null;
}

type Env = Partial<Record<string, string>>;

function envInt(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Logz.io is additive observability, not a boot requirement - unlike a hard
// `throw` when LOGZIO_TOKEN is missing, staying console-only lets the load
// balancer run locally/in tests without anyone needing an account first.
function loadLogzioConfig(env: Env): LogzioConfig | null {
  const token = env.LOGZIO_TOKEN;
  if (!token) return null;

  return {
    token,
    type: env.LOGZIO_TYPE ?? 'load-balancer',
    protocol: env.LOGZIO_PROTOCOL ?? 'https',
    port: envInt(env, 'LOGZIO_PORT', 8071),
    host: env.LOGZIO_HOST ?? 'listener.logz.io',
  };
}

export function loadConfig(env: Env = process.env): Config {
  return {
    port: envInt(env, 'PORT', 3000),
    registrationDurationSeconds: envInt(env, 'REGISTRATION_DURATION_SECONDS', 20),
    logzio: loadLogzioConfig(env),
  };
}
