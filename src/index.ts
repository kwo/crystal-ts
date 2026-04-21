import { createHash, randomBytes } from 'node:crypto';
import { hostname } from 'node:os';

const TOTAL_BITS = 63;
export const MIN_TIME_BITS = 40;
export const MAX_TIME_BITS = 48;
export const DEFAULT_TIME_BITS = 42;
export const DEFAULT_EPOCH_MILLIS = 1_577_836_800_000; // 2020-01-01T00:00:00.000Z

const MIN_INT64 = -(1n << 63n);
const MAX_INT64 = (1n << 63n) - 1n;
const MAX_UINT64 = (1n << 64n) - 1n;
const BASE32_LENGTH = 13;
const HEX_LENGTH = 16;
const CROCKFORD_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

let epochMillisValue = DEFAULT_EPOCH_MILLIS;
let timeBitsValue = DEFAULT_TIME_BITS;

const base32DecodeMap = buildBase32DecodeMap();

export class ID {
  readonly #value: bigint;

  public constructor(value: bigint) {
    assertIDRange(value);
    this.#value = value;
  }

  public int64(): bigint {
    return this.#value;
  }

  public toBigInt(): bigint {
    return this.#value;
  }

  public time(): Date {
    const millis = Number((this.#value >> currentTimeShift()) + BigInt(epochMillisValue));
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
}

export class Generator {
  #step: bigint;
  #lastMillis: number;
  readonly #seed: Buffer;

  public constructor() {
    const seed = calculateNodeSeed();

    this.#seed = seed;
    this.#step = initCounter(seed);
    this.#lastMillis = epochMillis();
  }

  // eslint-disable-next-line class-methods-use-this
  public epoch(): Date {
    return new Date(epochMillisValue);
  }

  public generate(): ID {
    let now = epochMillis();

    const mask = currentStepMask();
    const shift = currentTimeShift();

    if (now < this.#lastMillis) {
      now = this.#lastMillis;
    }

    if (now === this.#lastMillis) {
      this.#step = (this.#step + 1n) & mask;
      if (this.#step === 0n) {
        do {
          now = epochMillis();
        } while (now <= this.#lastMillis);

        this.#step = initCounter(this.#seed);
      }
    } else {
      this.#step = initCounter(this.#seed);
    }

    this.#lastMillis = now;

    return new ID((BigInt(now) << shift) | (this.#step & mask));
  }
}

export function setEpoch(epoch: Date | number | bigint): void {
  let millis: number;

  if (typeof epoch === 'bigint') {
    millis = Number(epoch);
  } else if (epoch instanceof Date) {
    millis = epoch.getTime();
  } else {
    millis = epoch;
  }

  if (!Number.isFinite(millis) || !Number.isInteger(millis)) {
    throw new Error('epoch must be an integer millisecond value');
  }

  epochMillisValue = millis;
}

export function getEpoch(): Date {
  return new Date(epochMillisValue);
}

export function getEpochMillis(): number {
  return epochMillisValue;
}

export function setTimeBits(timeBits: number): void {
  if (!Number.isInteger(timeBits)) {
    throw new Error('timeBits must be an integer');
  }

  timeBitsValue = clampTimeBits(timeBits);
}

export function getTimeBits(): number {
  return timeBitsValue;
}

export function parseInt64(value: bigint | number): ID {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new Error('number input exceeds safe integer range, use bigint instead');
    }

    return new ID(BigInt(value));
  }

  return new ID(value);
}

export function parseString(value: string): ID {
  return parseBase32(value);
}

export function parseBase32(value: string): ID {
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

  return new ID(uint64ToInt64(result));
}

export function parseHex(value: string): ID {
  if (value.length !== HEX_LENGTH) {
    throw new Error(`invalid hex length: ${String(value.length)}`);
  }

  if (!/^[\da-fA-F]+$/u.test(value)) {
    throw new Error('invalid hex input');
  }

  return new ID(uint64ToInt64(BigInt(`0x${value}`)));
}

function epochMillis(): number {
  const millis = Date.now() - epochMillisValue;
  if (millis < 0) {
    return 0;
  }

  return millis;
}

function normalizedTimeBits(): number {
  return clampTimeBits(timeBitsValue);
}

function currentStepBits(): number {
  const bits = TOTAL_BITS - normalizedTimeBits();
  if (bits < 1) {
    return 1;
  }

  return bits;
}

function currentTimeShift(): bigint {
  return BigInt(currentStepBits());
}

function currentStepMask(): bigint {
  return (1n << currentTimeShift()) - 1n;
}

function currentStepSeedMask(): bigint {
  const bits = currentStepBits();
  if (bits <= 1) {
    return 0n;
  }

  return (1n << BigInt(bits - 1)) - 1n;
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

function initCounter(seed: Buffer): bigint {
  const mask = currentStepSeedMask();
  if (mask === 0n) {
    return 0n;
  }

  try {
    const rand = randomBytes(32);
    const sum = createHash('sha256').update(seed).update(rand).digest();
    return bytesToBigInt(sum.subarray(0, 8)) & mask;
  } catch {
    const fallbackTime = BigInt(Date.now()) * 1_000_000n;
    const seedPrefix = bytesToBigInt(seed.subarray(0, 8));
    return (fallbackTime ^ seedPrefix) & mask;
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

function clampTimeBits(value: number): number {
  if (value < MIN_TIME_BITS) {
    return MIN_TIME_BITS;
  }

  if (value > MAX_TIME_BITS) {
    return MAX_TIME_BITS;
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
