/* ═══════════════════════════════════════════════
   Kompres PDF — juntar e comprimir PDFs no browser
   pdf-lib  → montagem/merge do PDF final
   pdf.js   → leitura, contagem de páginas, thumbs
              e render das páginas na compressão
═══════════════════════════════════════════════ */

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const fileInput   = document.getElementById('fileInput');
const dropZone    = document.getElementById('dropZone');
const actionBtn   = document.getElementById('actionBtn');
const downloadBtn = document.getElementById('downloadBtn');
const clearBtn    = document.getElementById('clearBtn');
const pdfList     = document.getElementById('pdfList');
const modeToggle  = document.getElementById('modeToggle');
const pdfControls = document.getElementById('pdfControls');
const dpiSelect   = document.getElementById('dpiSelect');
const qualityIn   = document.getElementById('pdfQuality');
const qualityVal  = document.getElementById('pdfQualityVal');
const statsBar    = document.getElementById('statsBar');

const statLabels = [1, 2, 3, 4].map((i) => document.getElementById(`statLabel${i}`));
const statValues = [1, 2, 3, 4].map((i) => document.getElementById(`statValue${i}`));

let mode = 'merge'; // 'merge' | 'compress'
let items = [];     // { id, name, size, pages, data, thumbUrl, status, outBlob, outSize }
let mergedBlob = null;
let zipBlob = null;
let busy = false;
let uid = 0;
const rasterizeInput = document.getElementById('allow-rasterize');
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
[dpiSelect, qualityIn, rasterizeInput].forEach(el => el.addEventListener('change', () => {
  if (busy) return;
  invalidateResults(); renderList(); updateStats(); updateButtons();
}));

/* ── Helpers ── */

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function baseName(name) {
  return name.replace(/\.pdf$/i, '');
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ── Entrada de arquivos ── */

fileInput.addEventListener('change', async (event) => {
  await handleFiles([...event.target.files]);
  fileInput.value = '';
});

dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));

dropZone.addEventListener('drop', async (event) => {
  event.preventDefault();
  dropZone.classList.remove('dragover');
  const files = [...event.dataTransfer.files].filter(
    (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
  );
  await handleFiles(files);
});

async function handleFiles(files) {
  if (!files.length || busy) return;

  for (const file of files) {
    const item = {
      id: `pdf-${uid++}`,
      name: file.name,
      size: file.size,
      pages: null,
      data: null,
      thumbUrl: null,
      status: 'loading', // loading | ready | working | done | error
      outBlob: null,
      outSize: null,
      error: null,
    };
    busy = true;
    updateButtons();
    items.push(item);
    renderList();

    try {
      item.data = await file.arrayBuffer();

      // pdf.js "consome" (detach) o buffer passado — sempre enviar uma cópia
      const doc = await pdfjsLib.getDocument({ isEvalSupported: false, data: item.data.slice(0) }).promise;
      item.pages = doc.numPages;
      item.thumbUrl = await renderThumb(doc);
      await doc.destroy();

      item.status = 'ready';
    } catch (err) {
      console.error('Erro ao ler PDF:', item.name, err);
      item.status = 'error';
      item.error = 'Não foi possível ler este PDF';
    }

    busy = false;
    invalidateResults();
    renderList();
    updateStats();
    updateButtons();
  }
}

async function renderThumb(doc) {
  try {
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    const scale = 84 / vp.width; // thumb pequena, 2x da largura exibida (42px)
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL('image/jpeg', 0.7);
  } catch {
    return null;
  }
}

/* ── Modo (Juntar / Comprimir) ── */

modeToggle.querySelectorAll('.fmt-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (busy || btn.dataset.mode === mode) return;
    modeToggle.querySelectorAll('.fmt-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    mode = btn.dataset.mode;
    applyMode();
  });
});

function applyMode() {
  const compress = mode === 'compress';

  document.querySelectorAll('.compress-only').forEach((el) => {
    el.classList.toggle('hidden', !compress);
  });
  pdfControls.classList.toggle('merge', !compress);

  invalidateResults();
  renderList();
  updateStats();
  updateButtons();

  if (compress && window.updateAllRangeFills) window.updateAllRangeFills();
}

qualityIn.addEventListener('input', () => {
  qualityVal.textContent = `${qualityIn.value}%`;
  if (window.updateAllRangeFills) window.updateAllRangeFills();
});

