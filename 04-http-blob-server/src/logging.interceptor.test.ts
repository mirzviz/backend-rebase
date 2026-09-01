import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { LogFields, Logger, LogLevel } from './logging';
import { RequestLoggingInterceptor } from './logging.interceptor';

interface Recorded {
  level: LogLevel;
  message: string;
  fields: LogFields;
}

function recordingLogger() {
  const entries: Recorded[] = [];
  const logger: Logger = {
    log: (level, message, fields = {}) => entries.push({ level, message, fields }),
  };
  return { logger, entries };
}

// Minimal fakes - the interceptor only touches req.method/url and the
// response's event emitter + statusCode.
function run(method: string, url: string) {
  const { logger, entries } = recordingLogger();
  const req = { method, url, originalUrl: url };
  const res = Object.assign(new EventEmitter(), { statusCode: 200 });

  const context = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
  const next: CallHandler = { handle: () => of(null) };

  new RequestLoggingInterceptor(logger).intercept(context, next).subscribe();
  return { res, entries };
}

test('logs one info line when the response finishes with a 2xx', () => {
  const { res, entries } = run('POST', '/blobs/hello');
  res.statusCode = 204;
  res.emit('finish');

  assert.equal(entries.length, 1);
  assert.equal(entries[0].level, 'info');
  assert.equal(entries[0].message, 'request completed');
  assert.equal(entries[0].fields.method, 'POST');
  assert.equal(entries[0].fields.path, '/blobs/hello');
  assert.equal(entries[0].fields.status, 204);
  assert.equal(typeof entries[0].fields.durationMs, 'number');
});

test('a 4xx is logged at warn, a 5xx at error', () => {
  const a = run('GET', '/blobs/missing');
  a.res.statusCode = 404;
  a.res.emit('finish');
  assert.equal(a.entries[0].level, 'warn');

  const b = run('POST', '/blobs/x');
  b.res.statusCode = 500;
  b.res.emit('finish');
  assert.equal(b.entries[0].level, 'error');
});

test("a client hang-up ('close' with no 'finish') logs 'request aborted' at error", () => {
  const { res, entries } = run('GET', '/blobs/big');
  res.emit('close');

  assert.equal(entries.length, 1);
  assert.equal(entries[0].level, 'error');
  assert.equal(entries[0].message, 'request aborted');
});

test('finish followed by close only logs once', () => {
  const { res, entries } = run('DELETE', '/blobs/x');
  res.statusCode = 204;
  res.emit('finish');
  res.emit('close');

  assert.equal(entries.length, 1);
  assert.equal(entries[0].message, 'request completed');
});
