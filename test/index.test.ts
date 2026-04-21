import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Crystal,
  DEFAULT_EPOCH_MILLIS,
  DEFAULT_TIME_BITS,
  ID,
  MAX_TIME_BITS,
  MIN_TIME_BITS,
} from '../src/index.js';

describe('crystal', { concurrency: false }, () => {
  test('generates unique and strictly increasing IDs', () => {
    const crystal = new Crystal();
    const ids = Array.from({ length: 10_000 }, () => crystal.newId().toBigInt());

    assert.equal(new Set(ids.map(String)).size, ids.length);
    ids.reduce((prev, curr) => {
      assert.ok(curr > prev);
      return curr;
    });
  });

  test('ID exposes string, hex, and bigint representations', () => {
    const id = new Crystal().newId();

    assert.equal(id.toString().length, 13);
    assert.equal(id.toHex().length, 16);
    assert.ok(id.toBigInt() > 0n);
    assert.ok(Math.abs(Date.now() - id.time().getTime()) < 5_000);
  });

  test('roundtrips through base32, hex, and int64', () => {
    const id = new Crystal().newId();
    const value = id.toBigInt();

    assert.equal(ID.parseBase32(id.toString()).toBigInt(), value);
    assert.equal(ID.parseHex(id.toHex()).toBigInt(), value);
    assert.equal(ID.parseInt64(value).toBigInt(), value);
    assert.equal(ID.parseInt64(Number(value & 0xffffffffn)).toBigInt(), value & 0xffffffffn);
  });

  test('rejects invalid parse input', () => {
    assert.throws(() => ID.parseBase32('too-short'));
    assert.throws(() => ID.parseBase32('invalid!@#$%^&'));
    assert.throws(() => ID.parseHex('zzzz'));
    assert.throws(() => ID.parseHex('not-hex-but-16ch'));
    assert.throws(() => ID.parseInt64(Number.MAX_SAFE_INTEGER + 1));
    assert.throws(() => ID.parseInt64(-1n));
    assert.throws(() => ID.parseHex('ffffffffffffffff')); // top bit set -> out of range
  });

  test('ID constructor rejects negative and oversized values', () => {
    assert.throws(() => new ID(-1n));
    assert.throws(() => new ID(1n << 63n));
  });

  test('supports constructor options for epoch and timeBits', () => {
    const customEpochMillis = Date.UTC(2000, 0, 1);
    const crystal = new Crystal({ epoch: customEpochMillis, timeBits: 40 });
    const id = crystal.newId();

    assert.equal(crystal.epoch().getTime(), customEpochMillis);
    assert.equal(crystal.timeBits(), 40);
    assert.ok(Math.abs(Date.now() - id.time().getTime()) < 5_000);
  });

  test('uses defaults for constructor options', () => {
    const crystal = new Crystal();
    assert.equal(crystal.epochMillis(), DEFAULT_EPOCH_MILLIS);
    assert.equal(crystal.timeBits(), DEFAULT_TIME_BITS);
  });

  test('rejects timeBits outside the supported range', () => {
    assert.throws(() => new Crystal({ timeBits: MIN_TIME_BITS - 1 }));
    assert.throws(() => new Crystal({ timeBits: MAX_TIME_BITS + 1 }));
    assert.throws(() => new Crystal({ timeBits: 42.5 }));
  });

  test('produced IDs have valid bit allocation', () => {
    const crystal = new Crystal();
    const id = crystal.newId().toBigInt();
    const stepBits = BigInt(63 - crystal.timeBits());
    const step = id & ((1n << stepBits) - 1n);
    const realMillis = (id >> stepBits) + BigInt(crystal.epochMillis());
    const now = BigInt(Date.now());

    assert.ok(step >= 0n);
    assert.ok(realMillis > 0n && realMillis <= now && now - realMillis < 60_000n);
  });
});
