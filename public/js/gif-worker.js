/* Codificador de GIF (Criar GIF, /criar-gif/), com gifenc (MIT).
 * Roda como Web Worker do tipo module, para a página não travar enquanto os quadros
 * são codificados. Se o navegador não aceitar worker module, gif-maker.js importa este
 * mesmo arquivo na página e chama `handle` diretamente.
 * Protocolo (uma mensagem por vez, cada uma com uma resposta):
 *   start  { samples, colors, repeat } → paleta global calculada de amostras de todos os quadros
 *   frame  { pixels, width, height, delay } → quadro RGBA mapeado na paleta e gravado
 *   finish {} → { bytes } com o arquivo GIF */
const GIFENC = 'https://cdn.jsdelivr.net/npm/gifenc@1.0.3/dist/gifenc.esm.js';

let lib = null;
let job = null; // { encoder, palette, repeat, depth, first }

export async function handle(message) {
  if (message.type === 'start') {
    lib ||= await import(GIFENC);
    // Paleta única para todos os quadros: com uma paleta por quadro as cores
    // "pulam" de um quadro para o outro e a animação cintila.
    const palette = lib.quantize(message.samples, message.colors);
    job = {
      encoder: lib.GIFEncoder(),
      palette,
      repeat: message.repeat,
      depth: Math.max(2, Math.ceil(Math.log2(message.colors))),
      first: true,
    };
    return { reply: { type: 'ok' } };
  }
  if (!job) throw new Error('Codificador não iniciado.');
  if (message.type === 'frame') {
    const index = lib.applyPalette(message.pixels, job.palette);
    // A paleta vai só no primeiro quadro (tabela global); os demais a reaproveitam.
    job.encoder.writeFrame(index, message.width, message.height, {
      palette: job.first ? job.palette : null,
      delay: message.delay,
      repeat: job.repeat,
      colorDepth: job.depth,
    });
    job.first = false;
    return { reply: { type: 'ok' } };
  }
  if (message.type === 'finish') {
    job.encoder.finish();
    const bytes = job.encoder.bytes();
    job = null;
    return { reply: { type: 'done', bytes }, transfer: [bytes.buffer] };
  }
  throw new Error(`Mensagem desconhecida: ${message.type}`);
}

// Só registra o ouvinte quando roda como worker (no fallback ele é importado pela página).
if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = async ({ data }) => {
    try {
      const { reply, transfer = [] } = await handle(data);
      self.postMessage(reply, transfer);
    } catch (err) {
      job = null;
      self.postMessage({ type: 'error', message: String(err?.message || err) });
    }
  };
}
