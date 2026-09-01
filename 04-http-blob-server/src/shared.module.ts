import { Global, Module } from '@nestjs/common';
import { BLOB_CONFIG, defaultBlobLimits, loadLogzioConfig } from './config';
import { createLoggerFromConfig, Logger, LOGGER } from './logging';

// One place that builds the process-wide singletons and hands them to
// Nest's DI. `@Global()` so the request-logging interceptor (registered in
// AppModule) and BlobsService (in BlobsModule) both resolve the *same*
// LOGGER without every module re-importing this one. Mirrors
// 06-load-balancer's SharedModule, and keeps the BLOB_CONFIG token pattern
// the tests already override.
@Global()
@Module({
  providers: [
    { provide: BLOB_CONFIG, useFactory: defaultBlobLimits },
    { provide: LOGGER, useFactory: (): Logger => createLoggerFromConfig(loadLogzioConfig()) },
  ],
  exports: [BLOB_CONFIG, LOGGER],
})
export class SharedModule {}
