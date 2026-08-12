import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './configureApp';
import { loadConfig } from './config';
import { createLogger, createLogzioShipper } from './logging';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  configureApp(app);

  const config = loadConfig();
  // Built directly rather than pulled from the DI container - this one
  // startup log line doesn't need to share the app's LOGGER instance.
  const shipper = config.logzio ? createLogzioShipper(config.logzio) : null;
  const logger = createLogger(shipper);

  await app.listen(config.port);
  logger.log('info', 'load balancer started', {
    port: config.port,
    registrationDurationSeconds: config.registrationDurationSeconds,
    logzioEnabled: config.logzio !== null,
  });
}

void bootstrap();
