/* Melhorar imagem com IA: amplia 2× com o Swin2SR (public/js/upscale-worker.js).
 * Montado a cada exibição da página (src/scripts/app.ts); `document` é restrito à página
 * e `signal` é abortado ao navegar para outra ferramenta.
 * O worker devolve um bloco por vez; aqui cada bloco é pintado sobre a ampliação comum,
 * então o usuário vê a imagem melhorar aos poucos, e a transparência é recolocada a partir
 * do canal alfa ampliado pelo canvas (a IA só trata o RGB). */
kompres.register('upscale', (signal, document) => {
  const $ = (id) => document.getElementById(id);
  const fileInput = $('upFile'), dropZone = $('upDrop'), stage = $('upStage'), statusLine = $('upStatus');
  const runBtn = $('upRun'), cancelBtn = $('upCancel'), clearBtn = $('upClear');
  const zoomBtn = $('upZoom'), changeBtn = $('upChange'), reduceBtn = $('upReduce');
  const frame = $('upFrame'), viewer = $('upViewer'), scrollBox = $('upScroll'), compare = $('upCompare'), handle = $('upHandle');
  const before = $('upBefore'), after = $('upAfter');
  const progress = $('upProgress'), progressBar = $('upProgressBar');

  const MAX_SIDE = 1280, SCALE = 2;
  const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
  const FORMAT_OF = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

  let image = null;      // { file, source (canvas na resolução de trabalho), width, height, origWidth, origHeight, needsReduce, hasAlpha }
  let worker = null;
  let job = null;        // processamento em andamento: { start, device, done, total, alpha }
  let done = false;      // resultado pronto em `after`
  let saving = false;
  let zoom = false;
  let pos = 50;          // posição da linha de comparação, em %
  let drag = null;

  const fmt = (n) => n.toLocaleString('pt-BR');
  const checked = (name) => document.querySelector(`input[name="${name}"]:checked`).value;
  function setStatus(message = '', error = false) {
    statusLine.textContent = message; statusLine.hidden = !message; statusLine.classList.toggle('error', error);
  }
  function formatBytes(bytes) {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  function formatTime(seconds) {
    if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1).replace('.', ',') : Math.round(seconds)} s`;
    const m = Math.floor(seconds / 60), s = Math.round(seconds % 60);
    return `${m} min${s ? ` ${s} s` : ''}`;
  }
  const deviceName = (device) => device === 'webgpu' ? 'placa de vídeo (WebGPU)' : 'processador';
  const deviceWhere = (device) => device === 'webgpu' ? 'na placa de vídeo' : 'no processador';

  function canvas(width, height) {
    const c = document.createElement('canvas'); c.width = width; c.height = height; return c;
  }
  // Reduções grandes num passo só serrilham; metade por vez preserva os detalhes.
  function resample(source, width, height) {
    let current = source, w = source.width, h = source.height;
    while (w / 2 >= width && h / 2 >= height) {
      w = Math.round(w / 2); h = Math.round(h / 2);
      current = drawScaled(current, canvas(w, h));
    }
    return drawScaled(current, canvas(width, height));
  }
  function drawScaled(source, target) {
    const ctx = target.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, target.width, target.height);
    return target;
  }

  /* ---------- entrada ---------- */

  fileInput.addEventListener('change', () => { const file = fileInput.files[0]; fileInput.value = ''; if (file) load(file); });
  kompres.fileDrop({ signal, document, zone: dropZone, onFiles: (files) => load(files[0]) });
  changeBtn.addEventListener('click', () => fileInput.click());

  async function load(file) {
    if (!file) return;
    if (job || saving) { setStatus('Aguarde terminar ou cancele antes de trocar a imagem.', true); return; }
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { setStatus('Use uma imagem PNG, JPG ou WebP.', true); return; }
    if (file.size > 50 * 1024 * 1024) { setStatus('Use uma imagem de até 50 MB.', true); return; }
    setStatus('Abrindo imagem…');
    let bitmap;
    try {
      // from-image: respeita a orientação EXIF das fotos de celular.
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      setStatus('Não foi possível abrir a imagem. Verifique se o arquivo não está corrompido.', true); return;
    }
    if (signal.aborted) { bitmap.close(); return; }
    try {
      const ow = bitmap.width, oh = bitmap.height;
      if (ow * oh > 60e6) throw new Error('grande');
      const fit = Math.min(1, MAX_SIDE / Math.max(ow, oh));
      const width = Math.max(1, Math.round(ow * fit)), height = Math.max(1, Math.round(oh * fit));
      // A cópia reduzida já sai pronta; ela só é usada depois que o usuário aceitar.
      const source = fit < 1 ? resample(bitmap, width, height) : drawScaled(bitmap, canvas(width, height));
      dispose();
      image = { file, source, width, height, origWidth: ow, origHeight: oh, needsReduce: fit < 1, hasAlpha: false };
      if (file.type !== 'image/jpeg') {
        const data = source.getContext('2d').getImageData(0, 0, width, height).data;
        for (let i = 3; i < data.length; i += 4) if (data[i] < 255) { image.hasAlpha = true; break; }
      }
      document.querySelectorAll('input[name="upFormat"]').forEach((input) => { input.checked = input.value === FORMAT_OF[file.type]; });
      $('upName').textContent = file.name;
      $('upDims').textContent = `${fmt(ow)} × ${fmt(oh)} px · ${formatBytes(file.size)}`;
      setStatus();
      stage.hidden = false;
      if (image.needsReduce) {
        $('upNoticeText').textContent = `Esta imagem tem ${fmt(ow)} × ${fmt(oh)} px. A IA aceita até ${fmt(MAX_SIDE)} px no maior lado (o resultado sai com até ${fmt(MAX_SIDE * SCALE)} px). Reduza para ${fmt(width)} × ${fmt(height)} px antes de melhorar; a proporção é mantida.`;
        reduceBtn.textContent = `Reduzir para ${fmt(width)} × ${fmt(height)} px`;
        $('upNotice').hidden = false;
        // Enquanto não reduz, a prévia mostra a cópia reduzida (o original pode ser enorme).
        before.width = width; before.height = height;
        drawScaled(source, before);
      } else {
        prepareBefore();
      }
      setZoom(false);
      update();
    } catch {
      setStatus('Imagem grande demais para abrir no navegador. Reduza antes no redimensionador de imagens.', true);
    } finally {
      bitmap.close();
    }
  }

  reduceBtn.addEventListener('click', () => {
    if (!image || job) return;
    image.needsReduce = false;
    $('upNotice').hidden = true;
    $('upDims').textContent = `${fmt(image.width)} × ${fmt(image.height)} px (reduzida de ${fmt(image.origWidth)} × ${fmt(image.origHeight)} px)`;
    prepareBefore();
    update();
    runBtn.focus();
  });

  // "Antes": ampliação comum (bicúbica do canvas), do mesmo tamanho do resultado.
  function prepareBefore() {
    before.width = image.width * SCALE; before.height = image.height * SCALE;
    drawScaled(image.source, before);
    after.width = before.width; after.height = before.height;
    layout();
  }

  /* ---------- processamento ---------- */

  runBtn.addEventListener('click', () => { if (done) download(); else enhance(); });

  function enhance() {
    if (!image || image.needsReduce || job || saving) return;
    // O resultado começa igual ao "antes"; cada bloco pronto substitui o seu pedaço.
    const actx = after.getContext('2d');
    actx.clearRect(0, 0, after.width, after.height);
    actx.drawImage(before, 0, 0);
    job = {
      start: 0, device: null, done: 0, total: 0,
      alpha: image.hasAlpha ? before.getContext('2d').getImageData(0, 0, before.width, before.height).data : null,
    };
    done = false;
    setCompare(false);
    setWorking(true, 'Preparando…');
    setProgress(0);
    setStatus('Preparando a IA…');
    $('upInfoTime').textContent = 'em andamento';
    update();

    const pixels = image.source.getContext('2d').getImageData(0, 0, image.width, image.height).data;
    if (!worker) {
      worker = new Worker('/js/upscale-worker.js?v=1', { type: 'module' });
      worker.onerror = () => { if (job) fail('Não foi possível iniciar a IA. Verifique a conexão e tente novamente.'); else stopWorker(); };
    }
    worker.onmessage = ({ data }) => onMessage(data);
    worker.postMessage({ type: 'upscale', pixels: pixels.buffer, width: image.width, height: image.height }, [pixels.buffer]);
  }

  function onMessage(data) {
    if (!job) return;
    if (data.type === 'progress') {
      if (data.phase === 'download' && data.percent < 100) {
        setStatus(`Baixando o modelo de IA (cerca de 8 MB, só na primeira vez)… ${data.percent}%. Sem placa de vídeo compatível, o processamento pode levar alguns minutos.`);
        setWorking(true, `Baixando a IA… ${data.percent}%`);
      } else {
        setStatus('Carregando o modelo de IA…');
        setWorking(true, 'Carregando a IA…');
      }
    } else if (data.type === 'start' || data.type === 'device') {
      if (data.type === 'start') { job.start = performance.now(); job.total = data.total; }
      job.device = data.device;
      setStatus(`Melhorando… ${job.total ? Math.floor(job.done / job.total * 100) : 0}% (${deviceWhere(data.device)})`);
      setWorking(true, `Melhorando… ${job.total ? Math.floor(job.done / job.total * 100) : 0}%`);
    } else if (data.type === 'tile') {
      paintTile(data);
      job.done = data.done;
      const pct = Math.floor(data.done / data.total * 100);
      setProgress(pct);
      // Estimativa só depois de alguns blocos, quando o ritmo já é representativo.
      const elapsed = (performance.now() - job.start) / 1000;
      const left = data.done >= 3 && data.done < data.total ? elapsed / data.done * (data.total - data.done) : 0;
      setStatus(`Melhorando… ${pct}%${left > 5 ? ` · cerca de ${formatTime(left)} restantes` : ''}`);
      setWorking(true, `Melhorando… ${pct}%`);
    } else if (data.type === 'done') {
      const seconds = (performance.now() - job.start) / 1000;
      $('upInfoTime').textContent = `${formatTime(seconds)} · ${deviceName(job.device)}`;
      job = null; done = true;
      progress.hidden = true;
      // Só agora, com a imagem inteira pronta, aparece a comparação antes/depois.
      setWorking(false);
      setCompare(true);
      setStatus(`Pronto em ${formatTime(seconds)}. Arraste a linha sobre a imagem para comparar e use Ver em 100% para ver os detalhes.`);
      update();
    } else if (data.type === 'error') {
      fail(data.message);
    }
  }

  function paintTile({ x, y, width, height, pixels }) {
    const data = new Uint8ClampedArray(pixels);
    if (job.alpha) {
      // Transparência: alfa da ampliação comum, que é suave e não tem artefatos.
      const full = after.width;
      for (let row = 0; row < height; row++) {
        let s = ((y + row) * full + x) * 4 + 3, d = row * width * 4 + 3;
        for (let col = 0; col < width; col++, s += 4, d += 4) data[d] = job.alpha[s];
      }
    }
    after.getContext('2d').putImageData(new ImageData(data, width, height), x, y);
  }

  function stopWorker() { worker?.terminate(); worker = null; }

  function fail(message) {
    stopWorker();
    job = null; done = false;
    progress.hidden = true;
    setWorking(false);
    setCompare(false);
    $('upInfoTime').textContent = '—';
    setStatus(message, true);
    update();
  }

  cancelBtn.addEventListener('click', () => {
    if (!job) return;
    // Encerrar o worker é o único jeito de parar a inferência no meio de um bloco.
    stopWorker();
    job = null; done = false;
    progress.hidden = true;
    setWorking(false);
    setCompare(false);
    $('upInfoTime').textContent = '—';
    setStatus('Processamento cancelado.');
    update();
    runBtn.focus();
  });

  clearBtn.addEventListener('click', () => {
    if (saving) return;
    if (job) { stopWorker(); job = null; }
    setWorking(false);
    dispose();
    stage.hidden = true;
    setStatus();
    update();
  });

  function setProgress(pct) {
    progress.hidden = false;
    progressBar.style.width = `${pct}%`;
  }

  /* ---------- download ---------- */

  async function download() {
    if (!done || saving) return;
    saving = true; update();
    const format = checked('upFormat');
    setStatus(format === 'png' ? 'Otimizando o PNG…' : 'Preparando o arquivo…');
    try {
      let blob;
      if (format === 'png') {
        blob = await kompres.pngFromCanvas(after, 1);
      } else {
        let out = after;
        if (format === 'jpg') {
          // JPG não tem transparência: fundo branco em vez de preto.
          out = canvas(after.width, after.height);
          const ctx = out.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, out.width, out.height); ctx.drawImage(after, 0, 0);
        }
        blob = await new Promise((resolve, reject) => out.toBlob((b) => b ? resolve(b) : reject(new Error()), MIME[format], 0.92));
        if (out !== after) out.width = out.height = 0;
      }
      if (signal.aborted) return;
      const base = image.file.name.replace(/\.[^.]+$/, '').replace(/[\\/\x00-\x1f<>:"|?*]/g, '_').slice(0, 140) || 'imagem';
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = `${base}-2x-kompres.${format}`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setStatus(`Baixado: ${fmt(after.width)} × ${fmt(after.height)} px · ${formatBytes(blob.size)}.`);
    } catch {
      setStatus('Não foi possível gerar o arquivo. Tente outro formato.', true);
    } finally {
      saving = false; update();
    }
  }

  /* ---------- comparação antes/depois ---------- */

  // Carregamento: a prévia fica desfocada, com um círculo girando e o andamento por cima.
  function setWorking(on, text = '') {
    viewer.classList.toggle('is-working', on);
    viewer.setAttribute('aria-busy', String(on));
    if (text) $('upLoadingText').textContent = text;
  }

  function setCompare(on) {
    viewer.classList.toggle('is-compare', on);
    $('upHelp').hidden = !on;
    if (on) setPos(50);
  }
  function setPos(value) {
    pos = Math.min(100, Math.max(0, value));
    compare.style.setProperty('--pos', `${pos}%`);
    const p = Math.round(pos);
    handle.setAttribute('aria-valuenow', String(p));
    handle.setAttribute('aria-valuetext', `${p}% antes, ${100 - p}% depois`);
  }
  const posFromEvent = (event) => {
    const rect = compare.getBoundingClientRect();
    return (event.clientX - rect.left) / rect.width * 100;
  };

  compare.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !image) return;
    const comparing = viewer.classList.contains('is-compare');
    const onHandle = !!event.target.closest('.up-handle');
    if (comparing && (onHandle || !zoom)) {
      drag = { type: 'slider' };
      setPos(posFromEvent(event));
    } else if (zoom && event.pointerType === 'mouse') {
      // Em 100%, arrastar fora da linha move a imagem (no toque, a rolagem é a nativa).
      drag = { type: 'pan', x: event.clientX, y: event.clientY, left: scrollBox.scrollLeft, top: scrollBox.scrollTop };
      compare.classList.add('is-panning');
    } else return;
    event.preventDefault();
    compare.setPointerCapture(event.pointerId);
  });
  compare.addEventListener('pointermove', (event) => {
    if (!drag) return;
    if (drag.type === 'slider') setPos(posFromEvent(event));
    else { scrollBox.scrollLeft = drag.left - (event.clientX - drag.x); scrollBox.scrollTop = drag.top - (event.clientY - drag.y); }
  });
  const endDrag = () => { drag = null; compare.classList.remove('is-panning'); };
  compare.addEventListener('pointerup', endDrag);
  compare.addEventListener('pointercancel', endDrag);
  compare.addEventListener('lostpointercapture', endDrag);

  handle.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 10 : 2;
    const next = { ArrowLeft: pos - step, ArrowDown: pos - step, ArrowRight: pos + step, ArrowUp: pos + step, Home: 0, End: 100 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setPos(next);
  });

  /* ---------- tamanho da prévia e zoom 100% ---------- */

  zoomBtn.addEventListener('click', () => setZoom(!zoom));

  function setZoom(on) {
    zoom = on;
    viewer.classList.toggle('is-zoom', on);
    zoomBtn.setAttribute('aria-pressed', String(on));
    zoomBtn.textContent = on ? 'Ajustar à tela' : 'Ver em 100%';
    layout();
    if (on) {
      // Centraliza na linha de comparação, onde está a diferença.
      scrollBox.scrollLeft = before.width * pos / 100 - scrollBox.clientWidth / 2;
      scrollBox.scrollTop = (before.height - scrollBox.clientHeight) / 2;
    }
  }

  // Em "ajustar", a imagem cabe na largura do palco e em 70% da altura da janela; em 100%,
  // um pixel da imagem é um pixel CSS e a área rola.
  function layout() {
    if (!image || stage.hidden) return;
    const w = before.width, h = before.height;
    let scale = 1;
    if (!zoom) {
      const maxH = Math.max(260, window.innerHeight * 0.7);
      scale = Math.min(1, frame.clientWidth / w, maxH / h);
    }
    compare.style.width = `${Math.max(1, Math.round(w * scale))}px`;
    compare.style.height = `${Math.max(1, Math.round(h * scale))}px`;
  }
  const resizeObserver = new ResizeObserver(() => { if (!zoom) layout(); });
  resizeObserver.observe(frame);
  window.addEventListener('resize', layout, { signal });

  /* ---------- estado ---------- */

  function update() {
    const ready = !!image && !image.needsReduce;
    runBtn.disabled = !ready || !!job || saving;
    runBtn.textContent = job ? 'Melhorando…' : saving ? 'Preparando…' : done ? '↓ Baixar' : 'Melhorar imagem';
    cancelBtn.hidden = !job;
    clearBtn.disabled = !image || saving;
    zoomBtn.disabled = !ready;
    changeBtn.disabled = !!job || saving;
    reduceBtn.disabled = !!job;
    fileInput.disabled = !!job || saving;
    $('upInfoDims').textContent = image
      ? `${fmt(image.width)} × ${fmt(image.height)} → ${fmt(image.width * SCALE)} × ${fmt(image.height * SCALE)} px`
      : '—';
    if (!image) $('upInfoTime').textContent = '—';
  }

  function dispose() {
    if (image) { image.source.width = image.source.height = 0; }
    image = null; done = false;
    before.width = before.height = after.width = after.height = 1;
    $('upNotice').hidden = true;
    progress.hidden = true;
    setCompare(false);
    $('upInfoTime').textContent = '—';
  }

  update();

  // Saiu da página: encerra a IA e libera a memória dos canvas.
  signal.addEventListener('abort', () => {
    resizeObserver.disconnect();
    stopWorker();
    job = null;
    dispose();
  });
});
