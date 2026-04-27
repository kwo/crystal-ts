import { createHash, randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { pid } from 'node:process';

const TOTAL_BITS = 63;
const BASE32_LENGTH = 13;
const HEX_LENGTH = 16;
const CROCKFORD_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

export const MIN_TIME_BITS = 40;
export const MAX_TIME_BITS = 48;
export const DEFAULT_TIME_BITS = 42;
export const DEFAULT_EPOCH_MILLIS = 1_577_836_800_000; // 2020-01-01T00:00:00.000Z

const MAX_ID = (1n << BigInt(TOTAL_BITS)) - 1n;

const base32DecodeMap = buildBase32DecodeMap();

export type EpochInput = Date | number;

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
    if (value < 0n || value > MAX_ID) {
      throw new Error(`id out of range: ${value.toString()}`);
    }

    this.#value = value;
    this.#epochMillis = epochMillis;
    this.#timeShift = BigInt(TOTAL_BITS - assertTimeBits(timeBits));
  }

  public toBigInt(): bigint {
    return this.#value;
  }

  public time(): Date {
    return new Date(Number((this.#value >> this.#timeShift) + BigInt(this.#epochMillis)));
  }

  public toHex(): string {
    return this.#value.toString(16).padStart(HEX_LENGTH, '0');
  }

  public toString(): string {
    const out = new Array<string>(BASE32_LENGTH);
    let remaining = this.#value;
    for (let index = BASE32_LENGTH - 1; index >= 0; index -= 1) {
      out[index] = CROCKFORD_ALPHABET.charAt(Number(remaining & 31n));
      remaining >>= 5n;
    }
    return out.join('');
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

    const resolved = resolveOptions(options);
    return new ID(result, resolved.epochMillis, resolved.timeBits);
  }

  public static parseHex(value: string, options: CrystalOptions = {}): ID {
    if (value.length !== HEX_LENGTH) {
      throw new Error(`invalid hex length: ${String(value.length)}`);
    }
    if (!/^[\da-fA-F]{16}$/u.test(value)) {
      throw new Error('invalid hex input');
    }

    const resolved = resolveOptions(options);
    return new ID(BigInt(`0x${value}`), resolved.epochMillis, resolved.timeBits);
  }

  public static parseInt64(value: bigint | number, options: CrystalOptions = {}): ID {
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value)) {
        throw new Error('number input exceeds safe integer range, use bigint instead');
      }
      value = BigInt(value);
    }

    const resolved = resolveOptions(options);
    return new ID(value, resolved.epochMillis, resolved.timeBits);
  }
}

export class Crystal {
  readonly #opts: ResolvedOptions;
  readonly #seed: Uint8Array;
  #step: bigint;
  #lastMillis: number;

  public constructor(options: CrystalOptions = {}) {
    this.#opts = resolveOptions(options);
    this.#seed = calculateNodeSeed();
    this.#step = initCounter(this.#seed, this.#opts.stepSeedMask);
    this.#lastMillis = this.epochMillisNow();
  }

  public epoch(): Date {
    return new Date(this.#opts.epochMillis);
  }

  public epochMillis(): number {
    return this.#opts.epochMillis;
  }

  public timeBits(): number {
    return this.#opts.timeBits;
  }

  public newId(): ID {
    let now = this.epochMillisNow();

    if (now < this.#lastMillis) {
      now = this.#lastMillis;
    }

    if (now === this.#lastMillis) {
      this.#step = (this.#step + 1n) & this.#opts.stepMask;
      if (this.#step === 0n) {
        do {
          now = this.epochMillisNow();
        } while (now <= this.#lastMillis);
        this.#step = initCounter(this.#seed, this.#opts.stepSeedMask);
      }
    } else {
      this.#step = initCounter(this.#seed, this.#opts.stepSeedMask);
    }

    this.#lastMillis = now;

    return new ID(
      (BigInt(now) << this.#opts.timeShift) | (this.#step & this.#opts.stepMask),
      this.#opts.epochMillis,
      this.#opts.timeBits,
    );
  }

  private epochMillisNow(): number {
    return Math.max(0, Date.now() - this.#opts.epochMillis);
  }
}

function resolveOptions(options: CrystalOptions): ResolvedOptions {
  const epochMillis = resolveEpochMillis(options.epoch);
  const timeBits = assertTimeBits(options.timeBits ?? DEFAULT_TIME_BITS);
  const stepBits = TOTAL_BITS - timeBits;
  const timeShift = BigInt(stepBits);
  const stepMask = (1n << timeShift) - 1n;
  const stepSeedMask = stepBits <= 1 ? 0n : (1n << BigInt(stepBits - 1)) - 1n;

  return { epochMillis, timeBits, timeShift, stepMask, stepSeedMask };
}

function resolveEpochMillis(epoch: EpochInput | undefined): number {
  if (epoch === undefined) {
    return DEFAULT_EPOCH_MILLIS;
  }

  const value = epoch instanceof Date ? epoch.getTime() : epoch;
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error('epoch must be an integer millisecond value');
  }

  return value;
}

function calculateNodeSeed(): Uint8Array {
  let machine: string;

  try {
    machine = hostname();
  } catch {
    machine = 'unknown';
  }

  if (machine.length === 0) {
    machine = 'unknown';
  }

  return createHash('sha256').update(machine).update(String(pid)).digest();
}

function initCounter(seed: Uint8Array, mask: bigint): bigint {
  if (mask === 0n) {
    return 0n;
  }

  try {
    const randomBuffer = randomBytes(32);
    const sum = createHash('sha256').update(seed).update(randomBuffer).digest();
    return readUint64BE(sum) & mask;
  } catch {
    return ((BigInt(Date.now()) * 1_000_000n) ^ readUint64BE(seed)) & mask;
  }
}

function readUint64BE(bytes: Uint8Array, offset = 0): bigint {
  let value = 0n;

  for (let index = offset; index < offset + 8; index += 1) {
    const byte = bytes[index];
    if (byte === undefined) {
      throw new Error('not enough bytes to read uint64');
    }
    value = (value << 8n) | BigInt(byte);
  }

  return value;
}

function assertTimeBits(value: number): number {
  if (!Number.isInteger(value)) {
    throw new Error('timeBits must be an integer');
  }
  if (value < MIN_TIME_BITS || value > MAX_TIME_BITS) {
    throw new Error(
      `timeBits out of range (${String(MIN_TIME_BITS)}..${String(MAX_TIME_BITS)}): ${String(value)}`,
    );
  }
  return value;
}

function buildBase32DecodeMap(): Map<string, bigint> {
  const map = new Map<string, bigint>();
  for (let i = 0; i < CROCKFORD_ALPHABET.length; i += 1) {
    map.set(CROCKFORD_ALPHABET.charAt(i), BigInt(i));
  }
  return map;
}
