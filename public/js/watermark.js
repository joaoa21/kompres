/* Marca d'água (texto ou logo) em imagens, em lote.
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

  const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];
  const LOGO_TYPES = [...ACCEPTED, 'image/svg+xml'];

  let images = [];
  let logo = null; // { image: HTMLImageElement, url }
  let position = 'br';
  let busy = false;
  let rerun = false; // configurações mudaram ou chegaram arquivos durante um processamento
  let settingsTimer;

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

  textInput.addEventListener('input', () => debounceSettings(150));
  logoInput.addEventListener('change', chooseLogo);

  positionButtons.forEach((button) => {
    button.addEventListener('click', () => {
      position = button.dataset.pos;
      positionButtons.forEach((other) => other.setAttribute('aria-pressed', String(other === button)));
      settingsChanged();
    });
  });

  // Ranges: mostra o valor ao lado do rótulo e refaz depois de uma pequena pausa.
  Object.values(ranges).forEach((range) => {
    range.addEventListener('input', () => { showRangeValue(range); debounceSettings(150); });
    range.addEventListener('change', settingsChanged);
    showRangeValue(range);
  });

  processBtn.addEventListener('click', () => processAll(true));
  downloadBtn.addEventListener('click', downloadAll);
  clearBtn.addEventListener('click', clearAll);

  const getType = () => document.querySelector('input[name="wmType"]:checked')?.value || 'text';
  const getColor = () => document.querySelector('input[name="wmColor"]:checked')?.value || 'white';

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
    const mark = prepareMark(context, settings, width);
    context.globalAlpha = settings.opacity;
    const margin = Math.round(Math.min(width, height) * settings.margin);

    if (settings.position === 'tile') drawTiled(context, mark, width, height);
    else {
      const { x, y } = anchor(settings.position, width, height, mark.width, mark.height, margin);
      mark.draw(x, y);
    }

    const { blob, extension } = await encode(canvas, file.type);
    const baseName = file.name.replace(/\.[^/.]+$/, '');
    return { blob, fileName: `${baseName}-marca-dagua-kompres.${extension}` };
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
    render();
    updateUI();
  }

  function clearAll() {
    images.forEach((item) => {
      URL.revokeObjectURL(item.previewUrl);
      if (item.downloadUrl) URL.revokeObjectURL(item.downloadUrl);
    });
    images = [];
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
  updateUI();

  // Saiu da página: libera os object URLs das prévias, resultados e do logo.
  signal.addEventListener('abort', () => {
    clearTimeout(settingsTimer);
    images.forEach((item) => {
      URL.revokeObjectURL(item.previewUrl);
      if (item.downloadUrl) URL.revokeObjectURL(item.downloadUrl);
    });
    images = [];
    if (logo) URL.revokeObjectURL(logo.url);
    logo = null;
  });
});
