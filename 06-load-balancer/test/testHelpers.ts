import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configureApp';
import { Config, loadConfig } from '../src/config';
import { Logger } from '../src/logging';
import { NodeRegistry } from '../src/nodeRegistry';
import { LB_CONFIG, LOGGER, REGISTRATION_STARTED_AT } from '../src/shared/shared.module';

export interface TestApp {
  baseUrl: string;
  // Exposes the same NodeRegistry instance the running app uses, so a test
  // that wants nodes already registered against an already-closed window
  // can seed them directly instead of going through the (window-gated)
  // HTTP registration endpoint.
  registry: NodeRegistry;
  close: () => Promise<void>;
}

export interface TestAppOverrides {
  config?: Partial<Config>;
  // Lets a test simulate "the registration window already closed" without
  // waiting on a real timer - just backdate when the app "started".
  startedAt?: number;
  // Lets a test capture what gets logged (e.g. a fake that pushes calls
  // into an array) instead of the real console+Logz.io logger.
  logger?: Logger;
}

// Every test gets its own server on an ephemeral port, its own fresh
// NodeRegistry (SharedModule provides a new one per compiled test module),
// and its own startedAt - so tests can run in any order without sharing
// state. Mirrors 04-http-blob-server's createTestApp/overrideProvider
// pattern.
export async function startTestApp(overrides: TestAppOverrides = {}): Promise<TestApp> {
  const config: Config = { ...loadConfig({}), ...overrides.config };
  const startedAt = overrides.startedAt ?? Date.now();

  const testModule = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(LB_CONFIG)
    .useValue(config)
    .overrideProvider(REGISTRATION_STARTED_AT)
    .useValue(startedAt);

  if (overrides.logger) {
    testModule.overrideProvider(LOGGER).useValue(overrides.logger);
  }

  const moduleRef = await testModule.compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  configureApp(app);
  await app.listen(0);
  const address = app.getHttpServer().address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    registry: moduleRef.get(NodeRegistry),
    close: () => app.close(),
  };
}

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RecordedRequest {
  method: string | undefined;
  url: string | undefined;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

export interface FakeNode {
  host: string;
  port: number;
  requests: RecordedRequest[];
  close: () => Promise<void>;
}

// Stands in for a real 04-http-blob-server instance in tests, so routing
// and proxying can be verified without spinning up an actual blob server.
// Reports its host as 'localhost', not '127.0.0.1': destination.host goes
// through the same a-zA-Z0-9_- whitelist as `name`, which a dotted IPv4
// address fails.
export function startFakeNode(
  respond: (req: http.IncomingMessage, res: http.ServerResponse, body: Buffer) => void,
): Promise<FakeNode> {
  const requests: RecordedRequest[] = [];

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      respond(req, res, body);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        host: 'localhost',
        port,
        requests,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}
