/* Organizar páginas de PDF: miniaturas de cada página para reordenar (arrastando ou
 * pelas setas), girar e excluir; o resultado é montado com pdf-lib. Um PDF por vez;
 * nada sai do navegador. `document` é restrito à página e `signal` aborta ao navegar. */
kompres.register('pdf-organize', (signal, document) => {
  const field = (id) => document.getElementById(id);
  const fileInput = field('orgFile');
  const dropZone = field('orgDrop');
  const grid = field('orgGrid');
  const statusEl = field('orgStatus');
  const applyBtn = field('orgApply');
  const reverseBtn = field('orgReverse');
  const resetBtn = field('orgReset');
  const clearBtn = field('orgClear');
  const fileInfo = field('orgFileInfo');
  if (!fileInput || !grid) return;

  const THUMB_PX = 220; // lado maior da miniatura em px CSS; a tela decide a densidade

  let source = null;   // { name, data, doc, count }
  let pages = [];      // ordem atual: [{ index (0-based original), turns, deleted }]
  let cards = [];      // elemento do cartão por índice original
  let urls = [];       // blob URLs das miniaturas, revogadas ao limpar
  let generation = 0;  // invalida renderizações de um PDF substituído
  let busy = false;    // montando o PDF final
  let loading = false;

  /* ── Utilidades ── */

  function setStatus(message = '', error = false) {
    statusEl.textContent = message;
    statusEl.hidden = !message;
    statusEl.classList.toggle('error', error);
  }
  function rotationOf(page) { return (((page.turns % 4) + 4) % 4) * 90; }
  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  async function releaseDoc() {
    const doc = source?.doc;
    if (!doc) return;
    source.doc = null;
    try { await doc.destroy(); } catch { /* já liberado */ }
  }
  function revokeUrls() { urls.forEach((url) => URL.revokeObjectURL(url)); urls = []; }

  /* ── Entrada do arquivo ── */

  fileInput.addEventListener('change', (event) => {
    handleFiles([...event.target.files]);
    fileInput.value = '';
  }, { signal });
  kompres.fileDrop({ signal, document, zone: dropZone, onFiles: handleFiles });

  async function handleFiles(files) {
    if (!files.length) return;
    if (busy) { setStatus('Aguarde terminar de montar o PDF atual.', true); return; }
    if (files.length > 1) { setStatus('Selecione um PDF por vez.', true); return; }
    const file = files[0];
    if (!(/\.pdf$/i.test(file.name) || file.type === 'application/pdf')) { setStatus('Selecione apenas arquivos PDF.', true); return; }

    // Soltar outro PDF substitui o atual, mesmo durante a leitura.
    await clear(false);
    const gen = ++generation;
    loading = true;
    setStatus('Lendo o PDF…');
    updateButtons();
    try {
      const data = await file.arrayBuffer();
      const doc = await KompresPDF.loadPdf(data);
      if (gen !== generation || signal.aborted) { await doc.destroy(); return; }
      source = { name: file.name, data, doc, count: doc.numPages };
      pages = Array.from({ length: doc.numPages }, (_, index) => ({ index, turns: 0, deleted: false }));
      buildCards();
      field('orgFileName').textContent = file.name;
      fileInfo.hidden = false;
      loading = false;
      setStatus();
      render();
      renderThumbs(doc, gen);
    } catch (err) {
      if (gen !== generation) return;
      loading = false;
      updateButtons();
      setStatus(err?.name === 'PasswordException'
        ? 'Este PDF está protegido por senha. Remova a senha antes de organizar.'
        : 'Não foi possível ler este PDF. Verifique se o arquivo não está corrompido.', true);
    }
  }

  /* ── Miniaturas (em sequência, sem travar a interface) ── */

  async function renderThumbs(doc, gen) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (let i = 0; i < doc.numPages; i++) {
      if (gen !== generation || signal.aborted) return;
      const card = cards[i];
      try {
        const page = await doc.getPage(i + 1);
        const base = page.getViewport({ scale: 1 });
        const scale = (THUMB_PX * dpr) / Math.max(base.width, base.height);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport, background: '#ffffff', intent: 'print' }).promise;
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
        canvas.width = 0; canvas.height = 0;
        page.cleanup();
        if (gen !== generation || !blob) return;
        const url = URL.createObjectURL(blob);
        urls.push(url);
        const img = card.querySelector('img');
        img.onload = () => card.classList.add('loaded');
        img.src = url;
      } catch {
        if (gen === generation) card.classList.add('thumb-error');
      }
    }
    // Com as miniaturas prontas, o pdf.js não é mais necessário: a montagem usa pdf-lib.
    if (gen === generation) await releaseDoc();
  }

  /* ── Cartões ── */

  function buildCards() {
    cards = pages.map((page) => {
      const n = page.index + 1;
      const card = document.createElement('div');
      card.className = 'org-card';
      card.setAttribute('role', 'listitem');
      card.dataset.index = String(page.index);
      card.innerHTML = `
        <div class="org-thumb">
          <img alt="Página ${n}" draggable="false">
          <span class="org-handle" title="Arraste para reordenar" aria-hidden="true">⠿</span>
          <span class="org-rot" hidden></span>
        </div>
        <div class="org-meta"><span class="org-num">Pág. ${n}</span></div>
        <div class="org-btns">
          <button type="button" class="org-btn" data-act="left" title="Mover para a esquerda" aria-label="Mover a página ${n} para a esquerda">‹</button>
          <button type="button" class="org-btn" data-act="rotate" title="Girar 90°" aria-label="Girar a página ${n} em 90 graus">↻</button>
          <button type="button" class="org-btn org-btn-x" data-act="delete" title="Excluir" aria-label="Excluir a página ${n}">×</button>
          <button type="button" class="org-btn" data-act="right" title="Mover para a direita" aria-label="Mover a página ${n} para a direita">›</button>
        </div>`;
      return card;
    });
  }

  /** Reflete `pages` na tela: ordem dos cartões, rotação, exclusão, resumo e botões. */
  function render() {
    grid.replaceChildren(...pages.map((page) => cards[page.index]), indicator);
    pages.forEach((page, position) => {
      const card = cards[page.index];
      const n = page.index + 1;
      const rotation = rotationOf(page);
      card.classList.toggle('deleted', page.deleted);
      card.querySelector('img').style.transform = `rotate(${page.turns * 90}deg)`;
      const badge = card.querySelector('.org-rot');
      badge.hidden = !rotation;
      badge.textContent = rotation ? `${rotation}°` : '';
      card.querySelector('[data-act="left"]').disabled = busy || position === 0;
      card.querySelector('[data-act="right"]').disabled = busy || position === pages.length - 1;
      card.querySelector('[data-act="rotate"]').disabled = busy;
      const del = card.querySelector('[data-act="delete"]');
      del.disabled = busy;
      del.textContent = page.deleted ? '↶' : '×';
      del.title = page.deleted ? 'Restaurar' : 'Excluir';
      del.setAttribute('aria-label', page.deleted ? `Restaurar a página ${n}` : `Excluir a página ${n}`);
    });
    updateSummary();
    updateButtons();
  }

  function updateSummary() {
    const deleted = pages.filter((page) => page.deleted).length;
    const rotated = pages.filter((page) => rotationOf(page)).length;
    const reordered = pages.some((page, position) => page.index !== position);
    const parts = [`${pages.length} página${pages.length === 1 ? '' : 's'}`];
    if (deleted) parts.push(`${deleted} excluída${deleted === 1 ? '' : 's'}`);
    if (rotated) parts.push(`${rotated} girada${rotated === 1 ? '' : 's'}`);
    if (reordered) parts.push('ordem alterada');
    field('orgSummary').textContent = parts.join(' · ');
  }

  function updateButtons() {
    const ready = !!source && !busy;
    applyBtn.disabled = !ready;
    reverseBtn.disabled = !ready || pages.length < 2;
    resetBtn.disabled = !ready;
    clearBtn.disabled = (!source && !loading) || busy;
    fileInput.disabled = busy;
    applyBtn.textContent = busy ? 'Montando PDF…' : 'Aplicar e baixar PDF';
  }

  /* ── Ações por página ── */

  grid.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-act]');
    if (!button || busy) return;
    const index = Number(button.closest('.org-card').dataset.index);
    const position = pages.findIndex((page) => page.index === index);
    if (position < 0) return;
    const page = pages[position];
    const act = button.dataset.act;
    if (act === 'rotate') page.turns++;
    else if (act === 'delete') page.deleted = !page.deleted;
    else if (act === 'left' && position > 0) movePage(position, position - 1);
    else if (act === 'right' && position < pages.length - 1) movePage(position, position + 1);
    render();
    // O foco segue a página movida (o cartão foi reposicionado no DOM).
    if (act === 'left' || act === 'right') {
      const same = cards[index].querySelector(`[data-act="${act}"]`);
      (same.disabled ? cards[index].querySelector(`[data-act="${act === 'left' ? 'right' : 'left'}"]`) : same).focus();
    }
  }, { signal });

  function movePage(from, to) {
    const [moved] = pages.splice(from, 1);
    pages.splice(to, 0, moved);
  }

  /* ── Arrastar para reordenar (Pointer Events: mouse e toque) ── */

  let drag = null; // { pointerId, index, card, startX, startY, x, y, active, ghost, target, raf }
  const indicator = document.createElement('div');
  indicator.className = 'org-indicator';
  indicator.hidden = true;
  grid.append(indicator);

  grid.addEventListener('pointerdown', (event) => {
    if (busy || drag || event.button !== 0) return;
    const card = event.target.closest('.org-card');
    if (!card || event.target.closest('button')) return;
    const onHandle = !!event.target.closest('.org-handle');
    // No toque só a alça inicia o arrasto (ela tem touch-action: none); o resto da
    // página continua rolando normalmente. Com mouse, a miniatura inteira serve.
    if (!onHandle && (event.pointerType !== 'mouse' || !event.target.closest('.org-thumb'))) return;
    event.preventDefault();
    drag = { pointerId: event.pointerId, index: Number(card.dataset.index), card, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, active: false, ghost: null, target: null, raf: 0 };
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
    moveGhost();
    updateTarget();
  }, { signal });
  window.addEventListener('pointerup', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { active, target, index } = drag;
    endDrag();
    if (active && target) {
      const from = pages.findIndex((page) => page.index === index);
      let to = target.position + (target.before ? 0 : 1);
      if (to > from) to--;
      if (to !== from) movePage(from, to);
      render();
    }
  }, { signal });
  window.addEventListener('pointercancel', (event) => {
    if (drag && event.pointerId === drag.pointerId) endDrag();
  }, { signal });

  function startDrag() {
    drag.active = true;
    const thumb = drag.card.querySelector('.org-thumb');
    const rect = thumb.getBoundingClientRect();
    // Fantasma da miniatura que segue o ponteiro; o cartão original fica esmaecido no lugar.
    const ghost = document.createElement('div');
    ghost.className = 'org-ghost';
    ghost.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
    const img = thumb.querySelector('img').cloneNode();
    img.style.transform = `rotate(${pages.find((page) => page.index === drag.index).turns * 90}deg)`;
    ghost.append(img);
    document.body.append(ghost);
    drag.ghost = ghost;
    drag.card.classList.add('dragging');
    grid.classList.add('is-dragging');
    document.body.classList.add('org-grabbing');
    drag.raf = requestAnimationFrame(autoScroll);
  }

  function moveGhost() {
    if (drag.ghost) drag.ghost.style.transform = `translate(${drag.x - drag.startX}px, ${drag.y - drag.startY}px)`;
  }

  /** Perto da borda da janela, rola a página sozinho (no toque ela não rola durante o arrasto). */
  function autoScroll() {
    if (!drag?.active) return;
    const edge = 72, max = 16;
    let dy = 0;
    if (drag.y < edge) dy = -max * (1 - Math.max(0, drag.y) / edge);
    else if (drag.y > window.innerHeight - edge) dy = max * (1 - Math.max(0, window.innerHeight - drag.y) / edge);
    if (dy) { window.scrollBy(0, dy); updateTarget(); }
    drag.raf = requestAnimationFrame(autoScroll);
  }

  /** Decide onde a página entraria: antes ou depois do cartão mais próximo do ponteiro. */
  function updateTarget() {
    const ordered = pages.map((page) => cards[page.index]);
    let target = null;
    const hit = document.elementFromPoint(drag.x, drag.y)?.closest?.('.org-card');
    if (hit && hit !== drag.card && grid.contains(hit)) {
      const rect = hit.getBoundingClientRect();
      target = { position: ordered.indexOf(hit), before: drag.x < rect.left + rect.width / 2, rect };
    } else {
      // Ponteiro num espaço entre cartões: usa o cartão da mesma linha mais próximo na horizontal.
      let best = Infinity;
      ordered.forEach((card, position) => {
        if (card === drag.card) return;
        const rect = card.getBoundingClientRect();
        if (drag.y < rect.top || drag.y > rect.bottom) return;
        const distance = Math.abs(drag.x - (rect.left + rect.width / 2));
        if (distance < best) { best = distance; target = { position, before: drag.x < rect.left + rect.width / 2, rect }; }
      });
      if (!target && ordered.length > 1) {
        const first = ordered.find((card) => card !== drag.card), last = [...ordered].reverse().find((card) => card !== drag.card);
        if (drag.y < first.getBoundingClientRect().top) target = { position: ordered.indexOf(first), before: true, rect: first.getBoundingClientRect() };
        else if (drag.y > last.getBoundingClientRect().bottom) target = { position: ordered.indexOf(last), before: false, rect: last.getBoundingClientRect() };
      }
    }
    if (!target) { drag.target = null; indicator.hidden = true; return; }
    drag.target = target;
    const gridRect = grid.getBoundingClientRect();
    const x = (target.before ? target.rect.left : target.rect.right) - gridRect.left;
    indicator.hidden = false;
    indicator.style.cssText = `left:${x}px;top:${target.rect.top - gridRect.top}px;height:${target.rect.height}px`;
  }

  function endDrag() {
    if (!drag) return;
    cancelAnimationFrame(drag.raf);
    drag.ghost?.remove();
    drag.card.classList.remove('dragging');
    try { drag.card.releasePointerCapture(drag.pointerId); } catch { /* ponteiro já solto */ }
    grid.classList.remove('is-dragging');
    document.body.classList.remove('org-grabbing');
    indicator.hidden = true;
    drag = null;
  }

  /* ── Ações gerais ── */

  reverseBtn.addEventListener('click', () => { if (!source || busy) return; pages.reverse(); render(); }, { signal });
  resetBtn.addEventListener('click', () => {
    if (!source || busy) return;
    pages = Array.from({ length: source.count }, (_, index) => ({ index, turns: 0, deleted: false }));
    setStatus();
    render();
  }, { signal });
  clearBtn.addEventListener('click', () => { if (!busy) clear(); }, { signal });
  applyBtn.addEventListener('click', apply, { signal });

  async function clear(resetStatus = true) {
    generation++;
    endDrag();
    await releaseDoc();
    revokeUrls();
    source = null; pages = []; cards = []; loading = false;
    grid.replaceChildren(indicator);
    fileInfo.hidden = true;
    field('orgFileName').textContent = '';
    field('orgSummary').textContent = '';
    if (resetStatus) setStatus();
    updateButtons();
  }

  async function apply() {
    if (!source || busy) return;
    const kept = pages.filter((page) => !page.deleted);
    if (!kept.length) { setStatus('Todas as páginas foram excluídas. Restaure pelo menos uma antes de baixar.', true); return; }
    busy = true;
    endDrag();
    setStatus('Montando o PDF…');
    render();
    try {
      const original = await PDFLib.PDFDocument.load(source.data, { ignoreEncryption: false });
      const output = await PDFLib.PDFDocument.create();
      const copied = await output.copyPages(original, kept.map((page) => page.index));
      copied.forEach((page, i) => {
        output.addPage(page);
        const delta = rotationOf(kept[i]);
        if (delta) page.setRotation(PDFLib.degrees((page.getRotation().angle + delta) % 360));
      });
      const bytes = await output.save({ useObjectStreams: true });
      if (signal.aborted) return;
      triggerDownload(new Blob([bytes], { type: 'application/pdf' }), `${KompresPDF.safeBase(source.name)}-organizado-kompres.pdf`);
      const removed = pages.length - kept.length;
      setStatus(`PDF pronto com ${kept.length} página${kept.length === 1 ? '' : 's'}${removed ? ` (${removed} removida${removed === 1 ? '' : 's'})` : ''}. O download começou.`);
    } catch (err) {
      setStatus(/encrypt/i.test(err?.message || '') ? 'Este PDF está protegido por senha. Remova a senha antes de organizar.' : 'Não foi possível montar o PDF. Tente novamente com outro arquivo.', true);
    } finally {
      busy = false;
      if (source) render(); else updateButtons();
    }
  }

  // Ao sair da página: libera o documento, as miniaturas e um arrasto em andamento.
  signal.addEventListener('abort', () => { generation++; endDrag(); releaseDoc(); revokeUrls(); });
});
