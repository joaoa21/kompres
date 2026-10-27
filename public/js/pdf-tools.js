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
          await page.render({ canvasContext: ctx, viewport, background: '#ffffff', intent: 'print' }).promise;
          const mime = options.format === 'png' ? 'image/png' : 'image/jpeg';
          const blob = await toBlob(canvas, mime, options.quality);
          files.push({ name: `${safeBase(item.name)}-pagina-${String(indices[i] + 1).padStart(3, '0')}.${options.format === 'png' ? 'png' : 'jpg'}`, blob });
        } finally { canvas.width = 0; canvas.height = 0; page.cleanup(); }
        progress(i + 1, indices.length);
      }
    } finally { await doc.destroy(); }
    return files;
  }
  async function rotate(item, indices, angle) {
    const doc = await PDFLib.PDFDocument.load(item.data, { ignoreEncryption: false });
    const pages = doc.getPages();
    for (const index of indices) {
      const page = pages[index];
      page.setRotation(PDFLib.degrees((page.getRotation().angle + angle) % 360));
    }
    const bytes = await doc.save({ useObjectStreams: true });
    return [{ name: `${safeBase(item.name)}-girado-kompres.pdf`, blob: new Blob([bytes], { type: 'application/pdf' }) }];
  }
  async function removePages(item, indices) {
    const source = await PDFLib.PDFDocument.load(item.data, { ignoreEncryption: false });
    const remove = new Set(indices);
    const keep = source.getPageIndices().filter(index => !remove.has(index));
    if (!keep.length) throw new Error('O PDF ficaria sem páginas. Deixe pelo menos uma.');
    const output = await PDFLib.PDFDocument.create();
    (await output.copyPages(source, keep)).forEach(page => output.addPage(page));
    const bytes = await output.save({ useObjectStreams: true });
    return [{ name: `${safeBase(item.name)}-sem-paginas-kompres.pdf`, blob: new Blob([bytes], { type: 'application/pdf' }) }];
  }

  /* ── Posicionamento no sistema "visual" ──
     O leitor exibe a página girada por /Rotate, mas pdf-lib desenha no sistema sem rotação.
     Os helpers abaixo trabalham em coordenadas de como o leitor mostra (origem no canto
     inferior esquerdo visível) e convertem para o sistema da página. */
  const MM = 72 / 25.4;
  const normalizeAngle = angle => ((Math.round(angle) % 360) + 360) % 360;
  function pageFrame(page) {
    const box = page.getCropBox(); // área visível; cai para a MediaBox quando não há CropBox
    const rotation = normalizeAngle(page.getRotation().angle);
    const sideways = rotation === 90 || rotation === 270;
    return { box, rotation, width: sideways ? box.height : box.width, height: sideways ? box.width : box.height };
  }
  function toPagePoint(frame, x, y) {
    const { box, rotation } = frame;
    if (rotation === 90) return { x: box.x + box.width - y, y: box.y + x };
    if (rotation === 180) return { x: box.x + box.width - x, y: box.y + box.height - y };
    if (rotation === 270) return { x: box.x + y, y: box.y + box.height - x };
    return { x: box.x + x, y: box.y + y };
  }
  const CAP_HEIGHT = .72; // altura das maiúsculas da Helvetica em relação ao tamanho da fonte

  const WATERMARK_COLORS = { gray: [.5, .5, .5], black: [0, 0, 0], red: [.8, .1, .1], blue: [.1, .3, .75] };
  // WinAnsi cobre os acentos do português; o que a fonte não codifica vira "?".
  function encodable(font, text) {
    return Array.from(String(text).replace(/[\x00-\x1f\x7f]/g, '')).map(ch => { try { font.encodeText(ch); return ch; } catch { return '?'; } }).join('');
  }
  async function watermark(item, indices, options) {
    const doc = await PDFLib.PDFDocument.load(item.data, { ignoreEncryption: false });
    const opacity = Math.min(1, Math.max(.02, Number(options.opacity) / 100));
    const sizePct = Math.min(100, Math.max(1, Number(options.size))) / 100;
    const color = PDFLib.rgb(...(WATERMARK_COLORS[options.color] || WATERMARK_COLORS.gray));
    let font, text, unitWidth, image, ratio;
    if (options.type === 'image') {
      const bytes = new Uint8Array(options.image || []);
      const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
      const jpg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      if (!png && !jpg) throw new Error("A marca d'água precisa ser uma imagem PNG ou JPG.");
      image = png ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      ratio = image.height / image.width;
    } else {
      font = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
      text = encodable(font, options.text).trim();
      if (!text) throw new Error("Digite o texto da marca d'água.");
      unitWidth = font.widthOfTextAtSize(text, 1);
    }
    const diagonal = options.position === 'diagonal', tile = options.position === 'tile';
    const angle = diagonal ? 45 : 0;
    const pages = doc.getPages();
    for (const index of indices) {
      const page = pages[index];
      const frame = pageFrame(page);
      const { width: W, height: H } = frame;
      const margin = Math.min(12 * MM, W * .06, H * .06);
      // Largura em % da página visível; a altura segue a proporção da imagem ou da fonte.
      let w = W * sizePct, h = image ? w * ratio : (w / unitWidth) * CAP_HEIGHT;
      // Reduz para caber: na diagonal, a caixa girada; nos cantos, dentro das margens.
      const fit = diagonal ? Math.min(W, H) * .95 * Math.SQRT2 / (w + h) : tile ? Math.min(W / w, H / h) : Math.min((W - 2 * margin) / w, (H - 2 * margin) / h);
      if (fit < 1) { w *= fit; h *= fit; }
      const size = image ? null : w / unitWidth;
      const spots = [];
      if (tile) {
        let cellW = w * 1.6, cellH = Math.max(h * 3, cellW * .5);
        let cols = Math.ceil(W / cellW), rows = Math.ceil(H / cellH);
        if (cols * rows > 400) { const grow = Math.sqrt(cols * rows / 400); cellW *= grow; cellH *= grow; cols = Math.ceil(W / cellW); rows = Math.ceil(H / cellH); } // limite de carimbos por página
        const x0 = (W - cols * cellW + cellW - w) / 2, y0 = (H - rows * cellH + cellH - h) / 2;
        for (let row = 0; row < rows; row++) {
          const shift = row % 2 ? cellW / 2 : 0; // linhas alternadas deslocadas: mosaico menos regular
          for (let col = -1; col < cols; col++) spots.push({ x: x0 + col * cellW + shift, y: y0 + row * cellH });
        }
      } else if (diagonal || options.position === 'center') {
        // A âncora é o canto inferior esquerdo: desloca do centro pelo meio do bloco (girado).
        const rad = angle * Math.PI / 180, cx = w / 2, cy = h / 2;
        spots.push({ x: W / 2 - (cx * Math.cos(rad) - cy * Math.sin(rad)), y: H / 2 - (cx * Math.sin(rad) + cy * Math.cos(rad)) });
      } else {
        const right = String(options.position).endsWith('right'), top = String(options.position).startsWith('top');
        spots.push({ x: right ? W - margin - w : margin, y: top ? H - margin - h : margin });
      }
      const rotate = PDFLib.degrees(angle + frame.rotation);
      for (const spot of spots) {
        const point = toPagePoint(frame, spot.x, spot.y);
        if (image) page.drawImage(image, { x: point.x, y: point.y, width: w, height: h, rotate, opacity });
        else page.drawText(text, { x: point.x, y: point.y, size, font, color, rotate, opacity });
      }
    }
    const bytes = await doc.save({ useObjectStreams: true });
    return [{ name: `${safeBase(item.name)}-marca-dagua-kompres.pdf`, blob: new Blob([bytes], { type: 'application/pdf' }) }];
  }

  const NUMBER_FORMATS = {
    n: n => `${n}`,
    'pagina-n': n => `Página ${n}`,
    'n-de-total': (n, total) => `${n} de ${total}`,
    'pagina-n-de-total': (n, total) => `Página ${n} de ${total}`,
  };
  async function numberPages(item, indices, options) {
    const start = Number(options.start);
    if (!Number.isInteger(start) || start < 0 || start > 999999) throw new Error('O número inicial precisa ser um inteiro entre 0 e 999999.');
    const doc = await PDFLib.PDFDocument.load(item.data, { ignoreEncryption: false });
    const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    const size = [10, 12, 14].includes(Number(options.fontSize)) ? Number(options.fontSize) : 12;
    const format = NUMBER_FORMATS[options.format] || NUMBER_FORMATS.n;
    const [vertical, horizontal] = String(options.position || 'bottom-center').split('-');
    const pages = doc.getPages();
    const total = pages.length + start - 1; // "1 de N": N é o número da última página do documento
    const margin = 12 * MM;
    for (const index of indices) {
      const page = pages[index];
      const frame = pageFrame(page);
      const label = format(index + start, total); // a contagem segue a posição da página, mesmo pulando algumas
      const w = font.widthOfTextAtSize(label, size), h = size * CAP_HEIGHT;
      const x = horizontal === 'left' ? margin : horizontal === 'right' ? frame.width - margin - w : (frame.width - w) / 2;
      const y = vertical === 'top' ? frame.height - margin - h : margin;
      const point = toPagePoint(frame, x, y);
      page.drawText(label, { x: point.x, y: point.y, size, font, color: PDFLib.rgb(0, 0, 0), rotate: PDFLib.degrees(frame.rotation) });
    }
    const bytes = await doc.save({ useObjectStreams: true });
    return [{ name: `${safeBase(item.name)}-numerado-kompres.pdf`, blob: new Blob([bytes], { type: 'application/pdf' }) }];
  }

  async function crop(item, indices, margins) {
    const cut = {};
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const value = Number(margins?.[side]);
      if (!Number.isFinite(value) || value < 0) throw new Error('As margens precisam ser números em milímetros, a partir de 0.');
      cut[side] = value * MM;
    }
    if (!Object.values(cut).some(value => value > 0)) throw new Error('Informe pelo menos uma margem maior que zero.');
    const doc = await PDFLib.PDFDocument.load(item.data, { ignoreEncryption: false });
    const pages = doc.getPages();
    for (const index of indices) {
      const page = pages[index];
      const rotation = normalizeAngle(page.getRotation().angle);
      // "Superior" é o topo como o leitor exibe: em páginas giradas, os lados trocam de lugar.
      const sides = rotation === 90 ? { left: cut.top, bottom: cut.left, right: cut.bottom, top: cut.right }
        : rotation === 180 ? { left: cut.right, bottom: cut.top, right: cut.left, top: cut.bottom }
        : rotation === 270 ? { left: cut.bottom, bottom: cut.right, right: cut.top, top: cut.left }
        : { left: cut.left, bottom: cut.bottom, right: cut.right, top: cut.top };
      const box = page.getCropBox(); // parte da área visível (CropBox ou, sem ela, MediaBox)
      const width = box.width - sides.left - sides.right, height = box.height - sides.bottom - sides.top;
      if (width < 20 * MM || height < 20 * MM) throw new Error(`A página ${index + 1} ficaria com menos de 20 mm de largura ou altura. Reduza as margens.`);
      const x = box.x + sides.left, y = box.y + sides.bottom;
      // MediaBox e CropBox juntas: alguns leitores só respeitam uma delas.
      page.setMediaBox(x, y, width, height);
      page.setCropBox(x, y, width, height);
      for (const [key, setter] of [['BleedBox', 'setBleedBox'], ['TrimBox', 'setTrimBox'], ['ArtBox', 'setArtBox']]) {
        if (page.node.has(PDFLib.PDFName.of(key)) && typeof page[setter] === 'function') page[setter](x, y, width, height);
      }
    }
    const bytes = await doc.save({ useObjectStreams: true });
    return [{ name: `${safeBase(item.name)}-recortado-kompres.pdf`, blob: new Blob([bytes], { type: 'application/pdf' }) }];
  }

  scope.KompresPDF = { parsePages, safeBase, loadPdf, imageInfo, imagesToPdf, extract, exportImages, rotate, removePages, watermark, numberPages, crop };
})(window);
