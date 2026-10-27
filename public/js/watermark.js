/* Marca d'água (texto ou logo) em imagens, em lote.
 * Posição por grade 3×3, mosaico ou livre (arrastando a marca na prévia grande).
 * Montado a cada exibição da página (src/scripts/app.ts); `document` é restrito à página
 * e `signal` é abortado quando o usuário navega para outra ferramenta. */
kompres.register('watermark', (signal, document) => {
  const fileInput = document.getElementById('fileInput');
  const dropZone = document.getElementById('dropZone');
  const processBtn = document.getElementById('processBtn');
  const downloadBtn = document.getElementById('downloadZipBtn');
  const clearBtn = document.getElementById('clearBtn');
  const grid = document.getElementById('imageGrid');
  const statusLine = document.getElementById('watermark-status');

  const textGroup = document.getElementById('wmTextGroup');
  const textInput = document.getElementById('wmText');
  const colorGroup = document.getElementById('wmColorGroup');
  const logoGroup = document.getElementById('wmLogoGroup');
  const logoInput = document.getElementById('wmLogo');
  const logoName = document.getElementById('wmLogoName');
  const positionButtons = [...document.querySelectorAll('[data-pos]')];
  const ranges = { size: document.getElementById('wmSize'), opacity: document.getElementById('wmOpacity'), margin: document.getElementById('wmMargin') };
  const freeBox = document.getElementById('wmFree');
  const freeReset = document.getElementById('wmFreeReset');

  // Prévia grande com a marca arrastável.
  const stage = document.getElementById('wmStage');
  const stageName = document.getElementById('wmPreviewName');
  const nav = document.getElementById('wmNav');
  const prevBtn = document.getElementById('wmPrev');
  const nextBtn = document.getElementById('wmNext');
  const navLabel = document.getElementById('wmNavLabel');
  const previewWrap = document.getElementById('wmPreviewWrap');
  const previewCanvas = document.getElementById('wmPreview');
  const markEl = document.getElementById('wmMark');

  const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];
  const LOGO_TYPES = [...ACCEPTED, 'image/svg+xml'];
  const PREVIEW_MAX = 1600; // maior lado da prévia, em px (redesenhada a cada movimento)
  const SIZE_MIN = Number(ranges.size.min);
  const SIZE_MAX = Number(ranges.size.max);

  let images = [];
  let logo = null; // { image: HTMLImageElement, url }
  let position = 'br'; // posição da grade, 'tile' (mosaico) ou 'free' (livre)
  let lastPreset = 'br'; // para "Voltar ao canto"
  const free = { x: 0.5, y: 0.5 }; // centro da marca na posição livre, em frações da imagem
  let busy = false;
  let rerun = false; // configurações mudaram ou chegaram arquivos durante um processamento
  let settingsTimer;

  let selected = null; // imagem mostrada na prévia
  let preview = null; // { item, base: canvas reduzido, width, height }
  let previewToken = 0;
  let frame = 0;
  let markBox = null; // caixa da marca na prévia, em pixels da prévia (null: mosaico ou sem marca)

  function setStatus(message = '', error = false) {
    statusLine.textContent = message; statusLine.hidden = !message; statusLine.classList.toggle('error', error);
  }

  fileInput.addEventListener('change', (event) => handleFiles([...event.target.files]));
  kompres.fileDrop({ signal, document, zone: dropZone, onFiles: handleFiles });

  // Tipo (texto/logo) e cor: rádios dentro de .fmt-btn.
  ['wmType', 'wmColor'].forEach((name) => {
    document.querySelectorAll(`input[name="${name}"]`).forEach((radio) => {
      radio.addEventListener('change', () => {
        document.querySelectorAll(`input[name="${name}"]`).forEach((input) => input.closest('.fmt-btn')?.classList.toggle('active', input.checked));
        if (name === 'wmType') syncTypeGroups();
        settingsChanged();
      });
    });
  });

  textInput.addEventListener('input', () => { refreshPreview(); debounceSettings(150); });
  logoInput.addEventListener('change', chooseLogo);

  positionButtons.forEach((button) => button.addEventListener('click', () => setPreset(button.dataset.pos)));
  freeReset.addEventListener('click', () => setPreset(lastPreset));

  // Ranges: mostra o valor ao lado do rótulo, atualiza a prévia na hora e refaz o lote depois de uma pausa.
  Object.values(ranges).forEach((range) => {
    range.addEventListener('input', () => { showRangeValue(range); refreshPreview(); debounceSettings(150); });
    range.addEventListener('change', settingsChanged);
    showRangeValue(range);
  });

  processBtn.addEventListener('click', () => processAll(true));
  downloadBtn.addEventListener('click', downloadAll);
  clearBtn.addEventListener('click', clearAll);
  prevBtn.addEventListener('click', () => stepPreview(-1));
  nextBtn.addEventListener('click', () => stepPreview(1));

  const getType = () => document.querySelector('input[name="wmType"]:checked')?.value || 'text';
  const getColor = () => document.querySelector('input[name="wmColor"]:checked')?.value || 'white';
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const percent = (fraction) => `${fraction * 100}%`;

  /** Centro limitado para a marca não sair da imagem (maior que a imagem: centralizada). */
  function clampCenter(center, size, total) {
    return size >= total ? total / 2 : clamp(center, size / 2, total - size / 2);
  }

  function showRangeValue(range) {
    const output = document.getElementById(`${range.id}Val`);
    if (output) output.textContent = `${range.value}%`;
  }

  // Texto mostra o campo de texto e a cor; logo mostra o seletor de arquivo.
  function syncTypeGroups() {
    const isText = getType() === 'text';
    textGroup.classList.toggle('hidden', !isText);
    colorGroup.classList.toggle('hidden', !isText);
    logoGroup.classList.toggle('hidden', isText);
  }

  /* ── Posição: grade, mosaico ou livre ── */

  function setPreset(value) {
    position = value;
    if (value !== 'tile') lastPreset = value;
    syncPositionUI();
    settingsChanged();
  }

  // Na posição livre nenhum botão fica marcado e aparece o indicador com "Voltar ao canto".
  function syncPositionUI() {
    positionButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.pos === position)));
    freeBox.hidden = position !== 'free';
  }

  /** Passa para a posição livre com o centro da marca em (cx, cy), em pixels da prévia. */
  function setFreeCenter(cx, cy, width = markBox.width, height = markBox.height) {
    free.x = clampCenter(cx, width, preview.width) / preview.width;
    free.y = clampCenter(cy, height, preview.height) / preview.height;
    if (position !== 'free') { position = 'free'; syncPositionUI(); }
    refreshPreview();
    debounceSettings(300);
  }

  /** Muda o range Tamanho; o evento input atualiza rótulo, preenchimento verde, prévia e lote. */
  function setSize(value) {
    const next = String(clamp(Math.round(value), SIZE_MIN, SIZE_MAX));
    if (ranges.size.value === next) return;
    ranges.size.value = next;
    ranges.size.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /** Carrega o logo escolhido numa <img> (SVG incluso) e guarda para reutilizar em todas as imagens. */
  async function chooseLogo() {
    const file = logoInput.files?.[0];
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) { setStatus('Logo inválido: use PNG, JPG, WebP ou SVG.', true); logoInput.value = ''; return; }

    if (logo) URL.revokeObjectURL(logo.url);
    logo = null;
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (!image.naturalWidth) throw new Error('Sem dimensões.'); // SVG sem width/height
      logo = { image, url };
      logoName.textContent = file.name;
      setStatus('');
    } catch {
      URL.revokeObjectURL(url);
      logoInput.value = ''; // permite escolher o mesmo arquivo de novo
      logoName.textContent = 'Nenhum arquivo escolhido';
      setStatus('Não foi possível abrir o logo. Para SVG, o arquivo precisa ter largura e altura definidas.', true);
    }
    settingsChanged();
  }

  /** Mensagem de validação, ou vazio quando dá para processar. */
  function validationError() {
    if (getType() === 'text' && !textInput.value.trim()) return "Digite o texto da marca d'água.";
    if (getType() === 'logo' && !logo) return 'Escolha o arquivo do logo.';
    return '';
  }

  async function handleFiles(files) {
    const valid = files.filter((file) => ACCEPTED.includes(file.type));
    const skipped = files.length - valid.length;
    setStatus(skipped ? `${skipped} ${skipped === 1 ? 'arquivo ignorado' : 'arquivos ignorados'}: use PNG, JPG ou WebP.` : '', skipped > 0);
    fileInput.value = '';
    if (!valid.length) return;

    const failed = [];
    for (const file of valid) {
      try {
        const bitmap = await decode(file);
        images.push({ file, previewUrl: URL.createObjectURL(file), width: bitmap.width, height: bitmap.height, processed: null, downloadUrl: null, failed: false });
        bitmap.close?.();
      } catch { failed.push(file.name); }
    }
    if (failed.length) setStatus(`Não foi possível abrir: ${failed.join(', ')}`, true);

    // A primeira imagem vai para a prévia; clicar num cartão troca.
    if (!selected && images.length) { selected = images[0]; loadPreview(selected); }
    render();
    updateUI();
    scheduleRun();
  }

  /** Decodifica a imagem já na orientação certa (EXIF); cai para <img> se o navegador não aceitar a opção. */
  async function decode(file) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* tenta abaixo */ }
    return new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imagem inválida.')); };
      image.src = url;
    });
  }

  function render() {
    grid.innerHTML = '';

    images.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = item.processed ? 'image-card done' : 'image-card';
      if (item === selected) { card.classList.add('selected'); card.setAttribute('aria-current', 'true'); }

      const sizeLine = item.processed
        ? `${formatBytes(item.file.size)} → <span class="size-new">${formatBytes(item.processed.blob.size)}</span>`
        : item.failed ? '<span class="card-error">Não foi possível processar</span>' : `${formatBytes(item.file.size)} → aguardando`;
      const action = item.processed
        ? `<a class="card-download" href="${item.downloadUrl}" download="${escapeHtml(item.processed.fileName)}">↓ baixar</a>`
        : '<button class="card-download" type="button" disabled>↓ baixar</button>';

      card.innerHTML = `
        <div class="card-thumb-wrap">
          <img class="card-thumb" src="${item.processed ? item.downloadUrl : item.previewUrl}" alt="${escapeHtml(item.file.name)}">
          <button class="card-remove" type="button" aria-label="Remover imagem">✕</button>
        </div>
        <div class="card-body">
          <div class="card-name">${escapeHtml(item.file.name)}</div>
          <small class="card-meta">${item.width}×${item.height}</small>
          <small class="card-meta">${sizeLine}</small>
          ${action}
        </div>
      `;

      card.querySelector('.card-remove').addEventListener('click', () => removeImage(index));
      // Clicar no cartão leva a imagem para a prévia (pelo teclado: botões ‹ › da prévia).
      card.addEventListener('click', (event) => {
        if (event.target.closest('.card-remove, .card-download')) return;
        selectImage(item);
      });

      // Segurar a miniatura de um resultado mostra o original; soltar volta ao resultado.
      const thumb = card.querySelector('.card-thumb');
      thumb.draggable = false;
      thumb.addEventListener('pointerdown', (event) => {
        if (!item.downloadUrl || event.button !== 0) return;
        event.preventDefault();
        thumb.src = item.previewUrl;
        card.classList.add('comparing');
      });
      const release = () => {
        if (!card.classList.contains('comparing')) return;
        card.classList.remove('comparing');
        thumb.src = item.downloadUrl || item.previewUrl;
      };
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((type) => thumb.addEventListener(type, release));
      thumb.addEventListener('contextmenu', (event) => { if (item.downloadUrl) event.preventDefault(); });

      grid.appendChild(card);
    });
  }

  function discardResults() {
    images.forEach((item) => {
      if (item.downloadUrl) URL.revokeObjectURL(item.downloadUrl);
      item.processed = null; item.downloadUrl = null; item.failed = false;
    });
  }

  function debounceSettings(delay) {
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(settingsChanged, delay);
  }

  // Configuração mudou: descarta os resultados e refaz com a nova.
  function settingsChanged() {
    clearTimeout(settingsTimer);
    discardResults();
    render(); updateUI();
    refreshPreview();
    scheduleRun();
  }

  // Mostra a mensagem de validação e lembra que foi ela, para limpá-la quando o problema for resolvido.
  let validationShown = false;
  function checkValidation() {
    const error = validationError();
    if (error) { setStatus(error, true); validationShown = true; }
    else if (validationShown) { setStatus(''); validationShown = false; }
    return !error;
  }

  function scheduleRun() {
    if (!images.length) return;
    if (!checkValidation()) return;
    if (busy) { rerun = true; return; }
    processAll();
  }

  const pending = () => images.filter((item) => !item.processed && !item.failed);

  async function processAll(force = false) {
    if (busy) { rerun = true; return; }
    if (!checkValidation()) return;
    if (force) discardResults();
    if (!pending().length) { updateUI(); return; }

    busy = true;
    updateUI();

    do {
      rerun = false;
      // Configurações lidas uma vez por rodada: todas as imagens da rodada saem iguais.
      const settings = readSettings();
      for (const item of pending()) {
        if (!images.includes(item)) continue;
        try {
          const processed = await stamp(item.file, settings);
          if (!images.includes(item) || item.processed || rerun) continue; // removida ou configurações mudaram
          item.processed = processed;
          item.downloadUrl = URL.createObjectURL(processed.blob);
        } catch { item.failed = true; }
        render();
      }
    } while (rerun);

    busy = false;
    updateUI();
  }

  function readSettings() {
    return {
      type: getType(),
      text: textInput.value.trim(),
      logo: logo?.image || null,
      color: getColor(),
      position,
      x: free.x, y: free.y,                        // centro na posição livre, em frações da imagem
      size: Number(ranges.size.value) / 100,       // fração da largura da imagem
      opacity: Number(ranges.opacity.value) / 100,
      margin: Number(ranges.margin.value) / 100,   // fração do lado menor
    };
  }

  /** Desenha a imagem e a marca d'água por cima; codifica no formato de entrada. */
  async function stamp(file, settings) {
    const source = await decode(file);
    const width = source.width;
    const height = source.height;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');

    // JPEG não tem transparência: fundo branco antes de desenhar.
    if (file.type === 'image/jpeg') { context.fillStyle = '#fff'; context.fillRect(0, 0, width, height); }
    context.drawImage(source, 0, 0);
    source.close?.();

    // Garante a Inter carregada antes de medir; sem ela o canvas mediria com a fonte substituta.
    if (settings.type === 'text') await document.fonts?.load('bold 100px Inter').catch(() => {});
    drawMark(context, settings, width, height);

    const { blob, extension } = await encode(canvas, file.type);
    const baseName = file.name.replace(/\.[^/.]+$/, '');
    return { blob, fileName: `${baseName}-marca-dagua-kompres.${extension}` };
  }

  /**
   * Desenha a marca na posição das configurações. Serve ao arquivo final e à prévia
   * (em escala menor): tudo é proporcional à largura, então as duas batem.
   * Devolve a caixa da marca, ou null no mosaico.
   */
  function drawMark(context, settings, width, height) {
    context.save();
    const mark = prepareMark(context, settings, width);
    context.globalAlpha = settings.opacity;
    let box = null;
    if (settings.position === 'tile') drawTiled(context, mark, width, height);
    else {
      const { x, y } = placeMark(settings, width, height, mark.width, mark.height);
      mark.draw(x, y);
      box = { x, y, width: mark.width, height: mark.height };
    }
    context.restore();
    return box;
  }

  /** Canto superior esquerdo da marca: posição livre (centro em frações) ou da grade 3×3. */
  function placeMark(settings, width, height, markWidth, markHeight) {
    if (settings.position === 'free') {
      return {
        x: clampCenter(settings.x * width, markWidth, width) - markWidth / 2,
        y: clampCenter(settings.y * height, markHeight, height) - markHeight / 2,
      };
    }
    const margin = Math.round(Math.min(width, height) * settings.margin);
    return anchor(settings.position, width, height, markWidth, markHeight, margin);
  }

  /**
   * Medidas da marca (texto ou logo) com largura = `size` da largura da imagem,
   * e uma função que a desenha com o canto superior esquerdo em (x, y).
   */
  function prepareMark(context, settings, imageWidth) {
    const targetWidth = Math.max(8, imageWidth * settings.size);

    if (settings.type === 'logo') {
      const ratio = settings.logo.naturalHeight / settings.logo.naturalWidth;
      const width = targetWidth;
      const height = Math.max(1, targetWidth * ratio);
      return { width, height, draw: (x, y) => context.drawImage(settings.logo, x, y, width, height) };
    }

    // Texto: mede em 100px e escala a fonte até o texto ocupar a largura desejada.
    const font = (px) => `bold ${px}px Inter, system-ui, sans-serif`;
    context.font = font(100);
    const measured = context.measureText(settings.text).width || 1;
    const px = Math.max(8, (targetWidth / measured) * 100);
    context.font = font(px);
    const metrics = context.measureText(settings.text);
    const ascent = metrics.actualBoundingBoxAscent ?? px * 0.8;
    const descent = metrics.actualBoundingBoxDescent ?? px * 0.2;
    const width = metrics.width;
    const height = ascent + descent;

    return {
      width, height,
      draw: (x, y) => {
        context.font = font(px);
        context.textBaseline = 'alphabetic';
        context.fillStyle = settings.color === 'black' ? '#000' : '#fff';
        // Sombra leve na cor oposta: o texto continua legível sobre áreas claras e escuras.
        context.shadowColor = settings.color === 'black' ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.55)';
        context.shadowBlur = px * 0.08;
        context.shadowOffsetX = px * 0.02;
        context.shadowOffsetY = px * 0.03;
        context.fillText(settings.text, x, y + ascent);
        context.shadowColor = 'transparent';
      },
    };
  }

  /** Canto superior esquerdo da marca para cada posição da grade 3×3. */
  function anchor(position, imageWidth, imageHeight, markWidth, markHeight, margin) {
    const [row, col] = position.split('');
    const x = col === 'l' ? margin : col === 'c' ? (imageWidth - markWidth) / 2 : imageWidth - markWidth - margin;
    const y = row === 't' ? margin : row === 'm' ? (imageHeight - markHeight) / 2 : imageHeight - markHeight - margin;
    return { x, y };
  }

  /** Mosaico: repete a marca em diagonal (-30°) cobrindo a imagem inteira, com linhas alternadas. */
  function drawTiled(context, mark, imageWidth, imageHeight) {
    const stepX = mark.width * 1.6;
    const stepY = mark.height * 3;
    const reach = Math.hypot(imageWidth, imageHeight) / 2;
    context.save();
    context.translate(imageWidth / 2, imageHeight / 2);
    context.rotate(-Math.PI / 6);
    let row = 0;
    for (let y = -reach; y < reach; y += stepY, row++) {
      const offset = row % 2 ? stepX / 2 : 0;
      for (let x = -reach - stepX + offset; x < reach + stepX; x += stepX) mark.draw(x, y);
    }
    context.restore();
  }

  /* ── Prévia grande ── */

  /** Reduz a imagem escolhida uma vez; a prévia é redesenhada a partir dela a cada ajuste. */
  async function loadPreview(item) {
    const token = ++previewToken;
    try {
      const source = await decode(item.file);
      if (token !== previewToken || signal.aborted) { source.close?.(); return; }
      const scale = Math.min(1, PREVIEW_MAX / Math.max(source.width, source.height));
      const width = Math.max(1, Math.round(source.width * scale));
      const height = Math.max(1, Math.round(source.height * scale));
      const base = document.createElement('canvas');
      base.width = width;
      base.height = height;
      const context = base.getContext('2d');
      if (item.file.type === 'image/jpeg') { context.fillStyle = '#fff'; context.fillRect(0, 0, width, height); }
      context.imageSmoothingQuality = 'high';
      context.drawImage(source, 0, 0, width, height);
      source.close?.();

      preview = { item, base, width, height };
      previewCanvas.width = width;
      previewCanvas.height = height;
      previewWrap.style.setProperty('--ar', String(width / height));
      drawPreview();
    } catch {
      if (token === previewToken) setStatus('Não foi possível mostrar a prévia desta imagem.', true);
    }
  }

  function clearPreview() {
    previewToken++;
    cancelAnimationFrame(frame);
    frame = 0;
    preview = null;
    markBox = null;
    markEl.hidden = true;
  }

  // Um redesenho por quadro, por mais eventos que cheguem (arrastar, ranges, texto).
  function refreshPreview() {
    if (preview && !frame) frame = requestAnimationFrame(drawPreview);
  }

  /** Imagem + marca com o mesmo código do arquivo final; a caixa arrastável fica por cima da marca. */
  function drawPreview() {
    cancelAnimationFrame(frame);
    frame = 0;
    if (!preview) return;
    const { base, width, height } = preview;
    const context = previewCanvas.getContext('2d');
    context.clearRect(0, 0, width, height);
    context.drawImage(base, 0, 0);
    markBox = validationError() ? null : drawMark(context, readSettings(), width, height);

    markEl.hidden = !markBox; // mosaico ou sem texto/logo: nada para arrastar
    if (!markBox) return;
    markEl.style.left = percent(markBox.x / width);
    markEl.style.top = percent(markBox.y / height);
    markEl.style.width = percent(markBox.width / width);
    markEl.style.height = percent(markBox.height / height);
    markEl.dataset.corner = resizeCorner();
  }

  /**
   * Canto da alça: o oposto ao lado em que a marca está presa, para a alça acompanhar o dedo.
   * Livre: o canto superior esquerdo fica parado e a alça vai no inferior direito.
   */
  function resizeCorner() {
    if (position === 'free') return 'se';
    const [row, col] = position.split('');
    return (row === 'b' ? 'n' : 's') + (col === 'r' ? 'w' : 'e');
  }

  function selectImage(item) {
    if (!item || item === selected) return;
    selected = item;
    render();
    updateStage();
    loadPreview(item);
    // No celular a prévia pode estar fora da tela quando o cartão é tocado.
    const rect = previewWrap.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > innerHeight) stage.scrollIntoView({ block: 'nearest' });
  }

  function stepPreview(delta) {
    if (images.length < 2) return;
    const index = images.indexOf(selected);
    selectImage(images[(index + delta + images.length) % images.length]);
  }

  function updateStage() {
    stage.hidden = !images.length;
    nav.hidden = images.length < 2;
    // Só troca o texto quando muda: o rótulo é aria-live e updateUI roda a cada imagem processada.
    const label = `${images.indexOf(selected) + 1} de ${images.length}`;
    if (navLabel.textContent !== label) navLabel.textContent = label;
    const name = selected?.file.name || '';
    if (stageName.textContent !== name) stageName.textContent = name;
  }

  /* ── Arrastar e redimensionar a marca (Pointer Events: mouse, caneta e toque) ── */

  let gesture = null; // { pointerId, kind, startX, startY, scale, box, corner, moved }

  markEl.addEventListener('pointerdown', (event) => {
    if (gesture || !markBox || !preview) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    markEl.focus({ preventScroll: true });
    const rect = previewWrap.getBoundingClientRect();
    gesture = {
      pointerId: event.pointerId,
      kind: event.target.closest('.wm-resize') ? 'resize' : 'move',
      startX: event.clientX, startY: event.clientY,
      scale: preview.width / rect.width, // pixels da prévia por pixel de tela
      box: { ...markBox },
      corner: markEl.dataset.corner || 'se',
      moved: false,
    };
    try { markEl.setPointerCapture(event.pointerId); } catch { /* segue sem captura */ }
    markEl.classList.add('dragging');
  });

  markEl.addEventListener('pointermove', (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId || !preview) return;
    const screenDx = event.clientX - gesture.startX;
    const screenDy = event.clientY - gesture.startY;
    // Um toque sem arrastar não tira a marca da posição da grade.
    if (!gesture.moved && Math.hypot(screenDx, screenDy) < 3) return;
    gesture.moved = true;
    const dx = screenDx * gesture.scale;
    const dy = screenDy * gesture.scale;
    const { box } = gesture;
    if (gesture.kind === 'move') setFreeCenter(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, box.width, box.height);
    else resizeMark(dx, dy);
  });

  /** Alça do canto: mantém a proporção seguindo o maior deslocamento (horizontal ou vertical). */
  function resizeMark(dx, dy) {
    const { box, corner } = gesture;
    const { width: W, height: H } = preview;
    const ratio = box.width / box.height;
    // Na grade, a marca centralizada cresce para os dois lados: a alça anda metade.
    const [row, col] = position === 'free' ? ['t', 'l'] : position.split('');
    const growX = (corner.includes('e') ? dx : -dx) * (col === 'c' ? 2 : 1);
    const growY = (corner.includes('s') ? dy : -dy) * (row === 'm' ? 2 : 1) * ratio;
    const grow = Math.abs(growX) >= Math.abs(growY) ? growX : growY;
    const minWidth = (W * SIZE_MIN) / 100;
    const maxWidth = Math.min((W * SIZE_MAX) / 100, W, H * ratio); // cabe na imagem
    const width = clamp(box.width + grow, minWidth, Math.max(minWidth, maxWidth));
    const size = clamp(Math.round((width / W) * 100), SIZE_MIN, SIZE_MAX);

    if (position === 'free') {
      // Canto superior esquerdo parado; o centro guardado acompanha o novo tamanho.
      const newWidth = (W * size) / 100;
      const newHeight = newWidth / ratio;
      setFreeCenter(box.x + newWidth / 2, box.y + newHeight / 2, newWidth, newHeight);
    }
    setSize(size);
  }

  function endGesture(event) {
    if (!gesture || (event && event.pointerId !== gesture.pointerId)) return;
    markEl.classList.remove('dragging');
    try { markEl.releasePointerCapture(gesture.pointerId); } catch { /* já solto */ }
    const moved = gesture.moved;
    gesture = null;
    if (moved) settingsChanged(); // soltou: processa o lote já, sem esperar a pausa
  }
  markEl.addEventListener('pointerup', endGesture);
  markEl.addEventListener('pointercancel', endGesture);

  // Teclado: setas movem 1% (Shift: 5%); + e − mudam o tamanho.
  markEl.addEventListener('keydown', (event) => {
    if (event.target !== markEl || !markBox || !preview) return;
    const step = event.shiftKey ? 0.05 : 0.01;
    let dx = 0;
    let dy = 0;
    switch (event.key) {
      case 'ArrowLeft': dx = -step; break;
      case 'ArrowRight': dx = step; break;
      case 'ArrowUp': dy = -step; break;
      case 'ArrowDown': dy = step; break;
      case '+': case '=': event.preventDefault(); setSize(Number(ranges.size.value) + 1); return;
      case '-': case '_': event.preventDefault(); setSize(Number(ranges.size.value) - 1); return;
      default: return;
    }
    event.preventDefault();
    const { width: W, height: H } = preview;
    // Parte do centro guardado (livre) ou do centro atual na grade; não depende do próximo quadro.
    const cx = position === 'free' ? free.x * W : markBox.x + markBox.width / 2;
    const cy = position === 'free' ? free.y * H : markBox.y + markBox.height / 2;
    setFreeCenter(cx + dx * W, cy + dy * H);
  });

  /* ── Download, remoção e estado ── */

  /** PNG passa pelo otimizador sem perdas; JPEG e WebP saem com qualidade .92.
   *  Navegador sem WebP no canvas (Safari antigo) recebe PNG para não perder o arquivo. */
  async function encode(canvas, mimeType) {
    if (mimeType === 'image/png') return { blob: await kompres.pngFromCanvas(canvas, 1), extension: 'png' };
    const blob = await new Promise((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Erro ao gerar imagem.')), mimeType, 0.92));
    if (blob.type !== mimeType) return { blob: await kompres.pngFromCanvas(canvas, 1), extension: 'png' };
    return { blob, extension: mimeType === 'image/jpeg' ? 'jpg' : 'webp' };
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // Um resultado só sai direto; vários vão em ZIP.
  async function downloadAll() {
    const done = images.filter((item) => item.processed);
    if (!done.length) return;
    if (done.length === 1) { downloadBlob(done[0].processed.blob, done[0].processed.fileName); return; }

    downloadBtn.disabled = true;
    downloadBtn.textContent = 'Gerando ZIP...';
    try {
      const zip = new JSZip();
      done.forEach((item, index) => zip.file(`${index + 1}-${item.processed.fileName}`, item.processed.blob));
      downloadBlob(await zip.generateAsync({ type: 'blob' }), 'imagens-marca-dagua-kompres.zip');
    } catch { setStatus('Não foi possível gerar o ZIP. Tente novamente.', true); }
    finally { updateUI(); }
  }

  function removeImage(index) {
    const item = images[index];
    if (!item) return;
    URL.revokeObjectURL(item.previewUrl);
    if (item.downloadUrl) URL.revokeObjectURL(item.downloadUrl);
    images.splice(index, 1);
    // A imagem da prévia saiu: mostra a vizinha.
    if (item === selected) {
      selected = images[Math.min(index, images.length - 1)] || null;
      if (selected) loadPreview(selected); else clearPreview();
    }
    render();
    updateUI();
  }

  function clearAll() {
    images.forEach((item) => {
      URL.revokeObjectURL(item.previewUrl);
      if (item.downloadUrl) URL.revokeObjectURL(item.downloadUrl);
    });
    images = [];
    selected = null;
    clearPreview();
    grid.innerHTML = '';
    fileInput.value = '';
    setStatus('');
    updateUI();
  }

  // Controles ficam ativos durante o processamento: mudar algo refaz o resultado.
  function updateUI() {
    const hasImages = images.length > 0;
    const done = images.filter((item) => item.processed).length;
    processBtn.disabled = busy || !hasImages;
    processBtn.textContent = busy ? 'Processando…' : hasImages && !pending().length ? 'Aplicar novamente' : 'Aplicar em tudo';
    clearBtn.disabled = !hasImages;
    downloadBtn.disabled = !done;
    downloadBtn.textContent = done === 1 ? '↓ Baixar' : '↓ Baixar ZIP';
    updateStage();
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function escapeHtml(value) {
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }

  syncTypeGroups();
  syncPositionUI();
  updateUI();
  // A prévia mede o texto com a Inter, como o arquivo final: redesenha quando ela chegar.
  document.fonts?.load('bold 100px Inter').then(refreshPreview, () => {});

  // Botão de baixar logo abaixo da prévia: espelha o da coluna (texto e estado).
  const mainDownload = document.getElementById('downloadZipBtn');
  const below = document.getElementById('wmBelow');
  const belowBtn = document.getElementById('wmDownloadBelow');
  const syncBelow = () => {
    belowBtn.textContent = mainDownload.textContent;
    belowBtn.disabled = mainDownload.disabled;
    below.hidden = !images.length;
  };
  belowBtn.addEventListener('click', () => mainDownload.click());
  const belowObserver = new MutationObserver(syncBelow);
  belowObserver.observe(mainDownload, { attributes: true, attributeFilter: ['disabled'], childList: true, characterData: true, subtree: true });
  syncBelow();

  // Saiu da página: libera os object URLs das prévias, resultados e do logo.
  signal.addEventListener('abort', () => {
    belowObserver.disconnect();
    clearTimeout(settingsTimer);
    clearPreview();
    images.forEach((item) => {
      URL.revokeObjectURL(item.previewUrl);
      if (item.downloadUrl) URL.revokeObjectURL(item.downloadUrl);
    });
    images = [];
    if (logo) URL.revokeObjectURL(logo.url);
    logo = null;
  });
});
