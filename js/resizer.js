const fileInput = document.getElementById('fileInput');
const dropZone = document.getElementById('dropZone');
const processBtn = document.getElementById('processBtn');
const downloadZipBtn = document.getElementById('downloadZipBtn');
const clearBtn = document.getElementById('clearBtn');
const previewList = document.getElementById('previewList');
const widthGroup = document.getElementById('widthGroup');
const percentGroup = document.getElementById('percentGroup');
const maxWidthInput = document.getElementById('maxWidth');
const percentSelect = document.getElementById('percent');
const statsBar = document.getElementById('statsBar');
const statCount = document.getElementById('statCount');
const statOriginal = document.getElementById('statOriginal');
const statNew = document.getElementById('statNew');
const statSaved = document.getElementById('statSaved');

let imageData = [];

fileInput.addEventListener('change', async (event) => {
  await handleFiles([...event.target.files]);
});

dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', async (event) => {
  event.preventDefault();
  dropZone.classList.remove('dragover');

  const files = [...event.dataTransfer.files].filter((file) => file.type.startsWith('image/'));
  await handleFiles(files);
});

document.querySelectorAll('input[name="resizeMode"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    const mode = getResizeMode();
    widthGroup.classList.toggle('hidden', mode !== 'width');
    percentGroup.classList.toggle('hidden', mode !== 'percent');
    updateActiveToggle('resizeMode');
    updatePreviewDimensions();
  });
});

[maxWidthInput, percentSelect].forEach((input) => {
  input.addEventListener('input', updatePreviewDimensions);
  input.addEventListener('change', updatePreviewDimensions);
});

processBtn.addEventListener('click', processImages);
downloadZipBtn.addEventListener('click', downloadAllAsZip);
clearBtn.addEventListener('click', clearAll);

async function handleFiles(files) {
  if (!files.length) return;

  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    const data = await getImageInfo(file);
    imageData.push(data);
  }

  renderPreviews();
  updateStats();
  updateUI();
  fileInput.value = '';
}

function getResizeMode() {
  return document.querySelector('input[name="resizeMode"]:checked').value;
}

function updateActiveToggle(groupName) {
  document.querySelectorAll(`input[name="${groupName}"]`).forEach((input) => {
    const label = input.closest('.fmt-btn');
    if (!label) return;
    label.classList.toggle('active', input.checked);
  });
}

function getImageInfo(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const previewUrl = URL.createObjectURL(file);

    image.onload = () => {
      resolve({
        file,
        previewUrl,
        originalWidth: image.width,
        originalHeight: image.height,
        originalSize: file.size,
        processed: null,
        downloadUrl: null,
      });
    };

    image.onerror = reject;
    image.src = previewUrl;
  });
}

function calculateNewDimensions(originalWidth, originalHeight) {
  const mode = getResizeMode();

  if (mode === 'width') {
    const width = Math.max(Number(maxWidthInput.value), 1);
    const height = Math.round((originalHeight / originalWidth) * width);
    return { width, height };
  }

  const percent = Math.max(Number(percentSelect.value), 1) / 100;
  return {
    width: Math.round(originalWidth * percent),
    height: Math.round(originalHeight * percent),
  };
}

function renderPreviews() {
  previewList.innerHTML = '';

  imageData.forEach((data, index) => {
    const dimensions = calculateNewDimensions(data.originalWidth, data.originalHeight);
    const savingPercent = data.processed
      ? calculateSavingPercent(data.originalSize, data.processed.blob.size)
      : 0;

    const card = document.createElement('div');
    card.className = data.processed ? 'preview-card done' : 'preview-card';
    card.dataset.index = index;

    const processedHtml = data.processed
      ? `
        <small>${data.originalWidth}x${data.originalHeight} → ${data.processed.width}x${data.processed.height}</small>
        <small>${formatBytes(data.originalSize)} → <span class="size-new">${formatBytes(data.processed.blob.size)}</span></small>
        <a class="download-btn" href="${data.downloadUrl}" download="${data.processed.fileName}">↓ baixar</a>
      `
      : `
        <small>Dimensão atual: ${data.originalWidth}x${data.originalHeight}</small>
        <small class="future-size">Nova dimensão: ${dimensions.width}x${dimensions.height}</small>
        <small>${formatBytes(data.originalSize)} → aguardando</small>
        <button class="download-btn" type="button" disabled>↓ baixar</button>
      `;

    card.innerHTML = `
      <div class="card-thumb-wrap">
        <img src="${data.previewUrl}" alt="Preview da imagem">
        <button class="card-remove" type="button" data-index="${index}" aria-label="Remover imagem">×</button>
        <span class="card-saving-overlay">-${savingPercent}%</span>
      </div>
      <div class="preview-info">
        <strong>${escapeHtml(data.file.name)}</strong>
        ${processedHtml}
      </div>
    `;

    previewList.appendChild(card);
  });

  document.querySelectorAll('.card-remove').forEach((button) => {
    button.addEventListener('click', () => removeImage(Number(button.dataset.index)));
  });
}

