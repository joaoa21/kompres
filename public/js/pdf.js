/* Ferramentas de PDF.
 * Montado a cada exibição da página (src/scripts/app.ts); `document` é restrito à página
 * e `signal` é abortado quando o usuário navega para outra ferramenta. */
kompres.register('pdf', (signal, document) => {
  /* ═══════════════════════════════════════════════
     Kompres PDF — ferramentas locais de PDF
     pdf-lib  → montagem/merge do PDF final
     pdf.js   → leitura, contagem de páginas, thumbs
                e render das páginas na compressão
  ═══════════════════════════════════════════════ */

  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const fileInput   = document.getElementById('fileInput');
  const dropZone    = document.getElementById('dropZone');
  const actionBtn   = document.getElementById('actionBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const clearBtn    = document.getElementById('clearBtn');
  const pdfList     = document.getElementById('pdfList');
  const pdfControls = document.getElementById('pdfControls');
  const dpiSelect   = document.getElementById('dpiSelect');
  const qualityIn   = document.getElementById('pdfQuality');
  const qualityVal  = document.getElementById('pdfQualityVal');
  const statsBar    = document.getElementById('statsBar');

  const statLabels = [1, 2, 3, 4].map((i) => document.getElementById(`statLabel${i}`));
  const statValues = [1, 2, 3, 4].map((i) => document.getElementById(`statValue${i}`));

  // Modo definido pela página (/pdf/, /pdf/comprimir/, ...); trocar de modo é navegar.
  const mode = pdfControls.dataset.mode || 'merge';
  const banks = { pdf: [], single: [], images: [] };
  const SINGLE = ['extract', 'export', 'rotate', 'remove', 'watermark', 'number', 'crop', 'text']; // um PDF por vez
  const bankKey = () => mode === 'images' ? 'images' : SINGLE.includes(mode) ? 'single' : 'pdf';
  let outputs = [];
  let textResult = null; // modo PDF para texto: o texto extraído (string)
  const field = id => document.getElementById(id);
  function setStatus(message = '', error = false) { const el = field('pdfStatus'); el.textContent = message; el.hidden = !message; el.classList.toggle('error', error); }
  const reorderable = () => mode === 'merge' || mode === 'images';
  let items = banks[bankKey()];     // { id, name, size, pages, data, thumbUrl, status, outBlob, outSize }
  let busy = false;
  let uid = 0;
  const rasterizeInput = document.getElementById('allow-rasterize');
  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  document.querySelectorAll('#pdfControls input, #pdfControls select, #allow-rasterize').forEach(el => el.addEventListener('input', () => {
    if (busy) return;
    qualityVal.textContent = `${qualityIn.value}%`;
    field('exportQualityVal').textContent = `${field('exportQuality').value}%`;
    field('exportQualityGroup').classList.toggle('hidden', mode !== 'export' || field('exportFormat').value === 'png');
    field('pageRange').removeAttribute('aria-invalid');
    if (el.id === 'wmPosition') wmPositionChanged();
    if (el.id === 'wmSize' && field('wmPosition').value === 'free') wmFree.w = Number(el.value) / 100;
    syncWatermarkUi();
    invalidateResults(); refresh();
    if (window.updateAllRangeFills) window.updateAllRangeFills();
  }));

  /* ── Marca d'água: tipo (texto/imagem) e imagem escolhida ── */
  let wmType = 'text', wmImage = null; // { bytes, name }
  const wmToggle = field('wmType');
  wmToggle.querySelectorAll('.fmt-btn').forEach(btn => btn.addEventListener('click', () => {
    if (busy || btn.dataset.type === wmType) return;
    wmType = btn.dataset.type;
    field('wmSize').value = wmType === 'image' ? 30 : 50; // imagem costuma ficar melhor menor que texto
    if (field('wmPosition').value === 'free') wmFree.w = Number(field('wmSize').value) / 100;
    syncWatermarkUi(); invalidateResults(); refresh();
    if (window.updateAllRangeFills) window.updateAllRangeFills();
  }));
  function syncWatermarkUi() {
    if (mode !== 'watermark') return;
    wmToggle.querySelectorAll('.fmt-btn').forEach(btn => { const on = btn.dataset.type === wmType; btn.classList.toggle('active', on); btn.setAttribute('aria-pressed', String(on)); });
    field('wmTextGroup').classList.toggle('hidden', wmType !== 'text');
    field('wmColorGroup').classList.toggle('hidden', wmType !== 'text');
    field('wmImageGroup').classList.toggle('hidden', wmType !== 'image');
    field('wmAngleGroup').classList.toggle('hidden', field('wmPosition').value !== 'free'); // ângulo só na posição Livre
    field('wmSizeVal').textContent = `${field('wmSize').value}%`;
    field('wmOpacityVal').textContent = `${field('wmOpacity').value}%`;
    const nameEl = field('wmImageName');
    nameEl.textContent = wmImage ? wmImage.name : 'Nenhuma imagem escolhida.';
    nameEl.classList.toggle('has-file', !!wmImage);
  }
  field('wmImage').addEventListener('change', async () => {
    const input = field('wmImage'), file = input.files[0];
    input.value = ''; // permite escolher o mesmo arquivo de novo
    if (!file || busy) return;
    if (!/^image\/(png|jpeg)$/.test(file.type) && !/\.(png|jpe?g)$/i.test(file.name)) { setStatus("A marca d'água precisa ser uma imagem PNG ou JPG.", true); return; }
    if (file.size > 20 * 1024 * 1024) { setStatus('Imagem muito grande (máximo 20 MB).', true); return; }
    let bytes;
    try { bytes = await file.arrayBuffer(); }
    catch { setStatus('Não foi possível ler a imagem.', true); return; }
    if (signal.aborted) return;
    // Dimensões lidas dos bytes (as mesmas do PDF): servem à prévia e já barram arquivo corrompido.
    const dims = KompresPDF.imageDims(bytes);
    if (!dims) { setStatus('Não foi possível ler esta imagem. Use um PNG ou JPG válido.', true); return; }
    if (wmImage?.url) URL.revokeObjectURL(wmImage.url);
    const type = new Uint8Array(bytes)[0] === 0x89 ? 'image/png' : 'image/jpeg';
    wmImage = { bytes, name: file.name, dims, url: URL.createObjectURL(new Blob([bytes], { type })) };
    invalidateResults(); refresh(); syncWatermarkUi();
  });

  /* ── Marca d'água: prévia da página e posição Livre ──
     A marca aparece sobre a página com a mesma geometria do PDF (KompresPDF.watermarkLayout).
     Arrastar ou redimensionar passa a posição para "Livre": centro em frações da página
     visível (x a partir da esquerda, y a partir do topo) e largura em fração da largura. */
  const wmFree = { x: .5, y: .5, w: .5 };
  let wmLastPosition = field('wmPosition').value;
  const wmStage = field('wmStage'), wmView = field('wmView'), wmPage = field('wmPage'), wmCanvas = field('wmCanvas');
  const wmInk = field('wmInk'), wmInkText = field('wmInkText'), wmInkStr = field('wmInkStr'), wmBaseline = field('wmBaseline'), wmInkImg = field('wmInkImg');
  const wmMark = field('wmMark'), wmNotice = field('wmNotice'), wmPageLabel = field('wmPageLabel'), wmPrev = field('wmPrev'), wmNext = field('wmNext');
  const preview = { item: null, doc: null, page: 0, size: null, gen: 0, token: 0, task: null }; // size: página atual em pontos
  const MIN_W = .05, A4 = { W: 595.28, H: 841.89 };
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  // Muda um <select> por código e avisa o seletor personalizado (selects.js) para redesenhar.
  function setSelect(id, value) { const el = field(id); el.value = value; el.dispatchEvent(new Event('kompres:sync')); }
  function wmSetSizeSlider(w) {
    field('wmSize').value = String(Math.round(w * 100));
    field('wmSizeVal').textContent = `${field('wmSize').value}%`;
    if (window.updateAllRangeFills) window.updateAllRangeFills();
  }
  // Proporção (altura ÷ largura) da marca atual e, no texto, o texto como vai para o PDF.
  function wmMarkInfo() {
    if (wmType === 'image') return wmImage?.dims ? { aspect: wmImage.dims.height / wmImage.dims.width } : null;
    if (!window.PDFLib?.StandardFontEmbedder || !window.KompresPDF) return null;
    const info = KompresPDF.watermarkText(field('wmText').value);
    return info.text ? info : null;
  }
  function wmOptions() {
    const position = field('wmPosition').value, free = position === 'free';
    return { position, size: free ? wmFree.w * 100 : Number(field('wmSize').value), angle: Number(field('wmAngle').value), free: { x: wmFree.x, y: wmFree.y } };
  }
  // Onde a marca está numa posição (centro e largura em frações da página da prévia, ângulo).
  function wmGeometry(position = field('wmPosition').value) {
    if (position === 'free') return { x: wmFree.x, y: wmFree.y, w: wmFree.w, angle: Number(field('wmAngle').value) };
    const size = Number(field('wmSize').value), info = wmMarkInfo(), { W, H } = preview.size || A4;
    if (!info || position === 'tile') return { x: .5, y: .5, w: size / 100, angle: 0 };
    const layout = KompresPDF.watermarkLayout(W, H, { position, size }, info.aspect);
    return { x: layout.spots[0].x / W, y: 1 - layout.spots[0].y / H, w: layout.w / W, angle: layout.angle };
  }
  function wmSetFree(geom) {
    Object.assign(wmFree, { x: clamp(geom.x, 0, 1), y: clamp(geom.y, 0, 1), w: clamp(geom.w, MIN_W, 1) });
    wmSetSizeSlider(wmFree.w);
  }
  // Arrastar ou usar o teclado: a posição vira Livre a partir de onde a marca estava.
  function wmApplyFree(geom) {
    const wasFree = field('wmPosition').value === 'free';
    wmSetFree(geom);
    if (wasFree) return;
    setSelect('wmPosition', 'free');
    setSelect('wmAngle', String(geom.angle));
    wmLastPosition = 'free';
    syncWatermarkUi();
  }
  // Escolher "Livre" no seletor também parte de onde a marca estava, sem pular.
  function wmPositionChanged() {
    const now = field('wmPosition').value;
    if (now === 'free' && wmLastPosition !== 'free') {
      const geom = wmGeometry(wmLastPosition);
      wmSetFree(geom);
      setSelect('wmAngle', String(geom.angle));
    }
    wmLastPosition = now;
  }

  function wmPreviewItem() {
    const item = items[0];
    return mode === 'watermark' && item?.data && (item.status === 'ready' || item.status === 'done') ? item : null;
  }
  // Chamada a cada refresh: mostra o palco com o PDF carregado e reposiciona a marca.
  function updatePreview() {
    if (mode !== 'watermark') return;
    const item = wmPreviewItem();
    if (item !== preview.item) wmOpen(item);
    wmStage.hidden = !item;
    wmUpdateNav();
    if (item) wmLayoutMark();
  }
  function wmClose() {
    preview.gen++; preview.token++;
    try { preview.task?.cancel(); } catch { /* já terminou */ }
    if (preview.doc) preview.doc.destroy().catch(() => {});
    Object.assign(preview, { item: null, doc: null, page: 0, size: null, task: null });
    wmCanvas.width = 1; wmCanvas.height = 1;
    wmEndGesture();
  }
  async function wmOpen(item) {
    wmClose();
    if (!item) return;
    preview.item = item;
    const gen = preview.gen;
    try {
      const doc = await KompresPDF.loadPdf(item.data);
      if (gen !== preview.gen || signal.aborted) { doc.destroy().catch(() => {}); return; }
      preview.doc = doc;
      wmRender();
    } catch {
      if (gen === preview.gen) setStatus('Não foi possível mostrar a prévia deste PDF.', true);
    }
  }
  async function wmRender() {
    const doc = preview.doc;
    if (!doc) return;
    const token = ++preview.token, index = preview.page;
    wmUpdateNav();
    try {
      const page = await doc.getPage(index + 1);
      if (token !== preview.token) return;
      const base = page.getViewport({ scale: 1 }); // já considera /Rotate e a área visível
      const style = getComputedStyle(wmView);
      const avail = wmView.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      if (avail <= 0) return; // palco ainda oculto: o ResizeObserver chama de novo
      wmLastWidth = wmView.clientWidth;
      preview.size = { W: base.width, H: base.height };
      const maxH = Math.max(380, window.innerHeight * .8);
      const cssW = Math.max(120, Math.min(avail, maxH * base.width / base.height, 1000));
      wmPage.style.width = `${cssW}px`;
      wmPage.style.height = `${cssW * base.height / base.width}px`;
      wmLayoutMark();
      // Renderiza fora da tela e copia no fim: a página anterior fica visível até a nova ficar pronta.
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const viewport = page.getViewport({ scale: (cssW * dpr) / base.width });
      const off = document.createElement('canvas');
      off.width = Math.ceil(viewport.width);
      off.height = Math.ceil(viewport.height);
      try { preview.task?.cancel(); } catch { /* já terminou */ }
      // 'print': sem requestAnimationFrame, não trava com a aba em segundo plano.
      const task = page.render({ canvasContext: off.getContext('2d'), viewport, background: '#ffffff', intent: 'print' });
      preview.task = task;
      await task.promise;
      if (token !== preview.token) return;
      wmCanvas.width = off.width;
      wmCanvas.height = off.height;
      wmCanvas.getContext('2d').drawImage(off, 0, 0);
      off.width = 0; off.height = 0;
      page.cleanup();
    } catch (err) {
      if (err?.name === 'RenderingCancelledException' || token !== preview.token) return;
      setStatus('Não foi possível mostrar esta página do PDF.', true);
    }
  }
  function wmPageInRange() {
    const total = preview.item?.pages;
    if (!total) return true;
    try { return KompresPDF.parsePages(field('pageRange').value, total).includes(preview.page); }
    catch { return true; } // campo inválido: o erro aparece ao aplicar
  }
  function wmLayoutMark() {
    let notice = '';
    const info = wmMarkInfo(), position = field('wmPosition').value;
    if (!preview.size) { /* página ainda carregando: nada a avisar */ }
    else if (!wmPageInRange()) notice = 'Esta página fica sem marca: ela não está no campo Páginas.';
    else if (position === 'tile') notice = 'O mosaico cobre a página inteira. Para arrastar a marca, escolha outra posição.';
    else if (!info) notice = wmType === 'image' ? "Escolha a imagem da marca d'água para vê-la na página." : "Digite o texto da marca d'água para vê-lo na página.";
    wmNotice.textContent = notice;
    wmNotice.hidden = !notice;
    const show = !!preview.size && !notice;
    wmInk.hidden = !show;
    wmMark.hidden = !show;
    if (!show) { wmEndGesture(); return; }
    const { W, H } = preview.size;
    const layout = KompresPDF.watermarkLayout(W, H, wmOptions(), info.aspect);
    const center = layout.spots[0];
    // CSS gira no sentido horário com y para baixo; o PDF, no anti-horário com y para cima.
    const box = { left: `${(center.x / W) * 100}%`, top: `${(1 - center.y / H) * 100}%`, width: `${(layout.w / W) * 100}%`, height: `${(layout.h / H) * 100}%`, transform: `translate(-50%, -50%) rotate(${-layout.angle}deg)` };
    Object.assign(wmInk.style, box);
    Object.assign(wmMark.style, box);
    wmInk.style.opacity = String(clamp(Number(field('wmOpacity').value) / 100, .02, 1));
    if (wmType === 'image') {
      wmInkText.hidden = true;
      wmInkImg.hidden = false;
      if (wmInkImg.getAttribute('src') !== wmImage.url) wmInkImg.src = wmImage.url;
    } else {
      wmInkImg.hidden = true;
      wmInkText.hidden = false;
      const pt = wmPage.clientWidth / W; // px CSS por ponto do PDF
      const rgb = KompresPDF.WATERMARK_COLORS[field('wmColor').value] || KompresPDF.WATERMARK_COLORS.gray;
      wmInkStr.textContent = info.text;
      wmInkText.style.fontSize = `${(layout.w / info.unitWidth) * pt}px`; // mesmo corpo da Helvetica Bold do PDF
      wmInkText.style.color = `rgb(${rgb.map(c => Math.round(c * 255)).join(', ')})`;
      // A caixa vai da linha de base até a altura das maiúsculas, como no PDF: o marcador de altura
      // zero mostra onde está a linha de base, e ela vai para o pé da caixa, com qualquer fonte do sistema.
      wmInkText.style.top = `${layout.h * pt - wmBaseline.offsetTop}px`;
    }
  }
  function wmUpdateNav() {
    const count = preview.item?.pages || 1;
    wmPageLabel.textContent = `Página ${preview.page + 1} de ${count}`;
    wmPrev.disabled = preview.page <= 0;
    wmNext.disabled = preview.page >= count - 1;
  }
  function wmGoTo(index) {
    if (!preview.doc) return;
    const next = clamp(index, 0, (preview.item?.pages || 1) - 1);
    if (next === preview.page) return;
    preview.page = next;
    wmRender();
  }
  wmPrev.addEventListener('click', () => wmGoTo(preview.page - 1), { signal });
  wmNext.addEventListener('click', () => wmGoTo(preview.page + 1), { signal });

  // Arrastar move o centro; a alça do canto muda o tamanho (Pointer Events: mouse, caneta e toque).
  let wmGesture = null; // { id, resize, startX, startY, geom, rect, cx, cy, d0, moved }
  wmMark.addEventListener('pointerdown', (event) => {
    if (busy || wmGesture || !preview.size || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    wmMark.focus({ preventScroll: true });
    const rect = wmPage.getBoundingClientRect(), geom = wmGeometry();
    const cx = rect.left + geom.x * rect.width, cy = rect.top + geom.y * rect.height;
    wmGesture = {
      id: event.pointerId, resize: !!event.target.closest('.wm-resize'), startX: event.clientX, startY: event.clientY,
      geom, rect, cx, cy, d0: Math.max(6, Math.hypot(event.clientX - cx, event.clientY - cy)), moved: false,
    };
    try { wmMark.setPointerCapture(event.pointerId); } catch { /* segue sem captura */ }
    wmMark.classList.add('dragging');
  }, { signal });
  wmMark.addEventListener('pointermove', (event) => {
    const g = wmGesture;
    if (!g || event.pointerId !== g.id) return;
    const dx = event.clientX - g.startX, dy = event.clientY - g.startY;
    if (!g.moved) {
      if (Math.hypot(dx, dy) < 3) return; // clique sem arrastar não muda a posição
      g.moved = true;
      wmApplyFree(g.geom);
      invalidateResults(); refresh();
    }
    if (g.resize) {
      // Escala pela distância até o centro, que fica parado: mantém a proporção com qualquer ângulo.
      wmFree.w = clamp(g.geom.w * Math.hypot(event.clientX - g.cx, event.clientY - g.cy) / g.d0, MIN_W, 1);
      wmSetSizeSlider(wmFree.w);
    } else {
      wmFree.x = clamp(g.geom.x + dx / g.rect.width, 0, 1);
      wmFree.y = clamp(g.geom.y + dy / g.rect.height, 0, 1);
    }
    wmLayoutMark();
  }, { signal });
  function wmEndGesture(event) {
    const g = wmGesture;
    if (!g || (event && event.pointerId !== g.id)) return;
    wmGesture = null;
    wmMark.classList.remove('dragging');
    try { wmMark.releasePointerCapture(g.id); } catch { /* já solto */ }
  }
  wmMark.addEventListener('pointerup', wmEndGesture, { signal });
  wmMark.addEventListener('pointercancel', wmEndGesture, { signal });

  // Teclado: setas movem (Shift: passo maior), + e − mudam o tamanho.
  wmMark.addEventListener('keydown', (event) => {
    if (busy || event.target !== wmMark) return;
    const step = event.shiftKey ? .05 : .01, geom = wmGeometry();
    switch (event.key) {
      case 'ArrowLeft': geom.x -= step; break;
      case 'ArrowRight': geom.x += step; break;
      case 'ArrowUp': geom.y -= step; break;
      case 'ArrowDown': geom.y += step; break;
      case '+': case '=': geom.w *= 1.08; break;
      case '-': case '_': geom.w /= 1.08; break;
      default: return;
    }
    event.preventDefault();
    wmApplyFree(geom);
    invalidateResults(); refresh();
  }, { signal });

  // Mudou a largura disponível (janela, coluna): renderiza a página de novo no tamanho certo.
  let wmLastWidth = 0, wmResizeTimer = 0;
  const wmObserver = new ResizeObserver(() => {
    const width = wmView.clientWidth;
    if (!preview.doc || !width || Math.abs(width - wmLastWidth) < 2) return;
    wmLastWidth = width;
    clearTimeout(wmResizeTimer);
    wmResizeTimer = setTimeout(wmRender, 150);
  });
  if (mode === 'watermark') wmObserver.observe(wmView);
  signal.addEventListener('abort', () => {
    wmClose();
    wmObserver.disconnect();
    clearTimeout(wmResizeTimer);
    if (wmImage?.url) URL.revokeObjectURL(wmImage.url);
  });

  // Lê as quatro margens do recorte; devolve { margins } ou { error, el } para focar o campo errado.
  function cropMargins() {
    const margins = {};
    for (const [side, id] of [['top', 'cropTop'], ['right', 'cropRight'], ['bottom', 'cropBottom'], ['left', 'cropLeft']]) {
      const el = field(id);
      const value = el.value.trim() === '' ? 0 : Number(el.value.replace(',', '.'));
      if (el.validity.badInput || !Number.isFinite(value) || value < 0 || value > 1000) return { error: 'Use margens de 0 a 1000 mm, só com números.', el };
      margins[side] = value;
    }
    if (!Object.values(margins).some(value => value > 0)) return { error: 'Informe pelo menos uma margem maior que zero.', el: field('cropTop') };
    return { margins };
  }
  // Validações dos campos de cada modo antes de processar.
  function validateOptions() {
    if (mode === 'watermark') {
      if (wmType === 'text' && !field('wmText').value.trim()) return { error: "Digite o texto da marca d'água.", el: field('wmText') };
      if (wmType === 'image' && !wmImage) return { error: "Escolha a imagem da marca d'água (PNG ou JPG).", el: field('wmImage') };
    }
    if (mode === 'number') {
      const el = field('numberStart'), start = Number(el.value);
      if (el.validity.badInput || el.value.trim() === '' || !Number.isInteger(start) || start < 0 || start > 999999) return { error: 'O número inicial precisa ser um inteiro entre 0 e 999999.', el };
    }
    if (mode === 'crop') { const read = cropMargins(); if (read.error) return read; }
    return null;
  }
  function refresh() { renderList(); renderOutputs(); renderText(); updateStats(); updateButtons(); updateRangePlaceholder(); updatePreview(); }
  function renderOutputs() {
    const root = field('pdfOutputs'); root.replaceChildren(); root.hidden = !outputs.length;
    outputs.forEach(output => {
      const row = document.createElement('div'); row.className = 'pdf-output';
      const info = document.createElement('div'); const name = document.createElement('strong'); name.textContent = output.name;
      const size = document.createElement('small'); size.textContent = formatBytes(output.blob.size); info.append(name, size);
      const btn = document.createElement('button'); btn.className = 'btn btn-outline'; btn.textContent = '↓ Baixar'; btn.disabled = busy;
      btn.addEventListener('click', () => triggerDownload(output.blob, output.name)); row.append(info, btn); root.append(row);
    });
  }

  /* ── PDF para texto: área de resultado, copiar e baixar ── */
  const textArea = field('pdfText');
  function renderText() {
    if (mode !== 'text') return;
    field('pdfTextResult').hidden = !textResult;
    // Só reescreve quando muda: assim a rolagem e a seleção do usuário não se perdem.
    if (textArea.value !== (textResult || '')) textArea.value = textResult || '';
    field('textCopy').disabled = busy || !textResult;
    field('textDownload').disabled = busy || !textResult;
  }
  field('textCopy').addEventListener('click', async () => {
    if (!textResult || busy) return;
    let copied = false;
    try { await navigator.clipboard.writeText(textResult); copied = true; }
    catch {
      // Sem a API de área de transferência (ou sem permissão): seleciona e usa o comando antigo.
      textArea.focus(); textArea.select();
      try { copied = window.document.execCommand('copy'); } catch { copied = false; }
    }
    setStatus(copied ? 'Texto copiado.' : 'Não foi possível copiar. Selecione o texto e use Ctrl+C.', !copied);
  });
  field('textDownload').addEventListener('click', () => {
    if (!textResult || busy || !items[0]) return;
    // BOM + quebras CRLF: o Bloco de Notas abre com acentos e linhas certos.
    const blob = new Blob(['\uFEFF' + textResult.replace(/\r?\n/g, '\r\n')], { type: 'text/plain;charset=utf-8' });
    triggerDownload(blob, `${KompresPDF.safeBase(items[0].name)}-texto-kompres.txt`);
  });
  // Trocar "Separar páginas" refaz a extração na hora (é rápida e não muda o arquivo).
  field('textSeparate').addEventListener('change', () => { if (mode === 'text' && !busy && items[0]?.status === 'ready') runAction(); });
  field('pageRange').addEventListener('keydown', event => { if (mode === 'text' && event.key === 'Enter') { event.preventDefault(); runAction(); } });

  /* ── Câmera (celular): cada foto entra como mais uma página no modo Imagens → PDF ── */
  const cameraInput = field('cameraInput');
  field('cameraBtn').addEventListener('click', () => { if (!busy) cameraInput.click(); });
  cameraInput.addEventListener('change', async () => {
    const files = [...cameraInput.files];
    cameraInput.value = ''; // permite tirar outra foto em seguida
    await handleFiles(files);
  });

  /* ── Helpers ── */

  function formatBytes(bytes) {
    if (!bytes && bytes !== 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function baseName(name) {
    return name.replace(/\.pdf$/i, '');
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  /* ── Entrada de arquivos ── */

  fileInput.addEventListener('change', async (event) => {
    await handleFiles([...event.target.files]);
    fileInput.value = '';
  });

  kompres.fileDrop({ signal, document, zone: dropZone, onFiles: handleFiles });

  async function handleFiles(files) {
    if (!files.length) return;
    const imageMode = mode === 'images';
    const single = bankKey() === 'single';
    if (busy) return;
    if (single && files.length > 1) { setStatus('Selecione um PDF por vez.', true); return; }
    const isImage = file => /^image\/(png|jpeg)$/.test(file.type) || /\.(png|jpe?g)$/i.test(file.name);
    const valid = files.filter(file => imageMode ? isImage(file) : /\.pdf$/i.test(file.name) || file.type === 'application/pdf');
    if (valid.length !== files.length) { setStatus(imageMode ? 'Selecione apenas imagens JPG ou PNG.' : 'Selecione apenas arquivos PDF.', true); return; }
    if (single) { items.length = 0; field('pageRange').value = ''; }
    invalidateResults(); busy = true;
    try {
      for (const file of valid) {
        const item = { id: `pdf-${uid++}`, name: file.name, size: file.size, file, status: 'loading', pages: null };
        items.push(item); setStatus('Lendo arquivos…'); refresh();
        try {
          if (imageMode) { Object.assign(item, await KompresPDF.imageInfo(file)); item.pages = 1; }
          else {
            item.data = await file.arrayBuffer();
            const doc = await KompresPDF.loadPdf(item.data);
            try { item.pages = doc.numPages; item.thumbUrl = await renderThumb(doc); }
            finally { await doc.destroy(); }
          }
          item.status = 'ready';
        } catch (err) {
          item.status = 'error';
          item.error = err.name === 'PasswordException' ? 'PDF protegido por senha' : imageMode ? 'Não foi possível ler esta imagem' : 'Não foi possível ler este PDF';
        }
      }
      setStatus();
    } finally { busy = false; refresh(); }
    if (mode === 'text' && items[0]?.status === 'ready') runAction(); // extrai assim que o PDF chega
  }

  async function renderThumb(doc) {
    try {
      const page = await doc.getPage(1);
      const vp = page.getViewport({ scale: 1 });
      const scale = 84 / vp.width; // thumb pequena, 2x da largura exibida (42px)
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise; // 'print': sem requestAnimationFrame, não trava em aba oculta
      return canvas.toDataURL('image/jpeg', 0.7);
    } catch {
      return null;
    }
  }

  /* ── Modo ── */

  function applyMode() {
    document.querySelectorAll('.compress-only').forEach(el => el.classList.toggle('hidden', mode !== 'compress'));
    document.querySelectorAll('[data-for]').forEach(el => el.classList.toggle('hidden', !el.dataset.for.split(' ').includes(mode)));
    field('exportQualityGroup').classList.toggle('hidden', mode !== 'export' || field('exportFormat').value === 'png');
    const titles = { merge: 'Juntar PDFs', compress: 'Comprimir PDFs', images: 'Imagens para PDF', extract: 'Extrair ou dividir PDF', remove: 'Remover páginas do PDF', rotate: 'Girar páginas do PDF', export: 'PDF para imagens', watermark: "Marca d'água no PDF", number: 'Numerar páginas do PDF', crop: 'Recortar margens do PDF', text: 'PDF para texto' };
    const descriptions = { merge: 'Adicione os PDFs e organize a ordem.', compress: 'Adicione seus PDFs e escolha a compressão.', images: 'Adicione as imagens e organize a ordem das páginas.', extract: 'Escolha as páginas que deseja salvar.', remove: 'Informe as páginas que devem sair do arquivo.', rotate: 'Escolha o ângulo e, se quiser, só algumas páginas.', export: 'Transforme as páginas do PDF em JPG ou PNG.', watermark: 'Escolha texto ou imagem e a posição, ou arraste a marca na prévia.', number: 'Escolha posição, formato e número inicial.', crop: 'Informe quanto cortar de cada margem.', text: 'Copie ou baixe o texto do PDF em .txt.' };
    field('toolTitle').textContent = titles[mode]; field('toolDescription').textContent = descriptions[mode];
    const hints = { remove: 'Separe por vírgula e use hífen para intervalos: 2, 5-7.', number: 'Deixe vazio para numerar todas. Páginas fora da lista ficam sem número, mas contam na sequência.', watermark: 'Deixe vazio para marcar todas as páginas.', crop: 'Deixe vazio para recortar todas as páginas.', text: 'Deixe vazio para extrair o texto de todas as páginas.' };
    field('rangeHint').textContent = hints[mode] || 'Deixe vazio para todas as páginas.';
    syncWatermarkUi();
    updateRangePlaceholder();
    const imageMode = mode === 'images', single = bankKey() === 'single';
    fileInput.accept = imageMode ? 'image/jpeg,image/png,.jpg,.jpeg,.png' : 'application/pdf,.pdf'; fileInput.multiple = !single;
    fileInput.setAttribute('aria-label', imageMode ? 'Selecionar imagens JPG ou PNG' : 'Selecionar arquivos PDF');
    downloadBtn.classList.toggle('hidden', mode === 'text'); // no modo texto, os botões ficam junto do resultado
    field('dropText').innerHTML = `<strong>${imageMode ? 'Arraste as imagens aqui' : single ? 'Arraste um PDF aqui' : 'Arraste os PDFs aqui'}</strong><br>ou clique para selecionar · ${imageMode ? 'JPG, PNG' : 'PDF'}`;
    invalidateResults(); refresh();
    if (window.updateAllRangeFills) window.updateAllRangeFills();
  }

  qualityIn.addEventListener('input', () => {
    qualityVal.textContent = `${qualityIn.value}%`;
    if (window.updateAllRangeFills) window.updateAllRangeFills();
  });

  // O campo de páginas mostra o total do PDF carregado: "Todas (1-12)".
  function updateRangePlaceholder() {
    const pages = SINGLE.includes(mode) ? items[0]?.pages : null;
    field('pageRange').placeholder = mode === 'remove' ? (pages ? `Ex.: 2, 5-7 (o PDF tem ${pages})` : 'Ex.: 2, 5-7') : pages ? `Todas (1-${pages})` : 'Todas ou 1-3, 7';
  }

  function invalidateResults() {
    outputs = []; textResult = null; setStatus();
    items.forEach((item) => {
      if (item.status === 'done' || item.status === 'working') item.status = 'ready';
      item.outBlob = null;
      item.outSize = null;
    });
  }

  /* ── Lista + reordenação ── */

  function renderList() {
    pdfList.innerHTML = '';

    items.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = `pdf-row ${item.status}`;
      row.dataset.id = item.id;
      row.draggable = reorderable() && !busy;

      const meta = item.status === 'loading'
        ? 'lendo arquivo…'
        : item.status === 'error'
          ? item.error
          : `${mode === 'images' ? `${item.width} × ${item.height} px` : `${item.pages} ${item.pages === 1 ? 'página' : 'páginas'}`} · ${formatBytes(item.size)}`;

      const thumb = item.thumbUrl
        ? `<img class="pdf-thumb" src="${item.thumbUrl}" alt="">`
        : '<span class="pdf-thumb pdf-thumb-empty">PDF</span>';

      let result = '';
      if (mode === 'compress' && item.status === 'done') {
        const saved = Math.round((1 - item.outSize / item.size) * 100);
        if (item.method === 'original' || saved <= 0) {
          result = `<div class="pdf-result"><small class="pdf-nogain">PDF já otimizado — mantido o original</small></div>`;
        } else {
          const tag = (item.method === 'lossless' || item.method === 'images')
            ? '<small class="pdf-nogain">texto preservado</small>'
            : '';
          result = `<div class="pdf-result">
               <span class="size-original">${formatBytes(item.size)}</span>
               <span class="size-arrow">→</span>
               <span class="size-new">${formatBytes(item.outSize)}</span>
               <span class="pdf-badge">−${saved}%</span>
               ${tag}
             </div>`;
        }
      }
      if (mode === 'compress' && item.status === 'working') {
        result = `<div class="pdf-result pdf-progress-wrap">
                    <div class="progress-bar"><div class="progress-fill" id="prog-${item.id}"></div></div>
                  </div>`;
      }

      const mergeControls = reorderable() && item.status !== 'error'
        ? `<span class="pdf-drag" title="Arraste para reordenar" aria-hidden="true">⠿</span>
           <span class="pdf-index">${index + 1}</span>`
        : '';

      const moveBtns = reorderable()
        ? `<button class="row-btn" data-act="up" title="Mover para cima" ${index === 0 ? 'disabled' : ''}>↑</button>
           <button class="row-btn" data-act="down" title="Mover para baixo" ${index === items.length - 1 ? 'disabled' : ''}>↓</button>`
        : '';

      const dlBtn = mode === 'compress' && item.status === 'done'
        ? `<button class="row-btn row-btn-dl" data-act="download" title="Baixar este PDF">↓</button>`
        : '';

      row.innerHTML = `
        ${mergeControls}
        ${thumb}
        <div class="pdf-info">
          <strong title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</strong>
          <small>${meta}</small>
        </div>
        ${result}
        <div class="pdf-actions">
          ${moveBtns}
          ${dlBtn}
          <button class="row-btn row-btn-x" data-act="remove" title="Remover">×</button>
        </div>
      `;

      row.querySelectorAll('.row-btn').forEach((btn) => {
        btn.addEventListener('click', () => rowAction(btn.dataset.act, item.id));
      });

      if (busy) row.querySelectorAll('button').forEach(btn => btn.disabled = true);
      if (reorderable()) attachDrag(row);

      pdfList.appendChild(row);
    });
  }

  function rowAction(act, id) {
    if (busy) return;
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) return;

    if (act === 'remove') {
      items.splice(index, 1);
      invalidateResults();
    }
    if (act === 'up' && index > 0) {
      [items[index - 1], items[index]] = [items[index], items[index - 1]];
      invalidateResults();
    }
    if (act === 'down' && index < items.length - 1) {
      [items[index + 1], items[index]] = [items[index], items[index + 1]];
      invalidateResults();
    }
    if (act === 'download') {
      const item = items[index];
      if (item.outBlob) triggerDownload(item.outBlob, `${baseName(item.name)}-kompres.pdf`);
      return;
    }

    refresh();
  }

  /* Drag & drop nas linhas (só no modo Juntar) */
  let dragId = null;

  function attachDrag(row) {
    row.addEventListener('dragstart', (event) => {
      dragId = row.dataset.id;
      row.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
    });

    row.addEventListener('dragend', () => {
      dragId = null;
      row.classList.remove('dragging');
      pdfList.querySelectorAll('.pdf-row').forEach((r) => r.classList.remove('drag-target'));
    });

    row.addEventListener('dragover', (event) => {
      if (busy || !dragId || dragId === row.dataset.id) return;
      event.preventDefault();
      row.classList.add('drag-target');
    });

    row.addEventListener('dragleave', () => row.classList.remove('drag-target'));

    row.addEventListener('drop', (event) => {
      event.preventDefault();
      row.classList.remove('drag-target');
      if (busy || !dragId || dragId === row.dataset.id) return;

      const from = items.findIndex((item) => item.id === dragId);
      const to = items.findIndex((item) => item.id === row.dataset.id);
      if (from < 0 || to < 0) return;

      const [moved] = items.splice(from, 1);
      items.splice(to, 0, moved);
      invalidateResults();

      refresh();
    });
  }

  /* ── Stats e botões ── */

  function updateStats() {
    const ready = items.filter((item) => item.status !== 'error' && item.status !== 'loading');
    statsBar.hidden = items.length === 0;

    if (mode !== 'compress') {
      const labels = ['Arquivos', 'Páginas', 'Tamanho total', 'Resultado'];
      statLabels.forEach((el, i) => { el.textContent = labels[i]; });

      const pages = ready.reduce((sum, item) => sum + (item.pages || 0), 0);
      const size = ready.reduce((sum, item) => sum + item.size, 0);
      statValues[0].textContent = ready.length;
      statValues[1].textContent = pages || '—';
      statValues[2].textContent = size ? formatBytes(size) : '—';
      statValues[3].textContent = outputs.length ? formatBytes(outputs.reduce((sum, output) => sum + output.blob.size, 0)) : '—';
      if (mode === 'text') { statLabels[3].textContent = 'Caracteres'; statValues[3].textContent = textResult ? textResult.length.toLocaleString('pt-BR') : '—'; }
    } else {
      const labels = ['Arquivos', 'Tamanho original', 'Novo tamanho', 'Economia total'];
      statLabels.forEach((el, i) => { el.textContent = labels[i]; });

      const done = ready.filter((item) => item.status === 'done');
      const original = ready.reduce((sum, item) => sum + item.size, 0);
      const output = done.reduce((sum, item) => sum + item.outSize, 0);
      const originalDone = done.reduce((sum, item) => sum + item.size, 0);
      const saved = originalDone > 0 ? Math.max(0, Math.round((1 - output / originalDone) * 100)) : null;

      statValues[0].textContent = ready.length;
      statValues[1].textContent = original ? formatBytes(original) : '—';
      statValues[2].textContent = done.length ? formatBytes(output) : '—';
      statValues[3].textContent = saved !== null ? `${saved}%` : '—';
    }
  }

  function updateButtons() {
    const ready = items.filter(item => item.status === 'ready' || item.status === 'done');
    document.querySelectorAll('#pdfControls input, #pdfControls select, #pdfControls button, #allow-rasterize, #fileInput, #cameraBtn, #cameraInput').forEach(el => el.disabled = busy);
    const labels = { merge: 'Juntar PDFs', compress: 'Comprimir tudo', images: 'Criar PDF', extract: 'Extrair páginas', remove: 'Remover páginas', rotate: 'Girar páginas', export: 'Converter páginas', watermark: "Aplicar marca d'água", number: 'Numerar páginas', crop: 'Recortar margens', text: 'Extrair texto' };
    actionBtn.textContent = busy ? 'Processando…' : labels[mode];
    actionBtn.disabled = busy || ready.length < (mode === 'merge' ? 2 : 1) || items.some(item => item.status === 'error');
    const files = downloadable();
    downloadBtn.textContent = files.length > 1 ? '↓ Baixar ZIP' : mode === 'export' ? '↓ Baixar imagem' : '↓ Baixar PDF';
    downloadBtn.disabled = busy || !files.length;
    clearBtn.disabled = busy || !items.length;
  }
  function downloadable() {
    return mode === 'compress' ? items.filter(item => item.outBlob).map((item, index) => ({ name: `${index + 1}-${KompresPDF.safeBase(item.name)}-kompres.pdf`, blob: item.outBlob })) : outputs;
  }
  actionBtn.addEventListener('click', runAction);
  downloadBtn.addEventListener('click', async () => {
    if (busy) return;
    const files = downloadable(); if (!files.length) return;
    if (files.length === 1) { triggerDownload(files[0].blob, files[0].name); return; }
    busy = true; setStatus('Preparando ZIP…'); refresh();
    try {
      const zip = new JSZip(); files.forEach(file => zip.file(file.name, file.blob));
      triggerDownload(await zip.generateAsync({ type: 'blob' }), 'kompres-arquivos.zip'); setStatus();
    } catch { setStatus('Não foi possível criar o ZIP. Baixe os arquivos individualmente.', true); }
    finally { busy = false; refresh(); }
  });
  clearBtn.addEventListener('click', () => { if (busy) return; items.length = 0; invalidateResults(); refresh(); });
  async function runAction() {
    if (busy || actionBtn.disabled) return;
    let indices;
    try {
      if (SINGLE.includes(mode)) {
        if (mode === 'remove' && !field('pageRange').value.trim()) throw new Error('Informe as páginas que devem ser removidas.');
        indices = KompresPDF.parsePages(field('pageRange').value, items[0].pages);
      }
    } catch (err) { field('pageRange').setAttribute('aria-invalid', 'true'); setStatus(err.message, true); field('pageRange').focus(); return; }
    const problem = validateOptions();
    if (problem) { setStatus(problem.error, true); problem.el.focus(); return; }
    invalidateResults(); busy = true; refresh();
    const progress = (current, total) => setStatus(`Processando ${current} de ${total}…`);
    try {
      if (!window.PDFLib || !window.KompresPDF) throw new Error('Não foi possível carregar a ferramenta. Recarregue a página.');
      if (mode === 'merge') {
        const out = await PDFLib.PDFDocument.create();
        for (let i = 0; i < items.length; i++) {
          const src = await PDFLib.PDFDocument.load(items[i].data, { ignoreEncryption: false });
          (await out.copyPages(src, src.getPageIndices())).forEach(page => out.addPage(page)); progress(i + 1, items.length);
        }
        outputs = [{ name: 'kompres-unido.pdf', blob: new Blob([await out.save()], { type: 'application/pdf' }) }];
      } else if (mode === 'images') {
        outputs = [{ name: 'kompres-imagens.pdf', blob: await KompresPDF.imagesToPdf(items, { pageSize: field('imagePageSize').value, marginMM: field('imageMargin').value }, progress) }];
      } else if (mode === 'extract') {
        outputs = await KompresPDF.extract(items[0], indices, field('extractOutput').value === 'split', progress);
      } else if (mode === 'remove') {
        outputs = await KompresPDF.removePages(items[0], indices);
      } else if (mode === 'rotate') {
        outputs = await KompresPDF.rotate(items[0], indices, Number(field('rotateAngle').value));
      } else if (mode === 'export') {
        outputs = await KompresPDF.exportImages(items[0], indices, { format: field('exportFormat').value, dpi: Number(field('exportDpi').value), quality: Number(field('exportQuality').value) / 100 }, progress);
      } else if (mode === 'watermark') {
        // wmOptions: posição, tamanho, ângulo e, na posição Livre, o centro em frações (o mesmo da prévia).
        outputs = await KompresPDF.watermark(items[0], indices, { type: wmType, text: field('wmText').value, image: wmImage?.bytes, opacity: Number(field('wmOpacity').value), color: field('wmColor').value, ...wmOptions() });
      } else if (mode === 'number') {
        outputs = await KompresPDF.numberPages(items[0], indices, { position: field('numberPosition').value, format: field('numberFormat').value, start: Number(field('numberStart').value), fontSize: Number(field('numberSize').value) });
      } else if (mode === 'crop') {
        outputs = await KompresPDF.crop(items[0], indices, cropMargins().margins);
      } else if (mode === 'text') {
        textResult = await KompresPDF.extractText(items[0], indices, { separatePages: field('textSeparate').checked }, progress);
      } else {
        for (let i = 0; i < items.length; i++) {
          const item = items[i]; item.status = 'working'; refresh(); progress(i + 1, items.length);
          try {
            const result = await compressSmart(item, Number(dpiSelect.value), Number(qualityIn.value) / 100);
            item.outBlob = result.blob; item.outSize = result.blob.size; item.method = result.method; item.status = 'done';
          } catch { item.status = 'error'; item.error = 'Falha ao comprimir este PDF'; }
        }
      }
      const failed = items.some(item => item.status === 'error');
      setStatus(failed ? 'Alguns arquivos não puderam ser processados.' : '', failed);
    } catch (err) { outputs = []; textResult = null; setStatus(err.message || 'Não foi possível processar o arquivo.', true); }
    finally { busy = false; refresh(); }
  }

  /*
    Estratégia inteligente de compressão:
    1) Passe sem perdas — re-save com object streams (texto continua selecionável).
    2) Recompressão de imagens embutidas — recomprime os JPEGs/bitmaps DENTRO do
       PDF mantendo texto, fontes e vetores intactos. É onde mora a gordura da
       maioria dos PDFs pesados.
    3) Re-render com escalonamento — último recurso; página vira imagem.
    Preferência: resultados que preservam o texto vencem, a menos que o
    re-render seja pelo menos 15% menor.
  */
  async function compressSmart(item, dpi, quality) {
    const candidates = [];

    // 1) sem perdas
    try {
      const src = await PDFLib.PDFDocument.load(item.data, { ignoreEncryption: false });
      const bytes = await src.save({ useObjectStreams: true });
      const blob = new Blob([bytes], { type: 'application/pdf' });
      if (blob.size < item.size) candidates.push({ blob, method: 'lossless' });
    } catch (err) {
      console.warn('Passe sem perdas falhou:', item.name, err);
    }

    // 2) recompressão de imagens embutidas (texto preservado)
    try {
      const blob = await recompressEmbeddedImages(item, dpi, quality);
      if (blob && blob.size < item.size) candidates.push({ blob, method: 'images' });
    } catch (err) {
      console.warn('Recompressão de imagens embutidas falhou:', item.name, err);
    }

    // se já temos ganho bom preservando o texto, nem tenta rasterizar
    const bestTextSafe = candidates.slice().sort((a, b) => a.blob.size - b.blob.size)[0];
    const goodEnough = bestTextSafe && bestTextSafe.blob.size < item.size * 0.6;

    // 3) re-render com fallback progressivo
    if (!goodEnough && rasterizeInput.checked) {
      const attempts = [
        { dpi, q: quality },
        { dpi: Math.max(96, dpi - 24), q: Math.max(0.5, quality - 0.15) },
        { dpi: 96, q: Math.max(0.45, quality - 0.3) },
      ];
      const seen = new Set();

      for (const attempt of attempts) {
        const key = `${attempt.dpi}-${attempt.q.toFixed(2)}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const blob = await compressOne(item, attempt.dpi, attempt.q);
        if (blob.size < item.size) candidates.push({ blob, method: 'render' });

        if (blob.size < item.size * 0.9) break;
      }
    }

    if (!candidates.length) {
      return {
        blob: new Blob([item.data], { type: 'application/pdf' }),
        method: 'original',
      };
    }

    candidates.sort((a, b) => a.blob.size - b.blob.size);
    const smallest = candidates[0];
    const textSafe = candidates.find((c) => c.method !== 'render');

    // render só vence um resultado com texto preservado se for 15%+ menor
    if (textSafe && smallest.method === 'render' && textSafe.blob.size <= smallest.blob.size * 1.15) {
      return textSafe;
    }
    return smallest;
  }

  /* ── Recompressão de imagens dentro do PDF (texto preservado) ── */

  async function recompressEmbeddedImages(item, dpi, quality) {
    const doc = await PDFLib.PDFDocument.load(item.data, { ignoreEncryption: false });
    const ctx2 = doc.context;
    const N = (key) => PDFLib.PDFName.of(key);
    const resolve = (v) => (v instanceof PDFLib.PDFRef ? ctx2.lookup(v) : v);
    const asNum = (v) => {
      const r = resolve(v);
      return r && typeof r.asNumber === 'function' ? r.asNumber() : null;
    };

    // imagens acima disso são reduzidas (proporcional ao preset de DPI)
    const maxDim = dpi >= 150 ? 2400 : dpi >= 120 ? 1800 : 1400;
    const progressBar = () => document.getElementById(`prog-${item.id}`);

    const objects = ctx2.enumerateIndirectObjects();
    const imageRefs = [];

    for (const [ref, obj] of objects) {
      if (!(obj instanceof PDFLib.PDFRawStream)) continue;
      if (obj.dict.get(N('Subtype')) !== N('Image')) continue;
      imageRefs.push([ref, obj]);
    }

    if (!imageRefs.length) return null;

    let touched = 0;
    let processed = 0;

    for (const [ref, stream] of imageRefs) {
      processed++;
      const bar = progressBar();
      if (bar) bar.style.width = `${Math.round((processed / imageRefs.length) * 100)}%`;

      try {
        const dict = stream.dict;
        if (dict.get(N('Decode')) || dict.get(N('SMask'))) continue;
        if (dict.get(N('Mask'))) continue;             // color-key mask: arriscado
        if (dict.get(N('ImageMask'))) continue;        // stencil mask: não é imagem comum
        const smaskRef = dict.get(N('SMask')) || null; // transparência: preserva

        const width = asNum(dict.get(N('Width')));
        const height = asNum(dict.get(N('Height')));
        if (!width || !height || width * height < 96 * 96) continue; // ícones: ignora

        const filters = filterNames(dict.get(N('Filter')), resolve);
        const rawCS = resolve(dict.get(N('ColorSpace')));
        if (rawCS !== N('DeviceRGB') && rawCS !== N('DeviceGray')) continue;
        const csInfo = colorSpaceInfo(dict.get(N('ColorSpace')), resolve, N);

        let source = null; // algo que o drawImage aceite

        if (filters.length === 1 && filters[0] === 'DCTDecode') {
          if (csInfo.channels === 4) continue; // CMYK: browser decodifica errado
          source = await createImageBitmap(new Blob([stream.contents], { type: 'image/jpeg' }));
        } else if (filters.length === 1 && filters[0] === 'FlateDecode') {
          const bpc = asNum(dict.get(N('BitsPerComponent')));
          const parms = resolve(dict.get(N('DecodeParms')));
          const predictor = parms && parms.get ? asNum(parms.get(N('Predictor'))) : null;
          if (predictor && predictor > 1) continue;    // PNG predictors: fora do escopo
          if (bpc !== 8 || (csInfo.channels !== 3 && csInfo.channels !== 1)) continue;

          const raw = PDFLib.decodePDFRawStream(stream).decode();
          source = canvasFromRawPixels(raw, width, height, csInfo.channels);
          if (!source) continue;
        } else {
          continue; // JPX, JBIG2, CCITT etc.: deixa quieto
        }

        // downscale só quando não há SMask (as dimensões precisam casar)
        let tw = source.width;
        let th = source.height;
        if (!smaskRef && Math.max(tw, th) > maxDim) {
          const f = maxDim / Math.max(tw, th);
          tw = Math.round(tw * f);
          th = Math.round(th * f);
        }

        const canvas = document.createElement('canvas');
        canvas.width = tw;
        canvas.height = th;
        const c2d = canvas.getContext('2d');
        c2d.fillStyle = '#ffffff';
        c2d.fillRect(0, 0, tw, th);
        c2d.drawImage(source, 0, 0, tw, th);
        if (source.close) source.close();

        const jpegBlob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
        const bytes = new Uint8Array(await jpegBlob.arrayBuffer());
        canvas.width = 0;
        canvas.height = 0;

        // só troca se o ganho for real
        if (bytes.length >= stream.contents.length * 0.92) continue;

        const newDict = ctx2.obj({
          Type: 'XObject',
          Subtype: 'Image',
          Width: tw,
          Height: th,
          ColorSpace: 'DeviceRGB',
          BitsPerComponent: 8,
          Filter: 'DCTDecode',
          Length: bytes.length,
        });
        if (smaskRef) newDict.set(N('SMask'), smaskRef);

        ctx2.assign(ref, PDFLib.PDFRawStream.of(newDict, bytes));
        touched++;
      } catch (err) {
        console.warn('Imagem embutida ignorada:', err);
      }
    }

    if (!touched) return null;

    const bytes = await doc.save({ useObjectStreams: true });
    return new Blob([bytes], { type: 'application/pdf' });
  }

  function filterNames(filter, resolve) {
    const f = resolve(filter);
    if (!f) return [];
    if (f instanceof PDFLib.PDFName) return [f.toString().slice(1)];
    if (f instanceof PDFLib.PDFArray) {
      return f.asArray().map((n) => resolve(n)).filter((n) => n instanceof PDFLib.PDFName)
        .map((n) => n.toString().slice(1));
    }
    return [];
  }

  function colorSpaceInfo(cs, resolve, N) {
    const v = resolve(cs);
    if (v instanceof PDFLib.PDFName) {
      const name = v.toString().slice(1);
      if (name === 'DeviceRGB') return { channels: 3 };
      if (name === 'DeviceGray') return { channels: 1 };
      if (name === 'DeviceCMYK') return { channels: 4 };
      return { channels: 0 };
    }
    if (v instanceof PDFLib.PDFArray) {
      const head = resolve(v.get(0));
      if (head === N('ICCBased')) {
        const icc = resolve(v.get(1));
        const n = icc && icc.dict ? resolve(icc.dict.get(N('N'))) : null;
        const channels = n && typeof n.asNumber === 'function' ? n.asNumber() : 0;
        return { channels };
      }
      return { channels: 0 }; // Indexed, Separation etc.: fora do escopo
    }
    return { channels: 0 };
  }

  function canvasFromRawPixels(raw, width, height, channels) {
    const expected = width * height * channels;
    if (raw.length < expected) return null;

    const rgba = new Uint8ClampedArray(width * height * 4);
    if (channels === 3) {
      for (let i = 0, j = 0; i < expected; i += 3, j += 4) {
        rgba[j] = raw[i];
        rgba[j + 1] = raw[i + 1];
        rgba[j + 2] = raw[i + 2];
        rgba[j + 3] = 255;
      }
    } else {
      for (let i = 0, j = 0; i < expected; i += 1, j += 4) {
        rgba[j] = raw[i];
        rgba[j + 1] = raw[i];
        rgba[j + 2] = raw[i];
        rgba[j + 3] = 255;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0);
    return canvas;
  }

  async function compressOne(item, dpi, quality) {
    const doc = await pdfjsLib.getDocument({ isEvalSupported: false, data: item.data.slice(0) }).promise;
    const out = await PDFLib.PDFDocument.create();
    const progress = () => document.getElementById(`prog-${item.id}`);
    const scale = dpi / 72;

    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const vp1 = page.getViewport({ scale: 1 });        // dimensões em pontos
      const viewport = page.getViewport({ scale });      // render no DPI alvo

      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise; // 'print': sem requestAnimationFrame, não trava em aba oculta

      const jpegBlob = await new Promise((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', quality)
      );
      const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
      const image = await out.embedJpg(jpegBytes);

      const outPage = out.addPage([vp1.width, vp1.height]);
      outPage.drawImage(image, { x: 0, y: 0, width: vp1.width, height: vp1.height });

      canvas.width = 0;
      canvas.height = 0;

      const bar = progress();
      if (bar) bar.style.width = `${Math.round((n / doc.numPages) * 100)}%`;
    }

    await doc.destroy();
    const bytes = await out.save();
    return new Blob([bytes], { type: 'application/pdf' });
  }

  /* ── Init ── */
  applyMode();
});
