/* HEIC para JPG (ou PNG) em lote.
 * Cada foto é decodificada uma vez: primeiro pelo próprio navegador (o Safari abre HEIC) e,
 * se ele não souber, pela biblioteca heic2any, baixada só quando chega o primeiro HEIC (~1 MB).
 * O resultado decodificado fica guardado, então mudar formato ou qualidade só recodifica.
 * Montado a cada exibição da página (src/scripts/app.ts); `document` é restrito à página
 * e `signal` é abortado quando o usuário navega para outra ferramenta. */
(() => {
  const HEIC2ANY_URL = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
  let heic2anyPromise = null; // compartilhado entre visitas à página: baixa uma vez por sessão

  /** Carrega a heic2any sob demanda. Usa o `document` real, pois o script vai no <head>. */
  function loadHeic2any() {
    if (window.heic2any) return Promise.resolve(window.heic2any);
    if (!heic2anyPromise) {
      heic2anyPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = HEIC2ANY_URL;
        script.async = true;
        script.onload = () => (window.heic2any ? resolve(window.heic2any) : reject(new Error('heic2any ausente')));
        script.onerror = () => reject(new Error('Falha ao baixar o conversor'));
        document.head.append(script);
      }).catch((error) => { heic2anyPromise = null; throw error; }); // permite tentar de novo
    }
    return heic2anyPromise;
  }

  kompres.register('heic', (signal, document) => {
    const fileInput = document.getElementById('heicInput');
    const dropZone = document.getElementById('heicDropZone');
    const downloadBtn = document.getElementById('heicDownload');
    const clearBtn = document.getElementById('heicClear');
    const grid = document.getElementById('heicGrid');
    const statusLine = document.getElementById('heicStatus');
    const qualityGroup = document.getElementById('heicQualityGroup');
    const qualitySlider = document.getElementById('heicQuality');
    const qualityVal = document.getElementById('heicQualityVal');
    const formatInputs = [...document.querySelectorAll('input[name="heicFormat"]')];

    const QUALITY_DEBOUNCE_MS = 300;

    let images = [];
    let busy = false;
    let rerun = false; // ajuste mudou enquanto um lote rodava
    let qualityTimer = null;
    let libNotice = false; // "Preparando o conversor…" visível na linha de status
    let aborted = false;

    const settings = () => ({
      format: formatInputs.find((input) => input.checked)?.value === 'png' ? 'png' : 'jpg',
      quality: Number(qualitySlider.value) / 100,
    });

    function setStatus(message = '', error = false) {
      statusLine.textContent = message; statusLine.hidden = !message; statusLine.classList.toggle('error', error);
    }

    // ── Entrada ───────────────────────────────────────────────────────
    const extension = (name) => (name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase();
    // No Windows e no Chrome o `file.type` de um HEIC costuma vir vazio: vale a extensão.
    const isHeic = (file) => /^image\/hei[cf]/.test(file.type) || ['heic', 'heif', 'hif'].includes(extension(file.name));
    const isCommon = (file) => ['image/jpeg', 'image/png'].includes(file.type) || ['jpg', 'jpeg', 'png'].includes(extension(file.name));

    fileInput.addEventListener('change', (event) => handleFiles([...event.target.files]));
    kompres.fileDrop({ signal, document, zone: dropZone, onFiles: handleFiles });
    downloadBtn.addEventListener('click', downloadAll);
    clearBtn.addEventListener('click', clearAll);

    formatInputs.forEach((input) => input.addEventListener('change', () => {
      syncControls();
      settingsChanged();
    }));
    qualitySlider.addEventListener('input', () => {
      qualityVal.textContent = `${qualitySlider.value}%`;
      // Espera o usuário soltar o controle antes de recodificar todas as fotos.
      clearTimeout(qualityTimer);
      qualityTimer = setTimeout(settingsChanged, QUALITY_DEBOUNCE_MS);
    });

    function handleFiles(files) {
      const valid = files.filter((file) => isHeic(file) || isCommon(file));
      const skipped = files.length - valid.length;
      setStatus(skipped ? `${skipped} ${skipped === 1 ? 'arquivo ignorado' : 'arquivos ignorados'}: use fotos HEIC ou HEIF.` : '', skipped > 0);
      fileInput.value = '';
      if (!valid.length) return;

      for (const file of valid) {
        const item = {
          file, heic: isHeic(file),
          source: null, frames: 1, width: 0, height: 0, // decodificação (feita uma vez)
          result: null, resultUrl: null, error: '', version: 0, card: null,
        };
        images.push(item);
        item.card = createCard(item);
        grid.appendChild(item.card);
        updateCard(item);
      }
      updateUI();
      processAll();
    }

    /** Formato ou qualidade mudou: todas as fotos são recodificadas (a decodificação fica). */
    function settingsChanged() {
      clearTimeout(qualityTimer);
      qualityTimer = null;
      if (!images.length) return;
      images.forEach((item) => {
        item.version++;
        if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
        item.result = null; item.resultUrl = null; item.error = '';
        updateCard(item);
      });
      updateUI();
      processAll();
    }

    // ── Processamento ─────────────────────────────────────────────────
    const pending = () => images.filter((item) => !item.result && !item.error);

    async function processAll() {
      if (busy) { rerun = true; return; }
      busy = true;
      updateUI();
      do {
        rerun = false;
        // Uma foto por vez: fotos de 12 MP ou mais ocupam muita memória decodificadas.
        for (const item of pending()) {
          if (aborted) return;
          if (!images.includes(item)) continue;
          const version = item.version;
          const options = settings();
          let result = null;
          let error = '';
          try { result = await convert(item, options); } catch (err) { error = err.message || 'Não foi possível converter.'; }
          if (aborted) return;
          if (!images.includes(item) || item.version !== version) continue; // removida ou ajuste mudou
          item.result = result;
          item.error = error;
          if (result) item.resultUrl = URL.createObjectURL(result.blob);
          updateCard(item);
          updateUI();
        }
      } while (rerun || (pending().length && !aborted));
      busy = false;
      if (libNotice) { libNotice = false; setStatus(''); }
      updateUI();
    }

    const toBitmap = (blob) => createImageBitmap(blob, { imageOrientation: 'from-image' });

    /** Devolve a foto decodificada e guarda em `item.source` um Blob que o navegador sabe desenhar. */
    async function decode(item) {
      if (item.source) {
        try { return await toBitmap(item.source); } catch { throw new Error('Arquivo corrompido ou formato não suportado.'); }
      }
      // Safari (e JPG/PNG enviados por engano): o navegador decodifica o arquivo direto.
      try {
        const bitmap = await toBitmap(item.file);
        item.source = item.file;
        return bitmap;
      } catch { /* sem suporte nativo: tenta a heic2any abaixo */ }
      if (!item.heic) throw new Error('Arquivo corrompido ou formato não suportado.');

      let heic2any;
      if (!window.heic2any) {
        libNotice = true;
        setStatus('Preparando o conversor… (só na primeira vez)');
      }
      try { heic2any = await loadHeic2any(); } catch {
        libNotice = false;
        setStatus('Não foi possível baixar o conversor de HEIC. Verifique a conexão e mude um ajuste para tentar de novo.', true);
        throw new Error('Conversor indisponível. Verifique a conexão.');
      }
      if (libNotice) { libNotice = false; setStatus(''); }

      let output;
      // PNG como intermediário: sem perdas, e a codificação final acontece depois, com os ajustes.
      try { output = await heic2any({ blob: item.file, toType: 'image/png', multiple: true }); } catch {
        throw new Error('HEIC corrompido ou não suportado.');
      }
      const blobs = Array.isArray(output) ? output : [output];
      if (!blobs[0]) throw new Error('HEIC corrompido ou não suportado.');
      item.source = blobs[0];
      item.frames = blobs.length; // HEIC com várias imagens (sequência): fica só a primeira
      try { return await toBitmap(item.source); } catch { throw new Error('HEIC corrompido ou não suportado.'); }
    }

    /** Decodifica, desenha no canvas e codifica no formato escolhido. */
    async function convert(item, { format, quality }) {
      const bitmap = await decode(item);
      item.width = bitmap.width;
      item.height = bitmap.height;

      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      // JPG não tem transparência: fundo branco no lugar do preto.
      if (format === 'jpg') { context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); }
      context.drawImage(bitmap, 0, 0);
      bitmap.close?.();

      let blob;
      try {
        blob = format === 'png'
          ? await kompres.pngFromCanvas(canvas, 1)
          : await new Promise((resolve, reject) => canvas.toBlob((out) => (out ? resolve(out) : reject(new Error())), 'image/jpeg', quality));
      } catch {
        // Costuma ser o limite de tamanho de canvas do navegador (iPhone com fotos de 48 MP).
        throw new Error('Imagem grande demais para este navegador.');
      } finally {
        canvas.width = 0; canvas.height = 0; // libera a memória do canvas na hora
      }
      const base = item.file.name.replace(/\.[^/.]+$/, '') || 'foto';
      return { blob, fileName: `${base}.${format}` };
    }

    // ── Cartões ───────────────────────────────────────────────────────
    function createCard(item) {
      const name = escapeHtml(item.file.name);
      const card = document.createElement('div');
      card.className = 'image-card heic-card';
      card.innerHTML = `
        <div class="card-thumb-wrap">
          <img class="card-thumb" alt="${name}" hidden>
          <span class="heic-placeholder" aria-hidden="true"></span>
          <button class="card-remove" type="button" aria-label="Remover ${name}">✕</button>
        </div>
        <div class="card-body">
          <div class="card-name" title="${name}">${name}</div>
          <small class="card-meta heic-dims"></small>
          <small class="card-meta heic-size"></small>
          <small class="card-meta heic-note" hidden></small>
          <div class="heic-card-action"></div>
        </div>
      `;
      card.querySelector('.card-remove').addEventListener('click', () => removeImage(item));
      return card;
    }

    function updateCard(item) {
      const card = item.card;
      if (!card || !card.isConnected) return;
      const thumb = card.querySelector('.card-thumb');
      const placeholder = card.querySelector('.heic-placeholder');

      card.classList.toggle('done', !!item.result);
      card.classList.toggle('failed', !!item.error);

      // O HEIC original não abre no <img> fora do Safari: a miniatura é o próprio resultado.
      if (item.resultUrl) {
        if (thumb.src !== item.resultUrl) thumb.src = item.resultUrl;
        thumb.hidden = false;
        placeholder.hidden = true;
      } else {
        thumb.hidden = true;
        thumb.removeAttribute('src');
        placeholder.hidden = false;
        placeholder.textContent = item.error ? 'Erro' : 'Convertendo…';
      }

      card.querySelector('.heic-dims').textContent = item.width ? `${item.width}×${item.height}` : extension(item.file.name).toUpperCase();

      const size = card.querySelector('.heic-size');
      if (item.result) size.innerHTML = `${formatBytes(item.file.size)} → <span class="size-new">${formatBytes(item.result.blob.size)}</span>`;
      else if (item.error) size.innerHTML = `<span class="card-error">${escapeHtml(item.error)}</span>`;
      else size.textContent = `${formatBytes(item.file.size)} → aguardando`;

      const note = card.querySelector('.heic-note');
      note.hidden = item.frames < 2;
      note.textContent = item.frames > 1 ? `Arquivo com ${item.frames} imagens: convertida a primeira` : '';

      card.querySelector('.heic-card-action').innerHTML = item.result
        ? `<a class="card-download" href="${item.resultUrl}" download="${escapeHtml(item.result.fileName)}">↓ baixar</a>`
        : '<button class="card-download" type="button" disabled>↓ baixar</button>';
    }

    // ── Download e limpeza ────────────────────────────────────────────
    function downloadBlob(blob, name) {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }

    /** Nomes repetidos no ZIP (IMG_0001.heic e IMG_0001.HEIC) ganham " (2)" em vez de se sobrescrever. */
    function uniqueName(name, used) {
      let candidate = name;
      const dot = name.lastIndexOf('.');
      for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${name.slice(0, dot)} (${n})${name.slice(dot)}`;
      used.add(candidate.toLowerCase());
      return candidate;
    }

    async function downloadAll() {
      const done = images.filter((item) => item.result);
      if (!done.length) return;
      if (done.length === 1) { downloadBlob(done[0].result.blob, done[0].result.fileName); return; }

      downloadBtn.disabled = true;
      downloadBtn.textContent = 'Gerando ZIP…';
      try {
        const zip = new JSZip();
        const used = new Set();
        // JPG e PNG já são comprimidos: STORE gera o ZIP muito mais rápido sem aumentar o tamanho.
        done.forEach((item) => zip.file(uniqueName(item.result.fileName, used), item.result.blob, { compression: 'STORE' }));
        downloadBlob(await zip.generateAsync({ type: 'blob' }), 'fotos-convertidas-kompres.zip');
      } catch { setStatus('Não foi possível gerar o ZIP. Tente novamente.', true); }
      finally { updateUI(); }
    }

    function releaseItem(item) {
      if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
      item.resultUrl = null;
    }

    function removeImage(item) {
      const index = images.indexOf(item);
      if (index === -1) return;
      releaseItem(item);
      images.splice(index, 1);
      item.card?.remove();
      item.card = null;
      updateUI();
    }

    function clearAll() {
      images.forEach(releaseItem);
      images = [];
      grid.innerHTML = '';
      fileInput.value = '';
      if (!libNotice) setStatus('');
      updateUI();
    }

    function syncControls() {
      const { format } = settings();
      formatInputs.forEach((input) => input.closest('.fmt-btn')?.classList.toggle('active', input.checked));
      qualityGroup.classList.toggle('hidden', format === 'png'); // PNG é sem perdas: qualidade não se aplica
    }

    function updateUI() {
      const done = images.filter((item) => item.result).length;
      const working = busy && pending().length > 0;
      clearBtn.disabled = !images.length;
      downloadBtn.disabled = working || !done;
      downloadBtn.textContent = working ? 'Convertendo…' : done > 1 ? '↓ Baixar ZIP' : '↓ Baixar';
    }

    function formatBytes(bytes) {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }

    function escapeHtml(value) {
      return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
    }

    // O navegador pode restaurar o formulário ao voltar à página: alinha a tela com os valores.
    qualityVal.textContent = `${qualitySlider.value}%`;
    syncControls();
    updateUI();

    // Saiu da página: interrompe o lote e libera os object URLs. A heic2any fica carregada
    // (global) para a próxima visita não baixar de novo.
    signal.addEventListener('abort', () => {
      aborted = true;
      clearTimeout(qualityTimer);
      images.forEach(releaseItem);
      images = [];
    });
  });
})();
