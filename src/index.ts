import { createHash, randomBytes } from 'node:crypto';
import { hostname } from 'node:os';

const TOTAL_BITS = 63;
const BASE32_LENGTH = 13;
const HEX_LENGTH = 16;
const CROCKFORD_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

export const MIN_TIME_BITS = 40;
export const MAX_TIME_BITS = 48;
export const DEFAULT_TIME_BITS = 42;
export const DEFAULT_EPOCH_MILLIS = 1_577_836_800_000; // 2020-01-01T00:00:00.000Z

const MIN_INT64 = -(1n << 63n);
const MAX_INT64 = (1n << 63n) - 1n;
const MAX_UINT64 = (1n << 64n) - 1n;

const base32DecodeMap = buildBase32DecodeMap();

export type EpochInput = Date | number | bigint;

export interface CrystalOptions {
  readonly epoch?: EpochInput;
  readonly timeBits?: number;
}

interface ResolvedOptions {
  readonly epochMillis: number;
  readonly timeBits: number;
  readonly timeShift: bigint;
  readonly stepMask: bigint;
  readonly stepSeedMask: bigint;
}

export class ID {
  readonly #value: bigint;
  readonly #epochMillis: number;
  readonly #timeShift: bigint;

  public constructor(
    value: bigint,
    epochMillis = DEFAULT_EPOCH_MILLIS,
    timeBits = DEFAULT_TIME_BITS,
  ) {
    assertIDRange(value);

    this.#value = value;
    this.#epochMillis = epochMillis;
    this.#timeShift = BigInt(TOTAL_BITS - clampTimeBits(timeBits));
  }

  public int64(): bigint {
    return this.#value;
  }

  public toBigInt(): bigint {
    return this.#value;
  }

  public time(): Date {
    const millis = Number((this.#value >> this.#timeShift) + BigInt(this.#epochMillis));
    return new Date(millis);
  }

  public base32(): string {
    return encodeBase32(this.#value);
  }

  public hex(): string {
    return int64ToUint64(this.#value).toString(16).padStart(HEX_LENGTH, '0');
  }

  public toHex(): string {
    return this.hex();
  }

  public toString(): string {
    return this.base32();
  }

  public static parseInt64(value: bigint | number, options: CrystalOptions = {}): ID {
    const resolved = resolveOptions(options);

    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value)) {
        throw new Error('number input exceeds safe integer range, use bigint instead');
      }

      return new ID(BigInt(value), resolved.epochMillis, resolved.timeBits);
    }

    return new ID(value, resolved.epochMillis, resolved.timeBits);
  }

  public static parseString(value: string, options: CrystalOptions = {}): ID {
    return ID.parseBase32(value, options);
  }

  public static parseBase32(value: string, options: CrystalOptions = {}): ID {
    if (value.length !== BASE32_LENGTH) {
      throw new Error(`invalid base32 length: ${String(value.length)}`);
    }

    let result = 0n;
    for (const char of value) {
      const mapped = base32DecodeMap.get(char);
      if (mapped === undefined) {
        throw new Error(`invalid base32 character: ${char}`);
      }

      result = (result << 5n) | mapped;
    }

    if (result > MAX_UINT64) {
      throw new Error('base32 value is out of range for crystal ID');
    }

    const resolved = resolveOptions(options);
    return new ID(uint64ToInt64(result), resolved.epochMillis, resolved.timeBits);
  }

  public static parseHex(value: string, options: CrystalOptions = {}): ID {
    if (value.length !== HEX_LENGTH) {
      throw new Error(`invalid hex length: ${String(value.length)}`);
    }

    if (!/^[\da-fA-F]+$/u.test(value)) {
      throw new Error('invalid hex input');
    }

    const resolved = resolveOptions(options);
    return new ID(uint64ToInt64(BigInt(`0x${value}`)), resolved.epochMillis, resolved.timeBits);
  }
}

export class Generator {
  readonly #epochMillis: number;
  readonly #timeBits: number;
  readonly #timeShift: bigint;
  readonly #stepMask: bigint;
  readonly #stepSeedMask: bigint;
  readonly #seed: Buffer;

  #step: bigint;
  #lastMillis: number;

  public constructor(options: CrystalOptions = {}) {
    const resolved = resolveOptions(options);

    this.#epochMillis = resolved.epochMillis;
    this.#timeBits = resolved.timeBits;
    this.#timeShift = resolved.timeShift;
    this.#stepMask = resolved.stepMask;
    this.#stepSeedMask = resolved.stepSeedMask;

    this.#seed = calculateNodeSeed();
    this.#step = initCounter(this.#seed, this.#stepSeedMask);
    this.#lastMillis = this.epochMillisNow();
  }

