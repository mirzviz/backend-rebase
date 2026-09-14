import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { Config, loadConfig } from '../config';

// PageViewsModule and ReportModule both need to talk to the same
// database - provided once here (mirrors 06-load-balancer's
// SharedModule/LB_CONFIG pattern) and imported by both, rather than each
// feature module opening its own pool.
export const APP_CONFIG = Symbol('APP_CONFIG');
export const PG_POOL = Symbol('PG_POOL');

@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: (): Config => loadConfig() },
    {
      provide: PG_POOL,
      useFactory: (config: Config): Pool => new Pool({ connectionString: config.databaseUrl }),
      inject: [APP_CONFIG],
    },
  ],
  exports: [APP_CONFIG, PG_POOL],
})
export class SharedModule {}
