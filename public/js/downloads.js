/* Download de vários resultados, compartilhado pelas ferramentas em lote.
 * Três formas, escolhidas na setinha ao lado do botão e lembradas para a próxima visita:
 *   separate -> um arquivo por resultado (padrão; o navegador pode pedir permissão na 1ª vez)
 *   folder   -> salva todos numa pasta escolhida (Chrome e Edge no computador)
 *   zip      -> um arquivo compactado
 * Uso: const dl = kompres.downloads.attach({ signal, button, onPick });
 *      dl.update(quantidade)  // texto do botão e setinha
 *      await kompres.downloads.saveFiles([{ name, blob }], { zipName }) */
(() => {
  const KEY = 'kompres-download';
  const canFolder = typeof window.showDirectoryPicker === 'function' && window.isSecureContext;
  const MODES = {
    separate: { label: '↓ Baixar todas', busy: 'Baixando…', title: 'Baixar todas', hint: 'Um arquivo por imagem. Na primeira vez, o navegador pode pedir permissão.' },
    folder: { label: '↓ Salvar numa pasta', busy: 'Salvando…', title: 'Salvar numa pasta', hint: 'Você escolhe a pasta e todos os arquivos vão para ela.' },
    zip: { label: '↓ Baixar ZIP', busy: 'Gerando ZIP…', title: 'Baixar ZIP', hint: 'Um arquivo compactado com tudo dentro.' },
  };
  const available = () => Object.keys(MODES).filter((mode) => mode !== 'folder' || canFolder);

  function getMode() {
    let mode = null;
    try { mode = localStorage.getItem(KEY); } catch {}
    return available().includes(mode) ? mode : 'separate';
  }
  function setMode(mode) { try { localStorage.setItem(KEY, mode); } catch {} }

  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // Nomes repetidos ganham " (2)", " (3)"...: nada é sobrescrito na pasta nem no ZIP.
  function uniqueNames(files) {
    const used = new Set();
    return files.map(({ name, blob }) => {
      let candidate = name;
      const dot = name.lastIndexOf('.');
      const base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
      for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${base} (${n})${ext}`;
      used.add(candidate.toLowerCase());
      return { name: candidate, blob };
    });
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // JSZip só carrega quando alguém pede um ZIP: as páginas abrem sem baixar ~95 KB a mais.
  const ZIP_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
  let zipLoading = null;
  function loadZip() {
    if (window.JSZip) return Promise.resolve(window.JSZip);
    zipLoading ??= new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = ZIP_SRC;
      script.onload = () => (window.JSZip ? resolve(window.JSZip) : reject(new Error('JSZip indisponível')));
      script.onerror = () => { zipLoading = null; script.remove(); reject(new Error('Não foi possível carregar o gerador de ZIP. Verifique a conexão e tente de novo.')); };
      document.head.append(script);
    });
    return zipLoading;
  }

  /** Salva os arquivos na forma escolhida. Devolve 'single', 'separate', 'folder', 'zip' ou 'cancelled'. */
  async function saveFiles(files, { zipName = 'kompres.zip', mode = getMode(), store = false } = {}) {
    if (!files.length) return 'cancelled';
    if (files.length === 1) { saveBlob(files[0].blob, files[0].name); return 'single'; }
    const list = uniqueNames(files);
    if (mode === 'folder' && canFolder) {
      let dir;
      try { dir = await window.showDirectoryPicker({ id: 'kompres', mode: 'readwrite', startIn: 'downloads' }); }
      catch (error) { if (error?.name === 'AbortError') return 'cancelled'; throw error; }
      for (const file of list) {
        const handle = await dir.getFileHandle(file.name, { create: true });
        const writable = await handle.createWritable();
        await writable.write(file.blob);
        await writable.close();
      }
      return 'folder';
    }
    if (mode === 'zip') {
      const JSZip = await loadZip();
      const zip = new JSZip();
      // Imagens já são comprimidas: STORE gera o ZIP bem mais rápido sem aumentar o tamanho.
      list.forEach((file) => zip.file(file.name, file.blob, store ? { compression: 'STORE' } : undefined));
      saveBlob(await zip.generateAsync({ type: 'blob' }), zipName);
      return 'zip';
    }
    // Separados: um intervalo curto entre eles evita que o navegador descarte downloads.
    for (let i = 0; i < list.length; i++) {
      saveBlob(list[i].blob, list[i].name);
      if (i < list.length - 1) await sleep(350);
    }
    return 'separate';
  }

  const label = (count) => (count > 1 ? MODES[getMode()].label : '↓ Baixar');
  const busyLabel = () => MODES[getMode()].busy;

  /** Setinha ao lado do botão com as formas de baixar. onPick() baixa na forma escolhida. */
  function attach({ signal, button, onPick }) {
    const wrap = document.createElement('div');
    wrap.className = 'dl-split';
    button.before(wrap);
    const caret = document.createElement('button');
    caret.type = 'button';
    caret.className = `${button.className} dl-caret`;
    caret.setAttribute('aria-label', 'Outras formas de baixar');
    caret.setAttribute('aria-haspopup', 'menu');
    caret.setAttribute('aria-expanded', 'false');
    caret.setAttribute('data-ah-label', 'Formas de baixar');
    caret.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
    const menu = document.createElement('div');
    menu.className = 'dl-menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    wrap.append(button, caret);
    // O menu vai direto no <body>: dentro da ferramenta, o desfoque de fundo (backdrop-filter)
    // muda a referência de posição de elementos fixos e o menu abriria fora da tela.
    document.body.append(menu);
    signal?.addEventListener('abort', () => menu.remove());

    const render = () => {
      const current = getMode();
      menu.innerHTML = '';
      for (const mode of available()) {
        const item = document.createElement('button');
        item.type = 'button';
        item.setAttribute('role', 'menuitemradio');
        item.setAttribute('aria-checked', String(mode === current));
        item.setAttribute('data-ah-label', MODES[mode].title);
        item.dataset.mode = mode;
        item.innerHTML = `<strong></strong><small></small>`;
        item.querySelector('strong').textContent = MODES[mode].title;
        item.querySelector('small').textContent = MODES[mode].hint;
        menu.append(item);
      }
    };
    // O menu fica "fixo" na tela: dentro da coluna de ajustes (que tem rolagem própria)
    // ele seria cortado. Abre abaixo do botão, ou acima quando não cabe.
    const place = () => {
      const rect = wrap.getBoundingClientRect();
      const width = Math.max(rect.width, 260);
      menu.style.width = `${width}px`;
      menu.style.left = `${Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8)}px`;
      const below = rect.bottom + 6, height = menu.offsetHeight;
      menu.style.top = `${below + height > window.innerHeight - 8 ? Math.max(8, rect.top - height - 6) : below}px`;
    };
    const open = (on) => {
      menu.hidden = !on;
      caret.setAttribute('aria-expanded', String(on));
      if (on) { render(); place(); menu.querySelector('[aria-checked="true"]')?.focus(); }
    };
    const closeOnMove = (event) => { if (!menu.hidden && !menu.contains(event.target)) open(false); };
    window.addEventListener('scroll', closeOnMove, { signal, capture: true, passive: true });
    window.addEventListener('resize', () => open(false), { signal });
    caret.addEventListener('click', () => open(menu.hidden));
    menu.addEventListener('click', (event) => {
      const item = event.target.closest('[data-mode]');
      if (!item) return;
      setMode(item.dataset.mode);
      open(false);
      onPick?.(item.dataset.mode);
    });
    menu.addEventListener('keydown', (event) => {
      const items = [...menu.querySelectorAll('[data-mode]')];
      const i = items.indexOf(document.activeElement);
      if (event.key === 'ArrowDown') { event.preventDefault(); items[(i + 1) % items.length]?.focus(); }
      if (event.key === 'ArrowUp') { event.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    });
    document.addEventListener('click', (event) => { if (!wrap.contains(event.target) && !menu.contains(event.target)) open(false); }, { signal });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !menu.hidden) { open(false); caret.focus(); } }, { signal });
    // A setinha acompanha o botão principal (ativo ou não).
    const sync = () => { caret.disabled = button.disabled; if (button.disabled) open(false); };
    const observer = new MutationObserver(sync);
    observer.observe(button, { attributes: true, attributeFilter: ['disabled'] });
    signal?.addEventListener('abort', () => observer.disconnect());

    return {
      /** Texto do botão e setinha (só com mais de um arquivo). */
      update(count) {
        button.textContent = label(count);
        wrap.classList.toggle('has-menu', count > 1);
        sync();
      },
    };
  }

  kompres.downloads = { getMode, setMode, saveFiles, label, busyLabel, attach, loadZip };
})();
