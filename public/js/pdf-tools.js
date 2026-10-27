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
  const WATERMARK_ANGLES = [0, 45, -45, 90]; // ângulos da posição Livre (graus, anti-horário como no PDF)
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  // WinAnsi cobre os acentos do português; o que a fonte não codifica vira "?".
  // Aceita a fonte embutida (PDFFont) ou o StandardFontEmbedder usado pela prévia.
  function encodable(font, text) {
    return Array.from(String(text).replace(/[\x00-\x1f\x7f]/g, '')).map(ch => { try { font.encodeText(ch); return ch; } catch { return '?'; } }).join('');
  }

  /* ── Marca d'água: geometria comum ao PDF e à prévia ──
     watermarkLayout trabalha no sistema visual (origem no canto inferior esquerdo da página
     como o leitor mostra, y para cima) e devolve o tamanho da marca, o ângulo e o CENTRO de
     cada carimbo. aspect = altura ÷ largura da marca (imagem: proporção; texto: altura das
     maiúsculas ÷ largura do texto). É pura: a prévia usa a mesma conta e bate com o PDF.
     Posição Livre: options.free = { x, y } é o centro em frações da página visível (x a partir
     da esquerda, y a partir do topo, como na tela) e options.size é a largura em % da página. */
  function watermarkLayout(W, H, options, aspect) {
    const position = String(options.position || 'diagonal');
    const free = position === 'free', diagonal = position === 'diagonal', tile = position === 'tile';
    const sizePct = clamp(Number(options.size) || 0, 1, 100) / 100;
    const angle = free ? (WATERMARK_ANGLES.includes(Number(options.angle)) ? Number(options.angle) : 0) : diagonal ? 45 : 0;
    const margin = Math.min(12 * MM, W * .06, H * .06);
    // Largura em % da página visível; a altura segue a proporção da imagem ou da fonte.
    let w = W * sizePct, h = w * aspect;
    if (!free) {
      // Reduz para caber: na diagonal, a caixa girada; nos cantos, dentro das margens.
      // Na posição Livre quem decide é a pessoa (o que passar da página é cortado, como na prévia).
      const fit = diagonal ? Math.min(W, H) * .95 * Math.SQRT2 / (w + h) : tile ? Math.min(W / w, H / h) : Math.min((W - 2 * margin) / w, (H - 2 * margin) / h);
      if (fit < 1) { w *= fit; h *= fit; }
    }
    const spots = [];
    if (free) {
      const frac = value => value !== null && value !== '' && Number.isFinite(Number(value)) ? clamp(Number(value), 0, 1) : .5;
      spots.push({ x: frac(options.free?.x) * W, y: (1 - frac(options.free?.y)) * H });
    } else if (tile) {
      let cellW = w * 1.6, cellH = Math.max(h * 3, cellW * .5);
      let cols = Math.ceil(W / cellW), rows = Math.ceil(H / cellH);
      if (cols * rows > 400) { const grow = Math.sqrt(cols * rows / 400); cellW *= grow; cellH *= grow; cols = Math.ceil(W / cellW); rows = Math.ceil(H / cellH); } // limite de carimbos por página
      const x0 = (W - cols * cellW + cellW - w) / 2, y0 = (H - rows * cellH + cellH - h) / 2;
      for (let row = 0; row < rows; row++) {
        const shift = row % 2 ? cellW / 2 : 0; // linhas alternadas deslocadas: mosaico menos regular
        for (let col = -1; col < cols; col++) spots.push({ x: x0 + col * cellW + shift + w / 2, y: y0 + row * cellH + h / 2 });
      }
    } else if (diagonal || position === 'center') {
      spots.push({ x: W / 2, y: H / 2 });
    } else {
      const right = position.endsWith('right'), top = position.startsWith('top');
      spots.push({ x: (right ? W - margin - w : margin) + w / 2, y: (top ? H - margin - h : margin) + h / 2 });
    }
    return { w, h, angle, spots };
  }
  /** Leva a geometria visual para pontos da página: para cada carimbo, o canto de ancoragem
   *  (inferior esquerdo do texto/imagem, já girado) e o ângulo final do desenho, respeitando
   *  /Rotate e CropBox. frame vem de pageFrame. */
  function watermarkPlacements(frame, options, aspect) {
    const layout = watermarkLayout(frame.width, frame.height, options, aspect);
    // A âncora do desenho é o canto inferior esquerdo: desloca do centro pelo meio do bloco (girado).
    const rad = layout.angle * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
    const hx = layout.w / 2, hy = layout.h / 2;
    const points = layout.spots.map(c => toPagePoint(frame, c.x - (hx * cos - hy * sin), c.y - (hx * sin + hy * cos)));
    return { w: layout.w, h: layout.h, angle: layout.angle, points, rotate: layout.angle + frame.rotation };
  }
  // Texto da marca como vai para o PDF (Helvetica Bold, WinAnsi) e sua largura com fonte de 1 pt.
  // Sem criar documento: a prévia chama a cada tecla.
  let helveticaBold = null, lastText = null;
  function watermarkText(value) {
    if (lastText && lastText.value === value) return lastText.result;
    helveticaBold ||= PDFLib.StandardFontEmbedder.for(PDFLib.StandardFonts.HelveticaBold);
    const text = encodable(helveticaBold, value).trim();
    const unitWidth = text ? helveticaBold.widthOfTextAtSize(text, 1) : 0;
    const result = { text, unitWidth, aspect: unitWidth ? CAP_HEIGHT / unitWidth : 0 };
    lastText = { value, result };
    return result;
  }
  // Largura e altura de um PNG ou JPG pelos bytes (as mesmas que o pdf-lib usa ao embutir).
  function imageDims(input) {
    const b = new Uint8Array(input || []);
    if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
      const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
      const width = view.getUint32(16), height = view.getUint32(20);
      return width && height ? { width, height } : null;
    }
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i + 8 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const marker = b[i + 1];
        if (marker === 0xff) { i++; continue; } // bytes de preenchimento
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { i += 2; continue; } // marcadores sem tamanho
        // SOF0…SOF15 (menos DHT, JPG e DAC): altura e largura logo depois da precisão.
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          const height = (b[i + 5] << 8) | b[i + 6], width = (b[i + 7] << 8) | b[i + 8];
          return width && height ? { width, height } : null;
        }
        i += 2 + ((b[i + 2] << 8) | b[i + 3]);
      }
    }
    return null;
  }

  async function watermark(item, indices, options) {
    const doc = await PDFLib.PDFDocument.load(item.data, { ignoreEncryption: false });
    const opacity = Math.min(1, Math.max(.02, Number(options.opacity) / 100));
    const color = PDFLib.rgb(...(WATERMARK_COLORS[options.color] || WATERMARK_COLORS.gray));
    let font, text, unitWidth, image, aspect;
    if (options.type === 'image') {
      const bytes = new Uint8Array(options.image || []);
      const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
      const jpg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      if (!png && !jpg) throw new Error("A marca d'água precisa ser uma imagem PNG ou JPG.");
      image = png ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      aspect = image.height / image.width;
    } else {
      font = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
      text = encodable(font, options.text).trim();
      if (!text) throw new Error("Digite o texto da marca d'água.");
      unitWidth = font.widthOfTextAtSize(text, 1);
      aspect = CAP_HEIGHT / unitWidth;
    }
    const pages = doc.getPages();
    for (const index of indices) {
      const page = pages[index];
      // Mesma posição relativa em todas as páginas escolhidas, cada uma com o seu tamanho e /Rotate.
      const place = watermarkPlacements(pageFrame(page), options, aspect);
      const rotate = PDFLib.degrees(place.rotate);
      const size = image ? null : place.w / unitWidth;
      for (const point of place.points) {
        if (image) page.drawImage(image, { x: point.x, y: point.y, width: place.w, height: place.h, rotate, opacity });
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

  /* ── PDF para texto ──
     layoutText recebe os trechos já na página como o leitor mostra (y cresce para baixo):
     { str, x, y (linha de base), w (largura), h (altura da fonte), eol (hasEOL do pdf.js) }.
     Agrupa por linha (y com tolerância), ordena cada linha por x e separa parágrafos pelos
     saltos verticais grandes. É pura, para poder ser testada fora do navegador. */
  function layoutText(items) {
    const parts = [];
    for (const item of items || []) {
      if (!item || typeof item.str !== 'string' || !Number.isFinite(item.x) || !Number.isFinite(item.y)) continue;
      const str = item.str.replace(/\s+/g, ' ');
      // Trecho vazio só com quebra de linha: a quebra vale para o trecho anterior.
      if (!str.trim()) { if (item.eol && parts.length) parts[parts.length - 1].eol = true; continue; }
      parts.push({ str, x: item.x, y: item.y, w: Math.max(0, Number(item.w) || 0), h: Math.abs(Number(item.h)) || 10, eol: !!item.eol });
    }
    if (!parts.length) return '';

    // Linhas: mesma linha de base, com folga de meia altura (pega índices e expoentes).
    const lines = [];
    for (const part of parts.slice().sort((a, b) => a.y - b.y || a.x - b.x)) {
      const line = lines[lines.length - 1];
      if (line && Math.abs(part.y - line.y) <= Math.max(2, .5 * Math.max(line.h, part.h))) {
        line.items.push(part);
        if (part.h > line.h) { line.h = part.h; line.y = part.y; } // a base da linha é a do texto maior
      } else lines.push({ y: part.y, h: part.h, items: [part] });
    }
    for (const line of lines) {
      let text = '', prev = null;
      for (const part of line.items.sort((a, b) => a.x - b.x)) {
        if (prev && part.str === prev.str && Math.abs(part.x - prev.x) < 1) continue; // negrito falso: o mesmo texto desenhado duas vezes
        if (prev) {
          const gap = part.x - (prev.x + prev.w);
          // Espaço quando há distância entre os trechos ou o pdf.js marcou fim de linha (ex.: duas colunas).
          if ((prev.eol || gap > .15 * Math.min(prev.h, part.h)) && !/ $/.test(text) && !/^ /.test(part.str)) text += ' ';
        }
        text += part.str; prev = part;
      }
      line.text = text.trim();
    }

    // Parágrafo: salto bem maior que o espaçamento típico entre linhas da página.
    const gaps = lines.slice(1).map((line, i) => line.y - lines[i].y).filter(gap => gap > 0).sort((a, b) => a - b);
    const typical = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
    let out = '';
    lines.forEach((line, i) => {
      if (i) {
        const gap = line.y - lines[i - 1].y, h = Math.max(line.h, lines[i - 1].h);
        out += gap > 1.9 * h || (typical && gap > 1.45 * typical && gap > 1.3 * h) ? '\n\n' : '\n';
      }
      out += line.text;
    });
    return out.replace(/\n{3,}/g, '\n\n').trim();
  }
  // Junta as páginas; com "Separar páginas", cada uma ganha um cabeçalho.
  function joinPages(pages, separate) {
    if (separate) return pages.map(page => `--- Página ${page.number} ---\n${page.text || '(página sem texto)'}`).join('\n\n');
    return pages.map(page => page.text).filter(Boolean).join('\n\n');
  }
  async function extractText(item, indices, options = {}, progress = () => {}) {
    const doc = await loadPdf(item.data);
    const pages = [];
    try {
      for (let i = 0; i < indices.length; i++) {
        const page = await doc.getPage(indices[i] + 1);
        try {
          // A matriz da página (com /Rotate) leva cada trecho para a posição em que o leitor mostra.
          const viewport = page.getViewport({ scale: 1 });
          const content = await page.getTextContent();
          const parts = content.items.filter(entry => typeof entry.str === 'string').map(entry => {
            const m = scope.pdfjsLib.Util.transform(viewport.transform, entry.transform);
            return { str: entry.str, x: m[4], y: m[5], w: entry.width, h: Math.hypot(m[2], m[3]) || entry.height, eol: entry.hasEOL };
          });
          pages.push({ number: indices[i] + 1, text: layoutText(parts) });
        } finally { page.cleanup(); }
        progress(i + 1, indices.length);
      }
    } finally { await doc.destroy(); }
    if (!pages.some(page => page.text)) {
      throw new Error(indices.length < item.pages
        ? 'As páginas escolhidas não têm texto; podem ser imagens escaneadas. Tente outras páginas.'
        : 'Este PDF parece ser uma imagem escaneada; não há texto para extrair.');
    }
    return joinPages(pages, !!options.separatePages);
  }

  scope.KompresPDF = { parsePages, safeBase, loadPdf, imageInfo, imagesToPdf, extract, exportImages, rotate, removePages, watermark, watermarkLayout, watermarkPlacements, watermarkText, imageDims, WATERMARK_COLORS, pageFrame, toPagePoint, numberPages, crop, layoutText, joinPages, extractText };
})(window);