function updatePreviewDimensions() {
  document.querySelectorAll('.preview-card').forEach((card, index) => {
    const data = imageData[index];
    if (!data || data.processed) return;

    const dimensions = calculateNewDimensions(data.originalWidth, data.originalHeight);
    const futureSize = card.querySelector('.future-size');

    if (futureSize) {
      futureSize.textContent = `Nova dimensão: ${dimensions.width}x${dimensions.height}`;
    }
  });
}

async function processImages() {
  if (!imageData.length) {
    alert('Selecione pelo menos uma imagem.');
    return;
  }

  processBtn.disabled = true;
  processBtn.textContent = 'Processando...';

  for (let index = 0; index < imageData.length; index++) {
    const item = imageData[index];

    if (item.downloadUrl) {
      URL.revokeObjectURL(item.downloadUrl);
    }

    const processed = await resizeImage(item.file);
    const downloadUrl = URL.createObjectURL(processed.blob);

    imageData[index].processed = processed;
    imageData[index].downloadUrl = downloadUrl;

    renderPreviews();
    updateStats();
  }

  processBtn.disabled = false;
  processBtn.textContent = 'Redimensionar tudo';
  updateUI();
}

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);

    image.onload = () => {
      const dimensions = calculateNewDimensions(image.width, image.height);
      const canvas = document.createElement('canvas');
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;

      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0, dimensions.width, dimensions.height);

      const mimeType = file.type || 'image/png';
      const extension = getFileExtension(file.name);

      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Erro ao gerar imagem.'));
          return;
        }

        URL.revokeObjectURL(url);

        const baseName = file.name.replace(/\.[^/.]+$/, '');
        const fileName = `${baseName}-${dimensions.width}x${dimensions.height}.${extension}`;

        resolve({
          blob,
          fileName,
          width: dimensions.width,
          height: dimensions.height,
        });
      }, mimeType);
    };

    image.onerror = reject;
    image.src = url;
  });
}

async function downloadAllAsZip() {
  const processedImages = imageData.filter((item) => item.processed);
  if (!processedImages.length) return;

  downloadZipBtn.disabled = true;
  downloadZipBtn.textContent = 'Gerando ZIP...';

  const zip = new JSZip();
  processedImages.forEach((item) => {
    zip.file(item.processed.fileName, item.processed.blob);
  });

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const zipUrl = URL.createObjectURL(zipBlob);

  const link = document.createElement('a');
  link.href = zipUrl;
  link.download = 'imagens-redimensionadas.zip';
  link.click();

  URL.revokeObjectURL(zipUrl);

  downloadZipBtn.disabled = false;
  downloadZipBtn.textContent = '↓ Baixar ZIP';
}

function removeImage(index) {
  const item = imageData[index];

  if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  if (item.downloadUrl) URL.revokeObjectURL(item.downloadUrl);

  imageData.splice(index, 1);
  renderPreviews();
  updateStats();
  updateUI();

  if (!imageData.length) fileInput.value = '';
}

function clearAll() {
  imageData.forEach((item) => {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    if (item.downloadUrl) URL.revokeObjectURL(item.downloadUrl);
  });

  imageData = [];
  previewList.innerHTML = '';
  fileInput.value = '';
  updateStats();
  updateUI();
}

function updateUI() {
  const hasImages = imageData.length > 0;
  const hasProcessed = imageData.some((item) => item.processed);

  processBtn.disabled = false;
  clearBtn.disabled = !hasImages;
  downloadZipBtn.disabled = !hasProcessed;
}

function updateStats() {
  const totalFiles = imageData.length;

  if (!totalFiles) {
    statsBar.hidden = true;
    statCount.textContent = '0';
    statOriginal.textContent = '—';
    statNew.textContent = '—';
    statSaved.textContent = '—';
    return;
  }

  const totalOriginal = imageData.reduce((sum, item) => sum + item.originalSize, 0);
  const processedImages = imageData.filter((item) => item.processed);
  const totalNew = processedImages.reduce((sum, item) => sum + item.processed.blob.size, 0);
  const saved = totalOriginal - totalNew;
  const savingPercent = processedImages.length ? calculateSavingPercent(totalOriginal, totalNew) : 0;

  statsBar.hidden = false;
  statCount.textContent = totalFiles;
  statOriginal.textContent = formatBytes(totalOriginal);

  if (!processedImages.length) {
    statNew.textContent = 'aguardando';
    statSaved.textContent = 'aguardando';
    return;
  }

  statNew.textContent = formatBytes(totalNew);
  statSaved.textContent = `${formatSignedBytes(saved)} (${savingPercent}%)`;
}

function calculateSavingPercent(originalSize, newSize) {
  if (!originalSize || !newSize) return 0;
  return Math.max(Math.round(((originalSize - newSize) / originalSize) * 100), 0);
}

function formatSignedBytes(bytes) {
  const sign = bytes >= 0 ? '-' : '+';
  return `${sign}${formatBytes(Math.abs(bytes))}`;
}

function getFileExtension(fileName) {
  return fileName.split('.').pop().toLowerCase();
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
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
