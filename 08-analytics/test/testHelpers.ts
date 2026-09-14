import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configureApp';
import { runMigrations } from '../src/db/migrate';
import { PG_POOL } from '../src/shared/shared.module';

// Tests run against a real Postgres (docker-compose's `db` service, or any
// Postgres reachable at this URL) - the logic under test is mostly SQL
// (ON CONFLICT accumulation, generate_series zero-fill, batched deletes),
// so a mock would test nothing meaningful. Every test picks its own
// unique page name (see uniquePage below) instead of truncating tables
// between tests, so the suite can run against a shared, never-reset
// database without tests seeing each other's rows.
process.env.DATABASE_URL ??= 'postgres://postgres:postgres@localhost:5432/analytics';

let pool: Pool | undefined;
let migrated = false;

export async function getTestPool(): Promise<Pool> {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  if (!migrated) {
    await runMigrations(pool);
    migrated = true;
  }
  return pool;
}

export function uniquePage(prefix = 'page'): string {
  return `${prefix}-${randomUUID()}.html`;
}

export interface TestApp {
  baseUrl: string;
  pool: Pool;
  close: () => Promise<void>;
}

export async function startTestApp(): Promise<TestApp> {
  await getTestPool(); // ensure migrations have run before the app boots

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.listen(0);
  const address = app.getHttpServer().address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    pool: moduleRef.get<Pool>(PG_POOL),
    close: () => app.close(),
  };
}
