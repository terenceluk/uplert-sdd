import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPoll } from '../../src/services/uptime-service.js';

test('status 200 within the timeout classifies "up"', () => {
  assert.equal(classifyPoll(200, 150), true);
});

test('status 399 within the timeout classifies "up"', () => {
  assert.equal(classifyPoll(399, 150), true);
});

test('status 400 classifies "down" regardless of timing', () => {
  assert.equal(classifyPoll(400, 50), false);
});

test('a connection failure (null status) classifies "down"', () => {
  assert.equal(classifyPoll(null, 10_000), false);
});

test('a full response read at exactly 10,000ms still classifies "up"', () => {
  assert.equal(classifyPoll(200, 10_000), true);
});

test('a response whose body finishes reading after 10,000ms classifies "down"', () => {
  // headers/status may have arrived quickly, but the whole-request budget (connect
  // through fully reading the response) has been exceeded — FR-008.
  assert.equal(classifyPoll(200, 10_001), false);
});
