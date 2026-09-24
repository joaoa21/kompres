/* PDF operations shared by the new tools. File bytes stay in the browser. */
(function (scope) {
  function parsePages(value, count) {
    const text = String(value).trim();
    if (!Number.isInteger(count) || count < 1) throw new Error('Não foi possível contar as páginas.');
    if (!text || /^todas$/i.test(text)) return Array.from({ length: count }, (_, i) => i);
    const result = [], seen = new Set();
    for (const token of text.split(',')) {
      const match = token.trim().match(/^(\d+)\s*(?:[-–]\s*(\d+))?$/);
      if (!match) throw new Error('Informe páginas como 1-3, 7 ou deixe o campo vazio para todas.');
      const first = Number(match[1]), last = Number(match[2] || match[1]);
      if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first || last > count) {
        throw new Error(`Use páginas de 1 a ${count}, com intervalos em ordem crescente.`);
      }
      for (let page = first; page <= last; page++) if (!seen.has(page)) { seen.add(page); result.push(page - 1); }
    }
    return result;
  }
  function safeBase(name) {
    return String(name).replace(/\.[^.]+$/, '').replace(/[\\/\x00-\x1f<>:"|?*]/g, '_').slice(0, 140) || 'documento';
  }
  async function loadPdf(data) {
    if (!scope.pdfjsLib) throw new Error('Não foi possível carregar o leitor de PDF. Recarregue a página.');
    const task = scope.pdfjsLib.getDocument({ data: data.slice(0), isEvalSupported: false });
    try { return await task.promise; }
    catch (error) { await task.destroy(); throw error; }
  }
  function toBlob(canvas, mime = 'image/png', quality = 1) {
    return new Promise((resolve, reject) => canvas.toBlob(blob => {
      if (blob && blob.type === mime) resolve(blob);
      else reject(new Error('Não foi possível gerar a imagem. Tente uma resolução menor.'));
    }, mime, quality));
  }
  async function imageInfo(file) {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    try {
      if (bitmap.width * bitmap.height > 40000000) throw new Error('Imagem muito grande. Reduza suas dimensões antes de adicionar.');
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 168 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return { width: bitmap.width, height: bitmap.height, thumbUrl: canvas.toDataURL('image/png') };
    } finally { bitmap.close(); }
  }
  async function imagesToPdf(items, options, progress = () => {}) {
    const doc = await PDFLib.PDFDocument.create();
    const margin = Number(options.marginMM) * 72 / 25.4;
    if (!Number.isFinite(margin) || margin < 0 || margin > 40 * 72 / 25.4) throw new Error('Margem inválida.');
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const bitmap = await createImageBitmap(item.file, { imageOrientation: 'from-image' });
      const canvas = document.createElement('canvas');
      try {
        canvas.width = bitmap.width; canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        // Normalize EXIF orientation. PNG keeps alpha; JPEG uses high quality.
        const jpeg = item.file.type === 'image/jpeg' || /\.jpe?g$/i.test(item.file.name);
        const blob = await toBlob(canvas, jpeg ? 'image/jpeg' : 'image/png', .98);
        const bytes = await blob.arrayBuffer();
        const embedded = jpeg ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
        let size;
        if (options.pageSize === 'image') size = [bitmap.width * .75 + margin * 2, bitmap.height * .75 + margin * 2];
        else if (options.pageSize === 'a4-landscape') size = [841.89, 595.28];
        else size = [595.28, 841.89];
        if (Math.max(...size) > 14400) throw new Error('A imagem é grande demais para esse tamanho de página. Escolha A4.');
        const [width, height] = size;
        const scale = Math.min((width - margin * 2) / embedded.width, (height - margin * 2) / embedded.height);
        const drawWidth = embedded.width * scale, drawHeight = embedded.height * scale;
        const page = doc.addPage(size);
        page.drawImage(embedded, { x: (width - drawWidth) / 2, y: (height - drawHeight) / 2, width: drawWidth, height: drawHeight });
      } finally { bitmap.close(); canvas.width = 0; canvas.height = 0; }
      progress(index + 1, items.length);
    }
    return new Blob([await doc.save()], { type: 'application/pdf' });
  }
  async function extract(item, indices, split, progress = () => {}) {
    const source = await PDFLib.PDFDocument.load(item.data, { ignoreEncryption: false });
    const files = [];
    const groups = split ? indices.map(index => [index]) : [indices];
    for (let i = 0; i < groups.length; i++) {
      const output = await PDFLib.PDFDocument.create();
      const copied = await output.copyPages(source, groups[i]);
      copied.forEach(page => output.addPage(page));
      const bytes = await output.save();
      files.push({ name: `${safeBase(item.name)}-${split ? 'pagina-' + String(groups[i][0] + 1).padStart(3, '0') : 'paginas'}-kompres.pdf`, blob: new Blob([bytes], { type: 'application/pdf' }) });
      progress(i + 1, groups.length);
    }
    return files;
  }
  async function exportImages(item, indices, options, progress = () => {}) {
    const doc = await loadPdf(item.data);
    const files = [];
    try {
      for (let i = 0; i < indices.length; i++) {
        const page = await doc.getPage(indices[i] + 1);
        const viewport = page.getViewport({ scale: options.dpi / 72 });
        if (viewport.width * viewport.height > 24000000 || Math.max(viewport.width, viewport.height) > 8192) {
          throw new Error('Página muito grande. Escolha uma resolução menor.');
        }
        const canvas = document.createElement('canvas');
        try {
          canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
          const ctx = canvas.getContext('2d');
          await page.render({ canvasContext: ctx, viewport, background: '#ffffff' }).promise;
          const mime = options.format === 'png' ? 'image/png' : 'image/jpeg';
          const blob = await toBlob(canvas, mime, options.quality);
          files.push({ name: `${safeBase(item.name)}-pagina-${String(indices[i] + 1).padStart(3, '0')}.${options.format === 'png' ? 'png' : 'jpg'}`, blob });
        } finally { canvas.width = 0; canvas.height = 0; page.cleanup(); }
        progress(i + 1, indices.length);
      }
    } finally { await doc.destroy(); }
    return files;
  }
  scope.KompresPDF = { parsePages, safeBase, loadPdf, imageInfo, imagesToPdf, extract, exportImages };
})(window);