function invalidateResults() {
  mergedBlob = null;
  zipBlob = null;
  items.forEach((item) => {
    if (item.status === 'done' || item.status === 'working') item.status = 'ready';
    item.outBlob = null;
    item.outSize = null;
  });
}

/* ── Lista + reordenação ── */

function renderList() {
  pdfList.innerHTML = '';

  items.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = `pdf-row ${item.status}`;
    row.dataset.id = item.id;
    row.draggable = mode === 'merge' && !busy;

    const meta = item.status === 'loading'
      ? 'lendo arquivo…'
      : item.status === 'error'
        ? item.error
        : `${item.pages} ${item.pages === 1 ? 'página' : 'páginas'} · ${formatBytes(item.size)}`;

    const thumb = item.thumbUrl
      ? `<img class="pdf-thumb" src="${item.thumbUrl}" alt="">`
      : '<span class="pdf-thumb pdf-thumb-empty">PDF</span>';

    let result = '';
    if (mode === 'compress' && item.status === 'done') {
      const saved = Math.round((1 - item.outSize / item.size) * 100);
      if (item.method === 'original' || saved <= 0) {
        result = `<div class="pdf-result"><small class="pdf-nogain">PDF já otimizado — mantido o original</small></div>`;
      } else {
        const tag = (item.method === 'lossless' || item.method === 'images')
          ? '<small class="pdf-nogain">texto preservado</small>'
          : '';
        result = `<div class="pdf-result">
             <span class="size-original">${formatBytes(item.size)}</span>
             <span class="size-arrow">→</span>
             <span class="size-new">${formatBytes(item.outSize)}</span>
             <span class="pdf-badge">−${saved}%</span>
             ${tag}
           </div>`;
      }
    }
    if (mode === 'compress' && item.status === 'working') {
      result = `<div class="pdf-result pdf-progress-wrap">
                  <div class="progress-bar"><div class="progress-fill" id="prog-${item.id}"></div></div>
                </div>`;
    }

    const mergeControls = mode === 'merge' && item.status !== 'error'
      ? `<span class="pdf-drag" title="Arraste para reordenar" aria-hidden="true">⠿</span>
         <span class="pdf-index">${index + 1}</span>`
      : '';

    const moveBtns = mode === 'merge'
      ? `<button class="row-btn" data-act="up" title="Mover para cima" ${index === 0 ? 'disabled' : ''}>↑</button>
         <button class="row-btn" data-act="down" title="Mover para baixo" ${index === items.length - 1 ? 'disabled' : ''}>↓</button>`
      : '';

    const dlBtn = mode === 'compress' && item.status === 'done'
      ? `<button class="row-btn row-btn-dl" data-act="download" title="Baixar este PDF">↓</button>`
      : '';

    row.innerHTML = `
      ${mergeControls}
      ${thumb}
      <div class="pdf-info">
        <strong title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</strong>
        <small>${meta}</small>
      </div>
      ${result}
      <div class="pdf-actions">
        ${moveBtns}
        ${dlBtn}
        <button class="row-btn row-btn-x" data-act="remove" title="Remover">×</button>
      </div>
    `;

    row.querySelectorAll('.row-btn').forEach((btn) => {
      btn.addEventListener('click', () => rowAction(btn.dataset.act, item.id));
    });

    if (mode === 'merge') attachDrag(row);

    pdfList.appendChild(row);
  });
}

function rowAction(act, id) {
  if (busy) return;
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return;

  if (act === 'remove') {
    items.splice(index, 1);
    invalidateResults();
  }
  if (act === 'up' && index > 0) {
    [items[index - 1], items[index]] = [items[index], items[index - 1]];
    mergedBlob = null;
  }
  if (act === 'down' && index < items.length - 1) {
    [items[index + 1], items[index]] = [items[index], items[index + 1]];
    mergedBlob = null;
  }
  if (act === 'download') {
    const item = items[index];
    if (item.outBlob) triggerDownload(item.outBlob, `${baseName(item.name)}-kompres.pdf`);
    return;
  }

  renderList();
  updateStats();
  updateButtons();
}

/* Drag & drop nas linhas (só no modo Juntar) */
let dragId = null;

