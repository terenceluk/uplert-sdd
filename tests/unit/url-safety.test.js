import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateOrReservedAddress } from '../../src/services/url-safety.js';

test('rejects private, loopback, link-local, and metadata addresses', () => {
  assert.equal(isPrivateOrReservedAddress('127.0.0.1', 4), true);
  assert.equal(isPrivateOrReservedAddress('10.0.0.1', 4), true);
  assert.equal(isPrivateOrReservedAddress('192.168.1.1', 4), true);
  assert.equal(isPrivateOrReservedAddress('172.16.0.5', 4), true);
  assert.equal(isPrivateOrReservedAddress('169.254.169.254', 4), true);
  assert.equal(isPrivateOrReservedAddress('::1', 6), true);
  assert.equal(isPrivateOrReservedAddress('fe80::1', 6), true);
});

test('accepts a public address', () => {
  assert.equal(isPrivateOrReservedAddress('93.184.216.34', 4), false);
});
