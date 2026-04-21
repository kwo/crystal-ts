import { Generator, parseString } from '../src/index.js';

const generator = new Generator();
const id = generator.generate();

console.log('base32:', id.toString());
console.log('hex:   ', id.toHex());
console.log('int:   ', id.toBigInt());
console.log('time:  ', id.time().toISOString());

const parsed = parseString(id.toString());
console.log('roundtrip equal:', parsed.toBigInt() === id.toBigInt());
