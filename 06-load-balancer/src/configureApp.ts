import { INestApplication } from '@nestjs/common';
import * as express from 'express';

// bodyParser stays off globally (see NestFactory.create call sites): blob
// bodies are opaque bytes streamed straight through to a node, and
// Express's body-parser would consume that stream before the blobs
// controller ever saw it. JSON parsing for /internal/nodes doesn't have
// that constraint, so it gets real middleware, scoped to just that route.
// `type: () => true` parses regardless of Content-Type, matching the spec
// (which never requires clients to send one).
//
// Both main.ts and the test harness build their own INestApplication
// instance (Nest's testing module doesn't run through main.ts's
// bootstrap), so this lives in one place both call - otherwise it's easy
// for the two to silently drift apart.
export function configureApp(app: INestApplication): void {
  app.use('/internal/nodes', express.json({ limit: '100kb', type: () => true }));
}
