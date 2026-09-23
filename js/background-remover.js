const $ = id => document.getElementById(id);
let items = [], busy = false, uid = 0, worker, rejectJob, cancelled = false;
const fileInput = $('bgFiles'), run = $('bgRun'), download = $('bgDownload'), clear = $('bgClear');
function status(message = '', error = false) { $('bgStatus').textContent = message; $('bgStatus').hidden = !message; $('bgStatus').classList.toggle('error', error); }
function bytes(n) { return n < 1048576 ? `${(n/1024).toFixed(1)} KB` : `${(n/1048576).toFixed(2)} MB`; }
function filename(item) { return item.file.name.replace(/\.[^.]+$/, '').replace(/[\\/\x00-\x1f<>:"|?*]/g, '_').slice(0,140) + '-sem-fundo.png'; }
function saveBlob(blob, name) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000); }
function canvasBlob(canvas) { return new Promise((resolve,reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Não foi possível salvar a imagem.')), 'image/png')); }
function update() {
  run.disabled = busy || !items.some(i => !i.resultBlob); run.textContent = busy ? 'Processando…' : 'Remover fundo';
  const count = items.filter(i => i.resultBlob).length;
  download.disabled = busy || !count; download.textContent = count > 1 ? '↓ Baixar ZIP' : '↓ Baixar PNG';
  clear.disabled = busy || !items.length; fileInput.disabled = busy;
  $('bgCancel').hidden = !busy || !rejectJob;
  document.querySelectorAll('.bg-card button').forEach(button => button.disabled = busy);
}
function dispose(item) { URL.revokeObjectURL(item.originalUrl); if (item.resultUrl) URL.revokeObjectURL(item.resultUrl); }
function render() {
  $('bgCards').replaceChildren();
  for (const item of items) {
    const card = document.createElement('article'); card.className = 'bg-card';
    const thumb = document.createElement('div'); thumb.className = 'bg-thumb';
    const img = document.createElement('img'); img.src = item.resultUrl || item.originalUrl; img.alt = item.file.name;
    const remove = document.createElement('button'); remove.textContent = '×'; remove.setAttribute('aria-label', `Remover ${item.file.name}`);
    remove.onclick = () => { if (busy) return; dispose(item); items = items.filter(i => i !== item); render(); };
    thumb.append(img, remove);
    const body = document.createElement('div'); body.className = 'bg-card-body';
    const name = document.createElement('strong'); name.textContent = item.file.name;
    const meta = document.createElement('small'); meta.textContent = item.error || `${item.width} × ${item.height} · ${bytes(item.resultBlob?.size || item.file.size)}`;
    body.append(name, meta);
    if (item.resultBlob) {
      const actions = document.createElement('div'); actions.className = 'bg-card-actions';
      const original = document.createElement('button'); original.textContent = 'Ver original';
      original.setAttribute('aria-pressed','false'); original.onclick = () => { const show = original.getAttribute('aria-pressed') !== 'true'; img.src = show ? item.originalUrl : item.resultUrl; original.textContent = show ? 'Ver resultado' : 'Ver original'; original.setAttribute('aria-pressed',String(show)); };
      const edit = document.createElement('button'); edit.textContent = 'Ajustar recorte'; edit.onclick = () => openEditor(item, edit);
      const dl = document.createElement('button'); dl.textContent = '↓ PNG'; dl.onclick = () => saveBlob(item.resultBlob, filename(item));
      actions.append(original,edit,dl); body.append(actions);
    }
    card.append(thumb,body); $('bgCards').append(card);
  }
  update();
}
async function addFiles(files) {
  if (busy || !files.length) return; busy = true; update(); const errors = [];
  try {
    for (const file of files) {
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { errors.push('Use imagens PNG, JPG ou WebP.'); continue; }
      if (items.length >= 10) { errors.push('Adicione até 10 imagens por vez.'); break; }
      if (file.size > 40*1024*1024) { errors.push(`${file.name}: limite de 40 MB.`); continue; }
      try {
        const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        const width = bitmap.width, height = bitmap.height; bitmap.close();
        if (width*height > 12000000 || Math.max(width,height)>8192) { errors.push(`${file.name}: use até 12 megapixels e 8192 px por lado.`); continue; }
        items.push({ id: ++uid, file, width, height, originalUrl: URL.createObjectURL(file), resultBlob: null });
      } catch { errors.push(`${file.name}: imagem inválida.`); }
    }
    status(errors.join(' '), !!errors.length);
  } finally { busy = false; render(); }
}
fileInput.onchange = async () => { const files = [...fileInput.files]; fileInput.value = ''; await addFiles(files); };
$('bgDrop').ondragover = e => { e.preventDefault(); if (!busy) $('bgDrop').classList.add('dragover'); };
$('bgDrop').ondragleave = () => $('bgDrop').classList.remove('dragover');
$('bgDrop').ondrop = e => { e.preventDefault(); $('bgDrop').classList.remove('dragover'); addFiles([...e.dataTransfer.files]); };
function process(file) {
  return new Promise((resolve,reject) => {
    worker ||= new Worker(new URL('./background-worker.js?v=1', import.meta.url), { type:'module' });
    rejectJob = reject;
    worker.onmessage = ({data}) => {
      if (data.type === 'progress') { status(data.message); return; }
      rejectJob = null;
      if (data.type === 'done') resolve(data); else reject(new Error(data.message));
    };
    worker.onerror = () => { worker.terminate(); worker = null; rejectJob = null; reject(new Error('Não foi possível iniciar a remoção. Verifique a conexão e tente novamente.')); };
    worker.postMessage({type:'remove', file}); update();
  });
}
run.onclick = async () => {
  if (busy) return; busy = true; cancelled = false; update(); let failures = 0;
  try {
    for (const item of items.filter(i => !i.resultBlob)) {
      if (cancelled) break;
      item.error = ''; status(`Processando ${item.file.name}…`);
      try { const result = await process(item.file); item.resultBlob = result.blob; item.maskBlob = result.maskBlob; item.resultUrl = URL.createObjectURL(result.blob); }
      catch (err) { if (cancelled) break; item.error = err.message; failures++; }
      render();
    }
    status(cancelled ? 'Processamento cancelado. Os resultados concluídos foram mantidos.' : failures ? 'Algumas imagens não puderam ser processadas. Você pode tentar novamente.' : '', failures > 0);
  } finally { busy = false; rejectJob = null; render(); }
};
$('bgCancel').onclick = () => { if (!rejectJob) return; cancelled = true; worker?.terminate(); worker = null; const reject = rejectJob; rejectJob = null; reject(new Error('Cancelado')); };
clear.onclick = () => { if (busy) return; items.forEach(dispose); items = []; status(); render(); };
download.onclick = async () => {
  if (busy) return; const done = items.filter(i => i.resultBlob); if (!done.length) return;
  if (done.length === 1) { saveBlob(done[0].resultBlob, filename(done[0])); return; }
  busy = true; update(); status('Preparando ZIP…');
  try { const zip = new JSZip(); done.forEach((item,i) => zip.file(`${i+1}-${filename(item)}`, item.resultBlob)); saveBlob(await zip.generateAsync({type:'blob'}),'kompres-sem-fundo.zip'); status(); }
  catch { status('Não foi possível gerar o ZIP. Baixe os arquivos individualmente.',true); }
  finally { busy = false; update(); }
};

/* Non-destructive editor: brush changes only the alpha mask. */
const dialog = $('bgEditor'), canvas = $('editorCanvas'), ctx = canvas.getContext('2d'), stage = $('editorStage');
const mask = document.createElement('canvas'), mc = mask.getContext('2d', {willReadFrequently:true});
let source = null, editing = null, mode = 'erase', history = [], previous = null, drawing = false, zoom = 1, showOriginal = false, saving = false, returnFocus;
function composite() { ctx.globalCompositeOperation = 'source-over'; ctx.clearRect(0,0,canvas.width,canvas.height); ctx.drawImage(source,0,0); if (!showOriginal) { ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(mask,0,0); ctx.globalCompositeOperation = 'source-over'; } }
function resizeView() {
  if (!editing) return;
  zoom = $('editorZoom').value === 'fit' ? Math.min(1, (stage.clientWidth-48)/canvas.width, (stage.clientHeight-48)/canvas.height) : Number($('editorZoom').value);
  zoom = Math.max(.01,zoom); canvas.style.width = `${canvas.width*zoom}px`; canvas.style.height = `${canvas.height*zoom}px`;
}
async function openEditor(item, opener) {
  if (busy || editing) return;
  busy = true; update();
  try {
    source = await createImageBitmap(item.file, {imageOrientation:'from-image'});
    const alpha = await createImageBitmap(item.maskBlob);
    canvas.width = mask.width = item.width; canvas.height = mask.height = item.height;
    mc.clearRect(0,0,mask.width,mask.height); mc.drawImage(alpha,0,0); alpha.close();
    editing = item; returnFocus = opener; history = []; $('editorUndo').disabled = true; $('editorZoom').value = 'fit'; $('editorZoom').dispatchEvent(new Event('kompres:sync')); showOriginal = false;
    $('editorOriginal').setAttribute('aria-pressed','false'); $('editorOriginal').textContent = 'Ver original';
    $('editorStatus').textContent = 'Apague o fundo que sobrou ou restaure detalhes.';
    composite(); dialog.showModal(); resizeView();
  } catch { source?.close(); source = null; editing = null; status('Não foi possível abrir o editor.',true); }
  finally { busy = false; update(); }
}
function closeEditor() {
  if (saving) return;
  drawing = false; previous = null; history = []; editing = null; source?.close(); source = null; canvas.width = mask.width = 0; canvas.height = mask.height = 0;
  $('brushCursor').hidden = true; dialog.close(); returnFocus?.focus();
}
$('editorClose').onclick = closeEditor;
dialog.addEventListener('cancel', e => { e.preventDefault(); closeEditor(); });
$('editorZoom').onchange = resizeView; window.addEventListener('resize',resizeView);
$('brushSize').oninput = () => { $('brushValue').textContent = `${$('brushSize').value} px`; window.updateAllRangeFills?.(); };
document.querySelectorAll('[data-brush]').forEach(btn => btn.onclick = () => { mode = btn.dataset.brush; document.querySelectorAll('[data-brush]').forEach(b => b.setAttribute('aria-pressed',String(b===btn))); canvas.style.cursor = mode==='pan' ? 'grab' : 'crosshair'; });
document.querySelectorAll('[data-bg]').forEach(btn => btn.onclick = () => { $('editorSurface').dataset.background = btn.dataset.bg; document.querySelectorAll('[data-bg]').forEach(b => b.setAttribute('aria-pressed',String(b===btn))); });
$('editorOriginal').onclick = () => { showOriginal = !showOriginal; $('editorOriginal').setAttribute('aria-pressed',String(showOriginal)); $('editorOriginal').textContent = showOriginal ? 'Ver recorte' : 'Ver original'; composite(); };
function point(e) { const r = canvas.getBoundingClientRect(); return {x:(e.clientX-r.left)/zoom,y:(e.clientY-r.top)/zoom}; }
function cursor(e) { const p=point(e), el=$('brushCursor'); el.hidden=mode==='pan'||showOriginal; el.style.left=`${p.x*zoom}px`; el.style.top=`${p.y*zoom}px`; el.style.width=el.style.height=`${Number($('brushSize').value)*zoom}px`; }
function remember() {
  // Keep history under 64 MiB, with at most 20 strokes.
  const limit = Math.max(1,Math.min(20,Math.floor(64*1024*1024/(mask.width*mask.height*4))));
  while (history.length>=limit) history.shift();
  history.push(mc.getImageData(0,0,mask.width,mask.height)); $('editorUndo').disabled=false;
}
function stroke(from,to) {
  mc.globalCompositeOperation = mode==='erase'?'destination-out':'source-over'; mc.strokeStyle='#fff'; mc.fillStyle='#fff'; mc.lineWidth=Number($('brushSize').value); mc.lineCap='round'; mc.lineJoin='round';
  mc.beginPath(); mc.moveTo(from.x,from.y); mc.lineTo(to.x,to.y); mc.stroke();
  if (from.x===to.x&&from.y===to.y) { mc.beginPath(); mc.arc(to.x,to.y,mc.lineWidth/2,0,Math.PI*2); mc.fill(); }
  mc.globalCompositeOperation='source-over'; composite();
}
canvas.oncontextmenu = e => e.preventDefault();
canvas.onpointerdown = e => {
  if (saving || showOriginal || e.button!==0) return;
  e.preventDefault(); canvas.setPointerCapture(e.pointerId); drawing=true;
  if (mode==='pan') { previous={x:e.clientX,y:e.clientY}; return; }
  remember(); previous=point(e); stroke(previous,previous); cursor(e);
};
canvas.onpointermove = e => {
  if (!editing) return; cursor(e); if (!drawing) return;
  if (mode==='pan') { stage.scrollLeft-=e.clientX-previous.x; stage.scrollTop-=e.clientY-previous.y; previous={x:e.clientX,y:e.clientY}; }
  else { const p=point(e); stroke(previous,p); previous=p; }
};
function endStroke() { drawing=false; previous=null; }
canvas.onpointerup=endStroke; canvas.onpointercancel=endStroke; canvas.onlostpointercapture=endStroke; canvas.onpointerleave=()=>{$('brushCursor').hidden=true;};
function undo() { if (!history.length||saving) return; mc.putImageData(history.pop(),0,0); $('editorUndo').disabled=!history.length; composite(); }
$('editorUndo').onclick=undo;
dialog.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undo();}});
$('editorSave').onclick = async () => {
  if (!editing||saving) return; saving=true; endStroke(); const controls=[...dialog.querySelectorAll('button,input,select')]; controls.forEach(b=>b.disabled=true); $('editorStatus').textContent='Salvando ajustes…';
  try {
    showOriginal=false; composite(); const result=await canvasBlob(canvas), alpha=await canvasBlob(mask);
    URL.revokeObjectURL(editing.resultUrl); editing.resultBlob=result; editing.maskBlob=alpha; editing.resultUrl=URL.createObjectURL(result);
    saving=false; closeEditor(); render();
    // The previous opener was replaced while rendering.
    const index=items.findIndex(i=>i.resultBlob===result); $('bgCards').children[index]?.querySelector('.bg-card-actions button')?.focus();
  } catch(err) { $('editorStatus').textContent=err.message; }
  finally { saving=false; controls.forEach(b=>b.disabled=false); $('editorUndo').disabled=!history.length; }
};