function attachDrag(row) {
  row.addEventListener('dragstart', (event) => {
    dragId = row.dataset.id;
    row.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
  });

  row.addEventListener('dragend', () => {
    dragId = null;
    row.classList.remove('dragging');
    pdfList.querySelectorAll('.pdf-row').forEach((r) => r.classList.remove('drag-target'));
  });

  row.addEventListener('dragover', (event) => {
    if (!dragId || dragId === row.dataset.id) return;
    event.preventDefault();
    row.classList.add('drag-target');
  });

  row.addEventListener('dragleave', () => row.classList.remove('drag-target'));

  row.addEventListener('drop', (event) => {
    event.preventDefault();
    row.classList.remove('drag-target');
    if (!dragId || dragId === row.dataset.id) return;

    const from = items.findIndex((item) => item.id === dragId);
    const to = items.findIndex((item) => item.id === row.dataset.id);
    if (from < 0 || to < 0) return;

    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved);
    mergedBlob = null;

    renderList();
    updateButtons();
  });
}

/* ── Stats e botões ── */

function updateStats() {
  const ready = items.filter((item) => item.status !== 'error' && item.status !== 'loading');
  statsBar.hidden = items.length === 0;

  if (mode === 'merge') {
    const labels = ['Arquivos', 'Páginas', 'Tamanho total', 'Resultado'];
    statLabels.forEach((el, i) => { el.textContent = labels[i]; });

    const pages = ready.reduce((sum, item) => sum + (item.pages || 0), 0);
    const size = ready.reduce((sum, item) => sum + item.size, 0);
    statValues[0].textContent = ready.length;
    statValues[1].textContent = pages || '—';
    statValues[2].textContent = size ? formatBytes(size) : '—';
    statValues[3].textContent = mergedBlob ? formatBytes(mergedBlob.size) : '—';
  } else {
    const labels = ['Arquivos', 'Tamanho original', 'Novo tamanho', 'Economia total'];
    statLabels.forEach((el, i) => { el.textContent = labels[i]; });

    const done = ready.filter((item) => item.status === 'done');
    const original = ready.reduce((sum, item) => sum + item.size, 0);
    const output = done.reduce((sum, item) => sum + item.outSize, 0);
    const originalDone = done.reduce((sum, item) => sum + item.size, 0);
    const saved = originalDone > 0 ? Math.max(0, Math.round((1 - output / originalDone) * 100)) : null;

    statValues[0].textContent = ready.length;
    statValues[1].textContent = original ? formatBytes(original) : '—';
    statValues[2].textContent = done.length ? formatBytes(output) : '—';
    statValues[3].textContent = saved !== null ? `${saved}%` : '—';
  }
}

function updateButtons() {
  const ready = items.filter((item) => item.status === 'ready' || item.status === 'done');
  document.querySelectorAll('#pdfControls input, #pdfControls select, #pdfControls button, #allow-rasterize, #fileInput').forEach(el => el.disabled = busy);

  if (mode === 'merge') {
    actionBtn.textContent = busy ? 'Juntando…' : 'Juntar PDFs';
    downloadBtn.textContent = '↓ Baixar PDF';
    actionBtn.disabled = busy || ready.length < 2;
    downloadBtn.disabled = busy || !mergedBlob;
  } else {
    actionBtn.textContent = busy ? 'Comprimindo…' : 'Comprimir tudo';
    downloadBtn.textContent = ready.filter((i) => i.status === 'done').length > 1 ? '↓ Baixar ZIP' : '↓ Baixar PDF';
    const doneCount = items.filter((item) => item.status === 'done').length;
    actionBtn.disabled = busy || ready.length === 0;
    downloadBtn.disabled = busy || doneCount === 0;
  }

  clearBtn.disabled = busy || items.length === 0;
}

/* ── Ações principais ── */

actionBtn.addEventListener('click', () => {
  if (mode === 'merge') mergeAll();
  else compressAll();
});

downloadBtn.addEventListener('click', async () => {
  if (mode === 'merge') {
    if (mergedBlob) triggerDownload(mergedBlob, 'kompres-unido.pdf');
    return;
  }

  const done = items.filter((item) => item.status === 'done' && item.outBlob);
  if (!done.length) return;

  if (done.length === 1) {
    triggerDownload(done[0].outBlob, `${baseName(done[0].name)}-kompres.pdf`);
    return;
  }

  if (!zipBlob) {
    const zip = new JSZip();
    done.forEach((item, index) => zip.file(`${index + 1}-${baseName(item.name)}-kompres.pdf`, item.outBlob));
    zipBlob = await zip.generateAsync({ type: 'blob' });
  }
  triggerDownload(zipBlob, 'kompres-pdfs.zip');
});

