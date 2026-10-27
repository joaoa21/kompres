/* PNG otimizado a partir de um canvas, compartilhado pelo compressor e pelo redimensionador.
 * A otimização roda em um Web Worker (png-worker.js + png-engine.js), sem upload.
 * quality 1 = sem perdas; targetBytes busca a maior qualidade que cabe no limite. */
kompres.pngFromCanvas = async (canvas, quality = 1, targetBytes = null) => {
  const native = await new Promise((resolve, reject) => canvas.toBlob((blob) => {
    if (blob) resolve(blob);
    else reject(new Error('Não foi possível gerar o PNG.'));
  }, 'image/png'));
  const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  const optimized = await optimizePNG(pixels, quality, targetBytes);
  if (optimized.buffer.byteLength >= native.size) return native;
  return new Blob([optimized.buffer], { type: 'image/png' });
};

function optimizePNG(pixels, quality, targetBytes = null) {
  return new Promise((resolve, reject) => {
    let worker;
    let timer;
    const finish = (error, result) => {
      clearTimeout(timer);
      if (worker) worker.terminate();
      if (error) reject(error); else resolve(result);
    };
    try {
      worker = new Worker('/js/png-worker.js?v=png-target-2');
      timer = setTimeout(() => finish(new Error('O PNG demorou demais para processar.')), 120000);
      worker.onmessage = ({ data }) => data.error ? finish(new Error(data.error)) : finish(null, data);
      worker.onerror = () => finish(new Error('Não foi possível carregar o otimizador PNG.'));
      worker.postMessage({ buffer: pixels.data.buffer, width: pixels.width, height: pixels.height, quality, targetBytes }, [pixels.data.buffer]);
    } catch (error) { finish(error); }
  });
}
