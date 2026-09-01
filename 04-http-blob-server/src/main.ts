import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadAutoRegistrationConfig, registerWithMaster } from './autoRegistration';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);

  // Optional: if MASTER_NODE_ADDRESS is set, announce ourselves to the load
  // balancer. Fire-and-forget on purpose - the blob server is fully usable
  // on its own, so a missing/slow/misconfigured load balancer must not
  // block startup or take the process down.
  const logger = new Logger('AutoRegistration');
  let autoReg;
  try {
    autoReg = loadAutoRegistrationConfig(process.env, port);
  } catch (err) {
    logger.error(`auto-registration is misconfigured, skipping: ${String(err)}`);
    autoReg = null;
  }
  if (autoReg) {
    void registerWithMaster(autoReg, {
      log: (m) => logger.log(m),
      warn: (m) => logger.warn(m),
      error: (m) => logger.error(m),
    });
  }
}

bootstrap();
