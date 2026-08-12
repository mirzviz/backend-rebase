import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config';

test('loadConfig uses spec defaults when no env vars are set', () => {
  const config = loadConfig({});

  assert.equal(config.port, 3000);
  assert.equal(config.registrationDurationSeconds, 20);
  assert.equal(config.logzio, null);
});

test('loadConfig reads PORT and REGISTRATION_DURATION_SECONDS from env', () => {
  const config = loadConfig({ PORT: '4321', REGISTRATION_DURATION_SECONDS: '5' });

  assert.equal(config.port, 4321);
  assert.equal(config.registrationDurationSeconds, 5);
});

test('loadConfig leaves logzio null when LOGZIO_TOKEN is unset, so the server can boot without it', () => {
  const config = loadConfig({ LOGZIO_HOST: 'listener-eu.logz.io' });

  assert.equal(config.logzio, null);
});

test('loadConfig builds a logzio config with defaults once LOGZIO_TOKEN is set', () => {
  const config = loadConfig({ LOGZIO_TOKEN: 'test-token' });

  assert.deepEqual(config.logzio, {
    token: 'test-token',
    type: 'load-balancer',
    protocol: 'https',
    port: 8071,
    host: 'listener.logz.io',
  });
});

test('loadConfig lets every logzio field be overridden individually', () => {
  const config = loadConfig({
    LOGZIO_TOKEN: 'test-token',
    LOGZIO_TYPE: 'my-type',
    LOGZIO_PROTOCOL: 'http',
    LOGZIO_PORT: '9000',
    LOGZIO_HOST: 'listener-eu.logz.io',
  });

  assert.deepEqual(config.logzio, {
    token: 'test-token',
    type: 'my-type',
    protocol: 'http',
    port: 9000,
    host: 'listener-eu.logz.io',
  });
});
