import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isRegistrationOpen } from '../src/registrationWindow';

test('is open right after startup', () => {
  assert.equal(isRegistrationOpen({ startedAt: Date.now(), registrationDurationSeconds: 20 }), true);
});

test('is closed once the duration has elapsed', () => {
  const startedAt = Date.now() - 21_000;
  assert.equal(isRegistrationOpen({ startedAt, registrationDurationSeconds: 20 }), false);
});

test('is open one millisecond before the deadline and closed one millisecond after', () => {
  const startedAt = Date.now() - 999;
  assert.equal(isRegistrationOpen({ startedAt, registrationDurationSeconds: 1 }), true);

  const justClosed = Date.now() - 1001;
  assert.equal(isRegistrationOpen({ startedAt: justClosed, registrationDurationSeconds: 1 }), false);
});
