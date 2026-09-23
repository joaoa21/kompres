// From kompres/: node tests/regression.cjs
// Optional dev dependency: npm install --no-save sharp
const fs = require('fs');
const vm = require('vm');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const engine = { console, Uint8Array, Uint32Array, Uint16Array, Uint8ClampedArray, Int32Array, Float32Array, Float64Array, ArrayBuffer, DataView, Math, Number, Map, Set };
engine.window = engine; engine.globalThis = engine;
vm.createContext(engine);
for (const file of ['vendor/pako.min.js', 'vendor/UPNG.js', 'png-engine.js']) {
  vm.runInContext(fs.readFileSync('js/' + file, 'utf8'), engine);
}
(async () => {
  const width = 256, height = 128;
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    pixels.set([x, y * 2, Math.round((x + y) / 2), x < 128 ? 128 : 255], (y * width + x) * 4);
  }
  for (const quality of [.3, .82, 1]) {
    const result = engine.KompresPNG.encode(pixels, width, height, quality);
    const { data, info } = await sharp(Buffer.from(result.buffer)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, width); assert.equal(info.height, height);
    for (let i = 3; i < data.length; i += 4) assert.equal(data[i], pixels[i]);
    assert.ok(engine.KompresPNG.acceptable(pixels, data, quality));
    if (quality === 1) assert.ok(data.equals(Buffer.from(pixels)));
  }
  const calls = [];
  const found = engine.KompresPNG.searchTarget(q => {
    const percent = Math.round(q * 100); calls.push(percent);
    const size = percent === 65 ? 500 : percent === 60 ? 400 : 2000;
    return { buffer: new ArrayBuffer(size), quality: q };
  }, 550);
  assert.equal(found.quality, .65); assert.equal(found.fits, true);
  assert.deepEqual(calls, Array.from({length:36}, (_, i)=>100-i));
  let attempts = 0;
  const impossible = engine.KompresPNG.searchTarget(q => {
    attempts++; return {buffer:new ArrayBuffer(Math.round(q * 1000)),quality:q};
  }, 100);
  assert.equal(impossible.fits, false); assert.equal(attempts, 71);
  assert.equal(impossible.buffer.byteLength, 300);
  const at60 = engine.KompresPNG.encode(pixels, width, height, .6);
  const target = engine.KompresPNG.encodeTarget(pixels, width, height, at60.buffer.byteLength);
  assert.equal(target.fits, true); assert.ok(target.buffer.byteLength <= at60.buffer.byteLength);
  assert.ok(target.quality >= .6);
  assert.throws(() => engine.KompresPNG.encode(new Uint8Array(4), 200, 200, .82));
  console.log('PASS: PNG encode/decode, dimensions, alpha, quality gate and 100% lossless.');
})().catch(error => { console.error(error); process.exitCode = 1; });
