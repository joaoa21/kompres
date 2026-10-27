/* PNG para ICO / gerador de favicon.
 * Montado a cada exibição da página (src/scripts/app.ts); `document` é restrito à página
 * e `signal` é abortado quando o usuário navega para outra ferramenta.
 * Cada tamanho é desenhado num canvas próprio a partir de uma cópia de até 1024 px da
 * imagem; o .ico é montado aqui mesmo, sem biblioteca (kompres.icoFromPngs). */

/* Monta um arquivo ICO com imagens PNG embutidas (aceito desde o Windows Vista e por todos
 * os navegadores atuais). Estrutura, tudo little-endian:
 *   ICONDIR (6 bytes): reservado 0, tipo 1 (ícone), quantidade de imagens;
 *   ICONDIRENTRY (16 bytes por imagem): largura, altura (0 = 256), cores 0, reservado 0,
 *   planes 1, bitCount 32, tamanho do PNG e posição dele no arquivo;
 *   depois os PNGs, um atrás do outro.
 * images: [{ size, data: Uint8Array com o PNG }]. Fica fora do register para ser testável no Node. */
kompres.icoFromPngs = (images) => {
  if (!images.length) throw new Error('Nenhuma imagem para o ICO.');
  const sorted = [...images].sort((a, b) => a.size - b.size);
  const headerSize = 6 + 16 * sorted.length;
  const total = sorted.reduce((sum, image) => sum + image.data.length, headerSize);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, sorted.length, true);
  let offset = headerSize;
  sorted.forEach(({ size, data }, index) => {
    if (!Number.isInteger(size) || size < 1 || size > 256) throw new Error(`Tamanho inválido para ICO: ${size}`);
    const entry = 6 + index * 16;
    out[entry] = out[entry + 1] = size === 256 ? 0 : size; // um byte só: 0 significa 256
    out[entry + 2] = 0; // paleta: não se aplica a 32 bits
    out[entry + 3] = 0;
    view.setUint16(entry + 4, 1, true);
    view.setUint16(entry + 6, 32, true);
    view.setUint32(entry + 8, data.length, true);
    view.setUint32(entry + 12, offset, true);
    out.set(data, offset);
    offset += data.length;
  });
  return out;
};

