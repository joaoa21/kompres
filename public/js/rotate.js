/* Girar e espelhar imagens em lote, com rotação acumulada por imagem (como no iLoveIMG).
 * Cada imagem guarda `angle` (0, 90, 180 ou 270) e `flipH`/`flipV`; os botões globais somam
 * em todas as imagens carregadas e os botões ↺ ↻ de cada miniatura mudam só aquela imagem.
 * A miniatura reflete a mudança na hora (CSS transform) e o arquivo é gerado com um pequeno
 * atraso (debounce), trocando a miniatura pelo resultado quando fica pronto.
 * Montado a cada exibição da página (src/scripts/app.ts); `document` é restrito à página
 * e `signal` é abortado quando o usuário navega para outra ferramenta. */
kompres.register('rotate', (signal, document) => {
  const fileInput = document.getElementById('fileInput');
  const dropZone = document.getElementById('dropZone');
  const downloadBtn = document.getElementById('downloadZipBtn');
  const clearBtn = document.getElementById('clearBtn');
  const resetBtn = document.getElementById('rotateReset');
  const grid = document.getElementById('imageGrid');
  const statusLine = document.getElementById('rotate-status');
  const globalButtons = [...document.querySelectorAll('.rotate-actions [data-rotate]')];

  const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];
  const DEBOUNCE_MS = 250;

  // Ícones em traço dos botões ↺ ↻ de cada miniatura (Feather, MIT).
  const ICONS = {
    left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',
    right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
  };

  let images = [];
  let busy = false;
  let rerun = false; // alguém pediu processamento enquanto um lote rodava
  let runTimer = null; // debounce entre o clique e o processamento real

  function setStatus(message = '', error = false) {
    statusLine.textContent = message; statusLine.hidden = !message; statusLine.classList.toggle('error', error);
  }

  fileInput.addEventListener('change', (event) => handleFiles([...event.target.files]));
  kompres.fileDrop({ signal, document, zone: dropZone, onFiles: handleFiles });

  // Botões globais: cada clique acumula em todas as imagens carregadas.
  globalButtons.forEach((button) => button.addEventListener('click', () => applyToAll(button.dataset.rotate)));
  resetBtn.addEventListener('click', () => applyToAll('reset'));
  downloadBtn.addEventListener('click', downloadAll);
  // Vários resultados: separados, numa pasta ou em ZIP (setinha ao lado do botão).
  const dl = kompres.downloads.attach({ signal, button: downloadBtn, onPick: () => downloadAll() });
  clearBtn.addEventListener('click', clearAll);

  async function handleFiles(files) {
    const valid = files.filter((file) => ACCEPTED.includes(file.type));
    const skipped = files.length - valid.length;
    setStatus(skipped ? `${skipped} ${skipped === 1 ? 'arquivo ignorado' : 'arquivos ignorados'}: use PNG, JPG ou WebP.` : '', skipped > 0);
    fileInput.value = '';
    if (!valid.length) return;

    const failed = [];
    for (const file of valid) {
      try {
        // Decodifica uma vez só para medir (respeitando a orientação EXIF) e libera a memória.
        const bitmap = await decode(file);
        const item = {
          file, previewUrl: URL.createObjectURL(file), width: bitmap.width, height: bitmap.height,
          // Estado da imagem: `spin` acumula sem limite (só para a animação da miniatura girar no
          // sentido clicado); `angle` é o resto em 0/90/180/270 usado no processamento.
          spin: 0, angle: 0, flipH: false, flipV: false,
          version: 0, processed: null, downloadUrl: null, failed: false, card: null,
        };
        bitmap.close?.();
        markUnchanged(item);
        images.push(item);
      } catch { failed.push(file.name); }
    }
    if (failed.length) setStatus(`Não foi possível abrir: ${failed.join(', ')}`, true);

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

  // ── Estado por imagem ─────────────────────────────────────────────
  const isUnchanged = (item) => item.angle === 0 && !item.flipH && !item.flipV;

  /** Dimensões de saída: quartos de volta trocam largura e altura. */
  function outputSize(width, height, angle) {
    return angle === 90 || angle === 270 ? { width: height, height: width } : { width, height };
  }

  /** Estado zero não gera arquivo: o original é entregue como está. */
  function markUnchanged(item) {
    item.processed = { blob: item.file, fileName: item.file.name, width: item.width, height: item.height, unchanged: true };
    item.downloadUrl = null;
  }

  /** Texto curto do estado para o cartão: "90°", "180° · espelhada H", "sem alteração". */
  function stateLabel(item) {
    const parts = [];
    if (item.angle) parts.push(`${item.angle}°`);
    if (item.flipH && item.flipV) parts.push('espelhada H+V');
    else if (item.flipH) parts.push('espelhada H');
    else if (item.flipV) parts.push('espelhada V');
    return parts.length ? parts.join(' · ') : 'sem alteração';
  }

  /** O estado mudou: invalida o resultado anterior e atualiza o cartão na hora. */
  function stateChanged(item) {
    item.version++;
    if (item.downloadUrl) URL.revokeObjectURL(item.downloadUrl);
    item.processed = null; item.downloadUrl = null; item.failed = false;
    if (isUnchanged(item)) markUnchanged(item);
    updateCard(item);
  }

  function applyAction(item, action) {
    if (action === 'left' || action === 'right' || action === 'half') {
      item.spin += action === 'left' ? -90 : action === 'right' ? 90 : 180;
      item.angle = ((item.spin % 360) + 360) % 360;
    } else if (action === 'flipH' || action === 'flipV') {
      item[action] = !item[action];
    } else if (action === 'reset') {
      item.spin -= item.angle; // volta ao múltiplo de 360 mais próximo, sem dar voltas extras
      item.angle = 0; item.flipH = false; item.flipV = false;
    } else return;
    stateChanged(item);
  }

  function applyToAll(action) {
    if (!images.length) return;
    images.forEach((item) => applyAction(item, action));
    updateUI();
    scheduleRun();
  }

  function applyToOne(item, action) {
    applyAction(item, action);
    updateUI();
    scheduleRun();
  }

  // ── Cartões ───────────────────────────────────────────────────────
  function render() {
    grid.innerHTML = '';
    images.forEach((item) => {
      item.card = createCard(item);
      grid.appendChild(item.card);
      updateCard(item);
    });
  }

  function createCard(item) {
    const name = escapeHtml(item.file.name);
    const card = document.createElement('div');
    card.className = 'image-card rotate-card';
    card.innerHTML = `
      <div class="card-thumb-wrap">
        <img class="card-thumb" src="${item.previewUrl}" alt="${name}">
        <div class="rotate-card-btns">
          <button class="rotate-card-btn" type="button" data-rotate="left" title="Girar para a esquerda" aria-label="Girar a imagem ${name} para a esquerda">${ICONS.left}</button>
          <button class="rotate-card-btn" type="button" data-rotate="right" title="Girar para a direita" aria-label="Girar a imagem ${name} para a direita">${ICONS.right}</button>
        </div>
        <button class="card-remove" type="button" data-ah-label="Remover imagem" aria-label="Remover imagem ${name}">✕</button>
      </div>
      <div class="card-body">
        <div class="card-name">${name}</div>
        <small class="card-meta rotate-state"></small>
        <small class="card-meta rotate-dims"></small>
        <small class="card-meta rotate-size"></small>
        <div class="rotate-card-action"></div>
      </div>
    `;

    card.querySelectorAll('.rotate-card-btn').forEach((button) => button.addEventListener('click', () => applyToOne(item, button.dataset.rotate)));
    card.querySelector('.card-remove').addEventListener('click', () => removeImage(item));

    // Segurar a miniatura mostra o original sem rotação; soltar volta à prévia girada.
    const thumb = card.querySelector('.card-thumb');
    thumb.draggable = false;
    thumb.addEventListener('pointerdown', (event) => {
      if (isUnchanged(item) || event.button !== 0) return;
      event.preventDefault();
      card.classList.add('comparing');
    });
    const release = () => card.classList.remove('comparing');
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((type) => thumb.addEventListener(type, release));
    thumb.addEventListener('contextmenu', (event) => { if (!isUnchanged(item)) event.preventDefault(); });

    return card;
  }

  /** Atualiza só as partes dinâmicas do cartão: miniatura (prévia ou resultado), estado, medidas e download. */
  function updateCard(item) {
    const card = item.card;
    if (!card || !card.isConnected) return;
    const { processed } = item;
    const thumb = card.querySelector('.card-thumb');
    const changed = !isUnchanged(item);

    card.classList.toggle('done', !!processed && !processed.unchanged);

    // A miniatura é sempre o original com a rotação e o espelho em CSS, com transição em todo
    // clique (inclusive na volta ao estado original). O arquivo gerado só vai para o download.
    // A miniatura é quadrada com object-fit: contain, então cabe em qualquer rotação.
    if (thumb.src !== item.previewUrl) thumb.src = item.previewUrl;
    thumb.classList.add('rotate-previewing');
    thumb.style.transform = `rotate(${item.spin}deg) scaleX(${item.flipH ? -1 : 1}) scaleY(${item.flipV ? -1 : 1})`;

    const state = card.querySelector('.rotate-state');
    state.textContent = stateLabel(item);
    state.classList.toggle('changed', changed);

    const after = processed ? processed : outputSize(item.width, item.height, item.angle);
    card.querySelector('.rotate-dims').textContent = changed
      ? `${item.width}×${item.height} → ${after.width}×${after.height}`
      : `${item.width}×${item.height}`;

    const size = card.querySelector('.rotate-size');
    if (processed?.unchanged) size.textContent = `${formatBytes(item.file.size)} · original`;
    else if (processed) size.innerHTML = `${formatBytes(item.file.size)} → <span class="size-new">${formatBytes(processed.blob.size)}</span>`;
    else if (item.failed) size.innerHTML = '<span class="card-error">Não foi possível processar</span>';
    else size.textContent = `${formatBytes(item.file.size)} → aguardando`;

    card.querySelector('.rotate-card-action').innerHTML = processed
      ? `<a class="card-download" data-ah-label="Baixar resultado" href="${item.downloadUrl || item.previewUrl}" download="${escapeHtml(processed.fileName)}">↓ baixar</a>`
      : '<button class="card-download" type="button" data-ah-label="Baixar resultado" disabled>↓ baixar</button>';
  }

  // ── Processamento ─────────────────────────────────────────────────
  const pending = () => images.filter((item) => !item.processed && !item.failed);

  /** Espera o usuário parar de clicar antes de gerar os arquivos. */
  function scheduleRun() {
    clearTimeout(runTimer);
    runTimer = null;
    if (!pending().length) return;
    runTimer = setTimeout(() => { runTimer = null; processAll(); }, DEBOUNCE_MS);
  }

  async function processAll() {
    if (busy) { rerun = true; return; }
    if (!pending().length) { updateUI(); return; }

    busy = true;
    updateUI();

    do {
      rerun = false;
      for (const item of pending()) {
        if (!images.includes(item)) continue;
        const version = item.version;
        try {
          const processed = await transform(item);
          if (!images.includes(item) || item.version !== version) continue; // removida ou o estado mudou
          item.processed = processed;
          item.downloadUrl = URL.createObjectURL(processed.blob);
        } catch {
          if (images.includes(item) && item.version === version) item.failed = true;
        }
        updateCard(item);
      }
    } while (rerun);

    busy = false;
    updateUI();
    // Estado mudou durante o lote: o debounce já agendou a próxima rodada.
  }

  /** Desenha a imagem a partir do estado (espelhos, depois rotação) e codifica no formato de entrada. */
  async function transform(item) {
    const { file, angle, flipH, flipV } = item;
    const source = await decode(file);
    const { width, height } = outputSize(source.width, source.height, angle);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');

    // JPEG não tem transparência: fundo branco antes de desenhar.
    if (file.type === 'image/jpeg') { context.fillStyle = '#fff'; context.fillRect(0, 0, width, height); }

    // Origem no centro; o canvas aplica as transformações de trás para a frente, então a imagem é
    // espelhada primeiro e girada depois, igual à prévia em CSS.
    context.translate(width / 2, height / 2);
    context.rotate((angle * Math.PI) / 180);
    context.scale(flipH ? -1 : 1, flipV ? -1 : 1);
    context.drawImage(source, -source.width / 2, -source.height / 2);
    source.close?.();

    const { blob, extension } = await encode(canvas, file.type);
    const baseName = file.name.replace(/\.[^/.]+$/, '');
    const suffix = angle ? 'girado' : 'espelhado';
    return { blob, fileName: `${baseName}-${suffix}-kompres.${extension}`, width, height };
  }

  /** PNG passa pelo otimizador sem perdas; JPEG e WebP saem com qualidade .92.
   *  Navegador sem WebP no canvas (Safari antigo) recebe PNG para não perder o arquivo. */
  async function encode(canvas, mimeType) {
    if (mimeType === 'image/png') return { blob: await kompres.pngFromCanvas(canvas, 1), extension: 'png' };
    const blob = await new Promise((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Erro ao gerar imagem.')), mimeType, 0.92));
    if (blob.type !== mimeType) return { blob: await kompres.pngFromCanvas(canvas, 1), extension: 'png' };
    return { blob, extension: mimeType === 'image/jpeg' ? 'jpg' : 'webp' };
  }

  // ── Download e limpeza ────────────────────────────────────────────
  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // Um resultado só sai direto; vários na forma escolhida. Imagens sem alteração vão como estão.
  async function downloadAll() {
    const done = images.filter((item) => item.processed);
    if (!done.length) return;
    const files = done.map((item) => ({ name: item.processed.fileName, blob: item.processed.blob }));
    downloadBtn.disabled = true;
    if (files.length > 1) downloadBtn.textContent = kompres.downloads.busyLabel();
    try {
      const result = await kompres.downloads.saveFiles(files, { zipName: 'imagens-giradas-kompres.zip' });
      if (result === 'folder') setStatus(`${files.length} imagens salvas na pasta escolhida.`);
    } catch { setStatus('Não foi possível salvar os arquivos. Tente outra forma de baixar na setinha ao lado do botão.', true); }
    finally { updateUI(); }
  }

  function releaseItem(item) {
    URL.revokeObjectURL(item.previewUrl);
    if (item.downloadUrl) URL.revokeObjectURL(item.downloadUrl);
  }

  function removeImage(item) {
    const index = images.indexOf(item);
    if (index === -1) return;
    releaseItem(item);
    images.splice(index, 1);
    item.card?.remove();
    item.card = null;
    updateUI();
    scheduleRun();
  }

  function clearAll() {
    clearTimeout(runTimer);
    runTimer = null;
    images.forEach(releaseItem);
    images = [];
    grid.innerHTML = '';
    fileInput.value = '';
    setStatus('');
    updateUI();
  }

  // Controles ficam ativos durante o processamento: girar de novo invalida só o que mudou.
  function updateUI() {
    const hasImages = images.length > 0;
    const done = images.filter((item) => item.processed).length;
    globalButtons.forEach((button) => { button.disabled = !hasImages; });
    resetBtn.disabled = !images.some((item) => !isUnchanged(item));
    clearBtn.disabled = !hasImages;
    downloadBtn.disabled = busy || !done || pending().length > 0;
    dl.update(done);
    if (busy || pending().length) downloadBtn.textContent = 'Processando…';
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function escapeHtml(value) {
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }

  updateUI();

  // Saiu da página: cancela o processamento agendado e libera os object URLs.
  signal.addEventListener('abort', () => {
    clearTimeout(runTimer);
    runTimer = null;
    images.forEach(releaseItem);
    images = [];
  });
});
