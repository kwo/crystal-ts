import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_EPOCH_MILLIS, DEFAULT_TIME_BITS, Generator, ID } from './index.js';

const generationCount = 1_000;

describe('crystal', { concurrency: false }, () => {
  test('generates unique and increasing IDs', () => {
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
    const id = new Generator().generate();

    assert.ok(id.toString().length > 0);
    assert.equal(id.toHex().length, 16);
    assert.ok(id.toBigInt() > 0n);
    assert.ok(Math.abs(Date.now() - id.time().getTime()) < 1_000);
  });

  test('parses base32 and hex IDs', () => {
    const id = new Generator().generate();

    assert.equal(ID.parseString(id.toString()).toBigInt(), id.toBigInt());
    assert.equal(ID.parseBase32(id.base32()).toBigInt(), id.toBigInt());
    assert.equal(ID.parseHex(id.hex()).toBigInt(), id.toBigInt());
    assert.equal(ID.parseInt64(id.toBigInt()).toBigInt(), id.toBigInt());
  });

  test('rejects invalid parse input', () => {
    assert.throws(() => ID.parseString('invalid!@#'));
    assert.throws(() => ID.parseBase32('invalid!@#'));
    assert.throws(() => ID.parseBase32('000G40R40M30E'));
    assert.throws(() => ID.parseHex('zzzz'));
    assert.throws(() => ID.parseInt64(Number.MAX_SAFE_INTEGER + 1));
  });

  test('supports signed int64 parse and formatting roundtrips', () => {
    const negative = ID.parseInt64(-1n);

    assert.equal(negative.toHex(), 'ffffffffffffffff');
    assert.equal(ID.parseHex('ffffffffffffffff').toBigInt(), -1n);
    assert.equal(ID.parseHex(negative.toHex()).toBigInt(), -1n);
    assert.equal(ID.parseBase32(negative.toString()).toBigInt(), -1n);
  });

  test('supports constructor options for epoch and timeBits', () => {
    const customEpochMillis = Date.UTC(2000, 0, 1, 0, 0, 0, 0);
    const generator = new Generator({
      epoch: customEpochMillis,
      timeBits: 40,
    });

    const id = generator.generate();

    assert.equal(generator.epoch().getTime(), customEpochMillis);
    assert.equal(generator.timeBits(), 40);
    assert.ok(Math.abs(Date.now() - id.time().getTime()) < 1_000);
  });

  test('uses defaults for constructor options', () => {
    const generator = new Generator();

    assert.equal(generator.epochMillis(), DEFAULT_EPOCH_MILLIS);
    assert.equal(generator.timeBits(), DEFAULT_TIME_BITS);
  });

  test('clamps constructor timeBits into supported range', () => {
    const high = new Generator({ timeBits: 100 });
    const low = new Generator({ timeBits: 0 });

    assert.equal(high.timeBits(), 48);
    assert.equal(low.timeBits(), 40);
  });

  test('produced IDs have valid bit allocation', () => {
    const generator = new Generator();
    const id = generator.generate().toBigInt();

    const stepBits = BigInt(63 - generator.timeBits());
    const stepMask = (1n << stepBits) - 1n;
    const step = id & stepMask;
    const timestamp = id >> stepBits;
    const realMillis = timestamp + BigInt(generator.epochMillis());

    assert.ok(step <= stepMask);

    const now = BigInt(Date.now());
    assert.ok(realMillis > 0n);
    assert.ok(realMillis <= now);
    assert.ok(now - realMillis < 60_000n);
  });

  test('remains unique across async generation bursts', async () => {
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
