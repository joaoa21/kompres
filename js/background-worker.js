/* Inference and edge refinement run off the UI thread. No image upload. */
const MODEL = 'studioludens/birefnet-lite-512';
const REVISION = '4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7';
let lib, model, processor, device;
const status = message => self.postMessage({ type: 'progress', message });
async function loadModel(force) {
  status('Preparando a remoção de fundo… Na primeira vez, o carregamento pode demorar.');
  lib ||= await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js');
  lib.env.allowLocalModels = false;
  lib.env.backends.onnx.wasm.numThreads = 1;
  let error, gpuReady = false;
  if (!force && navigator.gpu) {
    try { const adapter = await navigator.gpu.requestAdapter(); gpuReady = !!adapter?.features.has('shader-f16'); } catch {}
  }
  for (const candidate of force ? [force] : gpuReady ? ['webgpu', 'wasm'] : ['wasm']) {
    try {
      processor ||= await lib.AutoProcessor.from_pretrained(MODEL, { revision: REVISION });
      model = await lib.AutoModel.from_pretrained(MODEL, {
        revision: REVISION, device: candidate, dtype: candidate === 'webgpu' ? 'fp16' : 'fp32',
        progress_callback: event => { if (event.status === 'progress' && event.total) status(`Preparando a remoção de fundo… ${Math.round(event.loaded / event.total * 100)}%`); }
      });
      device = candidate; return;
    } catch (err) { error = err; model = null; }
  }
  throw error;
}
function floatValue(data, index, type) {
  if (type !== 'float16' || !(data instanceof Uint16Array)) return Number(data[index]);
  const h = data[index], sign = h & 0x8000 ? -1 : 1, exp = h >> 10 & 31, frac = h & 1023;
  return exp === 0 ? sign * 2 ** -14 * frac / 1024 : exp === 31 ? frac ? NaN : sign * Infinity : sign * 2 ** (exp - 15) * (1 + frac / 1024);
}
async function predict(image) {
  const input = await processor(image); let output;
  try {
    output = await model({ input_image: input.pixel_values });
    const tensor = output.logits || Object.values(output)[0];
    const [height, width] = tensor.dims.slice(-2);
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const v = floatValue(tensor.data, i, tensor.type);
      if (Number.isNaN(v)) throw new Error('Máscara inválida.');
      const a = Math.round(255 / (1 + Math.exp(-v)));
      pixels.set([a, a, a, 255], i * 4);
    }
    return { width, height, pixels };
  } finally {
    input.pixel_values?.dispose?.();
    if (output) Object.values(output).forEach(t => t?.dispose?.());
  }
}
async function remove(file) {
  if (!model) await loadModel();
  status('Removendo fundo…');
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const w = bitmap.width, h = bitmap.height;
  if (w * h > 12000000 || Math.max(w, h) > 8192) { bitmap.close(); throw new Error('Use uma imagem de até 12 megapixels e 8192 px por lado.'); }
  const original = new OffscreenCanvas(w, h), ctx = original.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0); bitmap.close();
  // Composite transparent inputs on white for inference only.
  const inference = new OffscreenCanvas(w, h), ic = inference.getContext('2d');
  ic.fillStyle = '#fff'; ic.fillRect(0, 0, w, h); ic.drawImage(original, 0, 0);
  const rgba = ic.getImageData(0, 0, w, h);
  const raw = new lib.RawImage(rgba.data, w, h, 4);
  let mask;
  try { mask = await predict(raw); }
  catch (err) {
    if (device !== 'webgpu') throw err;
    await model.dispose?.(); model = null; await loadModel('wasm'); mask = await predict(raw);
  }
  status('Refinando as bordas…');
  const small = new OffscreenCanvas(mask.width, mask.height);
  small.getContext('2d').putImageData(new ImageData(mask.pixels, mask.width, mask.height), 0, 0);
  // Bound refinement memory independently of original image dimensions.
  const scale = Math.min(1, Math.sqrt(2000000 / (w * h)));
  const rw = Math.max(1, Math.round(w * scale)), rh = Math.max(1, Math.round(h * scale));
  const refined = new OffscreenCanvas(rw, rh), rc = refined.getContext('2d', { willReadFrequently: true });
  rc.drawImage(small, 0, 0, rw, rh);
  const maskData = rc.getImageData(0, 0, rw, rh);
  rc.drawImage(inference, 0, 0, rw, rh);
  const source = rc.getImageData(0, 0, rw, rh).data;
  const n = rw * rh, guide = new Float32Array(n), alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) { guide[i] = (source[i*4]*.299 + source[i*4+1]*.587 + source[i*4+2]*.114)/255; alpha[i] = maskData.data[i*4]/255; }
  const result = guidedFilter(guide, alpha, rw, rh, Math.max(2, Math.min(8, Math.round(Math.max(rw,rh)/512*1.8))), .001);
  for (let i = 0; i < n; i++) { maskData.data[i*4] = maskData.data[i*4+1] = maskData.data[i*4+2] = 255; maskData.data[i*4+3] = Math.round(result[i]*255); }
  rc.clearRect(0, 0, rw, rh); rc.putImageData(maskData, 0, 0);
  const full = new OffscreenCanvas(w, h); full.getContext('2d').drawImage(refined, 0, 0, w, h);
  ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(full, 0, 0);
  const blob = await original.convertToBlob({ type: 'image/png' });
  const maskBlob = await full.convertToBlob({ type: 'image/png' });
  return { blob, maskBlob, width: w, height: h };
}
let working = false;
self.onmessage = async event => {
  if (working || event.data.type !== 'remove') return;
  working = true;
  try { self.postMessage({ type: 'done', ...await remove(event.data.file) }); }
  catch (err) { console.error(err); self.postMessage({ type: 'error', message: 'Não foi possível remover o fundo. Tente novamente ou use uma imagem menor.' }); }
  finally { working = false; }
};

    function guidedFilter(I, p, w, h, r, eps) {
      const n = w * h;
      const meanI = new Float32Array(n);
      const meanP = new Float32Array(n);
      const bufA = new Float32Array(n);
      const bufB = new Float32Array(n);
      const tmp = new Float32Array(n);

      for (let i = 0; i < n; i++) {
        bufA[i] = I[i] * p[i];
        bufB[i] = I[i] * I[i];
      }
      boxMean(I, meanI, tmp, w, h, r);
      boxMean(p, meanP, tmp, w, h, r);
      boxMean(bufA, bufA, tmp, w, h, r);
      boxMean(bufB, bufB, tmp, w, h, r);

      for (let i = 0; i < n; i++) {
        const a = (bufA[i] - meanI[i] * meanP[i]) / (bufB[i] - meanI[i] * meanI[i] + eps);
        bufA[i] = a;
        bufB[i] = meanP[i] - a * meanI[i];
      }
      boxMean(bufA, bufA, tmp, w, h, r);
      boxMean(bufB, bufB, tmp, w, h, r);

      const q = meanP; // reaproveita memória
      for (let i = 0; i < n; i++) {
        const v = bufA[i] * I[i] + bufB[i];
        q[i] = v < 0 ? 0 : v > 1 ? 1 : v;
      }
      return q;
    }

    function boxMean(src, dst, tmp, w, h, r) {
      for (let y = 0; y < h; y++) {
        const row = y * w;
        let sum = 0;
        for (let x = 0; x <= Math.min(r, w - 1); x++) sum += src[row + x];
        for (let x = 0; x < w; x++) {
          const lo = x - r < 0 ? 0 : x - r;
          const hi = x + r > w - 1 ? w - 1 : x + r;
          tmp[row + x] = sum / (hi - lo + 1);
          if (x + r + 1 < w) sum += src[row + x + r + 1];
          if (x - r >= 0) sum -= src[row + x - r];
        }
      }

      const colSum = new Float64Array(w);
      for (let y = 0; y <= Math.min(r, h - 1); y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) colSum[x] += tmp[row + x];
      }
      for (let y = 0; y < h; y++) {
        const lo = y - r < 0 ? 0 : y - r;
        const hi = y + r > h - 1 ? h - 1 : y + r;
        const count = hi - lo + 1;
        const row = y * w;
        for (let x = 0; x < w; x++) dst[row + x] = colSum[x] / count;
        const add = y + r + 1;
        const rem = y - r;
        if (add < h) { const ra = add * w; for (let x = 0; x < w; x++) colSum[x] += tmp[ra + x]; }
        if (rem >= 0) { const rr = rem * w; for (let x = 0; x < w; x++) colSum[x] -= tmp[rr + x]; }
      }
    }

