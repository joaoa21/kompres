/* ── Theme ── */
(function () {
  const saved = localStorage.getItem('kompres-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isLight = saved ? saved === 'light' : !prefersDark;
  if (isLight) document.documentElement.classList.add('light');
})();

function toggleTheme() {
  const isLight = document.documentElement.classList.toggle('light');
  localStorage.setItem('kompres-theme', isLight ? 'light' : 'dark');
  updateSliderFill();
}

const qualitySlider  = document.getElementById('quality-slider');
const qualityVal     = document.getElementById('quality-val');
const fmtToggle      = document.getElementById('fmt-toggle');
const dropZone       = document.getElementById('drop-zone');
const fileInput      = document.getElementById('file-input');
const imageGrid      = document.getElementById('image-grid');
const btnCompress    = document.getElementById('btn-compress');
const btnDownloadAll = document.getElementById('btn-download-all');
const btnClear       = document.getElementById('btn-clear');
const statsBar       = document.getElementById('stats-bar');

let selectedFormat = 'webp';
let images = [];

qualitySlider.addEventListener('input', () => {
  qualityVal.textContent = qualitySlider.value + '%';
  updateSliderFill();
});

fmtToggle.querySelectorAll('.fmt-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    fmtToggle.querySelectorAll('.fmt-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedFormat = btn.dataset.fmt;
  });
});

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  handleFiles([...e.dataTransfer.files]);
});

fileInput.addEventListener('change', () => handleFiles([...fileInput.files]));

function handleFiles(files) {
  const valid = files.filter(f => f.type.startsWith('image/'));
  if (!valid.length) return;
  valid.forEach(file => {
    const id = Date.now() + Math.random();
    const reader = new FileReader();
    reader.onload = e => {
      images.push({ id, file, dataUrl: e.target.result, compressed: null });
      renderCard(images[images.length - 1]);
      updateUI();
    };
    reader.readAsDataURL(file);
  });
  fileInput.value = '';
}

function renderCard(img) {
  const card = document.createElement('div');
  card.className = 'image-card';
  card.dataset.id = img.id;
  card.innerHTML = `
    <div class="card-thumb-wrap">
      <img class="card-thumb" src="${img.dataUrl}" alt="${img.file.name}">
      <button class="card-remove" title="Remover">✕</button>
      <span class="card-saving-overlay" id="overlay-${img.id}"></span>
    </div>
    <div class="card-body">
      <div class="card-name">${img.file.name}</div>
      <div class="progress-bar"><div class="progress-fill" id="prog-${img.id}"></div></div>
      <div class="card-sizes" id="sizes-${img.id}">
        <span class="size-original">${formatBytes(img.file.size)}</span>
        <span class="size-arrow">→</span>
        <span class="size-new" style="color:var(--muted)">aguardando</span>
      </div>
      <button class="card-download" disabled id="dl-${img.id}">↓ baixar</button>
    </div>`;

  card.querySelector('.card-remove').addEventListener('click', () => removeImage(img.id));
  imageGrid.appendChild(card);
}

function removeImage(id) {
  images = images.filter(i => i.id !== id);
  const card = document.querySelector(`.image-card[data-id="${id}"]`);
  if (card) {
    card.style.transition = 'opacity 0.18s, transform 0.18s';
    card.style.opacity = '0';
    card.style.transform = 'scale(0.9)';
    setTimeout(() => card.remove(), 180);
  }
  updateUI();
  updateStats();
}

btnCompress.addEventListener('click', async () => {
  btnCompress.disabled = true;
  btnCompress.textContent = 'Comprimindo...';
  const quality = parseInt(qualitySlider.value) / 100;
  const fmt = selectedFormat;

  for (const img of images) {
    if (img.compressed) continue;
    const prog = document.getElementById('prog-' + img.id);
    prog.style.width = '40%';

    let blob = await compressImage(img.dataUrl, fmt, quality);

    // Se ficou maior que o original, usa o original (mantém formato escolhido só se for conversão)
    const isConversion = !img.file.name.toLowerCase().endsWith('.' + fmt) &&
                         !(fmt === 'jpeg' && img.file.name.toLowerCase().match(/\.jpe?g$/));
    if (!isConversion && blob.size >= img.file.size) {
      blob = img.file;
    }

    img.compressed = blob;
    img.compressedName = img.file.name.replace(/\.(png|webp|jpe?g)$/i, '') + '.' + fmt;

    prog.style.width = '100%';

    const saved = ((img.file.size - blob.size) / img.file.size * 100);

    document.getElementById('sizes-' + img.id).innerHTML = `
      <span class="size-original">${formatBytes(img.file.size)}</span>
      <span class="size-arrow">→</span>
      <span class="size-new">${formatBytes(blob.size)}</span>`;

    const overlay = document.getElementById('overlay-' + img.id);
    if (saved > 0) {
      overlay.textContent = '-' + Math.round(saved) + '%';
      overlay.style.display = 'block';
    }

    const dlBtn = document.getElementById('dl-' + img.id);
    dlBtn.disabled = false;
    dlBtn.addEventListener('click', () => downloadBlob(blob, img.compressedName));

    document.querySelector(`.image-card[data-id="${img.id}"]`).classList.add('done');
  }

  updateStats();
  btnCompress.textContent = 'Comprimir tudo';
  btnCompress.disabled = false;
  btnDownloadAll.disabled = false;
});

