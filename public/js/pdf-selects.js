/* Accessible single-choice dropdowns, scoped to the PDF controls. */
(() => {
  let closeCurrent = null;
  document.querySelectorAll('#pdfControls select').forEach(select => {
    const wrapper = document.createElement('div'); wrapper.className = 'pdf-select';
    const trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'pdf-select-trigger'; trigger.id = `${select.id}-trigger`;
    trigger.setAttribute('role', 'combobox'); trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false');
    const label = document.querySelector(`label[for="${select.id}"]`);
    if (label) { label.id ||= `${select.id}-label`; trigger.setAttribute('aria-labelledby', label.id); label.htmlFor = trigger.id; }
    const text = document.createElement('span'); trigger.append(text);
    const menu = document.createElement('ul'); menu.className = 'pdf-select-menu'; menu.id = `${select.id}-menu`; menu.setAttribute('role', 'listbox'); menu.setAttribute('aria-hidden', 'true');
    if (label) menu.setAttribute('aria-labelledby', label.id);
    trigger.setAttribute('aria-controls', menu.id);
    let open = false, active = select.selectedIndex, query = '', lastKey = 0;
    const options = Array.from(select.options, (option, index) => {
      const row = document.createElement('li'); row.className = 'pdf-select-option'; row.id = `${select.id}-option-${index}`; row.setAttribute('role', 'option'); row.textContent = option.textContent;
      row.addEventListener('pointerdown', event => event.preventDefault());
      row.addEventListener('click', () => choose(index)); menu.append(row); return row;
    });
    function highlight(index) {
      active = index;
      options.forEach((row, i) => row.classList.toggle('is-active', i === active));
      trigger.setAttribute('aria-activedescendant', options[active].id);
      options[active].scrollIntoView({ block: 'nearest' });
    }
    function close() {
      open = false; wrapper.classList.remove('is-open'); trigger.setAttribute('aria-expanded', 'false'); trigger.removeAttribute('aria-activedescendant'); menu.setAttribute('aria-hidden', 'true');
      if (closeCurrent === close) closeCurrent = null;
    }
    function show() {
      if (select.disabled) return;
      if (closeCurrent) closeCurrent(); closeCurrent = close; open = true;
      wrapper.classList.add('is-open'); menu.setAttribute('aria-hidden', 'false'); trigger.setAttribute('aria-expanded', 'true'); highlight(select.selectedIndex);
    }
    function sync() {
      text.textContent = select.selectedOptions[0]?.textContent || '';
      trigger.disabled = select.disabled;
      options.forEach((row, i) => row.setAttribute('aria-selected', String(i === select.selectedIndex)));
      if (select.disabled) close();
    }
    function choose(index) {
      if (select.disabled) return;
      const changed = select.selectedIndex !== index; select.selectedIndex = index; close(); sync(); trigger.focus();
      if (changed) { select.dispatchEvent(new Event('input', { bubbles: true })); select.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    trigger.addEventListener('click', () => open ? close() : show());
    trigger.addEventListener('keydown', event => {
      const key = event.key;
      if (key === 'Tab') { close(); return; }
      if (key === 'Escape') { if (open) { event.preventDefault(); close(); } return; }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(key)) {
        event.preventDefault();
        if (key === 'Enter' || key === ' ') { open ? choose(active) : show(); return; }
        if (!open) show();
        highlight(key === 'Home' ? 0 : key === 'End' ? options.length - 1 : Math.max(0, Math.min(options.length - 1, active + (key === 'ArrowDown' ? 1 : -1))));
      } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault(); const now = Date.now(); query = now - lastKey > 700 ? key : query + key; lastKey = now;
        const index = Array.from(select.options).findIndex(option => option.textContent.toLocaleLowerCase().startsWith(query.toLocaleLowerCase()));
        if (index >= 0) { if (!open) show(); highlight(index); }
      }
    });
    document.addEventListener('pointerdown', event => { if (open && !wrapper.contains(event.target)) close(); });
    wrapper.addEventListener('focusout', event => { if (!wrapper.contains(event.relatedTarget)) close(); });
    select.addEventListener('input', sync); select.addEventListener('change', sync);
    new MutationObserver(sync).observe(select, { attributes: true, attributeFilter: ['disabled'] });
    new MutationObserver(() => { if (select.closest('.hidden')) close(); }).observe(select.parentElement, { attributes: true, attributeFilter: ['class'] });
    select.before(wrapper); wrapper.append(select, trigger, menu); select.hidden = true; sync();
  });
})();
