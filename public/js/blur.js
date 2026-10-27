/* Desfocar imagem: o usuário desenha retângulos sobre a foto e cada um recebe desfoque
 * ou pixelização. Montado a cada exibição da página (src/scripts/app.ts); `document` é
 * restrito à página e `signal` é abortado ao navegar para outra ferramenta.
 * As áreas são guardadas em pixels da imagem original; a prévia é a mesma conta em escala. */
kompres.register('blur', (signal, document) => {
  const $ = (id) => document.getElementById(id);
  const fileInput = $('blurFile'), dropZone = $('blurDrop'), editor = $('blurEditor'), frame = $('blurFrame');
  const stage = $('blurStage'), canvas = $('blurCanvas'), layer = $('blurLayer');
  const list = $('blurList'), count = $('blurCount'), strengthInput = $('blurStrength'), strengthVal = $('blurStrengthVal');
  const undoBtn = $('blurUndo'), clearAreasBtn = $('blurClearAreas'), runBtn = $('blurRun'), clearBtn = $('blurClear');
  const changeBtn = $('blurChange'), statusLine = $('blurStatus');

  const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
  const HANDLES = ['nw', 'n', 'e', 'se', 's', 'sw', 'w']; // o canto ne é o botão ×
  const NO_AREAS = 'Nenhuma área marcada ainda. Arraste sobre a imagem para cobrir o que quer esconder.';

  let image = null;    // { file, bitmap, width, height }
  let areas = [];      // [{ id, x, y, w, h }] em px da imagem original, na ordem de criação
  let selected = null; // id da área selecionada
  let nextId = 1;
  let scale = 1;       // px de tela (CSS) por px da imagem
  let base = null;     // cópia reduzida da imagem na resolução da prévia
  let drag = null;
  let busy = false;
  let frameId = 0;
  let lastFrameWidth = 0;

  // Canvas de rascunho reaproveitados entre quadros (evita alocar a cada movimento).
  const scratch = { pad: document.createElement('canvas'), small: document.createElement('canvas') };

  // ctx.filter não existe em navegadores antigos (Safari < 18): lá o desfoque é aproximado.
  const hasFilter = (() => {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx || !('filter' in ctx)) return false;
    ctx.filter = 'blur(2px)';
    return ctx.filter === 'blur(2px)';
  })();

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const checked = (name) => document.querySelector(`input[name="${name}"]:checked`).value;
  function setStatus(message = '', error = false) {
    statusLine.textContent = message; statusLine.hidden = !message; statusLine.classList.toggle('error', error);
  }
  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  /* ---------- intensidade ----------
   * Proporcional ao maior lado da imagem: o mesmo valor esconde o mesmo tanto numa foto
   * de 800 px e numa de 6000 px, e a prévia (em escala) mostra o resultado do arquivo. */
  const strength = () => Number(strengthInput.value) / 100;
  const blurRadius = () => Math.max(0.5, strength() * 0.03 * Math.max(image.width, image.height));
  const blockSize = () => Math.max(2, strength() * 0.05 * Math.max(image.width, image.height));

  /* ---------- entrada ---------- */

  fileInput.addEventListener('change', () => { const file = fileInput.files[0]; fileInput.value = ''; if (file) load(file); });
  kompres.fileDrop({ signal, document, zone: dropZone, onFiles: (files) => load(files[0]) });
  changeBtn.addEventListener('click', () => fileInput.click());

  async function load(file) {
    if (busy || !file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { setStatus('Use uma imagem PNG, JPG ou WebP.', true); return; }
    busy = true; updateUI(); setStatus('Abrindo imagem…');
    try {
      // from-image: respeita a orientação EXIF, para as áreas caírem onde o usuário vê.
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      dispose();
      image = { file, bitmap, width: bitmap.width, height: bitmap.height };
      $('blurName').textContent = file.name;
      $('blurDims').textContent = `${image.width} × ${image.height} px · ${formatBytes(file.size)}`;
      editor.hidden = false;
      lastFrameWidth = 0;
      layout(); // a escala depende da largura do quadro, que acabou de aparecer
      busy = false;
      syncAreas(); // mostra o aviso de nenhuma área
    } catch {
      setStatus('Não foi possível abrir a imagem. Verifique se o arquivo não está corrompido.', true);
    } finally { busy = false; updateUI(); }
  }

  function dispose() {
    image?.bitmap.close();
    image = null; base = null; areas = []; selected = null; drag = null;
    cancelAnimationFrame(frameId); frameId = 0;
    canvas.width = canvas.height = 1;
    releaseScratch();
  }
  function releaseScratch() { scratch.pad.width = scratch.pad.height = scratch.small.width = scratch.small.height = 1; }

  /* ---------- prévia ---------- */

  // Cabe na largura do quadro e em ~60% da altura da janela; imagens pequenas são
  // ampliadas até ~480 px para dar espaço às alças.
  function layout() {
    if (!image) return;
    const pad = parseFloat(getComputedStyle(frame).paddingLeft) || 0;
    const availW = Math.max(120, frame.clientWidth - pad * 2), availH = Math.max(200, window.innerHeight * 0.6);
    scale = Math.min(availW / image.width, availH / image.height, Math.max(1, 480 / Math.max(image.width, image.height)));
    const cssW = image.width * scale, cssH = image.height * scale;
    canvas.style.width = `${cssW}px`; canvas.style.height = `${cssH}px`;
    // Resolução da prévia: a da tela (com devicePixelRatio), nunca acima da original.
    const pw = Math.max(1, Math.round(Math.min(image.width, cssW * (window.devicePixelRatio || 1))));
    const ph = Math.max(1, Math.round(pw * image.height / image.width));
    if (!base || base.width !== pw || base.height !== ph) {
      base = document.createElement('canvas');
      base.width = pw; base.height = ph;
      const bctx = base.getContext('2d');
      bctx.imageSmoothingQuality = 'high';
      bctx.drawImage(image.bitmap, 0, 0, pw, ph);
      canvas.width = pw; canvas.height = ph;
    }
    paint();
  }
  // O quadro muda de largura com a janela e com a coluna de ajustes: refaz a escala.
  const observer = new ResizeObserver(() => {
    if (!image || frame.clientWidth === lastFrameWidth) return;
    lastFrameWidth = frame.clientWidth;
    layout();
  });
  observer.observe(frame);
  window.addEventListener('resize', () => { if (image) layout(); }, { signal });

  function requestPaint() { if (!frameId) frameId = requestAnimationFrame(() => { frameId = 0; paint(); }); }
  function paint() {
    if (!image) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(base, 0, 0);
    const p = canvas.width / image.width;
    for (const area of areas) applyEffect(ctx, area, p);
  }

  /**
   * Aplica o efeito numa área. `p` = px do canvas de destino por px da imagem
   * (1 no arquivo final, menor na prévia). A fonte é sempre o bitmap original.
   */
  function applyEffect(ctx, area, p) {
    const x = area.x * p, y = area.y * p, w = area.w * p, h = area.h * p;
    ctx.save();
    // Retângulo ou oval: o recorte define onde o efeito aparece (clearRect também respeita o recorte).
    ctx.beginPath();
    if (area.shape === 'oval') ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    else ctx.rect(x, y, w, h);
    ctx.clip();
    // Limpa antes: em imagens com transparência, o efeito semitransparente deixaria
    // o conteúdo nítido aparecer por baixo.
    ctx.clearRect(x, y, w, h);
    if (checked('blurMode') === 'pixel') {
      // Reduz a área a poucos pixels (a média de cada bloco) e amplia sem suavizar.
      // O tamanho reduzido é calculado em px da imagem: idêntico na prévia e no arquivo.
      const b = blockSize();
      const cols = Math.max(1, Math.round(area.w / b)), rows = Math.max(1, Math.round(area.h / b));
      const small = scratch.small;
      if (small.width !== cols || small.height !== rows) { small.width = cols; small.height = rows; }
      const sctx = small.getContext('2d');
      sctx.clearRect(0, 0, cols, rows);
      sctx.imageSmoothingEnabled = true; sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(image.bitmap, area.x, area.y, area.w, area.h, 0, 0, cols, rows);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small, 0, 0, cols, rows, x, y, w, h);
    } else {
      const r = blurRadius() * p;
      const padded = paddedRegion(x, y, w, h, Math.ceil(r * 3), p, ctx.canvas);
      if (hasFilter) {
        ctx.filter = `blur(${r}px)`;
        ctx.drawImage(padded.canvas, padded.x, padded.y);
        ctx.filter = 'none';
      } else {
        softBlur(ctx, padded, r);
      }
    }
    ctx.restore();
  }

  /**
   * Copia a área com uma margem ao redor (para o desfoque misturar pixels vizinhos e a
   * borda não clarear). Onde a margem passa da imagem, estica a última linha/coluna em
   * vez de deixar transparente.
   */
  function paddedRegion(x, y, w, h, margin, p, target) {
    const tx0 = Math.floor(x - margin), ty0 = Math.floor(y - margin);
    const tx1 = Math.ceil(x + w + margin), ty1 = Math.ceil(y + h + margin);
    const cx0 = Math.max(tx0, 0), cy0 = Math.max(ty0, 0);
    const cx1 = Math.min(tx1, target.width), cy1 = Math.min(ty1, target.height);
    const tw = tx1 - tx0, th = ty1 - ty0, vw = cx1 - cx0, vh = cy1 - cy0;
    const pad = scratch.pad;
    if (pad.width !== tw || pad.height !== th) { pad.width = tw; pad.height = th; }
    const pctx = pad.getContext('2d');
    pctx.clearRect(0, 0, tw, th);
    pctx.imageSmoothingEnabled = true; pctx.imageSmoothingQuality = 'high';
    const sx = cx0 / p, sy = cy0 / p;
    const sw = Math.min(vw / p, image.width - sx), sh = Math.min(vh / p, image.height - sy);
    const gl = cx0 - tx0, gt = cy0 - ty0, gr = tx1 - cx1, gb = ty1 - cy1;
    pctx.drawImage(image.bitmap, sx, sy, sw, sh, gl, gt, vw, vh);
    pctx.imageSmoothingEnabled = false;
    if (gl > 0) pctx.drawImage(pad, gl, gt, 1, vh, 0, gt, gl, vh);
    if (gr > 0) pctx.drawImage(pad, gl + vw - 1, gt, 1, vh, gl + vw, gt, gr, vh);
    if (gt > 0) pctx.drawImage(pad, 0, gt, tw, 1, 0, 0, tw, gt);
    if (gb > 0) pctx.drawImage(pad, 0, gt + vh - 1, tw, 1, 0, gt + vh, tw, gb);
    return { canvas: pad, x: tx0, y: ty0, w: tw, h: th };
  }

  // Sem ctx.filter: reduz e amplia com suavização, em duas etapas, para um borrão parecido.
  function softBlur(ctx, padded, r) {
    const small = scratch.small;
    const sw = Math.max(1, Math.round(padded.w / Math.max(1, r))), sh = Math.max(1, Math.round(padded.h / Math.max(1, r)));
    small.width = sw; small.height = sh;
    const sctx = small.getContext('2d');
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(padded.canvas, 0, 0, sw, sh);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small, padded.x, padded.y, padded.w, padded.h);
  }

  /* ---------- áreas ---------- */

  const minSize = () => Math.max(2, 10 / scale); // ~10 px na tela, em px da imagem
  const findArea = (id) => areas.find((area) => area.id === id);

  // Arredonda e mantém a área dentro da imagem.
  function fit(next) {
    const min = Math.min(minSize(), image.width, image.height);
    const w = clamp(Math.round(next.w), Math.round(min), image.width);
    const h = clamp(Math.round(next.h), Math.round(min), image.height);
    return { w, h, x: clamp(Math.round(next.x), 0, image.width - w), y: clamp(Math.round(next.y), 0, image.height - h) };
  }
  function updateArea(area, next) {
    Object.assign(area, fit(next));
    placeArea(area); updateListItem(area); requestPaint();
  }

  // Posição em % do palco: um redimensionamento da janela não exige recalcular.
  function placeArea(area) {
    const el = layer.querySelector(`[data-id="${area.id}"]`);
    if (!el) return;
    el.style.left = `${(area.x / image.width) * 100}%`;
    el.style.top = `${(area.y / image.height) * 100}%`;
    el.style.width = `${(area.w / image.width) * 100}%`;
    el.style.height = `${(area.h / image.height) * 100}%`;
  }

  // Recria a camada sobre a imagem e a lista da coluna de ajustes.
  function syncAreas() {
    layer.replaceChildren();
    list.replaceChildren();
    areas.forEach((area, index) => {
      const n = index + 1;
      const el = document.createElement('div');
      el.className = 'blur-area';
      el.dataset.id = area.id;
      el.classList.toggle('selected', area.id === selected);
      el.classList.toggle('oval', area.shape === 'oval');
      for (const handle of HANDLES) {
        const h = document.createElement('div');
        h.className = 'blur-handle'; h.dataset.handle = handle;
        el.append(h);
      }
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'blur-remove'; remove.dataset.remove = area.id;
      remove.setAttribute('aria-label', `Remover área ${n}`); remove.textContent = '×';
      el.append(remove);
      layer.append(el);
      placeArea(area);

      const item = document.createElement('li');
      item.dataset.id = area.id;
      item.classList.toggle('selected', area.id === selected);
      const pick = document.createElement('button');
      pick.type = 'button'; pick.className = 'blur-item'; pick.dataset.select = area.id;
      pick.setAttribute('aria-pressed', String(area.id === selected));
      const removeItem = document.createElement('button');
      removeItem.type = 'button'; removeItem.className = 'blur-item-remove'; removeItem.dataset.remove = area.id;
      removeItem.setAttribute('aria-label', `Remover área ${n}`); removeItem.textContent = '×';
      item.append(pick, removeItem);
      list.append(item);
      updateListItem(area);
    });
    count.textContent = areas.length;
    if (!busy) setStatus(image && !areas.length ? NO_AREAS : '');
    requestPaint(); updateUI();
  }
  function updateListItem(area) {
    const pick = list.querySelector(`[data-select="${area.id}"]`);
    if (!pick) return;
    const n = areas.indexOf(area) + 1;
    pick.textContent = `Área ${n} · ${area.shape === 'oval' ? 'oval' : 'retângulo'} · ${area.w} × ${area.h} px`;
  }

  function select(id) {
    selected = id;
    // O seletor de formato mostra o formato da área escolhida.
    const area = areas.find((item) => item.id === id);
    if (area) setShapeRadio(area.shape || 'rect');
    layer.querySelectorAll('.blur-area').forEach((el) => el.classList.toggle('selected', Number(el.dataset.id) === id));
    list.querySelectorAll('li').forEach((li) => {
      const on = Number(li.dataset.id) === id;
      li.classList.toggle('selected', on);
      li.querySelector('.blur-item').setAttribute('aria-pressed', String(on));
    });
  }
  function removeArea(id) {
    areas = areas.filter((area) => area.id !== id);
    if (selected === id) selected = null;
    syncAreas();
  }
  function undo() {
    if (!areas.length || busy) return;
    removeArea(areas[areas.length - 1].id);
  }

  /** Redimensiona a partir de uma alça; `dx`/`dy` em px da imagem. A borda oposta fica parada. */
  function resizeFrom(start, handle, dx, dy) {
    const min = minSize();
    const left = handle.includes('w'), right = handle.includes('e'), top = handle.includes('n'), bottom = handle.includes('s');
    const anchorX = left ? start.x + start.w : start.x, anchorY = top ? start.y + start.h : start.y;
    let w = start.w + (right ? dx : left ? -dx : 0), h = start.h + (bottom ? dy : top ? -dy : 0);
    w = clamp(w, min, left ? anchorX : image.width - anchorX);
    h = clamp(h, min, top ? anchorY : image.height - anchorY);
    return { x: left ? anchorX - w : anchorX, y: top ? anchorY - h : anchorY, w, h };
  }

  /* ---------- mouse e toque ---------- */

  function toImage(event) {
    const box = stage.getBoundingClientRect();
    return {
      x: clamp((event.clientX - box.left) / scale, 0, image.width),
      y: clamp((event.clientY - box.top) / scale, 0, image.height),
    };
  }

  stage.addEventListener('pointerdown', (event) => {
    if (!image || busy || drag || event.button !== 0) return;
    if (event.target.closest('.blur-remove')) return; // o clique do × é tratado à parte
    event.preventDefault(); // sem seleção de texto nem foco automático (focamos à mão)
    stage.focus({ preventScroll: true });
    stage.setPointerCapture(event.pointerId);
    const el = event.target.closest('.blur-area');
    const info = { id: event.pointerId, startX: event.clientX, startY: event.clientY };
    if (el) {
      const area = findArea(Number(el.dataset.id));
      select(area.id);
      drag = { ...info, mode: event.target.closest('[data-handle]')?.dataset.handle || 'move', area, start: { ...area } };
      el.classList.add('dragging');
    } else {
      // Fora das áreas: começa um retângulo novo, criado só depois de um arraste mínimo.
      select(null);
      drag = { ...info, mode: 'draw', origin: toImage(event), area: null };
    }
  });
  stage.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    if (drag.mode === 'draw') {
      if (!drag.area && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
      const point = toImage(event), o = drag.origin;
      const rect = { x: Math.min(o.x, point.x), y: Math.min(o.y, point.y), w: Math.abs(point.x - o.x), h: Math.abs(point.y - o.y) };
      if (!drag.area) {
        drag.area = { id: nextId++, shape: checked('blurShape'), ...fit(rect) };
        areas.push(drag.area);
        selected = drag.area.id;
        syncAreas();
        layer.querySelector(`[data-id="${drag.area.id}"]`)?.classList.add('dragging');
      }
      // Durante o desenho a área pode ficar menor que o mínimo; o ajuste vem ao soltar.
      const x = Math.min(Math.round(rect.x), image.width - 1), y = Math.min(Math.round(rect.y), image.height - 1);
      Object.assign(drag.area, { x, y, w: clamp(Math.round(rect.w), 1, image.width - x), h: clamp(Math.round(rect.h), 1, image.height - y) });
      placeArea(drag.area); updateListItem(drag.area); requestPaint();
      return;
    }
    const dx = (event.clientX - drag.startX) / scale, dy = (event.clientY - drag.startY) / scale;
    const { start } = drag;
    if (drag.mode === 'move') updateArea(drag.area, { ...start, x: start.x + dx, y: start.y + dy });
    else updateArea(drag.area, resizeFrom(start, drag.mode, dx, dy));
  });
  const endDrag = (event) => {
    if (!drag || (event && event.pointerId !== drag.id)) return;
    const { mode, area } = drag;
    drag = null;
    layer.querySelectorAll('.dragging').forEach((el) => el.classList.remove('dragging'));
    if (mode === 'draw' && area) {
      // Um toque quase sem arraste não deve virar uma área minúscula.
      if (area.w * scale < 8 || area.h * scale < 8) removeArea(area.id);
      else updateArea(area, area);
    }
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('lostpointercapture', endDrag);

  // Botões × (na imagem e na lista) e seleção pela lista.
  stage.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove]');
    if (remove) removeArea(Number(remove.dataset.remove));
  });
  list.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove]');
    if (remove) { removeArea(Number(remove.dataset.remove)); return; }
    const pick = event.target.closest('[data-select]');
    if (pick) select(Number(pick.dataset.select) === selected ? null : Number(pick.dataset.select));
  });

  // Teclado com a imagem em foco: setas movem a área selecionada, Delete remove, Ctrl+Z desfaz.
  stage.addEventListener('keydown', (event) => {
    if (!image || busy) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(); return; }
    const area = findArea(selected);
    if (!area) return;
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeArea(area.id); return; }
    if (event.key === 'Escape') { select(null); return; }
    const step = Math.max(1, Math.round(1 / scale)) * (event.shiftKey ? 10 : 1);
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    updateArea(area, { ...area, x: area.x + move[0], y: area.y + move[1] });
  });

  /* ---------- controles ---------- */

  document.querySelectorAll('input[name="blurMode"], input[name="blurFormat"], input[name="blurShape"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      document.querySelectorAll(`input[name="${radio.name}"]`).forEach((input) => input.closest('.fmt-btn')?.classList.toggle('active', input.checked));
      if (radio.name === 'blurMode') requestPaint();
      if (radio.name === 'blurShape') {
        // Muda também a área selecionada, se houver.
        const area = areas.find((item) => item.id === selected);
        if (area) {
          area.shape = radio.value;
          layer.querySelector(`[data-id="${area.id}"]`)?.classList.toggle('oval', area.shape === 'oval');
          updateListItem(area);
          requestPaint();
        }
      }
    });
  });
  function setShapeRadio(value) {
    document.querySelectorAll('input[name="blurShape"]').forEach((input) => {
      input.checked = input.value === value;
      input.closest('.fmt-btn')?.classList.toggle('active', input.checked);
    });
  }
  strengthInput.addEventListener('input', () => { strengthVal.textContent = `${strengthInput.value}%`; requestPaint(); });

  undoBtn.addEventListener('click', undo);
  clearAreasBtn.addEventListener('click', () => { if (!busy) { areas = []; selected = null; syncAreas(); } });
  clearBtn.addEventListener('click', clearAll);
  runBtn.addEventListener('click', exportImage);

  function clearAll() {
    if (busy) return;
    dispose();
    editor.hidden = true;
    $('blurName').textContent = ''; $('blurDims').textContent = '';
    layer.replaceChildren(); list.replaceChildren(); count.textContent = '0';
    setStatus(); updateUI();
  }

  /* ---------- saída ---------- */

  function toBlob(source, mime) {
    return new Promise((resolve) => source.toBlob((blob) => resolve(blob && blob.type === mime ? blob : null), mime, 0.92));
  }

  async function exportImage() {
    if (!image || !areas.length || busy) return;
    busy = true; updateUI(); setStatus('Gerando imagem…');
    try {
      const choice = checked('blurFormat');
      let mime = choice === 'same' ? image.file.type : MIME[choice];
      const out = document.createElement('canvas');
      out.width = image.width; out.height = image.height;
      const ctx = out.getContext('2d');
      ctx.drawImage(image.bitmap, 0, 0);
      for (const area of areas) applyEffect(ctx, area, 1);

      let blob = null, note = '';
      if (mime === 'image/jpeg') {
        // JPEG não tem transparência: fundo branco por baixo, como no compressor.
        const flat = document.createElement('canvas');
        flat.width = out.width; flat.height = out.height;
        const fctx = flat.getContext('2d');
        fctx.fillStyle = '#fff'; fctx.fillRect(0, 0, flat.width, flat.height);
        fctx.drawImage(out, 0, 0);
        blob = await toBlob(flat, mime);
        flat.width = flat.height = 1;
      } else if (mime === 'image/webp') {
        blob = await toBlob(out, mime);
        // Safari antigo não gera WebP: salva em PNG em vez de falhar.
        if (!blob) { mime = 'image/png'; note = ' (este navegador não gera WebP)'; }
      }
      if (mime === 'image/png') blob = await kompres.pngFromCanvas(out, 1);
      out.width = out.height = 1;
      if (!blob) throw new Error('Não foi possível gerar a imagem neste formato.');

      const ext = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1];
      const name = image.file.name.replace(/\.[^.]+$/, '').replace(/[\\/\x00-\x1f<>:"|?*]/g, '_').slice(0, 140) || 'imagem';
      download(blob, `${name}-desfocada-kompres.${ext}`);
      setStatus(`Imagem salva em ${ext.toUpperCase()}${note} · ${formatBytes(blob.size)}. O arquivo original continua intacto no seu dispositivo.`);
    } catch (err) {
      setStatus(err?.message || 'Não foi possível gerar a imagem.', true);
    } finally {
      releaseScratch(); // os rascunhos em resolução cheia ocupam muita memória
      busy = false; updateUI(); requestPaint();
    }
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function updateUI() {
    const has = !!image, any = areas.length > 0;
    runBtn.disabled = busy || !has || !any;
    runBtn.textContent = busy && has ? 'Gerando…' : 'Baixar imagem';
    undoBtn.disabled = clearAreasBtn.disabled = busy || !any;
    clearBtn.disabled = busy || !has;
    changeBtn.disabled = busy;
    fileInput.disabled = busy;
  }

  updateUI();

  // Saiu da página: libera o bitmap, os canvas e o observador.
  signal.addEventListener('abort', () => { observer.disconnect(); dispose(); });
});
