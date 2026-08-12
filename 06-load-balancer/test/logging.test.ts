import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLogger, LogShipper, logzioOptionsFrom } from '../src/logging';

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
  createLogger(shipper, sink).log('warn', 'node burned', { node: 'node-3', attempt: 2 });

  const parsed = JSON.parse(sink.lines[0]);
  assert.equal(parsed.node, 'node-3');
  assert.equal(parsed.attempt, 2);
  assert.equal(entries[0].node, 'node-3');
  assert.equal(entries[0].attempt, 2);
});

test('ships to the shipper when one is configured, in addition to the sink', () => {
  const sink = fakeSink();
  const { shipper, entries } = fakeShipper();
  createLogger(shipper, sink).log('error', 'boom');

  assert.equal(sink.lines.length, 1);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].message, 'boom');
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

test('logzioOptionsFrom maps our LogzioConfig shape onto logzio-nodejs createLogger options', () => {
  const options = logzioOptionsFrom({
    token: 'test-token',
    type: 'load-balancer',
    protocol: 'https',
    port: 8071,
    host: 'listener-eu.logz.io',
  });

  assert.equal(options.token, 'test-token');
  assert.equal(options.type, 'load-balancer');
  assert.equal(options.protocol, 'https');
  assert.equal(options.host, 'listener-eu.logz.io');
  // logzio-nodejs's own types declare port as a string, unlike our numeric config.
  assert.equal(options.port, '8071');
});
