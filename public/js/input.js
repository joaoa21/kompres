/* Entrada de arquivos compartilhada pelas ferramentas: arrastar para qualquer ponto
 * da página e colar (Ctrl+V). O destaque visual fica na área pontilhada (`zone`).
 * Uso: kompres.fileDrop({ signal, document, zone, onFiles }) — onFiles(files, origem). */
kompres.fileDrop = ({ signal, document, zone, onFiles }) => {
  let depth = 0;
  const hasFiles = (event) => Array.from(event.dataTransfer?.types || []).includes('Files');
  const blocked = () => !!document.querySelector('dialog[open]');
  const leave = () => { depth = 0; zone.classList.remove('drag-over'); };

  document.addEventListener('dragenter', (event) => {
    if (!hasFiles(event) || blocked()) return;
    event.preventDefault();
    depth++;
    zone.classList.add('drag-over');
  }, { signal });
  document.addEventListener('dragover', (event) => {
    if (!hasFiles(event) || blocked()) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, { signal });
  document.addEventListener('dragleave', (event) => {
    if (!hasFiles(event)) return;
    if (--depth <= 0) leave();
  }, { signal });
  document.addEventListener('drop', (event) => {
    if (!hasFiles(event) || blocked()) return;
    event.preventDefault();
    leave();
    onFiles(Array.from(event.dataTransfer.files), 'drop');
  }, { signal });
  document.addEventListener('paste', (event) => {
    if (blocked() || event.target.closest?.('input, textarea, [contenteditable]')) return;
    const files = Array.from(event.clipboardData?.files || []);
    if (!files.length) return;
    event.preventDefault();
    onFiles(files, 'paste');
  }, { signal });
};