btnDownloadAll.addEventListener('click', async () => {
  const done = images.filter(i => i.compressed);
  if (!done.length) return;
  btnDownloadAll.textContent = 'Gerando ZIP...';
  btnDownloadAll.disabled = true;
  const zip = new JSZip();
  done.forEach(img => zip.file(img.compressedName, img.compressed));
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, 'imagens-kompres.zip');
  btnDownloadAll.textContent = '↓ Baixar ZIP';
  btnDownloadAll.disabled = false;
});

btnClear.addEventListener('click', () => {
  images = [];
  imageGrid.innerHTML = '';
  statsBar.style.display = 'none';
  btnCompress.disabled = true;
  btnDownloadAll.disabled = true;
  btnClear.disabled = true;
});

/* ── Compressão ── */
async function compressImage(dataUrl, format, quality) {
  if (format === 'png') {
    return compressPNG(dataUrl, quality);
  }
  return compressCanvas(dataUrl, format, quality);
}

function compressCanvas(dataUrl, format, quality) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/' + format;
      canvas.toBlob(blob => resolve(blob), mimeType, quality);
    };
    img.src = dataUrl;
  });
}

async function compressPNG(dataUrl, quality) {
  const img = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const cnum = qualityToColors(quality);

  const arrayBuffer = UPNG.encode(
    [imageData.data.buffer],
    canvas.width,
    canvas.height,
    cnum
  );

  return new Blob([arrayBuffer], { type: 'image/png' });
}

function qualityToColors(q) {
  // q vai de 0.30 a 1.00
  // Mapeia para número de cores na paleta indexada
  // 0 = lossless (sem quantização, melhor qualidade mas maior arquivo)
  if (q >= 0.95) return 256;
  if (q >= 0.85) return 192;
  if (q >= 0.70) return 128;
  if (q >= 0.55) return 96;
  if (q >= 0.40) return 64;
  return 32;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function updateUI() {
  const has = images.length > 0;
  btnCompress.disabled = !has;
  btnClear.disabled = !has;
  if (!has) btnDownloadAll.disabled = true;
}

function updateStats() {
  const done = images.filter(i => i.compressed);
  if (!images.length) { statsBar.style.display = 'none'; return; }
  if (!done.length) return;
  statsBar.style.display = 'grid';
  const totalOrig = images.reduce((s, i) => s + i.file.size, 0);
  const totalNew  = done.reduce((s, i) => s + i.compressed.size, 0);
  document.getElementById('stat-count').textContent    = done.length;
  document.getElementById('stat-original').textContent = formatBytes(totalOrig);
  document.getElementById('stat-saved').textContent    = '-' + formatBytes(totalOrig - totalNew);
}

function updateSliderFill() {
  const pct = ((qualitySlider.value - qualitySlider.min) / (qualitySlider.max - qualitySlider.min)) * 100;
  const track = getComputedStyle(document.documentElement).getPropertyValue('--surface2').trim();
  const fill = document.documentElement.classList.contains('light') ? '#3d7000' : '#b8f55a';
  qualitySlider.style.background = `linear-gradient(to right, ${fill} 0%, ${fill} ${pct}%, ${track} ${pct}%, ${track} 100%)`;
}

/* ── Cookie banner ── */
const cookieBanner = document.getElementById('cookie-banner');

if (!localStorage.getItem('kompres-cookies')) {
  setTimeout(() => cookieBanner.classList.add('show'), 800);
}

function acceptCookies() {
  localStorage.setItem('kompres-cookies', 'accepted');
  cookieBanner.classList.remove('show');
}

function rejectCookies() {
  localStorage.setItem('kompres-cookies', 'rejected');
  cookieBanner.classList.remove('show');
}

updateSliderFill();
