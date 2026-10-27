/* Melhorar imagem: super-resolução 2× com o Swin2SR, fora da thread da interface.
 * A página manda os pixels (RGBA) e recebe de volta um bloco pronto por vez, que ela
 * mesma encaixa no resultado (e onde recoloca a transparência). Nenhuma imagem é enviada:
 * só o modelo é baixado do Hugging Face, uma vez, e fica no cache do navegador. */
const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/dist/transformers.min.js';
const MODEL = 'Xenova/swin2SR-lightweight-x2-64';
const REVISION = '92a21aca5713f20faf9a87590cdfbdce2e34112c';
// Blocos de 192 px: miolo de 160 px + 16 px de contexto de cada lado. A borda de um bloco
// não tem vizinhos e sai pior, então só o miolo é aproveitado. 192 é múltiplo de 8 (a
// janela de atenção do modelo) e todos os blocos têm o mesmo tamanho, o que evita
// recompilar os shaders do WebGPU a cada bloco.
const CORE = 160, PAD = 16, TILE = CORE + PAD * 2, SCALE = 2;
let lib, model, device;
const post = (message, transfer = []) => self.postMessage(message, transfer);

async function loadModel(force) {
  post({ type: 'progress', phase: 'load' });
  lib ||= await import(LIB);
  lib.env.allowLocalModels = false;
  // Várias threads no WASM só existem com isolamento de origem; sem ele, uma só.
  lib.env.backends.onnx.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
  let error, gpuReady = false;
  if (!force && navigator.gpu) {
    try { gpuReady = !!await navigator.gpu.requestAdapter(); } catch {}
  }
  // fp32 nos dois casos. O model_fp16.onnx desta revisão falha no ONNX Runtime ("Shape
  // mismatch attempting to re-use buffer" no Slice final) e os quantizados perdem detalhe,
  // que é justamente o que a ferramenta entrega. Com um arquivo só, cair do WebGPU para o
  // WASM também não baixa nada de novo, e o WebGPU não depende de shader-f16.
  for (const candidate of force ? [force] : gpuReady ? ['webgpu', 'wasm'] : ['wasm']) {
    try {
      model = await lib.AutoModelForImageToImage.from_pretrained(MODEL, {
        revision: REVISION, device: candidate, dtype: 'fp32',
        progress_callback: event => {
          if (event.status === 'progress' && event.total && /\.onnx$/.test(event.file || '')) {
            post({ type: 'progress', phase: 'download', percent: Math.round(event.loaded / event.total * 100) });
          }
        },
      });
      device = candidate; return;
    } catch (err) { error = err; model = null; }
  }
  throw error;
}

// Divide um eixo em blocos. Imagem menor que um bloco: um bloco só, arredondado para
// múltiplo de 8 (o que passar da borda é espelhado).
function spans(length) {
  if (length <= TILE) return [{ start: 0, size: Math.ceil(length / 8) * 8, core0: 0, core1: length }];
  const list = [];
  for (let core = 0; core < length; core += CORE) {
    const start = Math.min(Math.max(core - PAD, 0), length - TILE);
    list.push({ start, size: TILE, core0: core, core1: Math.min(core + CORE, length) });
  }
  return list;
}
const reflect = (i, length) => Math.max(0, i < length ? i : 2 * length - 2 - i);

