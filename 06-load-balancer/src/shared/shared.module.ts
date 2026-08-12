import { Module } from '@nestjs/common';
import { Config, loadConfig } from '../config';
import { createLogger, createLogzioShipper, Logger } from '../logging';
import { NodeRegistry } from '../nodeRegistry';

// Both feature modules (nodes, blobs) need the exact same NodeRegistry
// instance - a node registered via /internal/nodes must be visible to
// /blobs/* routing in the same process. Declaring it here once, and
// exporting it, is how Nest's DI shares that single instance instead of
// each module getting its own.
export const LB_CONFIG = Symbol('LB_CONFIG');
export const REGISTRATION_STARTED_AT = Symbol('REGISTRATION_STARTED_AT');
export const LOGGER = Symbol('LOGGER');

@Module({
  providers: [
    NodeRegistry,
    { provide: LB_CONFIG, useFactory: (): Config => loadConfig() },
    // Captured once per app/test instance, not at module load time - each
    // createTestingModule() call in a test gets its own fresh startedAt.
    { provide: REGISTRATION_STARTED_AT, useFactory: (): number => Date.now() },
    {
      provide: LOGGER,
      useFactory: (config: Config): Logger => {
        const shipper = config.logzio ? createLogzioShipper(config.logzio) : null;
        return createLogger(shipper);
      },
      inject: [LB_CONFIG],
    },
  ],
  exports: [NodeRegistry, LB_CONFIG, REGISTRATION_STARTED_AT, LOGGER],
})
export class SharedModule {}
