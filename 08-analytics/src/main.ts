import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { AppModule } from './app.module';
import { configureApp } from './configureApp';
import { loadConfig } from './config';
import { runMigrations } from './db/migrate';
import { PG_POOL } from './shared/shared.module';

async function bootstrap(): Promise<void> {
  const config = loadConfig();

  const app = await NestFactory.create(AppModule);
  configureApp(app);

  const pool = app.get<Pool>(PG_POOL);
  await runMigrations(pool);

  await app.listen(config.port);
  console.log(`analytics api listening on port ${config.port}`);
}

void bootstrap();
