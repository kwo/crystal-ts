# Crystal (TypeScript)

A minimal unique ID generator for TypeScript.

Crystal generates 63-bit unique identifiers optimized for distributed systems.
It combines a millisecond timestamp and a seeded per-millisecond sequence
counter into a single sortable ID.

> [!NOTE]
> This repository is a TypeScript port of the Go implementation at
> https://github.com/kwo/crystal.

## ID Format

The ID is a 63-bit value.

- 1 bit is unused, always `0` so IDs stay positive.
- `timeBits` bits (default `42`, configurable from `40` to `48`) store a
  millisecond timestamp measured from a configurable epoch
  (default `2020-01-01T00:00:00Z`).
- Remaining bits (default `21`) store a seeded sequence number.

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

## Sequence Number

The sequence starts from a node-seeded, cryptographically random value each
millisecond and increments per generated ID. The initial value is limited to the
lower half of the sequence range so generation does not start near the rollover
boundary. If the sequence space is exhausted in the same millisecond,
generation pauses until the clock advances.

## Seed Material

Each generator hashes the hostname and process ID with SHA-256 to create a node
seed. Whenever a sequence counter is initialized, that node seed is mixed with
fresh bytes from Node's cryptographic random source and hashed again. If the
cryptographic random source is unavailable, the generator falls back to mixing
the node seed with the current timestamp.

## Clock Rollback Protection

If the system clock moves backwards, the generator continues from the last
known timestamp and increments sequence values, preserving monotonic ordering.

## ID Representations

IDs can be used as a string or as an integer value.

- **Base32 string** (default): 13 characters using an integer-style lowercase
  Crockford Base32 representation with alphabet
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
import { Crystal } from '@kwo1/crystal';

const crystal = new Crystal();
const id = crystal.newId();

console.log('ID (base32):', id.toString());
console.log('ID (hex):   ', id.toHex());
console.log('ID (int):   ', id.toBigInt());
console.log('ID time:    ', id.time());
```

### Configuration

Defaults (no configuration required):

- **epoch**: `2020-01-01T00:00:00.000Z` (January 1, 2020 UTC)
- **timeBits**: `42` (allowed range when overridden: `40..48`; values outside
  this range throw)

```ts
import { Crystal } from '@kwo1/crystal';

const crystal = new Crystal({
  epoch: new Date('2020-01-01T00:00:00.000Z'),
  timeBits: 42,
});

const id = crystal.newId();
```

### Parsing

```ts
import { ID } from '@kwo1/crystal';

const a = ID.parseBase32('0d6av3w2kc002');
const b = ID.parseHex('00ff11aa22bb33cc');
const c = ID.parseInt64(237755712226918401n);
```

If the ID was generated with a custom epoch or `timeBits`, pass the same
options to the parse method so `id.time()` decodes correctly:

```ts
ID.parseBase32('0d6av3w2kc002', { epoch: customEpoch, timeBits: 40 });
```

## Time Bits

Assuming milliseconds since `2020-01-01T00:00:00.000Z`:

| Bits |      Max value (ms) | Max UTC date/time         | Range (years, months) |
| ---: | ------------------: | ------------------------- | --------------------- |
|   40 |   1,099,511,627,775 | 2054-11-09T07:00,51.775Z  | 34y 10m               |
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
- `npm run example` - run the example program
- `npm run build` - lint, clean, and compile to `dist/`

## Example

See [`examples/basic.ts`](./examples/basic.ts) for a working usage example.

## License

MIT - see [LICENSE](./LICENSE).
