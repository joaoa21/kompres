/* Redimensionador de imagens.
 * Montado a cada exibição da página (src/scripts/app.ts); `document` é restrito à página
 * e `signal` é abortado quando o usuário navega para outra ferramenta. */
kompres.register('resizer', (signal, document) => {
  const fileInput = document.getElementById('fileInput');
  const dropZone = document.getElementById('dropZone');
  const processBtn = document.getElementById('processBtn');
  const downloadZipBtn = document.getElementById('downloadZipBtn');
  const clearBtn = document.getElementById('clearBtn');
  const previewList = document.getElementById('previewList');
  const statusLine = document.getElementById('resizer-status');
  const groups = { width: document.getElementById('widthGroup'), height: document.getElementById('heightGroup'), percent: document.getElementById('percentGroup'), exact: document.getElementById('exactGroup') };
  const maxWidthInput = document.getElementById('maxWidth');
  const maxHeightInput = document.getElementById('maxHeight');
  const percentSelect = document.getElementById('percent');
  const exactWidthInput = document.getElementById('exactWidth');
  const exactHeightInput = document.getElementById('exactHeight');
  const exactFitSelect = document.getElementById('exactFit');
  const statsBar = document.getElementById('statsBar');
  const statCount = document.getElementById('statCount');
  const statOriginal = document.getElementById('statOriginal');
  const statNew = document.getElementById('statNew');
  const statSaved = document.getElementById('statSaved');

  let imageData = [];
  let busy = false;
  let rerun = false; // configurações mudaram ou chegaram arquivos durante um processamento
  let settingsTimer;

  function setStatus(message = '', error = false) {
    statusLine.textContent = message; statusLine.hidden = !message; statusLine.classList.toggle('error', error);
  }

  fileInput.addEventListener('change', async (event) => {
    await handleFiles([...event.target.files]);
  });
  kompres.fileDrop({ signal, document, zone: dropZone, onFiles: handleFiles });

  document.querySelectorAll('input[name="resizeMode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const mode = getResizeMode();
      Object.entries(groups).forEach(([key, group]) => group.classList.toggle('hidden', key !== mode));
      updateActiveToggle('resizeMode');
      settingsChanged();
    });
  });

  // Digitar um número refaz o resultado depois de uma pequena pausa.
  [maxWidthInput, maxHeightInput, exactWidthInput, exactHeightInput].forEach((input) => {
    input.addEventListener('input', () => { clearTimeout(settingsTimer); settingsTimer = setTimeout(settingsChanged, 350); });
    input.addEventListener('change', settingsChanged);
  });
  [percentSelect, exactFitSelect].forEach((select) => select.addEventListener('change', settingsChanged));

  processBtn.addEventListener('click', () => processImages(true));
  downloadZipBtn.addEventListener('click', downloadAllAsZip);
  clearBtn.addEventListener('click', clearAll);

  async function handleFiles(files) {
    const valid = files.filter((file) => ['image/png', 'image/jpeg', 'image/webp'].includes(file.type));
    const skipped = files.length - valid.length;
    setStatus(skipped ? `${skipped} ${skipped === 1 ? 'arquivo ignorado' : 'arquivos ignorados'}: use PNG, JPG ou WebP.` : '', skipped > 0);
    fileInput.value = '';
    if (!valid.length) return;

    const failed = [];
    for (const file of valid) {
      try { imageData.push(await getImageInfo(file)); } catch { failed.push(file.name); }
    }
    if (failed.length) setStatus(`Não foi possível abrir: ${failed.join(', ')}`, true);

    renderPreviews();
    updateStats();
    updateUI();
    scheduleRun();
  }

  function getResizeMode() {
    return document.querySelector('input[name="resizeMode"]:checked').value;
  }

  function updateActiveToggle(groupName) {
    document.querySelectorAll(`input[name="${groupName}"]`).forEach((input) => {
      const label = input.closest('.fmt-btn');
      if (!label) return;
      label.classList.toggle('active', input.checked);
    });
  }

  function getImageInfo(file) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const previewUrl = URL.createObjectURL(file);

      image.onload = () => {
        resolve({
          file,
          previewUrl,
          originalWidth: image.naturalWidth,
          originalHeight: image.naturalHeight,
          originalSize: file.size,
          processed: null,
          downloadUrl: null,
          failed: false,
        });
      };

      image.onerror = () => { URL.revokeObjectURL(previewUrl); reject(new Error('Imagem inválida.')); };
      image.src = previewUrl;
    });
  }

  const positive = (input, fallback) => {
    const value = Math.round(Number(input.value));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };

  /**
   * Dimensões finais e recorte de origem (sx, sy, sw, sh) para o drawImage.
   * Largura/Altura/Porcentagem mantêm a proporção e não ampliam.
   * Exato produz o tamanho pedido: "cortar" preenche a caixa recortando o centro;
   * "caber" ajusta dentro da caixa sem cortar (o resultado pode ser menor que a caixa).
   */
  function calculateNewDimensions(originalWidth, originalHeight) {
    const mode = getResizeMode();
    const full = { sx: 0, sy: 0, sw: originalWidth, sh: originalHeight };
    const ratio = originalHeight / originalWidth;

    if (mode === 'width') {
      const width = Math.min(originalWidth, positive(maxWidthInput, originalWidth));
      return { width, height: Math.max(1, Math.round(width * ratio)), ...full };
    }
    if (mode === 'height') {
      const height = Math.min(originalHeight, positive(maxHeightInput, originalHeight));
      return { width: Math.max(1, Math.round(height / ratio)), height, ...full };
    }
    if (mode === 'percent') {
      const percent = Math.max(Number(percentSelect.value), 1) / 100;
      return { width: Math.max(1, Math.round(originalWidth * percent)), height: Math.max(1, Math.round(originalHeight * percent)), ...full };
    }

    const boxWidth = positive(exactWidthInput, originalWidth);
    const boxHeight = positive(exactHeightInput, originalHeight);
    if (exactFitSelect.value === 'contain') {
      const scale = Math.min(boxWidth / originalWidth, boxHeight / originalHeight);
      return { width: Math.max(1, Math.round(originalWidth * scale)), height: Math.max(1, Math.round(originalHeight * scale)), ...full };
    }
    // cover: recorta o centro para preencher exatamente a caixa
    const scale = Math.max(boxWidth / originalWidth, boxHeight / originalHeight);
    const sw = Math.min(originalWidth, Math.round(boxWidth / scale));
    const sh = Math.min(originalHeight, Math.round(boxHeight / scale));
    return { width: boxWidth, height: boxHeight, sx: Math.round((originalWidth - sw) / 2), sy: Math.round((originalHeight - sh) / 2), sw, sh };
  }

  function renderPreviews() {
    previewList.innerHTML = '';

    imageData.forEach((data, index) => {
      const dimensions = calculateNewDimensions(data.originalWidth, data.originalHeight);
      const savingPercent = data.processed
        ? calculateSavingPercent(data.originalSize, data.processed.blob.size)
        : 0;

      const card = document.createElement('div');
      card.className = data.processed ? 'preview-card done' : 'preview-card';
      card.dataset.index = index;

      const processedHtml = data.processed
        ? `
          <small>${data.originalWidth}x${data.originalHeight} → ${data.processed.width}x${data.processed.height}</small>
          <small>${formatBytes(data.originalSize)} → <span class="size-new">${formatBytes(data.processed.blob.size)}</span></small>
          <a class="download-btn" href="${data.downloadUrl}" download="${escapeHtml(data.processed.fileName)}">↓ baixar</a>
        `
        : `
          <small>Dimensão atual: ${data.originalWidth}x${data.originalHeight}</small>
          <small class="future-size">Nova dimensão: ${dimensions.width}x${dimensions.height}</small>
          <small class="${data.failed ? 'card-error' : ''}">${data.failed ? 'Não foi possível redimensionar' : `${formatBytes(data.originalSize)} → aguardando`}</small>
          <button class="download-btn" type="button" disabled>↓ baixar</button>
        `;

      card.innerHTML = `
        <div class="card-thumb-wrap">
          <img src="${data.processed ? data.downloadUrl : data.previewUrl}" alt="Preview da imagem">
          <button class="card-remove" type="button" data-ah-label="Remover imagem" data-index="${index}" aria-label="Remover imagem">×</button>
          <span class="card-saving-overlay">-${savingPercent}%</span>
        </div>
        <div class="preview-info">
          <strong>${escapeHtml(data.file.name)}</strong>
          ${processedHtml}
        </div>
      `;

      previewList.appendChild(card);
    });

    document.querySelectorAll('.card-remove').forEach((button) => {
      button.addEventListener('click', () => removeImage(Number(button.dataset.index)));
    });
  }

  // Configuração mudou: descarta os resultados e refaz com a nova.
  function settingsChanged() {
    clearTimeout(settingsTimer);
    imageData.forEach(item => {
      if (item.downloadUrl) URL.revokeObjectURL(item.downloadUrl);
      item.processed = null; item.downloadUrl = null; item.failed = false;
    });
    renderPreviews(); updateStats(); updateUI();
    scheduleRun();
  }

  function scheduleRun() {
    if (!imageData.length) return;
    if (busy) { rerun = true; return; }
    processImages();
  }

  const pendingItems = () => imageData.filter((item) => !item.processed && !item.failed);

  async function processImages(force = false) {
    if (busy) { rerun = true; return; }
    if (force) imageData.forEach(item => { if (item.downloadUrl) URL.revokeObjectURL(item.downloadUrl); item.processed = null; item.downloadUrl = null; item.failed = false; });
    if (!pendingItems().length) { updateUI(); return; }

    busy = true;
    updateUI();

    do {
      rerun = false;
      for (const item of pendingItems()) {
        if (!imageData.includes(item)) continue;
        try {
          const processed = await resizeImage(item.file);
          if (!imageData.includes(item) || item.processed || rerun) continue; // removida ou configurações mudaram
          item.processed = processed;
          item.downloadUrl = URL.createObjectURL(processed.blob);
        } catch { item.failed = true; }
        renderPreviews();
        updateStats();
      }
    } while (rerun);

    busy = false;
    updateUI();
  }

  async function resizeImage(file) {
    const image = await loadImage(file);
    const dimensions = calculateNewDimensions(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;

    const context = canvas.getContext('2d');
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, dimensions.sx, dimensions.sy, dimensions.sw, dimensions.sh, 0, 0, dimensions.width, dimensions.height);

    const mimeType = file.type || 'image/png';
    const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1];

    // PNG passa pelo otimizador sem perdas (png-client.js): o PNG do canvas é grande.
    const blob = mimeType === 'image/png'
      ? await kompres.pngFromCanvas(canvas, 1)
      : await new Promise((resolve, reject) => canvas.toBlob((result) => {
          if (!result || result.type !== mimeType) reject(new Error('Erro ao gerar imagem.'));
          else resolve(result);
        }, mimeType, 0.9));

    const baseName = file.name.replace(/\.[^/.]+$/, '');
    return { blob, fileName: `${baseName}-${dimensions.width}x${dimensions.height}-kompres.${extension}`, width: dimensions.width, height: dimensions.height };
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imagem inválida.')); };
      image.src = url;
    });
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function downloadAllAsZip() {
    const processedImages = imageData.filter((item) => item.processed);
    if (!processedImages.length) return;
    if (processedImages.length === 1) { downloadBlob(processedImages[0].processed.blob, processedImages[0].processed.fileName); return; }

    downloadZipBtn.disabled = true;
    downloadZipBtn.textContent = 'Gerando ZIP...';

    try {
      const zip = new JSZip();
      processedImages.forEach((item, index) => {
        zip.file(`${index + 1}-${item.processed.fileName}`, item.processed.blob);
      });
      downloadBlob(await zip.generateAsync({ type: 'blob' }), 'imagens-redimensionadas.zip');
    } catch { setStatus('Não foi possível gerar o ZIP. Tente novamente.', true); }
    finally { updateUI(); }
  }

  function removeImage(index) {
    const item = imageData[index];
    if (!item) return;

    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    if (item.downloadUrl) URL.revokeObjectURL(item.downloadUrl);

    imageData.splice(index, 1);
    renderPreviews();
    updateStats();
    updateUI();

    if (!imageData.length) fileInput.value = '';
  }

  function clearAll() {
    imageData.forEach((item) => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      if (item.downloadUrl) URL.revokeObjectURL(item.downloadUrl);
    });

    imageData = [];
    previewList.innerHTML = '';
    fileInput.value = '';
    setStatus('');
    updateStats();
    updateUI();
  }

  // Controles ficam ativos durante o processamento: mudar algo refaz o resultado.
  function updateUI() {
    const hasImages = imageData.length > 0;
    const done = imageData.filter((item) => item.processed).length;

    processBtn.disabled = busy || !hasImages;
    processBtn.textContent = busy ? 'Processando…' : hasImages && !pendingItems().length ? 'Redimensionar novamente' : 'Redimensionar tudo';
    clearBtn.disabled = !hasImages;
    downloadZipBtn.disabled = !done;
    downloadZipBtn.textContent = done === 1 ? '↓ Baixar' : '↓ Baixar ZIP';
  }

  function updateStats() {
    const totalFiles = imageData.length;

    if (!totalFiles) {
      statsBar.hidden = true;
      statCount.textContent = '0';
      statOriginal.textContent = '—';
      statNew.textContent = '—';
      statSaved.textContent = '—';
      return;
    }

    const totalOriginal = imageData.reduce((sum, item) => sum + item.originalSize, 0);
    const processedImages = imageData.filter((item) => item.processed);
    const totalNew = processedImages.reduce((sum, item) => sum + item.processed.blob.size, 0);
    const originalDone = processedImages.reduce((sum, item) => sum + item.originalSize, 0);
    const saved = originalDone - totalNew;
    const savingPercent = processedImages.length ? calculateSavingPercent(originalDone, totalNew) : 0;

    statsBar.hidden = false;
    statCount.textContent = totalFiles;
    statOriginal.textContent = formatBytes(totalOriginal);

    if (!processedImages.length) {
      statNew.textContent = 'aguardando';
      statSaved.textContent = 'aguardando';
      return;
    }

    statNew.textContent = formatBytes(totalNew);
    statSaved.textContent = `${formatSignedBytes(saved)} (${savingPercent}%)`;
  }

  function calculateSavingPercent(originalSize, newSize) {
    if (!originalSize || !newSize) return 0;
    return Math.max(Math.round(((originalSize - newSize) / originalSize) * 100), 0);
  }

  function formatSignedBytes(bytes) {
    const sign = bytes >= 0 ? '-' : '+';
    return `${sign}${formatBytes(Math.abs(bytes))}`;
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function escapeHtml(value) {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  updateUI();

  // Saiu da página: libera os object URLs das prévias e resultados.
  signal.addEventListener('abort', () => {
    clearTimeout(settingsTimer);
    imageData.forEach((item) => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      if (item.downloadUrl) URL.revokeObjectURL(item.downloadUrl);
    });
    imageData = [];
  });
});
