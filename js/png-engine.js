/* Kompres PNG: deterministic, non-dithered candidates with a visual-error gate.
 * Runs inside png-worker.js. UPNG 2.1.0 and pako 2.1.0 are vendored with licenses.
 * Quality is an application preference, not a measured percentage of fidelity.
 */
(function (scope) {
  function precisionCandidate(src, step) {
    const out = new Uint8Array(src);
    for (let i = 0; i < out.length; i += 4) {
      // Alpha is never quantized. Invisible RGB can be normalized safely.
      for (let c = 0; c < 3; c++) {
        out[i + c] = src[i + 3] === 0 ? 0 : Math.min(255, Math.round(src[i + c] / step) * step);
      }
    }
    return out;
  }
  function measure(src, out) {
    let error = 0, weight = 0, peak = 0;
    for (let i = 0; i < src.length; i += 4) {
      if (src[i + 3] !== out[i + 3]) return { rms: Infinity, peak: Infinity };
      const alpha = src[i + 3] / 255;
      if (!alpha) continue;
      for (let c = 0; c < 3; c++) {
        const delta = Math.abs(src[i + c] - out[i + c]) * alpha;
        peak = Math.max(peak, delta);
        error += delta * delta;
        weight++;
      }
    }
    return { rms: weight ? Math.sqrt(error / weight) : 0, peak };
  }
  function passes(metrics, quality) {
    return metrics.rms <= 1.5 + (1 - quality) * 8 && metrics.peak <= 5 + (1 - quality) * 30;
  }
  function acceptable(src, out, quality) {
    return passes(measure(src, out), quality);
  }
  function createEncoder(src, width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || src.length !== width * height * 4) throw new Error('Dimensões inválidas.');
    const pack = (pixels, colors = 0) => UPNG.encode([pixels.buffer.slice(pixels.byteOffset, pixels.byteOffset + pixels.byteLength)], width, height, colors);
    const lossless = { buffer: pack(src), method: 'lossless' };
    const precision = new Map();
    let palette;
    return (quality) => {
      quality = Math.min(1, Math.max(.3, Number(quality) || .82));
      let best = lossless;
      if (quality < 1) {
        const step = Math.max(2, Math.round(2 + (1 - quality) * 12));
        if (!precision.has(step)) {
          const pixels = precisionCandidate(src, step);
          precision.set(step, { buffer: pack(pixels), method: 'precision', metrics: measure(src, pixels) });
        }
        const candidate = precision.get(step);
        if (passes(candidate.metrics, quality) && candidate.buffer.byteLength < best.buffer.byteLength) best = candidate;
        if (width * height <= 4000000) {
          if (!palette) {
            const buffer = pack(src, 256);
            const decoded = new Uint8Array(UPNG.toRGBA8(UPNG.decode(buffer))[0]);
            palette = { buffer, method: 'palette', metrics: measure(src, decoded) };
          }
          if (passes(palette.metrics, quality) && palette.buffer.byteLength < best.buffer.byteLength) best = palette;
        }
      }
      return { buffer: best.buffer, method: best.method, quality };
    };
  }
  function encode(src, width, height, quality) {
    return createEncoder(src, width, height)(quality);
  }
  function searchTarget(attempt, targetBytes) {
    if (!Number.isFinite(targetBytes) || targetBytes <= 0) throw new Error('Limite inválido.');
    let smallest;
    // PNG size is not monotonic: inspect every UI quality, highest first.
    // createEncoder caches repeated precision levels and the palette so this
    // does not re-encode the image 71 times or launch 71 workers.
    for (let percent = 100; percent >= 30; percent--) {
      const result = attempt(percent / 100);
      if (!smallest || result.buffer.byteLength < smallest.buffer.byteLength) smallest = result;
      if (result.buffer.byteLength <= targetBytes) return { ...result, fits: true };
    }
    return { ...smallest, fits: false };
  }
  function encodeTarget(src, width, height, targetBytes) {
    return searchTarget(createEncoder(src, width, height), targetBytes);
  }
  scope.KompresPNG = { encode, encodeTarget, searchTarget, acceptable, precisionCandidate };
})(globalThis);
