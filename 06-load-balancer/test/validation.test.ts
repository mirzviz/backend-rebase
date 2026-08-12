import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateNodeRegistration } from '../src/validation';

test('accepts a minimal valid payload with no name', () => {
  const result = validateNodeRegistration({ destination: { host: 'node-1', port: 8080 } });

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.value, {
    destination: { host: 'node-1', port: 8080 },
    name: null,
  });
});

test('accepts a valid payload with a name', () => {
  const result = validateNodeRegistration({
    destination: { host: 'node-1', port: 8080 },
    name: 'primary',
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.value, {
    destination: { host: 'node-1', port: 8080 },
    name: 'primary',
  });
});

test('treats null name as equivalent to missing', () => {
  const result = validateNodeRegistration({ destination: { host: 'node-1', port: 8080 }, name: null });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.value.name, null);
});

test('treats empty-string name as equivalent to missing', () => {
  const result = validateNodeRegistration({ destination: { host: 'node-1', port: 8080 }, name: '' });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.value.name, null);
});

test('rejects a payload with no destination', () => {
  const result = validateNodeRegistration({ name: 'primary' });
  assert.equal(result.ok, false);
});

test('rejects a payload that is not a JSON object', () => {
  assert.equal(validateNodeRegistration(null).ok, false);
  assert.equal(validateNodeRegistration('nope').ok, false);
  assert.equal(validateNodeRegistration([]).ok, false);
});

test('rejects a missing host', () => {
  const result = validateNodeRegistration({ destination: { port: 8080 } });
  assert.equal(result.ok, false);
});

test('rejects a host longer than 50 characters', () => {
  const result = validateNodeRegistration({ destination: { host: 'a'.repeat(51), port: 8080 } });
  assert.equal(result.ok, false);
});

test('accepts a host of exactly 50 characters', () => {
  const result = validateNodeRegistration({ destination: { host: 'a'.repeat(50), port: 8080 } });
  assert.equal(result.ok, true);
});

test('rejects a host with characters outside a-zA-Z0-9_-', () => {
  for (const badHost of ['bad host', 'bad.host', 'bad/host', 'bad@host', 'bad+host']) {
    const result = validateNodeRegistration({ destination: { host: badHost, port: 8080 } });
    assert.equal(result.ok, false, `expected ${badHost} to be rejected`);
  }
});

test('accepts every character in the allowed set for host', () => {
  const result = validateNodeRegistration({
    destination: { host: 'Az_09-node', port: 8080 },
  });
  assert.equal(result.ok, true);
});

test('rejects a missing port', () => {
  const result = validateNodeRegistration({ destination: { host: 'node-1' } });
  assert.equal(result.ok, false);
});

test('rejects a negative port', () => {
  const result = validateNodeRegistration({ destination: { host: 'node-1', port: -1 } });
  assert.equal(result.ok, false);
});

test('rejects a non-integer port', () => {
  const result = validateNodeRegistration({ destination: { host: 'node-1', port: 80.5 } });
  assert.equal(result.ok, false);
});

test('rejects a port above 65535', () => {
  const result = validateNodeRegistration({ destination: { host: 'node-1', port: 65536 } });
  assert.equal(result.ok, false);
});

test('accepts port 0 and port 65535 as the inclusive boundary', () => {
  assert.equal(validateNodeRegistration({ destination: { host: 'node-1', port: 0 } }).ok, true);
  assert.equal(validateNodeRegistration({ destination: { host: 'node-1', port: 65535 } }).ok, true);
});

test('rejects a name longer than 50 characters', () => {
  const result = validateNodeRegistration({
    destination: { host: 'node-1', port: 8080 },
    name: 'a'.repeat(51),
  });
  assert.equal(result.ok, false);
});

test('rejects a name with characters outside a-zA-Z0-9_-', () => {
  const result = validateNodeRegistration({
    destination: { host: 'node-1', port: 8080 },
    name: 'bad name!',
  });
  assert.equal(result.ok, false);
});
