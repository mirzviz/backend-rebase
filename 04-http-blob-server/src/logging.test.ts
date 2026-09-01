import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadLogzioConfig } from './config';
import { createLogger, createLoggerFromConfig, LogShipper, logzioOptionsFrom } from './logging';

function fakeSink() {
  const lines: string[] = [];
  return { log: (line: string) => lines.push(line), lines };
}

function fakeShipper() {
  const entries: Record<string, unknown>[] = [];
  const shipper: LogShipper = { log: (entry) => entries.push(entry) };
  return { shipper, entries };
}

test('logs to the sink even with no shipper configured', () => {
  const sink = fakeSink();
  createLogger(null, sink).log('info', 'hello');

  assert.equal(sink.lines.length, 1);
  const parsed = JSON.parse(sink.lines[0]);
  assert.equal(parsed.level, 'info');
  assert.equal(parsed.message, 'hello');
});

test('includes an ISO timestamp on every logged entry', () => {
  const sink = fakeSink();
  createLogger(null, sink).log('info', 'hello');

  const parsed = JSON.parse(sink.lines[0]);
  assert.equal(new Date(parsed.timestamp).toISOString(), parsed.timestamp);
});

test('merges extra fields into both the sink line and the shipped entry', () => {
  const sink = fakeSink();
  const { shipper, entries } = fakeShipper();
  createLogger(shipper, sink).log('info', 'blob stored', { id: 'x', bytes: 12 });

  const parsed = JSON.parse(sink.lines[0]);
  assert.equal(parsed.id, 'x');
  assert.equal(parsed.bytes, 12);
  assert.equal(entries[0].id, 'x');
  assert.equal(entries[0].bytes, 12);
});

test('a shipper that throws does not break the caller - logging can never fail a request', () => {
  const sink = fakeSink();
  const throwingShipper: LogShipper = {
    log: () => {
      throw new Error('network is down');
    },
  };
  const logger = createLogger(throwingShipper, sink);

  assert.doesNotThrow(() => logger.log('error', 'boom'));
  assert.equal(sink.lines.length, 2);
  assert.equal(JSON.parse(sink.lines[0]).message, 'boom');
  assert.match(JSON.parse(sink.lines[1]).message, /failed to ship/);
});

test('logzioOptionsFrom maps our LogzioConfig shape onto logzio-nodejs options', () => {
  const options = logzioOptionsFrom({
    token: 'test-token',
    type: 'blob-server',
    protocol: 'https',
    port: 8071,
    host: 'listener-eu.logz.io',
  });

  assert.equal(options.token, 'test-token');
  assert.equal(options.type, 'blob-server');
  assert.equal(options.host, 'listener-eu.logz.io');
  // logzio-nodejs's own types declare port as a string, unlike our numeric config.
  assert.equal(options.port, '8071');
});

test('loadLogzioConfig returns null without a token, and a filled config with one', () => {
  assert.equal(loadLogzioConfig({}), null);

  const config = loadLogzioConfig({ LOGZIO_TOKEN: 'abc', LOGZIO_HOST: 'listener-eu.logz.io' });
  assert.equal(config?.token, 'abc');
  assert.equal(config?.type, 'blob-server'); // default
  assert.equal(config?.host, 'listener-eu.logz.io');
  assert.equal(config?.port, 8071);
});

test('createLoggerFromConfig(null) is console-only and still logs', () => {
  const sink = fakeSink();
  // null config -> no shipper; just prove it doesn't throw and writes a line.
  const logger = createLoggerFromConfig(null);
  assert.equal(typeof logger.log, 'function');

  createLogger(null, sink).log('info', 'ok');
  assert.equal(sink.lines.length, 1);
});
