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

let selectedFormat = 'webp';
let images = [];

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
    resetCompressedResults();
  });
});

dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropZone.classList.remove('drag-over');
  handleFiles([...event.dataTransfer.files]);
});

fileInput.addEventListener('change', () => {
  handleFiles([...fileInput.files]);
});

btnCompress.addEventListener('click', compressAllImages);
btnDownloadAll.addEventListener('click', downloadAllAsZip);
btnClear.addEventListener('click', clearAll);

function handleFiles(files) {
  const validFiles = files.filter((file) => file.type.startsWith('image/'));
  if (!validFiles.length) return;

  validFiles.forEach((file) => {
    const id = `${Date.now()}-${Math.random()}`;
    const reader = new FileReader();

    reader.onload = (event) => {
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
    };

    reader.readAsDataURL(file);
  });

  fileInput.value = '';
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
      <button class="card-download" type="button" disabled id="dl-${image.id}">↓ baixar</button>
    </div>
  `;

  card.querySelector('.card-remove').addEventListener('click', () => removeImage(image.id));
  imageGrid.appendChild(card);
}

function removeImage(id) {
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

function resetCompressedResults() {
  images.forEach((image) => {
    image.compressed = null;
    image.compressedName = null;

    const card = document.querySelector(`.image-card[data-id="${CSS.escape(image.id)}"]`);
    const progress = document.getElementById(`prog-${image.id}`);
    const sizes = document.getElementById(`sizes-${image.id}`);
    const overlay = document.getElementById(`overlay-${image.id}`);
    const downloadButton = document.getElementById(`dl-${image.id}`);

    if (card) card.classList.remove('done');
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
}

async function compressAllImages() {
  if (!images.length) return;

  btnCompress.disabled = true;
  btnCompress.textContent = 'Comprimindo...';

  const quality = Number(qualitySlider.value) / 100;
  const format = selectedFormat;

  for (const image of images) {
    const progress = document.getElementById(`prog-${image.id}`);
    if (progress) progress.style.width = '40%';

    let blob = await compressImage(image.dataUrl, format, quality);

    const isConversion = !image.file.name.toLowerCase().endsWith(`.${format}`) &&
      !(format === 'jpeg' && image.file.name.toLowerCase().match(/\.jpe?g$/));

    if (!isConversion && blob.size >= image.file.size) {
      blob = image.file;
    }

    image.compressed = blob;
    image.compressedName = `${image.file.name.replace(/\.(png|webp|jpe?g)$/i, '')}.${format}`;

    if (progress) progress.style.width = '100%';

    const savedPercent = calculateSavingPercent(image.file.size, blob.size);

    document.getElementById(`sizes-${image.id}`).innerHTML = `
      <span class="size-original">${formatBytes(image.file.size)}</span>
      <span class="size-arrow">→</span>
      <span class="size-new">${formatBytes(blob.size)}</span>
    `;

    const overlay = document.getElementById(`overlay-${image.id}`);
    if (savedPercent > 0) {
      overlay.textContent = `-${savedPercent}%`;
      overlay.style.display = 'block';
    } else {
      overlay.textContent = '';
      overlay.style.display = 'none';
    }

    const downloadButton = document.getElementById(`dl-${image.id}`);
    downloadButton.disabled = false;
    downloadButton.onclick = () => downloadBlob(blob, image.compressedName);

    document.querySelector(`.image-card[data-id="${CSS.escape(image.id)}"]`).classList.add('done');
    updateStats();
  }

  btnCompress.textContent = 'Comprimir tudo';
  btnCompress.disabled = false;
  btnDownloadAll.disabled = images.some((image) => image.compressed) === false;
}

async function downloadAllAsZip() {
  const doneImages = images.filter((image) => image.compressed);
  if (!doneImages.length) return;

  btnDownloadAll.textContent = 'Gerando ZIP...';
  btnDownloadAll.disabled = true;

  const zip = new JSZip();
  doneImages.forEach((image) => {
    zip.file(image.compressedName, image.compressed);
  });

  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, 'imagens-kompres.zip');

  btnDownloadAll.textContent = '↓ Baixar ZIP';
  btnDownloadAll.disabled = false;
}

function clearAll() {
  images = [];
  imageGrid.innerHTML = '';
  fileInput.value = '';
  updateUI();
  updateStats();
}

function updateUI() {
  const hasImages = images.length > 0;
  const hasCompressed = images.some((image) => image.compressed);

  btnCompress.disabled = !hasImages;
  btnClear.disabled = !hasImages;
  btnDownloadAll.disabled = !hasCompressed;
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
  const saved = totalOriginal - totalNew;
  const savedPercent = doneImages.length ? calculateSavingPercent(totalOriginal, totalNew) : 0;

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

async function compressImage(dataUrl, format, quality) {
  if (format === 'png') return compressPNG(dataUrl, quality);
  return compressCanvas(dataUrl, format, quality);
}

function compressCanvas(dataUrl, format, quality) {
  return new Promise((resolve) => {
    const image = new Image();

    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext('2d').drawImage(image, 0, 0);

      const mimeType = format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
      canvas.toBlob((blob) => resolve(blob), mimeType, quality);
    };

    image.src = dataUrl;
  });
}

async function compressPNG(dataUrl, quality) {
  const image = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;

  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const colors = qualityToColors(quality);

  const arrayBuffer = UPNG.encode(
    [imageData.data.buffer],
    canvas.width,
    canvas.height,
    colors
  );

  return new Blob([arrayBuffer], { type: 'image/png' });
}

function qualityToColors(quality) {
  if (quality >= 0.95) return 256;
  if (quality >= 0.85) return 192;
  if (quality >= 0.70) return 128;
  if (quality >= 0.55) return 96;
  if (quality >= 0.40) return 64;
  return 32;
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
  URL.revokeObjectURL(url);
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

if (cookieBanner && !localStorage.getItem('kompres-cookies')) {
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

window.acceptCookies = acceptCookies;
window.rejectCookies = rejectCookies;

updateAllRangeFills();