clearBtn.addEventListener('click', () => {
  if (busy) return;
  items = [];
  mergedBlob = null;
  zipBlob = null;
  renderList();
  updateStats();
  updateButtons();
});

/* ── Juntar ── */

async function mergeAll() {
  const ready = items.filter((item) => item.status === 'ready' || item.status === 'done');
  if (ready.length < 2 || busy) return;

  busy = true;
  updateButtons();

  try {
    const out = await PDFLib.PDFDocument.create();

    for (const item of ready) {
      const src = await PDFLib.PDFDocument.load(item.data, { ignoreEncryption: false });
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach((page) => out.addPage(page));
    }

    const bytes = await out.save();
    mergedBlob = new Blob([bytes], { type: 'application/pdf' });
  } catch (err) {
    console.error('Erro ao juntar PDFs:', err);
    alert('Não foi possível juntar os PDFs. Verifique se algum arquivo está protegido por senha.');
  }

  busy = false;
  renderList();
  updateStats();
  updateButtons();
}

/* ── Comprimir ── */

async function compressAll() {
  const targets = items.filter((item) => item.status === 'ready' || item.status === 'done');
  if (!targets.length || busy) return;

  busy = true;
  zipBlob = null;
  const dpi = Number(dpiSelect.value);
  const quality = Number(qualityIn.value) / 100;

  for (const item of targets) {
    item.status = 'working';
    item.outBlob = null;
    item.outSize = null;
    renderList();
    updateButtons();

    try {
      const result = await compressSmart(item, dpi, quality);
      item.outBlob = result.blob;
      item.outSize = result.blob.size;
      item.method = result.method; // 'render' | 'lossless' | 'original'
      item.status = 'done';
    } catch (err) {
      console.error('Erro ao comprimir:', item.name, err);
      item.status = 'error';
      item.error = 'Falha ao comprimir este PDF';
    }

    renderList();
    updateStats();
    updateButtons();
  }

  busy = false;
  renderList();
  updateStats();
  updateButtons();
}

