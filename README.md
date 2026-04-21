# Crystal (TypeScript)

A minimal unique ID generator for TypeScript.

Crystal generates 63-bit unique identifiers optimized for distributed systems.
It combines a millisecond timestamp and a seeded sequence counter into a single
sortable ID.

> [!NOTE]
> This repository is a TypeScript port of the Go implementation at
> https://github.com/kwo/crystal. The implementation is in progress, and the
> API examples below document the intended TypeScript shape.

## ID Format

The ID is a 63-bit value.

- 1 bit is unused, always `0` so IDs stay positive.
- `timeBits` bits (default `42`, configurable from `40` to `48`) store a
  millisecond timestamp measured from a configurable epoch
  (default `2020-01-01T00:00:00Z`).
- Remaining bits (default `21`) store a sequence number.

```text
+---+------------------------------------------+---------------------+
| 1 |              42-bit timestamp            |   21-bit sequence   |
+---+------------------------------------------+---------------------+
```

Default bit ranges:

- unused sign bit: `bit 63`
- timestamp: `bits 62..21` (42 bits)
- sequence: `bits 20..0` (21 bits)

With defaults, each generator can emit `2,097,152` unique IDs per millisecond.
Changing `timeBits` trades timestamp range for per-millisecond throughput.

## Seed Material

The generator derives seed material from `SHA-256(hostname || PID)` and mixes it
with cryptographic randomness to initialize the sequence value each millisecond.
That helps independent processes diverge naturally even when started at the same
moment.

## Sequence Number

The sequence starts from a random, node-seeded value each millisecond and
increments per generated ID. If the sequence space is exhausted in the same
millisecond, generation pauses until the clock advances.

## Clock Rollback Protection

If the system clock moves backwards, the generator continues from the last known
timestamp and increments sequence values, preserving monotonic ordering.

## ID Representations

IDs are intended to be used either as a string or as an integer value.

- **Base32 string** (default): 13 characters using lowercase Crockford alphabet
  `0123456789abcdefghjkmnpqrstvwxyz`
- **Hex string**: 16 lowercase hexadecimal characters
- **Integer ID**: 63-bit integer returned as `bigint` via `id.toBigInt()`

Because JavaScript `number` cannot safely represent all 63-bit integers,
`bigint` is the canonical integer form.

## Getting Started

### Installing

```sh
npm install @kwo1/crystal
```

### Usage (TypeScript)

```ts
import { Generator } from '@kwo1/crystal';

const gen = new Generator();
const id = gen.generate();

console.log('ID (base32):', id.toString());
console.log('ID (hex):   ', id.toHex());
console.log('ID (int):   ', id.toBigInt());
console.log('ID time:    ', id.time());
```

### Configuration

Defaults (no configuration required):

- **epoch**: `2020-01-01T00:00:00.000Z` (January 1, 2020 UTC)
- **timeBits**: `42` (allowed range when overridden: `40..48`)

```ts
import { Generator } from '@kwo1/crystal';

// Uses default epoch (2020-01-01T00:00:00.000Z) and default timeBits (42)
const gen = new Generator();
const id = gen.generate();
```

Override only when you need a different layout:

```ts
import { Generator, setEpoch, setTimeBits } from '@kwo1/crystal';

setEpoch(new Date('2020-01-01T00:00:00.000Z'));
setTimeBits(42);

const gen = new Generator();
const id = gen.generate();
```

### Parsing

```ts
import { parseBase32, parseHex, parseString } from '@kwo1/crystal';

const a = parseString('0d6av3w2kc002'); // alias of parseBase32
const b = parseBase32('0d6av3w2kc002');
const c = parseHex('00ff11aa22bb33cc');
```

## Time Bits

Assuming milliseconds since `2020-01-01T00:00:00.000Z`:

| Bits |      Max value (ms) | Max UTC date/time         | Range (years, months) |
| ---: | ------------------: | ------------------------- | --------------------- |
|   41 |   2,199,023,255,551 | 2089-09-06T15:47:35.551Z  | 69y 8m                |
|   42 |   4,398,046,511,103 | 2159-05-15T07:35:11.103Z  | 139y 4m               |
|   43 |   8,796,093,022,207 | 2298-09-26T15:10:22.207Z  | 278y 8m               |
|   44 |  17,592,186,044,415 | 2577-06-22T06:20:44.415Z  | 557y 5m               |
|   45 |  35,184,372,088,831 | 3134-12-13T12:41:28.831Z  | 1114y 11m             |
|   46 |  70,368,744,177,663 | 4249-11-24T01:22:57.663Z  | 2229y 10m             |
|   47 | 140,737,488,355,327 | 6479-10-17T02:45:55.327Z  | 4459y 9m              |
|   48 | 281,474,976,710,655 | 10939-08-03T05:31:50.655Z | 8919y 7m              |

## Development

- `npm run lint` - run formatting + code lint/type checks
- `npm run lint:format:fix` - format files with Prettier
- `npm run lint:code:fix` - run ESLint with auto-fix
- `npm run test` - run tests
- `npm run build` - lint, clean, and compile to `dist/`

## License

MIT - see [LICENSE](./LICENSE).