kompres.register('favicon', (signal, document) => {
  const $ = (id) => document.getElementById(id);
  const fileInput = $('favFile'), dropZone = $('favDrop'), stage = $('favStage'), previews = $('favPreviews');
  const statusLine = $('favStatus'), downloadBtn = $('favDownload'), zipBtn = $('favZip'), clearBtn = $('favClear');
  const colorRow = $('favColorRow'), colorInput = $('favColor'), colorValue = $('favColorValue');
  const paddingInput = $('favPadding'), radiusInput = $('favRadius');
  const snippetBox = $('favSnippet'), copyBtn = $('favCopy');
  const snippet = $('favCode').textContent.trim();

  const BASE_MAX = 1024;  // maior saída é 512 (ícone do Android); o dobro dá margem para o corte
  const ZOOM = { 16: 4, 32: 3 }; // tamanhos pequenos ganham uma cópia ampliada sem suavizar
  const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

  let source = null;  // { name, width, height, base: canvas de até 1024 px }
  let busy = false;
  let frame = 0;      // requestAnimationFrame pendente da prévia
  let generation = 0; // descarta carregamentos antigos quando chega outra imagem

  function setStatus(message = '', error = false) {
    statusLine.textContent = message; statusLine.hidden = !message; statusLine.classList.toggle('error', error);
  }
  const checked = (name) => document.querySelector(`input[name="${name}"]:checked`).value;
  const selectedSizes = () => [...document.querySelectorAll('input[name="favSize"]:checked')].map((input) => Number(input.value)).sort((a, b) => a - b);
  const isSvg = (file) => file.type === 'image/svg+xml' || /\.svg$/i.test(file.name || '');
  const canvasOf = (width, height) => {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    return canvas;
  };
  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  /* ---------- entrada ---------- */

  fileInput.addEventListener('change', () => { const file = fileInput.files[0]; fileInput.value = ''; if (file) load(file); });
  kompres.fileDrop({ signal, document, zone: dropZone, onFiles: (files) => load(files[0]) });

  async function load(file) {
    if (busy || !file) return;
    // Alguns sistemas entregam .svg com tipo vazio: o nome decide.
    if (!TYPES.includes(file.type) && !isSvg(file)) { setStatus('Use uma imagem PNG, JPG, WebP ou SVG.', true); return; }
    const token = ++generation;
    setStatus('Abrindo imagem…');
    try {
      const loaded = isSvg(file) ? await loadSvg(file) : await loadRaster(file);
      if (token !== generation || signal.aborted) return;
      if (source) source.base.width = source.base.height = 0; // libera a imagem anterior
      source = { name: file.name, ...loaded };
      $('favName').textContent = file.name;
      const notes = [`${source.width} × ${source.height} px`, formatBytes(file.size)];
      if (source.width !== source.height) notes.push('não é quadrada');
      if (!source.vector && Math.min(source.width, source.height) < 256) notes.push('pequena: tamanhos grandes ficam borrados');
      $('favDims').textContent = notes.join(' · ');
      stage.hidden = false; snippetBox.hidden = false;
      setStatus();
      updateUI();
      render();
    } catch (err) {
      if (token === generation) setStatus(err?.message || 'Não foi possível abrir a imagem. Verifique se o arquivo não está corrompido.', true);
    }
  }

  async function loadRaster(file) {
    let bitmap;
    // from-image: respeita a orientação EXIF de fotos de celular.
    try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch { throw new Error('Não foi possível abrir a imagem. Verifique se o arquivo não está corrompido.'); }
    try {
      const { width, height } = bitmap;
      const factor = Math.min(1, BASE_MAX / Math.max(width, height));
      const base = downscale(bitmap, 0, 0, width, height, Math.max(1, Math.round(width * factor)), Math.max(1, Math.round(height * factor)));
      return { width, height, base, vector: false };
    } finally { bitmap.close(); }
  }

  // SVG é rasterizado direto em 1024 px no lado maior: fica nítido em qualquer tamanho.
  async function loadSvg(file) {
    const text = await file.text();
    let url;
    try { url = svgDataUrl(text, BASE_MAX); } catch { throw new Error(`"${file.name}" não é um SVG válido.`); }
    const img = new Image();
    img.src = url.dataUrl;
    try { await img.decode(); } catch { throw new Error(`Não foi possível desenhar "${file.name}". O SVG pode depender de arquivos externos.`); }
    const base = canvasOf(url.width, url.height);
    base.getContext('2d').drawImage(img, 0, 0, url.width, url.height);
    return { width: url.sourceWidth, height: url.sourceHeight, base, vector: true };
  }

  // Devolve o SVG como data URL com width/height definidos (o maior lado vale `maxSide`):
  // sem isso, SVGs só com viewBox rasterizam em 300×150 ou vazios. Mesma lógica do compressor.js.
  function svgDataUrl(text, maxSide) {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const svg = doc.documentElement;
    if (svg.nodeName !== 'svg' || doc.querySelector('parsererror')) throw new Error('SVG inválido');
    const px = (value) => { const n = parseFloat(value); return /%/.test(value || '') || !(n > 0) ? null : n; };
    const viewBox = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    const box = viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0 ? { w: viewBox[2], h: viewBox[3] } : null;
    let w = px(svg.getAttribute('width')), h = px(svg.getAttribute('height'));
    if (!w || !h) { w = box?.w ?? w ?? h ?? maxSide; h = box?.h ?? h ?? w; }
    if (!box) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const sourceWidth = Math.round(w), sourceHeight = Math.round(h);
    const factor = maxSide / Math.max(w, h);
    const width = Math.max(1, Math.round(w * factor)), height = Math.max(1, Math.round(h * factor));
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
    return { dataUrl, width, height, sourceWidth, sourceHeight };
  }

  /* ---------- desenho ---------- */

  // Reduz em etapas de 2×: uma redução direta de 1024 para 16 px pula pixels e serrilha.
  function downscale(src, sx, sy, sw, sh, dw, dh) {
    let cur = src, cx = sx, cy = sy, cw = sw, ch = sh;
    while (cw > dw * 2 && ch > dh * 2) {
      const nw = Math.max(dw, Math.round(cw / 2)), nh = Math.max(dh, Math.round(ch / 2));
      const next = canvasOf(nw, nh);
      const ctx = next.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(cur, cx, cy, cw, ch, 0, 0, nw, nh);
      cur = next; cx = 0; cy = 0; cw = nw; ch = nh;
    }
    const out = canvasOf(dw, dh);
    const ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, cx, cy, cw, ch, 0, 0, dw, dh);
    return out;
  }

  function options() {
    return {
      color: checked('favBg') === 'color' ? colorInput.value : null,
      padding: Number(paddingInput.value) / 100,
      radius: Number(radiusInput.value) / 100,
      fit: checked('favFit'),
    };
  }

  function roundedRect(ctx, size, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(0, 0, size, size, r);
    else {
      ctx.moveTo(r, 0); ctx.arcTo(size, 0, size, size, r); ctx.arcTo(size, size, 0, size, r);
      ctx.arcTo(0, size, 0, 0, r); ctx.arcTo(0, 0, size, 0, r); ctx.closePath();
    }
  }

  // Um ícone quadrado de `size` px. A margem é a fração do lado que fica vazia (metade de
  // cada lado); o raio é relativo ao lado (50% = círculo).
  function renderIcon(size, opts = options()) {
    const canvas = canvasOf(size, size);
    const ctx = canvas.getContext('2d');
    const { base } = source;
    if (opts.color) { ctx.fillStyle = opts.color; ctx.fillRect(0, 0, size, size); }

    const inner = Math.max(1, Math.round(size * (1 - opts.padding)));
    let sx = 0, sy = 0, sw = base.width, sh = base.height, dw, dh;
    if (opts.fit === 'cover') {
      const side = Math.min(sw, sh);
      sx = (sw - side) / 2; sy = (sh - side) / 2; sw = sh = side;
      dw = dh = inner;
    } else {
      const scale = inner / Math.max(sw, sh);
      dw = Math.max(1, Math.round(sw * scale)); dh = Math.max(1, Math.round(sh * scale));
    }
    ctx.drawImage(downscale(base, sx, sy, sw, sh, dw, dh), Math.round((size - dw) / 2), Math.round((size - dh) / 2));

    // Cantos: recorta depois de desenhar (destination-in), o que sai suavizado em todos os navegadores.
    if (opts.radius > 0) {
      ctx.globalCompositeOperation = 'destination-in';
      roundedRect(ctx, size, Math.min(size / 2, size * opts.radius));
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    return canvas;
  }

  /* ---------- prévia ---------- */

  function render() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!source) return;
      const opts = options();
      const sizes = selectedSizes();
      previews.replaceChildren(...sizes.map((size) => previewCard(size, renderIcon(size, opts).toDataURL('image/png'))));
      if (!sizes.length) {
        const empty = document.createElement('p');
        empty.className = 'fav-empty';
        empty.textContent = 'Marque pelo menos um tamanho em “Tamanhos do .ico”.';
        previews.append(empty);
      }
      // A aba mostra 16 px; em telas de alta densidade o navegador usa a versão de 32 px.
      const tabSize = (window.devicePixelRatio || 1) >= 1.5 ? 32 : 16;
      const tabUrl = renderIcon(tabSize, opts).toDataURL('image/png');
      document.querySelectorAll('.fav-tab-icon').forEach((img) => { img.src = tabUrl; });
    });
  }

  function previewCard(size, url) {
    const figure = document.createElement('figure');
    figure.className = 'fav-size';
    const row = document.createElement('div');
    row.className = 'fav-size-row';
    const real = document.createElement('img');
    real.src = url; real.width = size; real.height = size; real.alt = `Ícone de ${size} × ${size} px em tamanho real`;
    real.className = 'fav-real';
    row.append(real);
    if (ZOOM[size]) {
      const zoom = document.createElement('img');
      zoom.src = url; zoom.width = zoom.height = size * ZOOM[size];
      zoom.alt = `Ícone de ${size} px ampliado ${ZOOM[size]} vezes`;
      zoom.className = 'fav-zoom';
      row.append(zoom);
    }
    const caption = document.createElement('figcaption');
    caption.textContent = `${size} × ${size}${ZOOM[size] ? ` · ampliado ${ZOOM[size]}×` : ''}`;
    figure.append(row, caption);
    return figure;
  }

  document.querySelectorAll('input[name="favSize"], input[name="favBg"], input[name="favFit"]').forEach((input) => {
    input.addEventListener('change', () => {
      colorRow.hidden = checked('favBg') !== 'color';
      updateUI();
      render();
    });
  });
  colorInput.addEventListener('input', () => { colorValue.textContent = colorInput.value; render(); });
  paddingInput.addEventListener('input', () => { $('favPaddingVal').textContent = `${paddingInput.value}%`; render(); });
  radiusInput.addEventListener('input', () => { $('favRadiusVal').textContent = `${radiusInput.value}%`; render(); });

  /* ---------- saída ---------- */

  async function pngBytes(canvas) {
    const blob = await kompres.pngFromCanvas(canvas, 1); // PNG otimizado sem perdas
    return new Uint8Array(await blob.arrayBuffer());
  }

  async function buildIco(opts) {
    const images = [];
    for (const size of selectedSizes()) images.push({ size, data: await pngBytes(renderIcon(size, opts)) });
    return new Blob([kompres.icoFromPngs(images)], { type: 'image/x-icon' });
  }

  async function run(button, label, task) {
    if (!source || busy) return;
    if (!selectedSizes().length) { setStatus('Marque pelo menos um tamanho para o .ico.', true); return; }
    busy = true; updateUI(); button.textContent = 'Gerando…'; setStatus('Gerando arquivos…');
    try {
      const message = await task(options());
      if (!signal.aborted) setStatus(message);
    } catch (err) {
      if (!signal.aborted) setStatus(err?.message || 'Não foi possível gerar o favicon.', true);
    } finally {
      busy = false; button.textContent = label; updateUI();
    }
  }

  downloadBtn.addEventListener('click', () => run(downloadBtn, 'Baixar favicon.ico', async (opts) => {
    const ico = await buildIco(opts);
    download(ico, 'favicon.ico');
    return `favicon.ico com ${selectedSizes().join(', ')} px · ${formatBytes(ico.size)}.`;
  }));

  zipBtn.addEventListener('click', () => run(zipBtn, 'Baixar pacote (ZIP)', async (opts) => {
    if (typeof JSZip === 'undefined') throw new Error('Não foi possível carregar o gerador de ZIP. Verifique a conexão e tente de novo.');
    // iOS não aceita transparência no ícone da tela inicial (vira preto) e arredonda sozinho.
    const appleOpts = { ...opts, color: opts.color || '#ffffff', radius: 0 };
    const background = opts.color || '#ffffff';
    const zip = new JSZip();
    zip.file('favicon.ico', await buildIco(opts));
    zip.file('favicon-32x32.png', await pngBytes(renderIcon(32, opts)));
    zip.file('apple-touch-icon.png', await pngBytes(renderIcon(180, appleOpts)));
    zip.file('icon-192.png', await pngBytes(renderIcon(192, opts)));
    zip.file('icon-512.png', await pngBytes(renderIcon(512, opts)));
    zip.file('site.webmanifest', JSON.stringify({
      name: 'Seu site',
      short_name: 'Seu site',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
      theme_color: background,
      background_color: background,
      display: 'standalone',
    }, null, 2));
    zip.file('instalar.html', installPage());
    const blob = await zip.generateAsync({ type: 'blob' });
    download(blob, 'favicon-kompres.zip');
    return `Pacote com 7 arquivos · ${formatBytes(blob.size)}.`;
  }));

  const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function installPage() {
    return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Como instalar o favicon</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;line-height:1.6;color:#222}pre{background:#f4f4f4;padding:1rem;border-radius:8px;overflow-x:auto}code{font-size:.9rem}</style>
</head>
<body>
<h1>Como instalar o favicon</h1>
<ol>
<li>Envie todos os arquivos deste pacote para a raiz do site (a mesma pasta do <code>index.html</code>).</li>
<li>Cole este trecho dentro do <code>&lt;head&gt;</code> de todas as páginas:</li>
</ol>
<pre><code>${escapeHtml(snippet)}</code></pre>
<p>No arquivo <code>site.webmanifest</code>, troque "Seu site" pelo nome do seu site.</p>
<p>Se o ícone antigo continuar aparecendo, é cache do navegador: abra o site numa janela anônima.</p>
<h2>Arquivos</h2>
<ul>
<li><code>favicon.ico</code>: abas, favoritos e Windows (${selectedSizes().join(', ')} px).</li>
<li><code>favicon-32x32.png</code>: navegadores que preferem PNG.</li>
<li><code>apple-touch-icon.png</code>: tela inicial do iPhone e iPad (180 px).</li>
<li><code>icon-192.png</code> e <code>icon-512.png</code>: Android e instalação como aplicativo.</li>
<li><code>site.webmanifest</code>: nome e ícones do site para o Android.</li>
</ul>
<p>Gerado com o Kompres: https://kompres.com.br/converter/png-para-ico/</p>
</body>
</html>
`;
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  /* ---------- trecho de HTML ---------- */

  let copyTimer = 0;
  copyBtn.addEventListener('click', async () => {
    let ok = false;
    try { await navigator.clipboard.writeText(snippet); ok = true; }
    catch {
      // Sem permissão para a área de transferência (ex.: http): seleciona e copia à moda antiga.
      const area = document.createElement('textarea');
      area.value = snippet; area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0';
      snippetBox.append(area); area.select();
      try { ok = window.document.execCommand('copy'); } catch { ok = false; }
      area.remove();
    }
    copyBtn.textContent = ok ? 'Copiado!' : 'Selecione e copie (Ctrl+C)';
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { copyBtn.textContent = 'Copiar'; }, 2000);
  });

  /* ---------- estado ---------- */

  clearBtn.addEventListener('click', () => { if (!busy) { dispose(); setStatus(); updateUI(); } });

  function dispose() {
    generation++;
    cancelAnimationFrame(frame); frame = 0;
    if (source) source.base.width = source.base.height = 0; // libera a memória do canvas já
    source = null;
    previews.replaceChildren();
    document.querySelectorAll('.fav-tab-icon').forEach((img) => img.removeAttribute('src'));
    stage.hidden = true; snippetBox.hidden = true;
  }

  function updateUI() {
    const ready = !!source && !busy;
    downloadBtn.disabled = !ready || !selectedSizes().length;
    zipBtn.disabled = !ready || !selectedSizes().length;
    clearBtn.disabled = !ready;
    fileInput.disabled = busy;
  }

  updateUI();

  // Saiu da página: libera os canvas e a prévia pendente.
  signal.addEventListener('abort', () => { clearTimeout(copyTimer); dispose(); });
});
