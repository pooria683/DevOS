// DevOS — shared context menu component.

let menuEl = null;

function host() {
  return document.getElementById('ctxmenu');
}

/**
 * openContextMenu(x, y, items)
 * items: [{ label, icon?, key?, danger?, action } | 'separator']
 */
export function openContextMenu(x, y, items) {
  closeContextMenu();
  const host = host();
  menuEl = host;
  host.innerHTML = '';

  for (const item of items) {
    if (item === 'separator') {
      const sep = document.createElement('div');
      sep.className = 'ctx-sep';
      host.appendChild(sep);
      continue;
    }
    const el = document.createElement('div');
    el.className = `ctx-item${item.danger ? ' danger' : ''}`;
    el.innerHTML = `${item.icon || ''}<span></span>${item.key ? `<span class="k">${item.key}</span>` : ''}`;
    el.querySelector('span').textContent = item.label;
    el.addEventListener('click', () => {
      closeContextMenu();
      item.action?.();
    });
    host.appendChild(el);
  }

  host.classList.remove('hidden');
  // Keep inside viewport.
  const rect = host.getBoundingClientRect();
  const px = Math.min(x, window.innerWidth - rect.width - 8);
  const py = Math.min(y, window.innerHeight - rect.height - 8);
  host.style.left = `${Math.max(6, px)}px`;
  host.style.top = `${Math.max(6, py)}px`;
}

export function closeContextMenu() {
  const host = host();
  if (host) {
    host.classList.add('hidden');
    host.innerHTML = '';
  }
  menuEl = null;
}

export function initContextMenuGlobal() {
  window.addEventListener('mousedown', (e) => {
    if (menuEl && !menuEl.contains(e.target)) closeContextMenu();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeContextMenu();
  });
  window.addEventListener('blur', closeContextMenu);
}
