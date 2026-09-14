import { INestApplication } from '@nestjs/common';
import * as express from 'express';

// Both main.ts and the test harness build their own INestApplication
// instance (Nest's testing module doesn't run through main.ts's
// bootstrap), so shared app config lives in one place both call.
export function configureApp(app: INestApplication): void {
  app.use(express.json());
}
