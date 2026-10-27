/* Recortar imagem.
 * Montado a cada exibição da página (src/scripts/app.ts); `document` é restrito à página
 * e `signal` é abortado quando o usuário navega para outra ferramenta.
 * A caixa de recorte é guardada em pixels da imagem original; a tela só a exibe em escala. */
kompres.register('crop', (signal, document) => {
  const $ = (id) => document.getElementById(id);
  const fileInput = $('cropFile'), area = $('cropArea'), dropZone = $('cropDrop'), editor = $('cropEditor');
  const stage = $('cropStage'), canvas = $('cropCanvas'), shade = $('cropShade'), box = $('cropBox');
  const widthInput = $('cropWidth'), heightInput = $('cropHeight'), position = $('cropPosition');
  const runBtn = $('cropRun'), resetBtn = $('cropReset'), clearBtn = $('cropClear'), changeBtn = $('cropChange');
  const statusLine = $('cropStatus');

  const MIN = 16; // menor lado do recorte, em px da imagem original
  const RATIOS = { '1:1': 1, '4:5': 4 / 5, '16:9': 16 / 9, '9:16': 9 / 16, '4:3': 4 / 3, '3:2': 3 / 2 };
  const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

  let image = null;   // { file, bitmap, width, height }
  let rect = null;    // { x, y, w, h } em px da imagem original (inteiros)
  let scale = 1;      // px de tela por px da imagem
  let drag = null;    // arraste em andamento
  let busy = false;

  function setStatus(message = '', error = false) {
    statusLine.textContent = message; statusLine.hidden = !message; statusLine.classList.toggle('error', error);
  }
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const ratio = () => RATIOS[document.querySelector('input[name="cropRatio"]:checked').value] || 0;
  const checked = (name) => document.querySelector(`input[name="${name}"]:checked`).value;
  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  /* ---------- entrada ---------- */

  fileInput.addEventListener('change', () => { const file = fileInput.files[0]; fileInput.value = ''; if (file) load(file); });
  kompres.fileDrop({ signal, document, zone: area, onFiles: (files) => load(files[0]) });
  changeBtn.addEventListener('click', () => fileInput.click());

  async function load(file) {
    if (busy || !file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { setStatus('Use uma imagem PNG, JPG ou WebP.', true); return; }
    busy = true; updateUI(); setStatus('Abrindo imagem…');
    try {
      // from-image: respeita a orientação EXIF, para a caixa cair onde o usuário vê.
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      if (bitmap.width < MIN || bitmap.height < MIN) { bitmap.close(); throw new Error(`A imagem precisa ter pelo menos ${MIN} × ${MIN} px.`); }
      dispose();
      image = { file, bitmap, width: bitmap.width, height: bitmap.height };
      drawPreview();
      $('cropName').textContent = file.name;
      $('cropDims').textContent = `${image.width} × ${image.height} px · ${formatBytes(file.size)}`;
      dropZone.classList.add('hidden'); editor.classList.remove('hidden');
      layout(); // a escala depende da largura do editor, que acabou de aparecer
      resetRect();
      setStatus();
    } catch (err) {
      setStatus(err?.message?.startsWith('A imagem') ? err.message : 'Não foi possível abrir a imagem. Verifique se o arquivo não está corrompido.', true);
    } finally { busy = false; updateUI(); }
  }

  // Cópia reduzida para a tela: evita um canvas gigante só para a prévia.
  function drawPreview() {
    const cap = 2560, factor = Math.min(1, cap / Math.max(image.width, image.height));
    canvas.width = Math.max(1, Math.round(image.width * factor));
    canvas.height = Math.max(1, Math.round(image.height * factor));
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image.bitmap, 0, 0, canvas.width, canvas.height);
  }

  function dispose() {
    image?.bitmap.close();
    image = null; rect = null; drag = null;
    canvas.width = canvas.height = 1;
  }

  /* ---------- geometria ---------- */

  // Maior caixa possível na proporção escolhida (ou a imagem inteira), centralizada.
  function resetRect() {
    const r = ratio();
    let w = image.width, h = image.height;
    if (r) {
      if (w / h > r) w = Math.round(h * r); else h = Math.round(w / r);
    }
    setRect({ x: (image.width - w) / 2, y: (image.height - h) / 2, w, h });
  }

  // Arredonda e garante que a caixa fique dentro da imagem.
  function setRect(next) {
    const w = clamp(Math.round(next.w), MIN, image.width);
    const h = clamp(Math.round(next.h), MIN, image.height);
    rect = { w, h, x: clamp(Math.round(next.x), 0, image.width - w), y: clamp(Math.round(next.y), 0, image.height - h) };
    render();
  }

  // Posiciona caixa e sombra na tela a partir da caixa em px da imagem.
  function render() {
    if (!rect) return;
    const x = rect.x * scale, y = rect.y * scale, w = rect.w * scale, h = rect.h * scale;
    box.style.transform = `translate(${x}px, ${y}px)`;
    box.style.width = `${w}px`; box.style.height = `${h}px`;
    // Polígono evenodd: o retângulo externo menos o buraco da seleção.
    shade.style.clipPath = `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${x}px ${y}px, ${x}px ${y + h}px, ${x + w}px ${y + h}px, ${x + w}px ${y}px, ${x}px ${y}px)`;
    if (document.activeElement !== widthInput) widthInput.value = rect.w;
    if (document.activeElement !== heightInput) heightInput.value = rect.h;
    position.textContent = `Posição X ${rect.x}, Y ${rect.y} · em pixels da imagem original.`;
  }

  // Escala da prévia: cabe na largura disponível e em ~55% da altura da janela;
  // imagens pequenas são ampliadas até ~480 px para as alças não ficarem apertadas.
  function layout() {
    if (!image) return;
    const frame = stage.parentElement, pad = parseFloat(getComputedStyle(frame).paddingLeft) || 0;
    const availW = Math.max(120, frame.clientWidth - pad * 2), availH = Math.max(200, window.innerHeight * 0.55);
    scale = Math.min(availW / image.width, availH / image.height, Math.max(1, 480 / Math.max(image.width, image.height)));
    canvas.style.width = `${image.width * scale}px`;
    canvas.style.height = `${image.height * scale}px`;
    render();
  }
  window.addEventListener('resize', layout, { signal });

  /**
   * Redimensiona a partir de uma alça. `dx`/`dy` em px da imagem.
   * Em proporção fixa, o lado que mais cresceu manda; nas alças de lado, o outro eixo
   * cresce a partir do centro. Sempre limitado à imagem e ao mínimo.
   */
  function resizeFrom(start, handle, dx, dy) {
    const r = ratio();
    const left = handle.includes('w'), right = handle.includes('e'), top = handle.includes('n'), bottom = handle.includes('s');
    const anchorX = left ? start.x + start.w : start.x; // borda que não se move
    const anchorY = top ? start.y + start.h : start.y;
    let w = start.w + (right ? dx : left ? -dx : 0);
    let h = start.h + (bottom ? dy : top ? -dy : 0);
    const maxW = left ? anchorX : image.width - anchorX;
    const maxH = top ? anchorY : image.height - anchorY;

    if (!r) {
      w = clamp(w, MIN, maxW); h = clamp(h, MIN, maxH);
      return { x: left ? anchorX - w : anchorX, y: top ? anchorY - h : anchorY, w, h };
    }

    const minW = Math.max(MIN, MIN * r);
    if ((left || right) && (top || bottom)) {
      // Canto: segue a dimensão dominante, cabendo no espaço do lado da âncora.
      w = Math.max(w, h * r);
      w = clamp(w, minW, Math.min(maxW, maxH * r));
      h = w / r;
      return { x: left ? anchorX - w : anchorX, y: top ? anchorY - h : anchorY, w, h };
    }
    if (left || right) {
      w = clamp(w, minW, Math.min(maxW, image.height * r));
      h = w / r;
      const cy = start.y + start.h / 2;
      return { x: left ? anchorX - w : anchorX, y: clamp(cy - h / 2, 0, image.height - h), w, h };
    }
    h = clamp(h, Math.max(MIN, MIN / r), Math.min(maxH, image.width / r));
    w = h * r;
    const cx = start.x + start.w / 2;
    return { x: clamp(cx - w / 2, 0, image.width - w), y: top ? anchorY - h : anchorY, w, h };
  }

  /* ---------- mouse e toque ---------- */

  stage.addEventListener('pointerdown', (event) => {
    if (!rect || busy || drag || event.button !== 0) return;
    const handle = event.target.closest('[data-handle]')?.dataset.handle;
    if (!handle && !event.target.closest('#cropBox')) return; // fora da caixa: nada a fazer
    event.preventDefault(); // sem seleção de texto nem foco automático (focamos à mão)
    stage.focus({ preventScroll: true });
    stage.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, handle: handle || 'move', startX: event.clientX, startY: event.clientY, start: { ...rect } };
    box.classList.add('dragging');
  });
  stage.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = (event.clientX - drag.startX) / scale, dy = (event.clientY - drag.startY) / scale;
    const { start } = drag;
    if (drag.handle === 'move') setRect({ ...start, x: start.x + dx, y: start.y + dy });
    else setRect(resizeFrom(start, drag.handle, dx, dy));
  });
  const endDrag = (event) => {
    if (!drag || (event && event.pointerId !== drag.id)) return;
    drag = null; box.classList.remove('dragging');
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('lostpointercapture', endDrag);

  // Setas movem a caixa 1 px (10 com Shift) quando a área tem foco.
  stage.addEventListener('keydown', (event) => {
    if (!rect || busy) return;
    const step = event.shiftKey ? 10 : 1;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    setRect({ ...rect, x: rect.x + move[0], y: rect.y + move[1] });
  });

  /* ---------- controles ---------- */

  document.querySelectorAll('input[name="cropRatio"], input[name="cropFormat"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      document.querySelectorAll(`input[name="${radio.name}"]`).forEach((input) => input.closest('.fmt-btn')?.classList.toggle('active', input.checked));
      if (radio.name === 'cropRatio' && image) resetRect();
    });
  });

  // Campos de largura/altura: aplicam ao sair do campo ou com Enter; a caixa fica
  // onde está se couber, senão desliza para dentro da imagem.
  function applySize(changed) {
    if (!rect) return;
    const r = ratio();
    let w = Math.round(Number(widthInput.value)), h = Math.round(Number(heightInput.value));
    if (!Number.isFinite(w) || w < 1) w = rect.w;
    if (!Number.isFinite(h) || h < 1) h = rect.h;
    if (r) {
      if (changed === 'w') { w = clamp(w, MIN, image.width); h = w / r; if (h > image.height) { h = image.height; w = h * r; } }
      else { h = clamp(h, MIN, image.height); w = h * r; if (w > image.width) { w = image.width; h = w / r; } }
    }
    setRect({ x: rect.x, y: rect.y, w, h });
  }
  widthInput.addEventListener('change', () => applySize('w'));
  heightInput.addEventListener('change', () => applySize('h'));
  [widthInput, heightInput].forEach((input) => input.addEventListener('keydown', (event) => { if (event.key === 'Enter') input.blur(); }));

  resetBtn.addEventListener('click', () => { if (image) { resetRect(); stage.focus({ preventScroll: true }); } });
  clearBtn.addEventListener('click', clearAll);
  runBtn.addEventListener('click', cropAndDownload);

  function clearAll() {
    if (busy) return;
    dispose();
    editor.classList.add('hidden'); dropZone.classList.remove('hidden');
    $('cropName').textContent = ''; $('cropDims').textContent = '';
    widthInput.value = ''; heightInput.value = ''; position.textContent = 'Em pixels da imagem original.';
    setStatus(); updateUI();
  }

  /* ---------- saída ---------- */

  function outputMime() {
    const choice = checked('cropFormat');
    return choice === 'same' ? image.file.type : MIME[choice];
  }

  async function cropAndDownload() {
    if (!image || !rect || busy) return;
    busy = true; updateUI(); setStatus('Recortando…');
    try {
      const mime = outputMime();
      const out = document.createElement('canvas');
      out.width = rect.w; out.height = rect.h;
      const ctx = out.getContext('2d');
      // JPEG não tem transparência: fundo branco por baixo, como no compressor.
      if (mime === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, rect.w, rect.h); }
      ctx.drawImage(image.bitmap, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);

      const blob = mime === 'image/png'
        ? await kompres.pngFromCanvas(out, 1)
        : await new Promise((resolve, reject) => out.toBlob((result) => {
            if (!result || result.type !== mime) reject(new Error('Não foi possível gerar a imagem neste formato.'));
            else resolve(result);
          }, mime, 0.92));

      const ext = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1];
      const base = image.file.name.replace(/\.[^.]+$/, '').replace(/[\\/\x00-\x1f<>:"|?*]/g, '_').slice(0, 140) || 'imagem';
      download(blob, `${base}-recortado-kompres.${ext}`);
      setStatus(`Recorte de ${rect.w} × ${rect.h} px salvo em ${ext.toUpperCase()} · ${formatBytes(blob.size)}.`);
    } catch (err) {
      setStatus(err?.message || 'Não foi possível recortar a imagem.', true);
    } finally { busy = false; updateUI(); }
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function updateUI() {
    const has = !!image;
    runBtn.disabled = busy || !has;
    runBtn.textContent = busy && has ? 'Recortando…' : 'Recortar e baixar';
    resetBtn.disabled = busy || !has;
    clearBtn.disabled = busy || !has;
    changeBtn.disabled = busy;
    fileInput.disabled = busy;
    widthInput.disabled = heightInput.disabled = busy || !has;
  }

  updateUI();

  // Saiu da página: libera o bitmap e o canvas da prévia.
  signal.addEventListener('abort', dispose);
});
