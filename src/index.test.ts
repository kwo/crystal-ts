import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_EPOCH_MILLIS,
  DEFAULT_TIME_BITS,
  Generator,
  getEpochMillis,
  getTimeBits,
  parseBase32,
  parseHex,
  parseInt64,
  parseString,
  setEpoch,
  setTimeBits,
} from './index.js';

const generationCount = 1_000;

function resetDefaults(): void {
  setEpoch(DEFAULT_EPOCH_MILLIS);
  setTimeBits(DEFAULT_TIME_BITS);
}

describe('crystal', { concurrency: false }, () => {
  test('generates unique and increasing IDs', () => {
    resetDefaults();

    const generator = new Generator();
    const ids = Array.from({ length: generationCount }, () => generator.generate());

    const seen = new Set(ids.map((id) => id.toBigInt().toString()));
    assert.equal(seen.size, ids.length);

    for (let index = 1; index < ids.length; index += 1) {
      const current = ids.at(index);
      const previous = ids.at(index - 1);
      assert.ok(current !== undefined);
      assert.ok(previous !== undefined);
      assert.ok(current.toBigInt() > previous.toBigInt());
    }
  });

  test('ID exposes string and integer representations', () => {
    resetDefaults();

    const id = new Generator().generate();

    assert.ok(id.toString().length > 0);
    assert.equal(id.toHex().length, 16);
    assert.ok(id.toBigInt() > 0n);
    assert.ok(Math.abs(Date.now() - id.time().getTime()) < 1_000);
  });

  test('parses base32 and hex IDs', () => {
    resetDefaults();

    const id = new Generator().generate();

    assert.equal(parseString(id.toString()).toBigInt(), id.toBigInt());
    assert.equal(parseBase32(id.base32()).toBigInt(), id.toBigInt());
    assert.equal(parseHex(id.hex()).toBigInt(), id.toBigInt());
    assert.equal(parseInt64(id.toBigInt()).toBigInt(), id.toBigInt());
  });

  test('rejects invalid parse input', () => {
    assert.throws(() => parseString('invalid!@#'));
    assert.throws(() => parseBase32('invalid!@#'));
    assert.throws(() => parseBase32('000G40R40M30E'));
    assert.throws(() => parseHex('zzzz'));
    assert.throws(() => parseInt64(Number.MAX_SAFE_INTEGER + 1));
  });

  test('supports signed int64 parse and formatting roundtrips', () => {
    const negative = parseInt64(-1n);

    assert.equal(negative.toHex(), 'ffffffffffffffff');
    assert.equal(parseHex('ffffffffffffffff').toBigInt(), -1n);
    assert.equal(parseHex(negative.toHex()).toBigInt(), -1n);
    assert.equal(parseBase32(negative.toString()).toBigInt(), -1n);
  });

  test('supports epoch and timeBits overrides', () => {
    const customEpochMillis = Date.UTC(2000, 0, 1, 0, 0, 0, 0);
    setEpoch(customEpochMillis);
    setTimeBits(40);

    const generator = new Generator();
    const id = generator.generate();

    assert.equal(generator.epoch().getTime(), customEpochMillis);
    assert.ok(Math.abs(Date.now() - id.time().getTime()) < 1_000);

    resetDefaults();
  });

  test('clamps timeBits into supported range', () => {
    setTimeBits(100);
    assert.equal(getTimeBits(), 48);

    setTimeBits(0);
    assert.equal(getTimeBits(), 40);

    resetDefaults();
  });

  test('produced IDs have valid bit allocation', () => {
    resetDefaults();

    const id = new Generator().generate().toBigInt();

    const stepBits = BigInt(63 - getTimeBits());
    const stepMask = (1n << stepBits) - 1n;
    const step = id & stepMask;
    const timestamp = id >> stepBits;
    const realMillis = timestamp + BigInt(getEpochMillis());

    assert.ok(step <= stepMask);

    const now = BigInt(Date.now());
    assert.ok(realMillis > 0n);
    assert.ok(realMillis <= now);
    assert.ok(now - realMillis < 60_000n);
  });

  test('remains unique across async generation bursts', async () => {
    resetDefaults();

    const generator = new Generator();
    const total = 10_000;
    const ids = await Promise.all(
      Array.from({ length: total }, () =>
        Promise.resolve().then(() => generator.generate().toBigInt().toString()),
      ),
    );

    const unique = new Set(ids);
    assert.equal(unique.size, total);
  });
});