  public epoch(): Date {
    return new Date(this.#epochMillis);
  }

  public epochMillis(): number {
    return this.#epochMillis;
  }

  public timeBits(): number {
    return this.#timeBits;
  }

  public generate(): ID {
    let now = this.epochMillisNow();

    if (now < this.#lastMillis) {
      now = this.#lastMillis;
    }

    if (now === this.#lastMillis) {
      this.#step = (this.#step + 1n) & this.#stepMask;
      if (this.#step === 0n) {
        do {
          now = this.epochMillisNow();
        } while (now <= this.#lastMillis);

        this.#step = initCounter(this.#seed, this.#stepSeedMask);
      }
    } else {
      this.#step = initCounter(this.#seed, this.#stepSeedMask);
    }

    this.#lastMillis = now;

    return new ID(
      (BigInt(now) << this.#timeShift) | (this.#step & this.#stepMask),
      this.#epochMillis,
      this.#timeBits,
    );
  }

  private epochMillisNow(): number {
    const millis = Date.now() - this.#epochMillis;
    if (millis < 0) {
      return 0;
    }

    return millis;
  }
}

function resolveOptions(options: CrystalOptions): ResolvedOptions {
  const epochMillis = resolveEpochMillis(options.epoch);
  const timeBits = resolveTimeBits(options.timeBits);
  const stepBits = TOTAL_BITS - timeBits;
  const timeShift = BigInt(stepBits);
  const stepMask = (1n << timeShift) - 1n;
  const stepSeedMask = stepBits <= 1 ? 0n : (1n << BigInt(stepBits - 1)) - 1n;

  return {
    epochMillis,
    timeBits,
    timeShift,
    stepMask,
    stepSeedMask,
  };
}

function resolveEpochMillis(epoch: EpochInput | undefined): number {
  if (epoch === undefined) {
    return DEFAULT_EPOCH_MILLIS;
  }

  if (epoch instanceof Date) {
    return assertEpochMillis(epoch.getTime());
  }

  if (typeof epoch === 'bigint') {
    const asNumber = Number(epoch);
    return assertEpochMillis(asNumber);
  }

  return assertEpochMillis(epoch);
}

function assertEpochMillis(value: number): number {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error('epoch must be an integer millisecond value');
  }

  return value;
}

function resolveTimeBits(timeBits: number | undefined): number {
  if (timeBits === undefined) {
    return DEFAULT_TIME_BITS;
  }

  if (!Number.isInteger(timeBits)) {
    throw new Error('timeBits must be an integer');
  }

  return clampTimeBits(timeBits);
}

function calculateNodeSeed(): Buffer {
  const machine = resolveHostname();
  const pid = process.pid;

  return createHash('sha256').update(machine).update(String(pid)).digest();
}

function resolveHostname(): string {
  try {
    const machine = hostname();
    if (machine.length > 0) {
      return machine;
    }
  } catch {
    // fallback below
  }

  return 'unknown';
}

function initCounter(seed: Buffer, seedMask: bigint): bigint {
  if (seedMask === 0n) {
    return 0n;
  }

  try {
    const rand = randomBytes(32);
    const sum = createHash('sha256').update(seed).update(rand).digest();
    return bytesToBigInt(sum.subarray(0, 8)) & seedMask;
  } catch {
    const fallbackTime = BigInt(Date.now()) * 1_000_000n;
    const seedPrefix = bytesToBigInt(seed.subarray(0, 8));
    return (fallbackTime ^ seedPrefix) & seedMask;
  }
}

function bytesToBigInt(value: Uint8Array): bigint {
  let result = 0n;
  for (const byte of value) {
    result = (result << 8n) | BigInt(byte);
  }

  return result;
}

function encodeBase32(value: bigint): string {
  let remaining = int64ToUint64(value);
  const out = Array<string>(BASE32_LENGTH).fill('0');

  for (let index = BASE32_LENGTH - 1; index >= 0; index -= 1) {
    const symbolIndex = Number(remaining & 31n);
    const symbol = CROCKFORD_ALPHABET.at(symbolIndex);
    if (symbol === undefined) {
      throw new Error(`invalid symbol index: ${String(symbolIndex)}`);
    }

    out[index] = symbol;
    remaining >>= 5n;
  }

  if (remaining !== 0n) {
    throw new Error('value is too large for base32 encoding');
  }

  return out.join('');
}

function assertIDRange(value: bigint): void {
  if (value < MIN_INT64 || value > MAX_INT64) {
    throw new Error(`id out of range: ${value.toString()}`);
  }
}

function clampTimeBits(value: number): number {
  if (value < MIN_TIME_BITS) {
    return MIN_TIME_BITS;
  }

  if (value > MAX_TIME_BITS) {
    return MAX_TIME_BITS;
  }

  return value;
}

function int64ToUint64(value: bigint): bigint {
  if (value >= 0n) {
    return value;
  }

  return (value + MAX_UINT64 + 1n) & MAX_UINT64;
}

function uint64ToInt64(value: bigint): bigint {
  if (value < 0n || value > MAX_UINT64) {
    throw new Error(`uint64 out of range: ${value.toString()}`);
  }

  if (value > MAX_INT64) {
    return value - (MAX_UINT64 + 1n);
  }

  return value;
}

function buildBase32DecodeMap(): Map<string, bigint> {
  const map = new Map<string, bigint>();

  for (const [index, char] of Array.from(CROCKFORD_ALPHABET).entries()) {
    map.set(char, BigInt(index));
  }

  return map;
}