/*
  Estratégia inteligente de compressão:
  1) Passe sem perdas — re-save com object streams (texto continua selecionável).
  2) Recompressão de imagens embutidas — recomprime os JPEGs/bitmaps DENTRO do
     PDF mantendo texto, fontes e vetores intactos. É onde mora a gordura da
     maioria dos PDFs pesados.
  3) Re-render com escalonamento — último recurso; página vira imagem.
  Preferência: resultados que preservam o texto vencem, a menos que o
  re-render seja pelo menos 15% menor.
*/
async function compressSmart(item, dpi, quality) {
  const candidates = [];

  // 1) sem perdas
  try {
    const src = await PDFLib.PDFDocument.load(item.data, { ignoreEncryption: false });
    const bytes = await src.save({ useObjectStreams: true });
    const blob = new Blob([bytes], { type: 'application/pdf' });
    if (blob.size < item.size) candidates.push({ blob, method: 'lossless' });
  } catch (err) {
    console.warn('Passe sem perdas falhou:', item.name, err);
  }

  // 2) recompressão de imagens embutidas (texto preservado)
  try {
    const blob = await recompressEmbeddedImages(item, dpi, quality);
    if (blob && blob.size < item.size) candidates.push({ blob, method: 'images' });
  } catch (err) {
    console.warn('Recompressão de imagens embutidas falhou:', item.name, err);
  }

  // se já temos ganho bom preservando o texto, nem tenta rasterizar
  const bestTextSafe = candidates.slice().sort((a, b) => a.blob.size - b.blob.size)[0];
  const goodEnough = bestTextSafe && bestTextSafe.blob.size < item.size * 0.6;

  // 3) re-render com fallback progressivo
  if (!goodEnough && rasterizeInput.checked) {
    const attempts = [
      { dpi, q: quality },
      { dpi: Math.max(96, dpi - 24), q: Math.max(0.5, quality - 0.15) },
      { dpi: 96, q: Math.max(0.45, quality - 0.3) },
    ];
    const seen = new Set();

    for (const attempt of attempts) {
      const key = `${attempt.dpi}-${attempt.q.toFixed(2)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const blob = await compressOne(item, attempt.dpi, attempt.q);
      if (blob.size < item.size) candidates.push({ blob, method: 'render' });

      if (blob.size < item.size * 0.9) break;
    }
  }

  if (!candidates.length) {
    return {
      blob: new Blob([item.data], { type: 'application/pdf' }),
      method: 'original',
    };
  }

  candidates.sort((a, b) => a.blob.size - b.blob.size);
  const smallest = candidates[0];
  const textSafe = candidates.find((c) => c.method !== 'render');

  // render só vence um resultado com texto preservado se for 15%+ menor
  if (textSafe && smallest.method === 'render' && textSafe.blob.size <= smallest.blob.size * 1.15) {
    return textSafe;
  }
  return smallest;
}

/* ── Recompressão de imagens dentro do PDF (texto preservado) ── */

async function recompressEmbeddedImages(item, dpi, quality) {
  const doc = await PDFLib.PDFDocument.load(item.data, { ignoreEncryption: false });
  const ctx2 = doc.context;
  const N = (key) => PDFLib.PDFName.of(key);
  const resolve = (v) => (v instanceof PDFLib.PDFRef ? ctx2.lookup(v) : v);
  const asNum = (v) => {
    const r = resolve(v);
    return r && typeof r.asNumber === 'function' ? r.asNumber() : null;
  };

  // imagens acima disso são reduzidas (proporcional ao preset de DPI)
  const maxDim = dpi >= 150 ? 2400 : dpi >= 120 ? 1800 : 1400;
  const progressBar = () => document.getElementById(`prog-${item.id}`);

  const objects = ctx2.enumerateIndirectObjects();
  const imageRefs = [];

  for (const [ref, obj] of objects) {
    if (!(obj instanceof PDFLib.PDFRawStream)) continue;
    if (obj.dict.get(N('Subtype')) !== N('Image')) continue;
    imageRefs.push([ref, obj]);
  }

  if (!imageRefs.length) return null;

  let touched = 0;
  let processed = 0;

  for (const [ref, stream] of imageRefs) {
    processed++;
    const bar = progressBar();
    if (bar) bar.style.width = `${Math.round((processed / imageRefs.length) * 100)}%`;

    try {
      const dict = stream.dict;
      if (dict.get(N('Decode')) || dict.get(N('SMask'))) continue;
      if (dict.get(N('Mask'))) continue;             // color-key mask: arriscado
      if (dict.get(N('ImageMask'))) continue;        // stencil mask: não é imagem comum
      const smaskRef = dict.get(N('SMask')) || null; // transparência: preserva

      const width = asNum(dict.get(N('Width')));
      const height = asNum(dict.get(N('Height')));
      if (!width || !height || width * height < 96 * 96) continue; // ícones: ignora

      const filters = filterNames(dict.get(N('Filter')), resolve);
      const rawCS = resolve(dict.get(N('ColorSpace')));
      if (rawCS !== N('DeviceRGB') && rawCS !== N('DeviceGray')) continue;
      const csInfo = colorSpaceInfo(dict.get(N('ColorSpace')), resolve, N);

      let source = null; // algo que o drawImage aceite

      if (filters.length === 1 && filters[0] === 'DCTDecode') {
        if (csInfo.channels === 4) continue; // CMYK: browser decodifica errado
        source = await createImageBitmap(new Blob([stream.contents], { type: 'image/jpeg' }));
      } else if (filters.length === 1 && filters[0] === 'FlateDecode') {
        const bpc = asNum(dict.get(N('BitsPerComponent')));
        const parms = resolve(dict.get(N('DecodeParms')));
        const predictor = parms && parms.get ? asNum(parms.get(N('Predictor'))) : null;
        if (predictor && predictor > 1) continue;    // PNG predictors: fora do escopo
        if (bpc !== 8 || (csInfo.channels !== 3 && csInfo.channels !== 1)) continue;

        const raw = PDFLib.decodePDFRawStream(stream).decode();
        source = canvasFromRawPixels(raw, width, height, csInfo.channels);
        if (!source) continue;
      } else {
        continue; // JPX, JBIG2, CCITT etc.: deixa quieto
      }

      // downscale só quando não há SMask (as dimensões precisam casar)
      let tw = source.width;
      let th = source.height;
      if (!smaskRef && Math.max(tw, th) > maxDim) {
        const f = maxDim / Math.max(tw, th);
        tw = Math.round(tw * f);
        th = Math.round(th * f);
      }

      const canvas = document.createElement('canvas');
      canvas.width = tw;
      canvas.height = th;
      const c2d = canvas.getContext('2d');
      c2d.fillStyle = '#ffffff';
      c2d.fillRect(0, 0, tw, th);
      c2d.drawImage(source, 0, 0, tw, th);
      if (source.close) source.close();

      const jpegBlob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
      const bytes = new Uint8Array(await jpegBlob.arrayBuffer());
      canvas.width = 0;
      canvas.height = 0;

      // só troca se o ganho for real
      if (bytes.length >= stream.contents.length * 0.92) continue;

      const newDict = ctx2.obj({
        Type: 'XObject',
        Subtype: 'Image',
        Width: tw,
        Height: th,
        ColorSpace: 'DeviceRGB',
        BitsPerComponent: 8,
        Filter: 'DCTDecode',
        Length: bytes.length,
      });
      if (smaskRef) newDict.set(N('SMask'), smaskRef);

      ctx2.assign(ref, PDFLib.PDFRawStream.of(newDict, bytes));
      touched++;
    } catch (err) {
      console.warn('Imagem embutida ignorada:', err);
    }
  }

  if (!touched) return null;

  const bytes = await doc.save({ useObjectStreams: true });
  return new Blob([bytes], { type: 'application/pdf' });
}

function filterNames(filter, resolve) {
  const f = resolve(filter);
  if (!f) return [];
  if (f instanceof PDFLib.PDFName) return [f.toString().slice(1)];
  if (f instanceof PDFLib.PDFArray) {
    return f.asArray().map((n) => resolve(n)).filter((n) => n instanceof PDFLib.PDFName)
      .map((n) => n.toString().slice(1));
  }
  return [];
}

function colorSpaceInfo(cs, resolve, N) {
  const v = resolve(cs);
  if (v instanceof PDFLib.PDFName) {
    const name = v.toString().slice(1);
    if (name === 'DeviceRGB') return { channels: 3 };
    if (name === 'DeviceGray') return { channels: 1 };
    if (name === 'DeviceCMYK') return { channels: 4 };
    return { channels: 0 };
  }
  if (v instanceof PDFLib.PDFArray) {
    const head = resolve(v.get(0));
    if (head === N('ICCBased')) {
      const icc = resolve(v.get(1));
      const n = icc && icc.dict ? resolve(icc.dict.get(N('N'))) : null;
      const channels = n && typeof n.asNumber === 'function' ? n.asNumber() : 0;
      return { channels };
    }
    return { channels: 0 }; // Indexed, Separation etc.: fora do escopo
  }
  return { channels: 0 };
}

function canvasFromRawPixels(raw, width, height, channels) {
  const expected = width * height * channels;
  if (raw.length < expected) return null;

  const rgba = new Uint8ClampedArray(width * height * 4);
  if (channels === 3) {
    for (let i = 0, j = 0; i < expected; i += 3, j += 4) {
      rgba[j] = raw[i];
      rgba[j + 1] = raw[i + 1];
      rgba[j + 2] = raw[i + 2];
      rgba[j + 3] = 255;
    }
  } else {
    for (let i = 0, j = 0; i < expected; i += 1, j += 4) {
      rgba[j] = raw[i];
      rgba[j + 1] = raw[i];
      rgba[j + 2] = raw[i];
      rgba[j + 3] = 255;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvas;
}

async function compressOne(item, dpi, quality) {
  const doc = await pdfjsLib.getDocument({ isEvalSupported: false, data: item.data.slice(0) }).promise;
  const out = await PDFLib.PDFDocument.create();
  const progress = () => document.getElementById(`prog-${item.id}`);
  const scale = dpi / 72;

  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp1 = page.getViewport({ scale: 1 });        // dimensões em pontos
    const viewport = page.getViewport({ scale });      // render no DPI alvo

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport }).promise;

    const jpegBlob = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality)
    );
    const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
    const image = await out.embedJpg(jpegBytes);

    const outPage = out.addPage([vp1.width, vp1.height]);
    outPage.drawImage(image, { x: 0, y: 0, width: vp1.width, height: vp1.height });

    canvas.width = 0;
    canvas.height = 0;

    const bar = progress();
    if (bar) bar.style.width = `${Math.round((n / doc.numPages) * 100)}%`;
  }

  await doc.destroy();
  const bytes = await out.save();
  return new Blob([bytes], { type: 'application/pdf' });
}

/* ── Init ── */
applyMode();
