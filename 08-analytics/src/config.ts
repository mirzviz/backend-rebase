export interface Config {
  port: number;
  databaseUrl: string;
}

type Env = Partial<Record<string, string>>;

function envInt(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(env: Env = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  return {
    port: envInt(env, 'PORT', 3000),
    databaseUrl,
  };
}
