/* Compressor e conversor de imagens.
 * Montado a cada exibição da página (src/scripts/app.ts); `document` é restrito à página
 * e `signal` é abortado quando o usuário navega para outra ferramenta. */
kompres.register('compressor', (signal, document) => {
  const qualitySlider = document.getElementById('quality-slider');
  const qualityVal = document.getElementById('quality-val');
  const fmtToggle = document.getElementById('fmt-toggle');
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const imageGrid = document.getElementById('image-grid');
  const btnCompress = document.getElementById('btn-compress');
  const btnDownloadAll = document.getElementById('btn-download-all');
  const btnClear = document.getElementById('btn-clear');
  const statsBar = document.getElementById('stats-bar');
  const statCount = document.getElementById('stat-count');
  const statOriginal = document.getElementById('stat-original');
  const statNew = document.getElementById('stat-new');
  const statSaved = document.getElementById('stat-saved');
  const cookieBanner = document.getElementById('cookie-banner');
  const modeToggle = document.getElementById('mode-toggle');
  const qualityGroup = document.getElementById('quality-group');
  const sizeGroup = document.getElementById('size-group');
  const targetSizeInput = document.getElementById('target-size');
  const targetUnit = document.getElementById('target-unit');

  // Formato inicial definido pela página (/, /converter/png-para-jpg/, ...).
  let selectedFormat = fmtToggle.querySelector('.fmt-btn.active')?.dataset.fmt || 'webp';
  let compressMode = 'quality'; // 'quality' | 'size'
  let images = [];
  let busy = false;
  let rerun = false;       // configurações mudaram ou chegaram arquivos durante um processamento
  let inputGeneration = 0;
  const statusLine = document.getElementById('compressor-status');
  function setStatus(message = '', error = false) {
    if (!statusLine) return;
    statusLine.textContent = message; statusLine.hidden = !message; statusLine.classList.toggle('error', error);
  }

  qualitySlider.addEventListener('input', () => {
    qualityVal.textContent = `${qualitySlider.value}%`;
    updateAllRangeFills();
  });

  qualitySlider.addEventListener('change', () => {
    resetCompressedResults();
  });

  fmtToggle.querySelectorAll('.fmt-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      fmtToggle.querySelectorAll('.fmt-btn').forEach((item) => item.classList.remove('active'));
      btn.classList.add('active');

      selectedFormat = btn.dataset.fmt;
      updateFormatControls();
      resetCompressedResults();
    });
  });

  modeToggle.querySelectorAll('.fmt-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.mode === compressMode) return;

      modeToggle.querySelectorAll('.fmt-btn').forEach((item) => item.classList.remove('active'));
      btn.classList.add('active');

      compressMode = btn.dataset.mode;
      updateFormatControls();
      sizeGroup.classList.toggle('hidden', compressMode !== 'size');

      if (compressMode === 'quality' && typeof updateAllRangeFills === 'function') updateAllRangeFills();
      resetCompressedResults();
    });
  });

  function updateFormatControls() {
    qualityGroup.classList.toggle('hidden', compressMode !== 'quality');
  }

  targetSizeInput.addEventListener('change', resetCompressedResults);
  targetUnit.addEventListener('change', resetCompressedResults);

  kompres.fileDrop({ signal, document, zone: dropZone, onFiles: handleFiles });

  fileInput.addEventListener('change', () => {
    handleFiles([...fileInput.files]);
  });

  btnCompress.addEventListener('click', () => compressAllImages(true));
  btnDownloadAll.addEventListener('click', downloadAllAsZip);
  btnClear.addEventListener('click', clearAll);

  function handleFiles(files) {
    const generation = inputGeneration;
    const validFiles = files.filter((file) => ['image/png', 'image/webp', 'image/jpeg'].includes(file.type));
    const skipped = files.length - validFiles.length;
    setStatus(skipped ? `${skipped} ${skipped === 1 ? 'arquivo ignorado' : 'arquivos ignorados'}: use PNG, JPG ou WebP.` : '', skipped > 0);
    fileInput.value = '';
    if (!validFiles.length) return;

    // Quando todos os arquivos terminarem de ser lidos, a compressão começa sozinha.
    let remaining = validFiles.length;
    const loaded = () => { if (--remaining === 0 && generation === inputGeneration) scheduleRun(); };

    validFiles.forEach((file) => {
      const id = `${Date.now()}-${Math.random()}`;
      const reader = new FileReader();

      reader.onload = (event) => {
        if (generation !== inputGeneration) return;
        images.push({
          id,
          file,
          dataUrl: event.target.result,
          compressed: null,
          compressedName: null,
        });

        renderCard(images[images.length - 1]);
        updateUI();
        updateStats();
        loaded();
      };
      reader.onerror = loaded;

      reader.readAsDataURL(file);
    });
  }

  // Processa o que estiver pendente; se já houver um processamento, ele repete ao terminar.
  function scheduleRun() {
    if (busy) { rerun = true; return; }
    compressAllImages();
  }

  function renderCard(image) {
    const card = document.createElement('div');
    card.className = 'image-card';
    card.dataset.id = image.id;

    card.innerHTML = `
      <div class="card-thumb-wrap">
        <img class="card-thumb" src="${image.dataUrl}" alt="${escapeHtml(image.file.name)}">
        <button class="card-remove" type="button" title="Remover" aria-label="Remover imagem">✕</button>
        <span class="card-saving-overlay" id="overlay-${image.id}"></span>
      </div>

      <div class="card-body">
        <div class="card-name">${escapeHtml(image.file.name)}</div>
        <div class="progress-bar"><div class="progress-fill" id="prog-${image.id}"></div></div>
        <div class="card-sizes" id="sizes-${image.id}">
          <span class="size-original">${formatBytes(image.file.size)}</span>
          <span class="size-arrow">→</span>
          <span class="size-new" style="color:var(--muted)!important">aguardando</span>
        </div>
        <div class="card-note" id="note-${image.id}"></div>
        <button class="card-download" type="button" disabled id="dl-${image.id}">↓ baixar</button>
      </div>
    `;

    card.querySelector('.card-remove').addEventListener('click', () => removeImage(image.id));

    // Segurar a miniatura mostra o original; soltar volta ao resultado.
    const thumb = card.querySelector('.card-thumb');
    thumb.draggable = false;
    thumb.addEventListener('pointerdown', (event) => {
      if (!image.resultUrl || event.button !== 0) return;
      event.preventDefault();
      thumb.src = image.dataUrl;
      card.classList.add('comparing');
    });
    const release = () => {
      if (!card.classList.contains('comparing')) return;
      card.classList.remove('comparing');
      thumb.src = image.resultUrl || image.dataUrl;
    };
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((type) => thumb.addEventListener(type, release));
    thumb.addEventListener('contextmenu', (event) => { if (image.resultUrl) event.preventDefault(); });

    imageGrid.appendChild(card);
  }

  function removeImage(id) {
    const removed = images.find((image) => image.id === id);
    if (removed) {
      removed.runId = (removed.runId || 0) + 1;
      if (removed.resultUrl) URL.revokeObjectURL(removed.resultUrl);
    }
    images = images.filter((image) => image.id !== id);

    const card = document.querySelector(`.image-card[data-id="${CSS.escape(id)}"]`);
    if (card) {
      card.style.transition = 'opacity 0.18s, transform 0.18s';
      card.style.opacity = '0';
      card.style.transform = 'scale(0.9)';
      setTimeout(() => card.remove(), 180);
    }

    updateUI();
    updateStats();
  }

  function resetCompressedResults({ run = true } = {}) {
    images.forEach((image) => {
      if (image.resultUrl) URL.revokeObjectURL(image.resultUrl);
      image.resultUrl = null;
      image.compressed = null;
      image.compressedName = null;
      image.awaiting = false;
      image.failed = false;
      image.runId = (image.runId || 0) + 1;
      setNote(image, '');

      const card = document.querySelector(`.image-card[data-id="${CSS.escape(image.id)}"]`);
      const progress = document.getElementById(`prog-${image.id}`);
      const sizes = document.getElementById(`sizes-${image.id}`);
      const overlay = document.getElementById(`overlay-${image.id}`);
      const downloadButton = document.getElementById(`dl-${image.id}`);

      if (card) {
        card.classList.remove('done');
        card.querySelector('.card-thumb').src = image.dataUrl;
      }
      if (progress) progress.style.width = '0%';

      if (sizes) {
        sizes.innerHTML = `
          <span class="size-original">${formatBytes(image.file.size)}</span>
          <span class="size-arrow">→</span>
          <span class="size-new" style="color:var(--muted)!important">aguardando</span>
        `;
      }

      if (overlay) {
        overlay.textContent = '';
        overlay.style.display = 'none';
      }

      if (downloadButton) {
        downloadButton.disabled = true;
        downloadButton.onclick = null;
      }
    });

    updateUI();
    updateStats();
    if (run && images.length) scheduleRun();
  }

  // Imagens ainda sem resultado (e que não estão esperando uma resposta do usuário).
  const pendingImages = () => images.filter((image) => !image.compressed && !image.awaiting && !image.failed);

  async function compressAllImages(force = false) {
    if (busy) { rerun = true; return; }
    if (force) resetCompressedResults({ run: false });
    if (!pendingImages().length) { updateUI(); return; }

    busy = true;
    updateUI();

    do {
      rerun = false;
      // Lidas a cada rodada: podem ter mudado durante o processamento.
      const format = selectedFormat;
      const quality = Number(qualitySlider.value) / 100;
      const target = getTarget();

      if (compressMode === 'size' && !target) {
        setStatus('Informe um tamanho máximo válido para começar.', true);
        break;
      }
      setStatus('');

      for (const image of pendingImages()) {
        if (!images.includes(image)) continue;

        const run = (image.runId = (image.runId || 0) + 1);
        setNote(image, '');
        const progress = document.getElementById(`prog-${image.id}`);
        if (progress) progress.style.width = '15%';

        try {
          if (compressMode === 'size') {
            const result = await compressToTarget(image, format, target.bytes, progress);
            if (image.runId !== run) continue;

            if (result.fits) {
              showResult(image, result.blob, format, { note: `${result.label} · até ${target.label}` });
            } else {
              askResize(image, format, target, result.blob);
            }
          } else {
            let blob = await compressImage(image.dataUrl, format, quality);
            if (image.runId !== run) continue;

            if (!isConversion(image, format) && blob.size >= image.file.size) {
              blob = image.file;
            }
            showResult(image, blob, format, { note: blob === image.file ? 'Original mantido: não houve redução com esta qualidade.' : '' });
          }
        } catch (error) {
          if (image.runId !== run) continue;
          image.failed = true;
          setNote(image, 'Não foi possível processar esta imagem. Verifique o arquivo e tente novamente.', true);
          if (progress) progress.style.width = '0%';
        }
      }
    } while (rerun);

    busy = false;
    updateUI();
  }

  /* Exibe o resultado final no card */
  function showResult(image, blob, format, { note = '', warn = false, name = null } = {}) {
    const card = document.querySelector(`.image-card[data-id="${CSS.escape(image.id)}"]`);
    if (!card) return;

    if (image.resultUrl) URL.revokeObjectURL(image.resultUrl);
    image.resultUrl = URL.createObjectURL(blob);
    card.querySelector('.card-thumb').src = image.resultUrl;
    image.compressed = blob;
    image.compressedName = name || `${stripExtension(image.file.name)}-kompres.${format}`;

    const progress = document.getElementById(`prog-${image.id}`);
    if (progress) progress.style.width = '100%';

    document.getElementById(`sizes-${image.id}`).innerHTML = `
      <span class="size-original">${formatBytes(image.file.size)}</span>
      <span class="size-arrow">→</span>
      <span class="size-new">${formatBytes(blob.size)}</span>
    `;

    const savedPercent = calculateSavingPercent(image.file.size, blob.size);
    const overlay = document.getElementById(`overlay-${image.id}`);
    if (savedPercent > 0) {
      overlay.textContent = `-${savedPercent}%`;
      overlay.style.display = 'block';
    } else {
      overlay.textContent = '';
      overlay.style.display = 'none';
    }

    setNote(image, note, warn);

    const downloadButton = document.getElementById(`dl-${image.id}`);
    downloadButton.disabled = false;
    downloadButton.onclick = () => downloadBlob(blob, image.compressedName);

    card.classList.add('done');
    updateUI();
    updateStats();
  }

  function setNote(image, text, warn = false) {
    const note = document.getElementById(`note-${image.id}`);
    if (!note) return;
    note.className = warn ? 'card-note warn' : 'card-note';
    note.textContent = text;
  }

  /* ── Modo "Tamanho máximo" ── */

  // Base 1000 de propósito: 300 KB = 300.000 bytes. Assim o arquivo fica dentro do
  // limite tanto em sistemas que contam KB como 1000 quanto como 1024 bytes.
  function getTarget() {
    const value = parseFloat(String(targetSizeInput.value).replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) return null;
    const unit = targetUnit.value;
    return {
      bytes: Math.floor(value * (unit === 'MB' ? 1000 * 1000 : 1000)),
      label: `${value} ${unit}`,
    };
  }

  // Busca a MAIOR qualidade que ainda cabe no limite
  async function compressToTarget(image, format, targetBytes, progress) {
    const setProgress = (pct) => { if (progress) progress.style.width = `${pct}%`; };

    // já cabe e não é conversão: mantém o original, sem perda nenhuma
    if (!isConversion(image, format) && image.file.size <= targetBytes) {
      return { fits: true, blob: image.file, label: 'original já estava no limite' };
    }

    if (format === 'png') return pngToTarget(image, targetBytes, setProgress);

    const MIN = 0.3;
    const MAX = 0.95;

    const top = await compressImage(image.dataUrl, format, MAX);
    if (top.size <= targetBytes) return { fits: true, blob: top, label: `qualidade ${Math.round(MAX * 100)}%` };
    setProgress(25);

    const bottom = await compressImage(image.dataUrl, format, MIN);
    if (bottom.size > targetBytes) return { fits: false, blob: bottom };
    setProgress(35);

    let lo = MIN;
    let hi = MAX;
    let best = { blob: bottom, q: MIN };
    const steps = 7;

    for (let i = 0; i < steps; i++) {
      const mid = (lo + hi) / 2;
      const blob = await compressImage(image.dataUrl, format, mid);
      if (blob.size <= targetBytes) {
        best = { blob, q: mid };
        lo = mid;
      } else {
        hi = mid;
      }
      setProgress(35 + Math.round(((i + 1) / steps) * 60));
    }

    return { fits: true, blob: best.blob, label: `qualidade ${Math.round(best.q * 100)}%` };
  }

  // PNG: tenta compressão inteligente antes de oferecer redução de dimensões.
  async function pngToTarget(image, targetBytes, setProgress) {
    let blob = await compressPNG(image.dataUrl, 1, 1, targetBytes);
    if (!isConversion(image, 'png') && image.file.size < blob.size) blob = image.file;
    setProgress(90);
    return { fits: blob.size <= targetBytes, blob, label: 'Concluído' };
  }

  // Não coube nem na qualidade mínima: pergunta antes de redimensionar
  function askResize(image, format, target, minBlob) {
    image.awaiting = true;
    const progress = document.getElementById(`prog-${image.id}`);
    if (progress) progress.style.width = '100%';

    const sizes = document.getElementById(`sizes-${image.id}`);
    if (sizes) {
      sizes.innerHTML = `
        <span class="size-original">${formatBytes(image.file.size)}</span>
        <span class="size-arrow">→</span>
        <span class="size-new">${formatBytes(minBlob.size)}</span>
      `;
    }

    const note = document.getElementById(`note-${image.id}`);
    if (!note) return;

    const run = image.runId;
    note.className = 'card-note warn';
    note.innerHTML = `
      <span>Com as configurações atuais ficou acima de ${escapeHtml(target.label)}. Posso reduzir as dimensões para caber?</span>
      <div class="card-note-actions">
        <button class="card-download primary" type="button" data-act="resize">Redimensionar</button>
        <button class="card-download" type="button" data-act="keep">Manter assim</button>
      </div>
    `;

    note.querySelector('[data-act="resize"]').onclick = async () => {
      if (image.runId !== run || busy) return;
      image.awaiting = false;
      busy = true; updateUI();
      try {
      setNote(image, 'Redimensionando…');
      if (progress) progress.style.width = '30%';

      const result = await resizeToTarget(image, format, target.bytes, progress);
      if (image.runId !== run) return;

      if (result) {
        showResult(image, result.blob, format, {
          note: `redimensionada para ${result.width}×${result.height} px · até ${target.label}`,
          name: `${stripExtension(image.file.name)}-${result.width}x${result.height}-kompres.${format}`,
        });
      } else {
        showResult(image, minBlob, format, {
          note: `Não foi possível chegar a ${target.label}. Mantida a versão disponível.`,
          warn: true,
        });
      }
      } catch { image.failed = true; setNote(image, 'Falha ao redimensionar. Tente novamente.', true); }
      finally { busy = false; updateUI(); if (rerun) scheduleRun(); }
    };

    note.querySelector('[data-act="keep"]').onclick = () => {
      if (image.runId !== run) return;
      image.awaiting = false;
      showResult(image, minBlob, format, {
        note: `acima de ${target.label} · dimensões originais`,
        warn: true,
      });
    };
  }

  // Maior escala (dimensões) que cabe no limite, com qualidade boa fixa
  async function resizeToTarget(image, format, targetBytes, progress) {
    const source = await loadImage(image.dataUrl);
    const quality = format === 'png' ? 0.75 : 0.8;
    const steps = format === 'png' ? 5 : 8;

    let lo = 0.05;
    let hi = 1;
    let best = null;

    for (let i = 0; i < steps; i++) {
      const mid = (lo + hi) / 2;
      const blob = await compressImage(image.dataUrl, format, quality, mid);
      if (blob.size <= targetBytes) {
        best = { blob, scale: mid };
        lo = mid;
      } else {
        hi = mid;
      }
      if (progress) progress.style.width = `${30 + Math.round(((i + 1) / steps) * 70)}%`;
    }

    if (!best) {
      const blob = await compressImage(image.dataUrl, format, quality, 0.05);
      if (blob.size > targetBytes) return null;
      best = { blob, scale: 0.05 };
    }

    return {
      blob: best.blob,
      width: scaledSize(source.naturalWidth, best.scale),
      height: scaledSize(source.naturalHeight, best.scale),
    };
  }

  function scaledSize(value, scale) {
    return Math.max(1, Math.round(value * scale));
  }

  function isConversion(image, format) {
    return image.file.type !== `image/${format}`;
  }

  function stripExtension(name) {
    return name.replace(/\.(png|webp|jpe?g)$/i, '');
  }

  async function downloadAllAsZip() {
    const doneImages = images.filter((image) => image.compressed);
    if (!doneImages.length) return;
    if (doneImages.length === 1) { downloadBlob(doneImages[0].compressed, doneImages[0].compressedName); return; }

    btnDownloadAll.textContent = 'Gerando ZIP...';
    btnDownloadAll.disabled = true;

    try {
    const zip = new JSZip();
    doneImages.forEach((image, index) => {
      zip.file(`${index + 1}-${image.compressedName}`, image.compressed);
    });

    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, 'imagens-kompres.zip');

    } catch { setStatus('Não foi possível gerar o ZIP. Tente novamente.', true); }
    finally { updateUI(); }
  }

  function clearAll() {
    inputGeneration++;
    images.forEach((image) => {
      image.runId = (image.runId || 0) + 1;
      if (image.resultUrl) URL.revokeObjectURL(image.resultUrl);
    });
    images = [];
    imageGrid.innerHTML = '';
    fileInput.value = '';
    setStatus('');
    updateUI();
    updateStats();
  }

  // Controles ficam ativos durante o processamento: mudar algo refaz o resultado.
  function updateUI() {
    const hasImages = images.length > 0;
    const done = images.filter((image) => image.compressed).length;

    document.querySelectorAll('.card-note-actions button').forEach((el) => el.disabled = busy);
    btnCompress.disabled = busy || !hasImages;
    btnCompress.textContent = busy ? 'Comprimindo…' : hasImages && !pendingImages().length ? 'Comprimir novamente' : 'Comprimir tudo';
    btnClear.disabled = !hasImages;
    btnDownloadAll.disabled = !done;
    btnDownloadAll.textContent = done === 1 ? '↓ Baixar' : '↓ Baixar ZIP';
  }

  function updateStats() {
    if (!images.length) {
      statsBar.hidden = true;
      statCount.textContent = '0';
      statOriginal.textContent = '—';
      statNew.textContent = '—';
      statSaved.textContent = '—';
      return;
    }

    const doneImages = images.filter((image) => image.compressed);
    const totalOriginal = images.reduce((sum, image) => sum + image.file.size, 0);
    const totalNew = doneImages.reduce((sum, image) => sum + image.compressed.size, 0);
    const originalDone = doneImages.reduce((sum, image) => sum + image.file.size, 0);
    const saved = originalDone - totalNew;
    const savedPercent = doneImages.length ? calculateSavingPercent(originalDone, totalNew) : 0;

    statsBar.hidden = false;
    statCount.textContent = images.length;
    statOriginal.textContent = formatBytes(totalOriginal);

    if (!doneImages.length) {
      statNew.textContent = 'aguardando';
      statSaved.textContent = 'aguardando';
      return;
    }

    statNew.textContent = formatBytes(totalNew);
    statSaved.textContent = `${formatSignedBytes(saved)} (${savedPercent}%)`;
  }

  async function compressImage(dataUrl, format, quality, scale = 1) {
    if (format === 'png') return compressPNG(dataUrl, quality, scale);
    return compressCanvas(dataUrl, format, quality, scale);
  }

  function compressCanvas(dataUrl, format, quality, scale = 1) {
    return new Promise((resolve, reject) => {
      const image = new Image();

      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = scaledSize(image.naturalWidth, scale);
        canvas.height = scaledSize(image.naturalHeight, scale);

        const context = canvas.getContext('2d');
        context.imageSmoothingEnabled = scale !== 1;
    context.imageSmoothingQuality = 'high';
        if (format === 'jpeg') { context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); }
        if (scale === 1) context.drawImage(image, 0, 0);
    else context.drawImage(image, 0, 0, canvas.width, canvas.height);

        const mimeType = format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
        canvas.toBlob((blob) => {
          if (!blob || blob.type !== mimeType) reject(new Error('Formato não suportado pelo navegador.'));
          else resolve(blob);
        }, mimeType, quality);
      };

      image.onerror = () => reject(new Error('Imagem inválida.'));
      image.src = dataUrl;
    });
  }

  async function compressPNG(dataUrl, quality, scale = 1, targetBytes = null) {
    const image = await loadImage(dataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = scaledSize(image.naturalWidth, scale);
    canvas.height = scaledSize(image.naturalHeight, scale);

    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = scale !== 1;
    context.imageSmoothingQuality = 'high';
    if (scale === 1) context.drawImage(image, 0, 0);
    else context.drawImage(image, 0, 0, canvas.width, canvas.height);

    // Otimização em Web Worker (png-client.js). Sem upload.
    return kompres.pngFromCanvas(canvas, quality, targetBytes);
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
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

  updateAllRangeFills();
  updateFormatControls();

  // Saiu da página: descarta arquivos e libera os object URLs.
  signal.addEventListener('abort', clearAll);
});
