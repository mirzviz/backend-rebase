import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadAutoRegistrationConfig, registerWithMaster } from './autoRegistration';
import { loadLogzioConfig } from './config';
import { Logger, LOGGER } from './logging';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);

  // Same logger instance the request interceptor and BlobsService use, so
  // startup and auto-registration lines ship to Logz.io too when it's on.
  const logger = app.get<Logger>(LOGGER);
  logger.log('info', 'blob server started', {
    port,
    logzioEnabled: loadLogzioConfig() !== null,
  });

  // Optional: if MASTER_NODE_ADDRESS is set, announce ourselves to the load
  // balancer. Fire-and-forget on purpose - the blob server is fully usable
  // on its own, so a missing/slow/misconfigured load balancer must not
  // block startup or take the process down.
  let autoReg;
  try {
    autoReg = loadAutoRegistrationConfig(process.env, port);
  } catch (err) {
    logger.log('error', 'auto-registration is misconfigured, skipping', { error: String(err) });
    autoReg = null;
  }
  if (autoReg) {
    void registerWithMaster(autoReg, {
      log: (m) => logger.log('info', m, { component: 'auto-registration' }),
      warn: (m) => logger.log('warn', m, { component: 'auto-registration' }),
      error: (m) => logger.log('error', m, { component: 'auto-registration' }),
    });
  }
}

bootstrap();
