/* Assinar PDF: a assinatura é criada no navegador (desenho, nome em letra cursiva ou
 * imagem), colocada sobre as páginas na prévia (arrastar, redimensionar, remover) e
 * gravada com pdf-lib como imagem PNG. Um PDF por vez; nada sai do navegador.
 * `document` é restrito à página e `signal` aborta ao navegar para outra. */
kompres.register('pdf-sign', (signal, document) => {
  const field = (id) => document.getElementById(id);
  const fileInput = field('signFile');
  const dropZone = field('signDrop');
  const stage = field('signStage');
  const statusEl = field('signStatus');
  const view = field('signView');
  const pageEl = field('signPage');
  const canvas = field('signCanvas');
  const layer = field('signLayer');
  const thumbs = field('signThumbs');
  const prevBtn = field('signPrev');
  const nextBtn = field('signNext');
  const pageLabel = field('signPageLabel');
  const addBtn = field('signAdd');
  const allBtn = field('signAll');
  const dateBox = field('signDate');
  const downloadBtn = field('signDownload');
  const clearBtn = field('signClear');
  const pad = field('signPad');
  const padHint = field('signPadHint');
  const widthInput = field('signWidth');
  const nameInput = field('signName');
  const imageInput = field('signImageFile');
  const imageLabel = field('signImageLabel');
  const imagePreview = field('signImagePreview');
  const imageCanvas = field('signImageCanvas');
  const removeBgBox = field('signRemoveBg');
  const inkGroup = field('signInkGroup');
  if (!fileInput || !stage || !pad || !layer) return;

  const INKS = { black: '#16181d', blue: '#1b3fa6' };
  const ASSET_MAX = 1400;   // maior lado da imagem da assinatura gravada no PDF, em px
  const IMAGE_MAX = 1600;   // imagens enviadas são reduzidas antes de processar
  const THUMB_PX = 96;      // lado maior das miniaturas, em px CSS
  const MIN_W = 0.04;       // largura mínima da assinatura, em fração da página
  const CAP_HEIGHT = 0.72;  // altura das maiúsculas da Helvetica em relação ao tamanho

  let source = null;        // { name, data, doc, count }
  let sizes = [];           // tamanho visual de cada página em pontos { W, H } (já com /Rotate)
  let current = 0;          // página mostrada (0-based)
  let placements = [];      // { id, page, asset, x, y, w, group, el } — x, y, w em fração da página
  let selected = null;
  let seq = 0;
  let assets = [];          // assinaturas geradas: { canvas, ratio, url, color, png }
  let cached = null;        // { version, asset }: reaproveita a assinatura enquanto não muda
  let sigVersion = 0;       // muda a cada alteração na assinatura
  let thumbUrls = [];
  let generation = 0;       // invalida trabalho de um PDF substituído
  let renderToken = 0;
  let renderTask = null;
  let busy = false;
  let loading = false;

  let mode = 'draw';
  let ink = 'black';
  let strokes = [];         // traços do quadro; pontos normalizados pela largura do quadro
  let imageSource = null;   // canvas com a imagem enviada (já reduzida)
  let imageResult = null;   // canvas depois de remover o fundo e aparar

  /* ── Utilidades ── */

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  function setStatus(message = '', error = false) {
    statusEl.textContent = message;
    statusEl.hidden = !message;
    statusEl.classList.toggle('error', error);
  }
  function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }
  function today() {
    return new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }
  function canvasBlob(source) {
    return new Promise((resolve, reject) => source.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Falha ao gerar o PNG.')), 'image/png'));
  }
  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  function syncToggle(name) {
    document.querySelectorAll(`input[name="${name}"]`).forEach((input) => input.closest('.fmt-btn')?.classList.toggle('active', input.checked));
  }
  const isPdf = (file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
  const isImage = (file) => /^image\/(png|jpeg)$/.test(file.type) || /\.(png|jpe?g)$/i.test(file.name);

  /** Apara as bordas transparentes: a assinatura fica do tamanho do traço. */
  function trimCanvas(src, margin = 0) {
    const { width, height } = src;
    if (!width || !height) return null;
    const data = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
      const row = y * width * 4;
      for (let x = 0; x < width; x++) {
        if (data[row + x * 4 + 3] > 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    minX = Math.max(0, minX - margin); minY = Math.max(0, minY - margin);
    maxX = Math.min(width - 1, maxX + margin); maxY = Math.min(height - 1, maxY + margin);
    const out = document.createElement('canvas');
    out.width = maxX - minX + 1; out.height = maxY - minY + 1;
    out.getContext('2d').drawImage(src, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  }
  function fitCanvas(src, max) {
    const scale = Math.min(1, max / Math.max(src.width, src.height));
    if (scale === 1) return src;
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(src.width * scale));
    out.height = Math.max(1, Math.round(src.height * scale));
    const ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, out.width, out.height);
    return out;
  }

  /* ── Modo e cor da assinatura ── */

  function changed() { sigVersion++; }

  function setMode(next) {
    mode = next;
    document.querySelectorAll('input[name="signMode"]').forEach((input) => { input.checked = input.value === next; });
    syncToggle('signMode');
    document.querySelectorAll('.sign-panel').forEach((panel) => { panel.hidden = panel.dataset.panel !== next; });
    inkGroup.hidden = next === 'image'; // a imagem mantém as cores próprias
    if (next === 'draw') resizePad();
    changed();
  }
  document.querySelectorAll('input[name="signMode"]').forEach((input) => input.addEventListener('change', () => {
    if (input.checked) setMode(input.value);
  }, { signal }));
  document.querySelectorAll('input[name="signInk"]').forEach((input) => input.addEventListener('change', () => {
    if (!input.checked) return;
    ink = input.value;
    syncToggle('signInk');
    inkGroup.closest('.control-group').dataset.ink = ink; // a cor do nome digitado acompanha
    drawPad();
    changed();
  }, { signal }));

  /* ── Desenhar: quadro com Pointer Events e curvas suaves ── */

  let padW = 0, padH = 0, padDpr = 1;
  let drawing = null; // { pointerId, stroke }
  let padFrame = 0;

  function resizePad() {
    const rect = pad.getBoundingClientRect();
    if (!rect.width || !rect.height) return; // painel oculto
    padW = rect.width; padH = rect.height;
    padDpr = Math.min(3, window.devicePixelRatio || 1);
    pad.width = Math.round(padW * padDpr);
    pad.height = Math.round(padH * padDpr);
    drawPad();
  }
  // Espessura proporcional à largura do quadro: o traço não muda ao redimensionar a janela.
  const lineWidthFor = (width) => Number(widthInput.value) * width / 300;

  /** Desenha os traços com curvas quadráticas pelos pontos médios (sem quinas). */
  function paintStrokes(ctx, scale, color, lineWidth) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lineWidth;
    for (const stroke of strokes) {
      const pts = stroke.map(([x, y]) => [x * scale, y * scale]);
      if (pts.length === 1) {
        ctx.beginPath();
        ctx.arc(pts[0][0], pts[0][1], lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length - 1; i++) {
        ctx.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
      }
      const last = pts[pts.length - 1];
      ctx.lineTo(last[0], last[1]);
      ctx.stroke();
    }
  }
  function drawPad() {
    padFrame = 0;
    const ctx = pad.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pad.width, pad.height);
    if (padW) {
      ctx.setTransform(padDpr, 0, 0, padDpr, 0, 0);
      paintStrokes(ctx, padW, INKS[ink], lineWidthFor(padW));
    }
    padHint.hidden = strokes.length > 0;
  }
  function schedulePad() { if (!padFrame) padFrame = requestAnimationFrame(drawPad); }
  function padPoint(event) {
    const rect = pad.getBoundingClientRect();
    return [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.width];
  }

  pad.addEventListener('pointerdown', (event) => {
    if (drawing || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    try { pad.setPointerCapture(event.pointerId); } catch { /* segue sem captura */ }
    const stroke = [padPoint(event)];
    strokes.push(stroke);
    drawing = { pointerId: event.pointerId, stroke };
    schedulePad();
  }, { signal });
  pad.addEventListener('pointermove', (event) => {
    if (!drawing || event.pointerId !== drawing.pointerId) return;
    // Eventos agrupados pelo navegador dão um traço mais fiel em movimentos rápidos.
    const coalesced = event.getCoalescedEvents?.();
    for (const item of coalesced?.length ? coalesced : [event]) {
      const point = padPoint(item);
      const last = drawing.stroke[drawing.stroke.length - 1];
      if (Math.hypot(point[0] - last[0], point[1] - last[1]) * padW >= 1) drawing.stroke.push(point);
    }
    schedulePad();
  }, { signal });
  const endStroke = (event) => {
    if (!drawing || event.pointerId !== drawing.pointerId) return;
    drawing = null;
    schedulePad();
    changed();
  };
  pad.addEventListener('pointerup', endStroke, { signal });
  pad.addEventListener('pointercancel', endStroke, { signal });

  field('signPadClear').addEventListener('click', () => { strokes = []; drawing = null; drawPad(); changed(); }, { signal });
  widthInput.addEventListener('input', () => { drawPad(); changed(); }, { signal });

  const padObserver = new ResizeObserver(() => { if (mode === 'draw') resizePad(); });
  padObserver.observe(pad);

  /* ── Digitar ── */

  nameInput.addEventListener('input', changed, { signal });
  // Já pede a fonte manuscrita: quando o usuário clicar em Adicionar, ela está pronta.
  nameInput.addEventListener('focus', () => { document.fonts?.load('400 48px "Mrs Saint Delafield"').catch(() => {}); }, { signal, once: true });

  /* ── Imagem ── */

  imageInput.addEventListener('change', () => {
    const file = imageInput.files[0];
    imageInput.value = '';
    if (file) loadSignatureImage(file);
  }, { signal });
  removeBgBox.addEventListener('change', () => { processImage(); changed(); }, { signal });

  async function loadSignatureImage(file) {
    if (!isImage(file)) { setStatus('Para a assinatura, use uma imagem PNG ou JPG.', true); return; }
    let bitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      setStatus('Não foi possível abrir esta imagem. Tente outro arquivo PNG ou JPG.', true);
      return;
    }
    if (signal.aborted) { bitmap.close?.(); return; }
    const scale = Math.min(1, IMAGE_MAX / Math.max(bitmap.width, bitmap.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bitmap.width * scale));
    c.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, c.width, c.height);
    bitmap.close?.();
    imageSource = c;
    imageLabel.textContent = file.name;
    if (mode !== 'image') setMode('image');
    processImage();
    changed();
    setStatus(imageResult ? '' : 'A imagem ficou vazia ao remover o fundo branco. Desmarque a opção ou use outra foto.', !imageResult);
  }

  /** Torna transparentes os pixels quase brancos (papel), com borda suave no traço. */
  function processImage() {
    if (!imageSource) { imageResult = null; imagePreview.hidden = true; return; }
    const c = document.createElement('canvas');
    c.width = imageSource.width; c.height = imageSource.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(imageSource, 0, 0);
    if (removeBgBox.checked) {
      const pixels = ctx.getImageData(0, 0, c.width, c.height);
      const d = pixels.data;
      const solid = 200, clear = 235; // abaixo de 200: traço; acima de 235: papel
      for (let i = 0; i < d.length; i += 4) {
        const light = Math.min(d[i], d[i + 1], d[i + 2]);
        if (light >= clear) d[i + 3] = 0;
        else if (light > solid) d[i + 3] = Math.round(d[i + 3] * (clear - light) / (clear - solid));
      }
      ctx.putImageData(pixels, 0, 0);
    }
    imageResult = trimCanvas(c, 2);
    c.width = 0; c.height = 0;
    if (!imageResult) { imagePreview.hidden = true; return; }
    imageCanvas.width = imageResult.width;
    imageCanvas.height = imageResult.height;
    const preview = imageCanvas.getContext('2d');
    preview.clearRect(0, 0, imageCanvas.width, imageCanvas.height);
    preview.drawImage(imageResult, 0, 0);
    imagePreview.hidden = false;
  }

  /* ── Assinatura pronta para colocar ── */

  async function typedCanvas() {
    const text = nameInput.value.trim();
    if (!text) return null;
    // A fonte vem do Google Fonts pelo CSS; sem ela, o canvas desenharia com a fonte padrão.
    try { await document.fonts.load('400 64px "Mrs Saint Delafield"', text); } catch { /* usa a cursiva do sistema */ }
    // Mesma letra de mão do Propostaria. As voltas das letras passam bem da caixa do texto:
    // o canvas ganha folga em volta e o trimCanvas recorta depois.
    const family = '"Mrs Saint Delafield", "Segoe Script", cursive';
    const measure = document.createElement('canvas').getContext('2d');
    measure.font = `400 160px ${family}`;
    const width = measure.measureText(text).width;
    // Nomes longos: reduz a fonte para a imagem não passar de ASSET_MAX.
    const size = Math.max(40, 160 * Math.min(1, (ASSET_MAX * 0.9) / Math.max(1, width)));
    const c = document.createElement('canvas');
    c.width = Math.ceil(width * size / 160 + size * 1.6);
    c.height = Math.ceil(size * 2.2);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.font = `400 ${size}px ${family}`;
    ctx.fillStyle = INKS[ink];
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, size * 0.8, size * 1.45);
    return trimCanvas(c, Math.ceil(size * 0.05));
  }
  function drawnCanvas() {
    if (!strokes.length) return null;
    const w = padW || 300, h = padH || 150;
    const scale = 1200 / w; // resolução maior que a do quadro para o PDF ficar nítido
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const lineWidth = lineWidthFor(w) * scale;
    paintStrokes(ctx, w * scale, INKS[ink], lineWidth);
    return trimCanvas(c, Math.ceil(lineWidth / 2) + 2);
  }

  async function createAsset() {
    let c = null;
    if (mode === 'draw') c = drawnCanvas();
    else if (mode === 'type') c = await typedCanvas();
    else if (imageResult) {
      c = document.createElement('canvas');
      c.width = imageResult.width; c.height = imageResult.height;
      c.getContext('2d').drawImage(imageResult, 0, 0);
    }
    if (!c) {
      setStatus(mode === 'draw' ? 'Desenhe sua assinatura no quadro "Sua assinatura" antes de colocá-la na página.'
        : mode === 'type' ? 'Digite seu nome em "Sua assinatura" para criar a assinatura.'
        : 'Escolha a imagem da assinatura (PNG ou JPG) em "Sua assinatura".', true);
      return null;
    }
    c = fitCanvas(c, ASSET_MAX);
    const url = URL.createObjectURL(await canvasBlob(c));
    const asset = { canvas: c, ratio: c.width / c.height, url, color: mode === 'image' ? INKS.black : INKS[ink], png: null };
    assets.push(asset);
    return asset;
  }
  async function currentAsset() {
    if (cached && cached.version === sigVersion) return cached.asset;
    const version = sigVersion;
    const asset = await createAsset();
    if (asset) cached = { version, asset };
    return asset;
  }
  /** PNG otimizado sem perdas (worker compartilhado); se falhar, o PNG do navegador. */
  function assetBytes(asset) {
    asset.png ||= (async () => {
      let blob;
      try { blob = await kompres.pngFromCanvas(asset.canvas, 1); }
      catch { blob = await canvasBlob(asset.canvas); }
      return new Uint8Array(await blob.arrayBuffer());
    })();
    return asset.png;
  }

  /* ── Geometria: frações da página visível ↔ pontos PDF ── */

  const pageSize = (index) => sizes[index] || { W: 612, H: 792 };
  const dateSizeFor = (widthPt) => clamp(widthPt * 0.09, 7, 14);

  /** Caixa da assinatura (e da data) em pontos, dentro da página W × H, origem no topo. */
  function geometry(p, W, H) {
    let w = Math.max(p.w, MIN_W) * W;
    let h = w / p.asset.ratio;
    const size = dateSizeFor(w);
    const gap = size * 0.35;
    const extra = dateBox.checked ? gap + size * 1.05 : 0;
    // Grande demais para a página: reduz mantendo a proporção.
    const fit = Math.min(1, W / w, (H - extra) / h);
    if (fit < 1) { w *= fit; h *= fit; }
    const left = clamp(p.x * W, 0, Math.max(0, W - w));
    const top = clamp(p.y * H, 0, Math.max(0, H - h - extra));
    return { left, top, w, h, size, gap };
  }
  function clampPlacement(p) {
    const { W, H } = pageSize(p.page);
    const g = geometry(p, W, H);
    p.x = g.left / W; p.y = g.top / H; p.w = g.w / W;
    return g;
  }

  // Cópia de pageFrame/toPagePoint de pdf-tools.js (lá não são exportados): o leitor mostra a
  // página girada por /Rotate, mas o pdf-lib desenha no sistema sem rotação.
  function pageFrame(page) {
    const box = page.getCropBox();
    const rotation = ((Math.round(page.getRotation().angle) % 360) + 360) % 360;
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

  /* ── Entrada do PDF ── */

  fileInput.addEventListener('change', (event) => {
    handleFiles([...event.target.files]);
    fileInput.value = '';
  }, { signal });
  kompres.fileDrop({ signal, document, zone: dropZone, onFiles: handleFiles });

  async function handleFiles(files) {
    if (!files.length) return;
    const pdfs = files.filter(isPdf);
    if (!pdfs.length) {
      // Imagem solta ou colada na página: vira a imagem da assinatura.
      const image = files.find(isImage);
      if (image) { await loadSignatureImage(image); return; }
      setStatus('Selecione um arquivo PDF. Para usar a imagem da assinatura, escolha um PNG ou JPG.', true);
      return;
    }
    if (busy) { setStatus('Aguarde terminar de montar o PDF atual.', true); return; }
    const file = pdfs[0];

    // Outro PDF substitui o atual (as assinaturas colocadas são descartadas).
    await clear(false);
    const gen = ++generation;
    loading = true;
    setStatus('Lendo o PDF…');
    updateButtons();
    try {
      const data = await file.arrayBuffer();
      const doc = await KompresPDF.loadPdf(data);
      if (gen !== generation || signal.aborted) { await doc.destroy(); return; }
      source = { name: file.name, data, doc, count: doc.numPages };
      sizes = new Array(doc.numPages).fill(null);
      current = 0;
      loading = false;
      field('signFileName').textContent = file.name;
      stage.hidden = false;
      setStatus(pdfs.length > 1 ? 'Um PDF por vez: abrimos o primeiro arquivo.' : '');
      buildThumbs();
      renderPage();
      renderThumbs(doc, gen);
    } catch (err) {
      if (gen !== generation) return;
      loading = false;
      updateButtons();
      setStatus(err?.name === 'PasswordException'
        ? 'Este PDF está protegido por senha. Remova a senha antes de assinar.'
        : 'Não foi possível ler este PDF. Verifique se o arquivo não está corrompido.', true);
    }
  }

  /* ── Prévia da página atual ── */

  async function renderPage() {
    if (!source?.doc) return;
    const token = ++renderToken;
    const index = current;
    pageLabel.textContent = `Página ${index + 1} de ${source.count}`;
    markActiveThumb();
    updateButtons();
    try {
      const page = await source.doc.getPage(index + 1);
      if (token !== renderToken) return;
      const base = page.getViewport({ scale: 1 }); // já considera /Rotate e a área visível
      sizes[index] = { W: base.width, H: base.height };
      const style = getComputedStyle(view);
      const avail = view.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const maxH = Math.max(380, window.innerHeight * 0.8);
      const cssW = Math.max(120, Math.min(avail, maxH * base.width / base.height, 1000));
      const cssH = cssW * base.height / base.width;
      pageEl.style.width = `${cssW}px`;
      pageEl.style.height = `${cssH}px`;
      pageEl.style.setProperty('--pt', String(cssW / base.width)); // px CSS por ponto PDF
      renderLayer();

      // Renderiza fora da tela e copia no fim: a página anterior fica visível até a nova ficar pronta.
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const viewport = page.getViewport({ scale: (cssW * dpr) / base.width });
      const off = document.createElement('canvas');
      off.width = Math.ceil(viewport.width);
      off.height = Math.ceil(viewport.height);
      try { renderTask?.cancel(); } catch { /* já terminou */ }
      const task = page.render({ canvasContext: off.getContext('2d'), viewport, background: '#ffffff', intent: 'print' });
      renderTask = task;
      await task.promise;
      if (token !== renderToken) return;
      canvas.width = off.width;
      canvas.height = off.height;
      canvas.getContext('2d').drawImage(off, 0, 0);
      off.width = 0; off.height = 0;
      page.cleanup();
    } catch (err) {
      if (err?.name === 'RenderingCancelledException' || token !== renderToken) return;
      setStatus('Não foi possível mostrar esta página do PDF.', true);
    }
  }

  function goTo(index) {
    if (!source) return;
    const next = clamp(index, 0, source.count - 1);
    if (next === current) return;
    current = next;
    if (selected && selected.page !== current) selected = null;
    renderPage();
  }
  prevBtn.addEventListener('click', () => goTo(current - 1), { signal });
  nextBtn.addEventListener('click', () => goTo(current + 1), { signal });

  // Mudou a largura disponível (janela, coluna): renderiza a página de novo no tamanho certo.
  let lastViewWidth = 0, resizeTimer = 0;
  const viewObserver = new ResizeObserver(() => {
    const width = view.clientWidth;
    if (!source || !width || Math.abs(width - lastViewWidth) < 2) return;
    lastViewWidth = width;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderPage, 150);
  });
  viewObserver.observe(view);

  /* ── Miniaturas ── */

  function buildThumbs() {
    const buttons = Array.from({ length: source.count }, (_, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sign-thumb';
      button.dataset.index = String(i);
      button.setAttribute('aria-label', `Ir para a página ${i + 1}`);
      button.innerHTML = '<span class="sign-thumb-img"><img alt="" draggable="false"></span><span class="sign-thumb-num"></span>';
      button.querySelector('.sign-thumb-num').textContent = String(i + 1);
      return button;
    });
    thumbs.replaceChildren(...buttons);
    thumbs.hidden = source.count < 2;
  }
  function markActiveThumb() {
    const active = thumbs.children[current];
    [...thumbs.children].forEach((button) => {
      const on = button === active;
      button.classList.toggle('active', on);
      if (on) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    // Rola só a faixa (scrollIntoView também rolaria a página inteira).
    if (active) {
      const left = active.offsetLeft - (thumbs.clientWidth - active.offsetWidth) / 2;
      thumbs.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
    }
  }
  function markThumbBadges() {
    const used = new Set(placements.map((p) => p.page));
    [...thumbs.children].forEach((button, i) => button.classList.toggle('has-sign', used.has(i)));
  }
  thumbs.addEventListener('click', (event) => {
    const button = event.target.closest('.sign-thumb');
    if (button) goTo(Number(button.dataset.index));
  }, { signal });

  async function renderThumbs(doc, gen) {
    if (source.count < 2) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (let i = 0; i < doc.numPages; i++) {
      if (gen !== generation || signal.aborted) return;
      try {
        const page = await doc.getPage(i + 1);
        const base = page.getViewport({ scale: 1 });
        if (!sizes[i]) sizes[i] = { W: base.width, H: base.height };
        const viewport = page.getViewport({ scale: (THUMB_PX * dpr) / Math.max(base.width, base.height) });
        const c = document.createElement('canvas');
        c.width = Math.ceil(viewport.width);
        c.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: c.getContext('2d'), viewport, background: '#ffffff', intent: 'print' }).promise;
        const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.8));
        c.width = 0; c.height = 0;
        if (i !== current) page.cleanup();
        if (gen !== generation || !blob) return;
        const url = URL.createObjectURL(blob);
        thumbUrls.push(url);
        const button = thumbs.children[i];
        const img = button?.querySelector('img');
        if (img) { img.onload = () => button.classList.add('loaded'); img.src = url; }
      } catch {
        if (gen !== generation) return;
      }
    }
  }

  /* ── Assinaturas colocadas ── */

  function buildPlacementEl(p) {
    const el = document.createElement('div');
    el.className = 'sign-place';
    el.tabIndex = 0;
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', 'Assinatura. Arraste para mover; com o foco, as setas movem, + e − mudam o tamanho e Delete remove.');
    el.innerHTML = `
      <img alt="" draggable="false">
      <span class="sign-date" aria-hidden="true" hidden></span>
      <button type="button" class="sign-remove" aria-label="Remover esta assinatura">×</button>
      <span class="sign-resize" aria-hidden="true"></span>`;
    el.querySelector('img').src = p.asset.url;
    p.el = el;
    return el;
  }
  function positionEl(p) {
    const style = p.el.style;
    style.left = `${p.x * 100}%`;
    style.top = `${p.y * 100}%`;
    style.width = `${p.w * 100}%`;
    const date = p.el.querySelector('.sign-date');
    date.hidden = !dateBox.checked;
    if (dateBox.checked) {
      const { W } = pageSize(p.page);
      const size = dateSizeFor(p.w * W);
      date.textContent = today();
      date.style.setProperty('--date-size', String(size));
      date.style.setProperty('--date-gap', String(size * 0.35));
      date.style.color = p.asset.color;
    }
    p.el.classList.toggle('selected', p === selected);
  }
  function renderLayer() {
    const visible = placements.filter((p) => p.page === current);
    layer.replaceChildren(...visible.map((p) => {
      if (!p.el) buildPlacementEl(p);
      clampPlacement(p);
      positionEl(p);
      return p.el;
    }));
    markThumbBadges();
    updateButtons();
  }
  function select(p) {
    selected = p;
    placements.forEach((item) => item.el?.classList.toggle('selected', item === p));
    updateButtons();
  }
  const placementOf = (el) => placements.find((p) => p.el === el);

  async function addPlacement(at = null) {
    if (!source || busy) return;
    const page = current;
    const asset = await currentAsset();
    if (!asset || !source || page !== current) return;
    const { W, H } = pageSize(page);
    // Tamanho inicial: 30% da largura, sem passar de 12% da altura (assinaturas muito altas).
    const w = Math.min(0.3, (0.12 * H * asset.ratio) / W);
    const h = (w * W) / asset.ratio / H;
    let x, y;
    if (at) { x = at.x - w / 2; y = at.y - h / 2; }
    else {
      // Botão: canto inferior direito, deslocando a cada nova assinatura para não empilhar.
      const n = placements.filter((p) => p.page === page).length;
      x = 0.9 - w - n * 0.03;
      y = 0.8 - h / 2 - n * 0.05;
    }
    const p = { id: ++seq, page, asset, x, y, w, group: null, el: null };
    placements.push(p);
    selected = p;
    setStatus();
    renderLayer();
    p.el.focus({ preventScroll: true });
  }
  function removePlacement(p) {
    placements = placements.filter((item) => item !== p);
    if (selected === p) selected = null;
    p.el?.remove();
    renderLayer();
  }

  /** Repete a assinatura escolhida em todas as páginas, na mesma posição relativa. */
  function applyToAll() {
    if (!source || busy) return;
    const onPage = placements.filter((p) => p.page === current);
    const base = selected && selected.page === current ? selected : onPage[onPage.length - 1];
    if (!base) { setStatus('Coloque a assinatura nesta página primeiro e depois aplique nas outras.', true); return; }
    base.group ||= base.id;
    for (let i = 0; i < source.count; i++) {
      if (i === base.page) continue;
      // Aplicar de novo atualiza as cópias em vez de duplicar.
      const copy = placements.find((p) => p.page === i && p.group === base.group);
      if (copy) Object.assign(copy, { asset: base.asset, x: base.x, y: base.y, w: base.w });
      else placements.push({ id: ++seq, page: i, asset: base.asset, x: base.x, y: base.y, w: base.w, group: base.group, el: null });
      if (copy?.el) copy.el.querySelector('img').src = base.asset.url;
    }
    renderLayer();
    setStatus(`Assinatura aplicada nas ${source.count} páginas, na mesma posição.`);
  }

  addBtn.addEventListener('click', () => addPlacement(), { signal });
  allBtn.addEventListener('click', applyToAll, { signal });
  dateBox.addEventListener('change', () => renderLayer(), { signal });
  field('signDateSample').textContent = `(${today()})`;

  // Clique na página vazia: coloca a assinatura centrada no ponto clicado.
  layer.addEventListener('click', (event) => {
    if (!source || busy) return;
    const remove = event.target.closest('.sign-remove');
    if (remove) { const p = placementOf(remove.closest('.sign-place')); if (p) removePlacement(p); return; }
    if (event.target.closest('.sign-place')) return;
    const rect = layer.getBoundingClientRect();
    addPlacement({ x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height });
  }, { signal });

  layer.addEventListener('focusin', (event) => {
    const p = placementOf(event.target.closest?.('.sign-place'));
    if (p && p !== selected) select(p);
  }, { signal });

  layer.addEventListener('keydown', (event) => {
    const el = event.target.closest?.('.sign-place');
    const p = el && event.target === el ? placementOf(el) : null;
    if (!p) return;
    const step = event.shiftKey ? 0.05 : 0.01;
    switch (event.key) {
      case 'ArrowLeft': p.x -= step; break;
      case 'ArrowRight': p.x += step; break;
      case 'ArrowUp': p.y -= step; break;
      case 'ArrowDown': p.y += step; break;
      case '+': case '=': p.w *= 1.08; break;
      case '-': case '_': p.w = Math.max(MIN_W, p.w / 1.08); break;
      case 'Delete': case 'Backspace': removePlacement(p); addBtn.focus(); event.preventDefault(); return;
      default: return;
    }
    event.preventDefault();
    clampPlacement(p);
    positionEl(p);
  }, { signal });

  /* ── Arrastar e redimensionar (Pointer Events: mouse, caneta e toque) ── */

  let gesture = null; // { pointerId, p, kind, startX, startY, x0, y0, w0, rect }

  layer.addEventListener('pointerdown', (event) => {
    const el = event.target.closest('.sign-place');
    if (!el || gesture || busy || event.target.closest('.sign-remove')) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const p = placementOf(el);
    if (!p) return;
    event.preventDefault();
    select(p);
    el.focus({ preventScroll: true });
    gesture = {
      pointerId: event.pointerId, p, kind: event.target.closest('.sign-resize') ? 'resize' : 'move',
      startX: event.clientX, startY: event.clientY, x0: p.x, y0: p.y, w0: p.w, rect: layer.getBoundingClientRect(),
    };
    try { el.setPointerCapture(event.pointerId); } catch { /* segue sem captura */ }
    el.classList.add('dragging');
  }, { signal });

  layer.addEventListener('pointermove', (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const { p, rect } = gesture;
    const dx = (event.clientX - gesture.startX) / rect.width;
    const dy = (event.clientY - gesture.startY) / rect.height;
    if (gesture.kind === 'move') {
      p.x = gesture.x0 + dx;
      p.y = gesture.y0 + dy;
    } else {
      // Alça do canto: mantém a proporção seguindo o maior deslocamento (horizontal ou vertical).
      const { W, H } = pageSize(p.page);
      const dyAsWidth = (dy * H * p.asset.ratio) / W;
      const grow = Math.abs(dx) >= Math.abs(dyAsWidth) ? dx : dyAsWidth;
      // O canto superior esquerdo fica parado: o limite é a borda direita/inferior.
      const extra = dateBox.checked ? (dateSizeFor((gesture.w0 + grow) * W) * 1.4) / H : 0;
      const maxW = Math.min(1 - p.x, ((1 - p.y - extra) * H * p.asset.ratio) / W);
      p.w = clamp(gesture.w0 + grow, MIN_W, Math.max(MIN_W, maxW));
    }
    clampPlacement(p);
    positionEl(p);
  }, { signal });

  function endGesture(event) {
    if (!gesture || (event && event.pointerId !== gesture.pointerId)) return;
    gesture.p.el?.classList.remove('dragging');
    try { gesture.p.el?.releasePointerCapture(gesture.pointerId); } catch { /* já solto */ }
    gesture = null;
  }
  layer.addEventListener('pointerup', endGesture, { signal });
  layer.addEventListener('pointercancel', endGesture, { signal });

  /* ── Botões e estado ── */

  function updateButtons() {
    const ready = !!source && !busy;
    addBtn.disabled = !ready;
    allBtn.disabled = !ready || source.count < 2 || !placements.some((p) => p.page === current);
    downloadBtn.disabled = !ready || !placements.length;
    downloadBtn.textContent = busy ? 'Montando PDF…' : 'Baixar PDF assinado';
    clearBtn.disabled = (!source && !loading) || busy;
    fileInput.disabled = busy;
    prevBtn.disabled = !source || current <= 0;
    nextBtn.disabled = !source || current >= source.count - 1;
  }

  clearBtn.addEventListener('click', () => { if (!busy) clear(); }, { signal });
  downloadBtn.addEventListener('click', exportPdf, { signal });

  function revokeAll() {
    thumbUrls.forEach((url) => URL.revokeObjectURL(url));
    thumbUrls = [];
    assets.forEach((asset) => URL.revokeObjectURL(asset.url));
    assets = [];
    cached = null;
  }

  async function clear(resetStatus = true) {
    generation++;
    renderToken++;
    try { renderTask?.cancel(); } catch { /* já terminou */ }
    renderTask = null;
    endGesture();
    const doc = source?.doc;
    source = null;
    if (doc) { try { await doc.destroy(); } catch { /* já liberado */ } }
    placements = []; selected = null; sizes = []; current = 0; loading = false;
    revokeAll();
    layer.replaceChildren();
    thumbs.replaceChildren();
    canvas.width = 1; canvas.height = 1;
    stage.hidden = true;
    field('signFileName').textContent = '';
    if (resetStatus) setStatus();
    updateButtons();
  }

  async function exportPdf() {
    if (!source || busy) return;
    if (!placements.length) { setStatus('Coloque a assinatura em pelo menos uma página antes de baixar.', true); return; }
    busy = true;
    endGesture();
    updateButtons();
    setStatus('Montando o PDF assinado…');
    try {
      const doc = await PDFLib.PDFDocument.load(source.data, { ignoreEncryption: false });
      const pages = doc.getPages();
      const withDate = dateBox.checked;
      const font = withDate ? await doc.embedFont(PDFLib.StandardFonts.Helvetica) : null;
      const dateText = today();
      const embedded = new Map();
      const items = placements.slice(); // a lista pode mudar durante as esperas abaixo
      for (const p of items) {
        const page = pages[p.page];
        if (!page) continue;
        let image = embedded.get(p.asset);
        if (!image) {
          image = await doc.embedPng(await assetBytes(p.asset));
          embedded.set(p.asset, image);
        }
        // Mesmas frações da prévia, convertidas para pontos na área visível (CropBox) da página.
        const frame = pageFrame(page);
        const { width: W, height: H } = frame;
        const g = geometry(p, W, H);
        const vx = g.left, vy = H - g.top - g.h; // canto inferior esquerdo, como o leitor mostra
        const rotate = PDFLib.degrees(frame.rotation);
        const point = toPagePoint(frame, vx, vy);
        page.drawImage(image, { x: point.x, y: point.y, width: g.w, height: g.h, rotate });
        if (font) {
          const textWidth = font.widthOfTextAtSize(dateText, g.size);
          const tx = clamp(vx, 0, Math.max(0, W - textWidth));
          const ty = vy - g.gap - g.size * CAP_HEIGHT; // linha de base logo abaixo da assinatura
          const at = toPagePoint(frame, tx, ty);
          page.drawText(dateText, { x: at.x, y: at.y, size: g.size, font, color: PDFLib.rgb(...hexToRgb(p.asset.color)), rotate });
        }
      }
      const bytes = await doc.save({ useObjectStreams: true });
      if (signal.aborted || !source) return;
      triggerDownload(new Blob([bytes], { type: 'application/pdf' }), `${KompresPDF.safeBase(source.name)}-assinado-kompres.pdf`);
      const pageCount = new Set(items.map((p) => p.page)).size;
      setStatus(`PDF assinado pronto: ${plural(items.length, 'assinatura', 'assinaturas')} em ${plural(pageCount, 'página', 'páginas')}. O download começou.`);
    } catch (err) {
      setStatus(/encrypt/i.test(err?.message || '')
        ? 'Este PDF está protegido por senha. Remova a senha antes de assinar.'
        : 'Não foi possível montar o PDF assinado. Tente novamente com outro arquivo.', true);
    } finally {
      busy = false;
      updateButtons();
    }
  }

  // Estado inicial: quadro de desenho visível e dimensionado.
  setMode('draw');
  updateButtons();

  // Ao sair da página: cancela renderizações, libera o PDF, as imagens e os observadores.
  signal.addEventListener('abort', () => {
    generation++;
    renderToken++;
    try { renderTask?.cancel(); } catch { /* já terminou */ }
    endGesture();
    clearTimeout(resizeTimer);
    if (padFrame) cancelAnimationFrame(padFrame);
    padObserver.disconnect();
    viewObserver.disconnect();
    source?.doc?.destroy().catch?.(() => {});
    source = null;
    revokeAll();
    imageSource = null; imageResult = null;
  });
});