async function runTile(rgba, width, height, xs, ys) {
  // Entrada: [1, 3, h, w] em 0–1. A média RGB do Swin2SR já está dentro do modelo.
  const w = xs.size, h = ys.size, plane = w * h, input = new Float32Array(plane * 3);
  for (let y = 0; y < h; y++) {
    const row = reflect(ys.start + y, height) * width;
    for (let x = 0; x < w; x++) {
      const p = (row + reflect(xs.start + x, width)) * 4, o = y * w + x;
      input[o] = rgba[p] / 255; input[o + plane] = rgba[p + 1] / 255; input[o + plane * 2] = rgba[p + 2] / 255;
    }
  }
  const tensor = new lib.Tensor('float32', input, [1, 3, h, w]);
  let output;
  try {
    output = await model({ pixel_values: tensor });
    let result = output.reconstruction;
    if (result.type !== 'float32') result = result.to('float32');
    const outWidth = result.dims[3], outPlane = result.dims[2] * outWidth, data = result.data;
    // Recorta só o miolo do bloco, já na escala 2×.
    const ox = (xs.core0 - xs.start) * SCALE, oy = (ys.core0 - ys.start) * SCALE;
    const tw = (xs.core1 - xs.core0) * SCALE, th = (ys.core1 - ys.core0) * SCALE;
    const pixels = new Uint8ClampedArray(tw * th * 4);
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        const s = (oy + y) * outWidth + ox + x, p = (y * tw + x) * 4;
        const r = data[s], g = data[s + outPlane], b = data[s + outPlane * 2];
        // Falha numérica na placa de vídeo viraria preto sem aviso: melhor refazer no WASM.
        if (Number.isNaN(r + g + b)) throw new Error('Resultado inválido no bloco.');
        pixels[p] = r * 255; pixels[p + 1] = g * 255; pixels[p + 2] = b * 255; pixels[p + 3] = 255;
      }
    }
    return { pixels, width: tw, height: th };
  } finally {
    tensor.dispose?.();
    if (output) Object.values(output).forEach(t => t?.dispose?.());
  }
}

// Pixels totalmente transparentes chegam com RGB preto (o canvas guarda cor pré-multiplicada).
// A IA olharia esse preto e escureceria as bordas do objeto: antes, cada pixel transparente
// vizinho de um visível recebe a média das cores ao redor, algumas camadas para fora.
function bleed(rgba, width, height, passes = 8) {
  const n = width * height, known = new Uint8Array(n);
  let missing = 0;
  for (let i = 0; i < n; i++) { if (rgba[i * 4 + 3] > 0) known[i] = 1; else missing++; }
  if (!missing || missing === n) return;
  const next = new Uint8Array(n);
  for (let pass = 0; pass < passes; pass++) {
    next.set(known);
    let changed = false;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (known[i]) continue;
        let r = 0, g = 0, b = 0, count = 0;
        const add = (j) => { if (known[j]) { r += rgba[j * 4]; g += rgba[j * 4 + 1]; b += rgba[j * 4 + 2]; count++; } };
        if (x > 0) add(i - 1);
        if (x < width - 1) add(i + 1);
        if (y > 0) add(i - width);
        if (y < height - 1) add(i + width);
        if (!count) continue;
        rgba[i * 4] = r / count; rgba[i * 4 + 1] = g / count; rgba[i * 4 + 2] = b / count;
        next[i] = 1; changed = true;
      }
    }
    known.set(next);
    if (!changed) break;
  }
}

async function upscale({ pixels, width, height }) {
  if (!model) await loadModel();
  const rgba = new Uint8ClampedArray(pixels);
  bleed(rgba, width, height);
  const xs = spans(width), ys = spans(height), total = xs.length * ys.length;
  post({ type: 'start', device, total });
  let done = 0;
  for (const y of ys) {
    for (const x of xs) {
      let tile;
      try { tile = await runTile(rgba, width, height, x, y); }
      catch (err) {
        if (device !== 'webgpu') throw err;
        // A placa de vídeo falhou (memória, driver, fp16): continua no processador a
        // partir deste bloco, sem perder os que já ficaram prontos.
        console.warn('WebGPU falhou; usando WASM.', err);
        try { await model.dispose?.(); } catch {}
        model = null; await loadModel('wasm');
        post({ type: 'device', device });
        tile = await runTile(rgba, width, height, x, y);
      }
      done++;
      post({ type: 'tile', x: x.core0 * SCALE, y: y.core0 * SCALE, width: tile.width, height: tile.height, pixels: tile.pixels.buffer, done, total }, [tile.pixels.buffer]);
    }
  }
  post({ type: 'done', device });
}

let working = false;
self.onmessage = async ({ data }) => {
  if (working || data?.type !== 'upscale') return;
  working = true;
  const loading = !model;
  try { await upscale(data); }
  catch (err) {
    console.error(err);
    post({ type: 'error', message: loading && !model
      ? 'Não foi possível carregar o modelo de IA. Verifique a conexão e tente novamente.'
      : 'Não foi possível melhorar a imagem. Tente novamente ou use uma imagem menor.' });
  } finally { working = false; }
};
