/* Criar GIF (/criar-gif/): várias imagens viram os quadros de um GIF animado.
 * Montado a cada exibição da página (src/scripts/app.ts); `document` é restrito à página
 * e `signal` é abortado quando o usuário navega para outra ferramenta.
 * A prévia toca os quadros num canvas; o GIF é codificado com gifenc num Web Worker
 * (gif-worker.js), carregado só quando o usuário pede para criar o arquivo. */
kompres.register('gif-maker', (signal, document) => {
  const $ = (id) => document.getElementById(id);
  const fileInput = $('gifFile'), dropZone = $('gifDrop'), stage = $('gifStage');
  const canvas = $('gifCanvas'), playBtn = $('gifPlay'), counter = $('gifCounter'), info = $('gifInfo');
  const queue = $('gifQueue'), indicator = $('gifIndicator');
  const delayInput = $('gifDelay'), delayVal = $('gifDelayVal'), delayHint = $('gifDelayHint');
  const widthSelect = $('gifWidth'), sizeHint = $('gifSizeHint'), bgInput = $('gifBg'), bgHex = $('gifBgHex');
  const runBtn = $('gifRun'), clearBtn = $('gifClear'), statusLine = $('gifStatus');

  const MAX_FRAMES = 60;
  const MAX_SOURCE_PIXELS = 1.5e6;  // cada foto é guardada reduzida: 60 fotos de 12 MP não cabem na memória
  const SAMPLE_PIXELS = 400000;     // pixels amostrados de todos os quadros para montar a paleta
  const WORKER_URL = '/js/gif-worker.js?v=1';
  const FILE_NAME = 'kompres-animado.gif';

  let frames = [];      // { id, name, bitmap, width, height, thumbUrl, el }
  let nextId = 1;
  let current = 0;      // quadro exibido na prévia
  let playing = true;
  let timer = 0;
  let busy = false;     // criando o GIF
  let jobId = 0;        // invalida uma criação em andamento (Limpar, sair da página)
  let encoder = null;   // codificador da criação em andamento
  let loading = Promise.resolve();
  const ctx = canvas.getContext('2d');

  /* ---------- utilidades ---------- */

  function setStatus(message = '', error = false) {
    statusLine.textContent = message; statusLine.hidden = !message; statusLine.classList.toggle('error', error);
  }
  const checked = (name) => document.querySelector(`input[name="${name}"]:checked`).value;
  const num = (value, digits = 1) => value.toLocaleString('pt-BR', { maximumFractionDigits: digits });
  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${num(bytes / 1024)} KB`;
    return `${num(bytes / (1024 * 1024), 2)} MB`;
  }
  const settings = () => ({
    delay: Number(delayInput.value),
    width: Number(widthSelect.value),
    fit: checked('gifFit'),
    bg: bgInput.value,
    repeat: checked('gifRepeat') === 'once' ? -1 : 0, // gifenc: 0 = sempre, -1 = sem bloco de repetição (toca uma vez)
    colors: Number(checked('gifColors')),
  });

  // Largura escolhida; altura pela proporção do primeiro quadro.
  function outputSize() {
    const width = Number(widthSelect.value), first = frames[0];
    if (!first) return { width, height: Math.round(width * 0.75) };
    return { width, height: Math.min(2000, Math.max(16, Math.round(width * first.height / first.width))) };
  }

  // Desenha um quadro no tamanho do GIF: "fit" cabe inteiro sobre o fundo, "fill" cobre e corta o centro.
  function drawFrame(context, frame, width, height, fit, bg) {
    context.fillStyle = bg; // também cobre as áreas transparentes de PNG: o GIF sai com fundo sólido
    context.fillRect(0, 0, width, height);
    const scale = fit === 'fill'
      ? Math.max(width / frame.width, height / frame.height)
      : Math.min(width / frame.width, height / frame.height);
    const w = frame.width * scale, h = frame.height * scale;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(frame.bitmap, (width - w) / 2, (height - h) / 2, w, h);
  }

  /* ---------- entrada ---------- */

  fileInput.addEventListener('change', () => { const files = Array.from(fileInput.files); fileInput.value = ''; addFiles(files); }, { signal });
  kompres.fileDrop({ signal, document, zone: dropZone, onFiles: (files) => addFiles(files) });

  // Fila: arquivos soltos durante a leitura entram depois, na ordem.
  function addFiles(files) {
    loading = loading.then(() => loadFiles(files)).catch(() => {});
  }

  async function loadFiles(files) {
    if (signal.aborted || !files.length) return;
    const images = files.filter((file) => /^image\/(png|jpeg|webp)$/.test(file.type));
    const rejected = files.length - images.length;
    const room = MAX_FRAMES - frames.length;
    const accepted = images.slice(0, Math.max(0, room));
    const notes = [];
    if (rejected) notes.push(rejected === 1 ? '1 arquivo não é PNG, JPG ou WebP e foi ignorado.' : `${rejected} arquivos não são PNG, JPG ou WebP e foram ignorados.`);
    if (images.length > accepted.length) {
      const left = images.length - accepted.length;
      notes.push(`O GIF aceita até ${MAX_FRAMES} quadros: ${left === 1 ? '1 imagem ficou' : `${left} imagens ficaram`} de fora.`);
    }

    let failed = 0;
    for (let i = 0; i < accepted.length; i++) {
      if (signal.aborted) return;
      if (accepted.length > 1) setStatus(`Abrindo imagem ${i + 1} de ${accepted.length}…`);
      try {
        const frame = await openImage(accepted[i]);
        if (signal.aborted) { frame.bitmap.close(); URL.revokeObjectURL(frame.thumbUrl); return; }
        frames.push(frame);
        queue.append(frame.el);
        // Com o segundo quadro já existe animação: a prévia começa a tocar sozinha.
        if (frames.length === 2) playing = true;
        refresh();
      } catch { failed++; }
    }
    if (failed) notes.push(failed === 1 ? '1 imagem não pôde ser aberta (arquivo corrompido?).' : `${failed} imagens não puderam ser abertas (arquivos corrompidos?).`);
    setStatus(notes.join(' '), notes.length > 0);
  }

  // Decodifica respeitando o EXIF, guarda uma cópia reduzida e gera a miniatura.
  async function openImage(file) {
    const source = await createImageBitmap(file, { imageOrientation: 'from-image' });
    try {
      const factor = Math.min(1, Math.sqrt(MAX_SOURCE_PIXELS / (source.width * source.height)));
      const width = Math.max(1, Math.round(source.width * factor)), height = Math.max(1, Math.round(source.height * factor));
      let bitmap;
      if (factor < 1) {
        const work = document.createElement('canvas');
        work.width = width; work.height = height;
        const c = work.getContext('2d');
        c.imageSmoothingQuality = 'high';
        c.drawImage(source, 0, 0, width, height);
        bitmap = await createImageBitmap(work);
        work.width = work.height = 0;
      } else {
        bitmap = await createImageBitmap(source);
      }
      const thumbUrl = URL.createObjectURL(await thumbnail(bitmap));
      const frame = { id: nextId++, name: file.name, bitmap, width, height, thumbUrl, el: null };
      frame.el = buildCard(frame);
      return frame;
    } finally { source.close(); }
  }

  // Miniatura pequena em JPEG: um <img> com a foto original decodificaria a imagem inteira.
  function thumbnail(bitmap) {
    const side = 220, factor = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    const thumb = document.createElement('canvas');
    thumb.width = Math.max(1, Math.round(bitmap.width * factor));
    thumb.height = Math.max(1, Math.round(bitmap.height * factor));
    const c = thumb.getContext('2d');
    c.fillStyle = '#fff'; c.fillRect(0, 0, thumb.width, thumb.height);
    c.drawImage(bitmap, 0, 0, thumb.width, thumb.height);
    return new Promise((resolve, reject) => thumb.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('miniatura'))), 'image/jpeg', 0.8));
  }

  function buildCard(frame) {
    const li = document.createElement('li');
    li.className = 'gif-frame';
    li.dataset.id = frame.id;
    li.innerHTML = `
      <div class="gif-frame-thumb"><img alt="" draggable="false"><span class="gif-frame-num"></span></div>
      <button type="button" class="gif-frame-remove" data-act="remove">×</button>
      <div class="gif-frame-tools">
        <button type="button" class="gif-frame-btn" data-act="left">‹</button>
        <span class="gif-grip" title="Arraste para mudar a ordem" aria-hidden="true">⠿</span>
        <button type="button" class="gif-frame-btn" data-act="right">›</button>
      </div>`;
    const img = li.querySelector('img');
    img.src = frame.thumbUrl;
    img.alt = frame.name;
    li.title = frame.name;
    return li;
  }

  /* ---------- fila de quadros ---------- */

  // Reordena os cartões no DOM conforme `frames` e atualiza números, rótulos e estados.
  function renderQueue() {
    const focused = document.activeElement?.closest?.('.gif-frame') ? {
      id: document.activeElement.closest('.gif-frame').dataset.id,
      act: document.activeElement.dataset.act,
    } : null;
    frames.forEach((frame, i) => {
      if (queue.children[i] !== frame.el) queue.insertBefore(frame.el, queue.children[i] || null);
      const n = i + 1, el = frame.el;
      el.querySelector('.gif-frame-num').textContent = n;
      el.classList.toggle('current', i === current);
      const [left, right] = el.querySelectorAll('.gif-frame-btn');
      const remove = el.querySelector('.gif-frame-remove');
      left.setAttribute('aria-label', `Mover quadro ${n} para a esquerda`);
      right.setAttribute('aria-label', `Mover quadro ${n} para a direita`);
      remove.setAttribute('aria-label', `Remover quadro ${n}`);
      left.disabled = busy || i === 0;
      right.disabled = busy || i === frames.length - 1;
      remove.disabled = busy;
    });
    // Mover um elemento no DOM tira o foco dele; devolve ao mesmo botão do mesmo quadro.
    if (focused && document.activeElement === document.body) {
      const el = queue.querySelector(`.gif-frame[data-id="${focused.id}"]`);
      let target = el?.querySelector(`[data-act="${focused.act}"]`);
      if (target?.disabled) target = el.querySelector('[data-act]:not(:disabled)');
      target?.focus();
    }
  }

  function moveFrame(from, to) {
    if (from === to || to < 0 || to >= frames.length) return;
    const shown = frames[current];
    const [frame] = frames.splice(from, 1);
    frames.splice(to, 0, frame);
    current = Math.max(0, frames.indexOf(shown));
    refresh();
  }

  function removeFrame(index) {
    const shown = frames[current];
    const [frame] = frames.splice(index, 1);
    // Quem removeu pelo teclado continua na fila: o foco vai para o quadro que ocupou o lugar.
    const hadFocus = frame.el.contains(document.activeElement);
    frame.el.remove();
    frame.bitmap.close();
    URL.revokeObjectURL(frame.thumbUrl);
    current = frames.includes(shown) ? frames.indexOf(shown) : Math.min(index, frames.length - 1);
    current = Math.max(0, current);
    if (!frames.length) setStatus();
    refresh();
    if (hadFocus) (frames[Math.min(index, frames.length - 1)]?.el.querySelector('.gif-frame-remove') || fileInput).focus();
  }

  let suppressClick = false;
  queue.addEventListener('click', (event) => {
    const card = event.target.closest('.gif-frame');
    if (!card || busy) return;
    const index = frames.findIndex((frame) => String(frame.id) === card.dataset.id);
    if (index < 0) return;
    const act = event.target.closest('[data-act]')?.dataset.act;
    if (act === 'left') moveFrame(index, index - 1);
    else if (act === 'right') moveFrame(index, index + 1);
    else if (act === 'remove') removeFrame(index);
    else if (event.target.closest('.gif-frame-thumb') && !suppressClick) {
      // Clique na miniatura: pausa e mostra esse quadro na prévia.
      playing = false; current = index; refresh();
    }
  }, { signal });

  /* Arrastar para reordenar (Pointer Events). Mouse e caneta arrastam pela miniatura;
     no toque só pela alça ⠿, para o dedo continuar rolando a página sobre as miniaturas. */
  let drag = null; // { pointerId, el, index, startX, startY, x, y, active, ghost, target, raf }

  queue.addEventListener('pointerdown', (event) => {
    if (busy || drag || event.button !== 0 || event.target.closest('button')) return;
    const card = event.target.closest('.gif-frame');
    if (!card) return;
    const onGrip = !!event.target.closest('.gif-grip');
    if (!onGrip && (event.pointerType === 'touch' || !event.target.closest('.gif-frame-thumb'))) return;
    if (onGrip) event.preventDefault();
    drag = {
      pointerId: event.pointerId, el: card, index: frames.findIndex((frame) => String(frame.id) === card.dataset.id),
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, active: false, ghost: null, target: null, raf: 0,
    };
    try { card.setPointerCapture(event.pointerId); } catch { /* sem captura: o window ainda recebe os eventos */ }
  }, { signal });

  window.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.x = event.clientX; drag.y = event.clientY;
    if (!drag.active) {
      if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 6) return;
      startDrag();
    }
    event.preventDefault();
    drag.ghost.style.transform = `translate(${drag.x - drag.startX}px, ${drag.y - drag.startY}px)`;
    findTarget();
  }, { signal, passive: false });

  window.addEventListener('pointerup', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { active, target, index } = drag;
    endDrag();
    if (!active) return;
    // O clique que vem logo depois do arraste não deve selecionar o quadro.
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
    if (target) {
      let to = target.before ? target.position : target.position + 1;
      if (index < to) to--;
      moveFrame(index, to);
    }
  }, { signal });
  window.addEventListener('pointercancel', (event) => { if (drag && event.pointerId === drag.pointerId) endDrag(); }, { signal });

  function startDrag() {
    drag.active = true;
    const rect = drag.el.getBoundingClientRect();
    const ghost = drag.el.cloneNode(true);
    ghost.classList.add('gif-ghost');
    ghost.classList.remove('current');
    ghost.removeAttribute('data-id');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.querySelectorAll('button').forEach((button) => { button.tabIndex = -1; });
    Object.assign(ghost.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    queue.parentElement.append(ghost);
    drag.ghost = ghost;
    drag.el.classList.add('dragging');
    queue.classList.add('is-dragging');
    drag.raf = requestAnimationFrame(autoScroll);
  }

  // Perto da borda da janela, rola a página para alcançar quadros fora da tela.
  function autoScroll() {
    if (!drag?.active) return;
    const edge = 60, max = 14;
    let dy = 0;
    if (drag.y < edge) dy = -max * (1 - Math.max(0, drag.y) / edge);
    else if (drag.y > window.innerHeight - edge) dy = max * (1 - Math.max(0, window.innerHeight - drag.y) / edge);
    if (dy) { window.scrollBy(0, dy); findTarget(); }
    drag.raf = requestAnimationFrame(autoScroll);
  }

  // Encontra o cartão mais próximo do ponteiro na mesma linha e mostra a barra de inserção.
  function findTarget() {
    const cards = frames.map((frame) => frame.el);
    let target = null, best = Infinity;
    cards.forEach((card, position) => {
      if (card === drag.el) return;
      const rect = card.getBoundingClientRect();
      if (drag.y < rect.top - 8 || drag.y > rect.bottom + 8) return;
      const center = rect.left + rect.width / 2, distance = Math.abs(drag.x - center);
      if (distance < best) { best = distance; target = { position, before: drag.x < center, rect }; }
    });
    if (!target) {
      const others = cards.filter((card) => card !== drag.el);
      if (others.length) {
        const first = others[0], last = others[others.length - 1];
        if (drag.y < first.getBoundingClientRect().top) target = { position: cards.indexOf(first), before: true, rect: first.getBoundingClientRect() };
        else if (drag.y > last.getBoundingClientRect().bottom) target = { position: cards.indexOf(last), before: false, rect: last.getBoundingClientRect() };
      }
    }
    drag.target = target;
    if (!target) { indicator.hidden = true; return; }
    const wrap = queue.parentElement.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(queue).columnGap) || 0;
    const x = (target.before ? target.rect.left - gap / 2 : target.rect.right + gap / 2) - wrap.left;
    Object.assign(indicator.style, { left: `${x - 1.5}px`, top: `${target.rect.top - wrap.top}px`, height: `${target.rect.height}px` });
    indicator.hidden = false;
  }

  function endDrag() {
    if (!drag) return;
    cancelAnimationFrame(drag.raf);
    drag.ghost?.remove();
    drag.el.classList.remove('dragging');
    try { drag.el.releasePointerCapture(drag.pointerId); } catch { /* já liberado */ }
    queue.classList.remove('is-dragging');
    indicator.hidden = true;
    drag = null;
  }

  /* ---------- prévia animada ---------- */

  function refresh() {
    stage.hidden = !frames.length;
    if (current >= frames.length) current = 0;
    const { width, height } = outputSize();
    const s = settings();
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    if (frames.length) drawFrame(ctx, frames[current], width, height, s.fit, s.bg);
    counter.textContent = frames.length ? `Quadro ${current + 1} de ${frames.length}` : '';
    const loop = frames.length * s.delay / 1000;
    info.textContent = frames.length ? `${width} × ${height} px · ${num(loop, 2)} s por volta` : '';
    sizeHint.textContent = frames.length
      ? `Altura: ${height} px, pela proporção do primeiro quadro.`
      : 'A altura segue a proporção do primeiro quadro.';
    delayVal.textContent = `${s.delay} ms`;
    delayHint.textContent = `${num(1000 / s.delay, 1)} quadros por segundo. Menos tempo deixa a animação mais rápida.`;
    bgHex.textContent = s.bg.toUpperCase();
    if (frames.length < 2) playing = false;
    renderQueue();
    updatePlayer();
    updateUI();
    schedule();
  }

  function updatePlayer() {
    playBtn.disabled = frames.length < 2;
    playBtn.classList.toggle('is-playing', playing);
    playBtn.setAttribute('aria-label', playing ? 'Pausar prévia' : 'Tocar prévia');
  }

  function schedule() {
    clearTimeout(timer);
    if (!playing || frames.length < 2) return;
    timer = setTimeout(step, Number(delayInput.value));
  }

  function step() {
    // "Uma vez": a prévia para no último quadro, como o GIF vai fazer.
    if (checked('gifRepeat') === 'once' && current === frames.length - 1) { playing = false; refresh(); return; }
    current = (current + 1) % frames.length;
    refresh();
  }

  playBtn.addEventListener('click', () => {
    if (frames.length < 2) return;
    playing = !playing;
    if (playing && checked('gifRepeat') === 'once' && current === frames.length - 1) current = 0;
    refresh();
  }, { signal });

  // Ajustes atualizam a prévia na hora.
  delayInput.addEventListener('input', refresh, { signal });
  bgInput.addEventListener('input', refresh, { signal });
  widthSelect.addEventListener('change', refresh, { signal });
  document.querySelectorAll('input[name="gifFit"], input[name="gifRepeat"], input[name="gifColors"]')
    .forEach((input) => input.addEventListener('change', refresh, { signal }));

  /* ---------- criar o GIF ---------- */

  // Abre o worker module; se o navegador não aceitar, a mesma lógica roda na página.
  function workerEncoder() {
    const worker = new Worker(WORKER_URL, { type: 'module' });
    let pending = null, broken = false;
    worker.onmessage = ({ data }) => {
      const p = pending; pending = null;
      if (!p) return;
      if (data.type === 'error') p.reject(new Error(data.message)); else p.resolve(data);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      broken = true;
      const p = pending; pending = null;
      p?.reject(Object.assign(new Error('worker'), { workerFailed: true }));
    };
    return {
      send(message, transfer = []) {
        if (broken) return Promise.reject(Object.assign(new Error('worker'), { workerFailed: true }));
        return new Promise((resolve, reject) => { pending = { resolve, reject }; worker.postMessage(message, transfer); });
      },
      close() { worker.terminate(); },
    };
  }

  async function localEncoder() {
    const { handle } = await import(WORKER_URL);
    return {
      async send(message) {
        await new Promise((resolve) => setTimeout(resolve)); // deixa a página atualizar o progresso
        return (await handle(message)).reply;
      },
      close() {},
    };
  }

  // Amostra pixels de todos os quadros (com passo fixo) para a paleta global.
  function collectSamples(list, width, height, s, work) {
    const total = width * height, step = Math.max(1, Math.ceil(total * list.length / SAMPLE_PIXELS));
    const samples = new Uint8Array(Math.ceil(total / step) * list.length * 4);
    let o = 0;
    list.forEach((frame, i) => {
      drawFrame(work, frame, width, height, s.fit, s.bg);
      const data = work.getImageData(0, 0, width, height).data;
      // Começa cada quadro num deslocamento diferente para não amostrar sempre as mesmas colunas.
      for (let p = i % step; p < total; p += step, o += 4) {
        const k = p * 4;
        samples[o] = data[k]; samples[o + 1] = data[k + 1]; samples[o + 2] = data[k + 2]; samples[o + 3] = 255;
      }
    });
    return samples.slice(0, o);
  }

  async function createGif() {
    if (busy || !frames.length) return;
    const job = ++jobId;
    const list = frames.slice(), s = settings(), { width, height } = outputSize();
    busy = true; refresh();
    const work = document.createElement('canvas');
    work.width = width; work.height = height;
    const wctx = work.getContext('2d', { willReadFrequently: true });
    try {
      setStatus('Preparando as cores…');
      await new Promise((resolve) => setTimeout(resolve)); // mostra o status antes do trabalho síncrono
      const samples = collectSamples(list, width, height, s, wctx);
      if (job !== jobId) return;
      const start = { type: 'start', samples, colors: s.colors, repeat: s.repeat };
      encoder = null;
      try {
        encoder = workerEncoder();
        await encoder.send(start);
      } catch (err) {
        // Sem worker module (navegador antigo, bloqueio): codifica na própria página.
        if (encoder && !err.workerFailed) throw err;
        encoder?.close();
        encoder = await localEncoder();
        await encoder.send(start);
      }
      for (let i = 0; i < list.length; i++) {
        if (job !== jobId) return;
        setStatus(`Criando GIF: quadro ${i + 1} de ${list.length}…`);
        drawFrame(wctx, list[i], width, height, s.fit, s.bg);
        const pixels = wctx.getImageData(0, 0, width, height).data;
        await encoder.send({ type: 'frame', pixels, width, height, delay: s.delay }, [pixels.buffer]);
      }
      if (job !== jobId) return;
      const { bytes } = await encoder.send({ type: 'finish' });
      if (job !== jobId) return;
      const blob = new Blob([bytes], { type: 'image/gif' });
      download(blob, FILE_NAME);
      setStatus(`GIF criado: ${formatBytes(blob.size)} · ${list.length} ${list.length === 1 ? 'quadro' : 'quadros'} · ${width} × ${height} px. O download começou.`);
    } catch (err) {
      if (job !== jobId) return;
      console.error(err);
      const network = /fetch|import|module|network/i.test(String(err?.message));
      setStatus(network
        ? 'Não foi possível carregar o codificador de GIF. Verifique a conexão e tente de novo.'
        : 'Não foi possível criar o GIF. Tente com menos quadros ou uma largura menor.', true);
    } finally {
      work.width = work.height = 0;
      if (job === jobId) {
        encoder?.close(); encoder = null;
        busy = false; refresh();
      }
    }
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function cancelJob() {
    jobId++;
    encoder?.close(); encoder = null;
    busy = false;
  }

  function clearAll() {
    cancelJob();
    endDrag();
    frames.forEach((frame) => { frame.bitmap.close(); URL.revokeObjectURL(frame.thumbUrl); });
    frames = [];
    queue.replaceChildren();
    current = 0; playing = true;
    clearTimeout(timer);
    setStatus();
    refresh();
  }

  function updateUI() {
    runBtn.disabled = busy || !frames.length;
    runBtn.textContent = busy ? 'Criando GIF…' : 'Criar e baixar GIF';
    clearBtn.disabled = !frames.length;
    stage.classList.toggle('is-busy', busy);
  }

  runBtn.addEventListener('click', createGif, { signal });
  clearBtn.addEventListener('click', clearAll, { signal });

  signal.addEventListener('abort', () => {
    cancelJob();
    clearTimeout(timer);
    if (drag) { cancelAnimationFrame(drag.raf); drag.ghost?.remove(); drag = null; }
    frames.forEach((frame) => { frame.bitmap.close(); URL.revokeObjectURL(frame.thumbUrl); });
    frames = [];
  });

  refresh();
});
