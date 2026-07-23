import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import { BLOB_CONFIG, BlobLimits, defaultBlobLimits } from './config';

export interface TestApp {
  app: INestApplication;
  baseUrl: string;
  storageDir: string;
  cleanup: () => Promise<void>;
}

// Every test gets its own throwaway storage directory and its own limits
// (defaults to the real spec numbers, overridable per test) instead of
// sharing global state, so tests can run in any order without colliding.
export async function createTestApp(overrides: Partial<BlobLimits> = {}): Promise<TestApp> {
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blob-server-test-'));
  const limits: BlobLimits = { ...defaultBlobLimits(), storageDir, ...overrides };

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(BLOB_CONFIG)
    .useValue(limits)
    .compile();

  const app = moduleRef.createNestApplication({ bodyParser: false });
  await app.listen(0);
  const address = app.getHttpServer().address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    app,
    baseUrl,
    storageDir,
    cleanup: async () => {
      await app.close();
      fs.rmSync(storageDir, { recursive: true, force: true });
    },
  };
}

// supertest/superagent always send a full, known-length Buffer via a
// single .end(buf) call, which makes Node auto-compute Content-Length -
// there's no way to omit it through that API. Splitting the write into
// write()+end() forces Node's http client to fall back to
// Transfer-Encoding: chunked instead, which is the only way to produce
// a real "no Content-Length" request to test against.
export function postWithoutContentLength(
  baseUrl: string,
  urlPath: string,
  data: Buffer,
): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, baseUrl);
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST' },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
      },
    );
    req.on('error', reject);
    const mid = Math.max(1, Math.floor(data.length / 2));
    req.write(data.subarray(0, mid));
    req.end(data.subarray(mid));
  });
}
