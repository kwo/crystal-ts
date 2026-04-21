import { Generator, ID } from '../src/index.js';

const generator = new Generator({
  epoch: new Date('2020-01-01T00:00:00.000Z'), // default epoch
  timeBits: 42, // default timeBits
});
const id = generator.generate();

console.log('base32:', id.toString());
console.log('hex:   ', id.toHex());
console.log('int:   ', id.toBigInt());
console.log('time:  ', id.time().toISOString());

const parsed = ID.parseString(id.toString());
console.log('roundtrip equal:', parsed.toBigInt() === id.toBigInt());
