// UPNG's browser bundle uses window; in this worker the alias is local.
self.window = self;
importScripts('./vendor/pako.min.js', './vendor/UPNG.js', './png-engine.js?v=png-target-2');
self.onmessage = ({ data }) => {
  try {
    const pixels = new Uint8Array(data.buffer);
    const result = data.targetBytes != null
      ? KompresPNG.encodeTarget(pixels, data.width, data.height, data.targetBytes)
      : KompresPNG.encode(pixels, data.width, data.height, data.quality);
    self.postMessage(result, [result.buffer]);
  } catch (error) {
    self.postMessage({ error: error.message || 'Falha ao otimizar PNG.' });
  }
};
