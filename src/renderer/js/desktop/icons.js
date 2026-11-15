// DevOS — desktop icon grid with select, open, drag repositioning, context menu.

import { devos } from '../core/bridge.js';
import { state } from '../core/state.js';
import { icon } from '../ui/icons.js';
import { openContextMenu } from '../ui/contextmenu.js';
import { openApp, APPS } from '../apps/registry.js';

export function initDesktopIcons() {
  const desktop = document.getElementById('desktop');
  const wrap = document.createElement('div');
  wrap.className = 'desk-icons';
  desktop.appendChild(wrap);

  const positions = { ...(state.persistedIcons || {}) };

  APPS.forEach((app, i) => {
    const el = document.createElement('div');
    el.className = 'desk-icon';
    el.dataset.app = app.id;
    el.innerHTML = `
      <span class="glyph">${icon(app.icon)}</span>
      <span class="label"></span>`;
    el.querySelector('.label').textContent = app.title;

    // Persisted or cascade position
    const pos = positions[app.id] || {};
    const perCol = Math.floor((desktop.clientHeight - 36) / 94);
    const col = pos.x ?? Math.floor(i / Math.max(1, perCol));
    const row = pos.y ?? (i % Math.max(1, perCol));
    el.style.order = col * 100 + row;

    el.addEventListener('click', (e) => {
      desktop.querySelectorAll('.desk-icon.selected').forEach((s) => s.classList.remove('selected'));
      el.classList.add('selected');
      e.stopPropagation();
    });
    el.addEventListener('dblclick', () => openApp(app.id));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') openApp(app.id);
    });
    el.tabIndex = 0;

    // Drag to reorder (persisted)
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/devos-app', app.id);
      e.dataTransfer.effectAllowed = 'move';
    });
    el.draggable = true;
    wrap.addEventListener('dragover', (e) => e.preventDefault());
    wrap.addEventListener('drop', (e) => {
      e.preventDefault();
      const id = e.dataTransfer.getData('text/devos-app');
      if (!id) return;
      const target = e.target.closest('.desk-icon');
      if (!target || target.dataset.app === id) return;
      const dragEl = wrap.querySelector(`[data-app="${id}"]`);
      const rect = target.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      target.parentNode.insertBefore(dragEl, after ? target.nextSibling : target);
      persistOrder();
    });

    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openContextMenu(e.clientX, e.clientY, [
        { label: `Open ${app.title}`, icon: icon('chevronRight'), action: () => openApp(app.id) },
        ...(app.id === 'files' ? [{ label: 'Open home folder', icon: icon('home'), action: () => openApp('files') }] : []),
        { label: 'What is this?', icon: icon('info'), action: () => openApp('settings') },
      ]);
    });

    wrap.appendChild(el);
  });

  desktop.addEventListener('click', () => {
    desktop.querySelectorAll('.desk-icon.selected').forEach((s) => s.classList.remove('selected'));
  });

  desktop.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.desk-icon')) return;
    e.preventDefault();
    openContextMenu(e.clientX, e.clientY, [
      { label: 'New terminal here', icon: icon('terminal'), key: 'Ctrl+Alt+T', action: () => openApp('terminal') },
      { label: 'Open File Explorer', icon: icon('folder'), key: 'Ctrl+Alt+E', action: () => openApp('files') },
      { label: 'Open VS Code', icon: icon('code'), key: 'Ctrl+Alt+V', action: () => openApp('vscode') },
      'separator',
      { label: 'Toggle developer mode', icon: icon('zap'), key: 'Ctrl+Alt+D', action: () => toggleDevMode() },
      { label: 'Next theme', icon: icon('palette'), action: async () => { const { cycleTheme } = await import('../themes.js'); cycleTheme(); } },
      { label: 'Settings', icon: icon('settings'), action: () => openApp('settings') },
      'separator',
      { label: 'Open system explorer', icon: icon('external'), action: async () => { await devos.sh.launch('files'); } },
    ]);
  });

  function persistOrder() {
    const order = {};
    [...wrap.children].forEach((child, i) => {
      order[child.dataset.app] = { x: Math.floor(i / 100), y: i % 100 };
    });
    devos.cfg.set({ desktopIcons: order }).catch(() => {});
  }

  function toggleDevMode() {
    import('../core/state.js').then(({ set: setState }) => {
      const next = !state.developerMode;
      setState({ developerMode: next });
      devos.cfg.set({ developerMode: next }).catch(() => {});
    });
  }

  // Persist order snapshot at boot if present
  try {
    devos.cfg.get().then((cfg) => {
      if (cfg?.desktopIcons && Object.keys(cfg.desktopIcons).length) {
        Object.entries(cfg.desktopIcons).forEach(([id, p]) => {
          const el = wrap.querySelector(`[data-app="${id}"]`);
          if (el) el.style.order = (p.x ?? 0) * 100 + (p.y ?? 0);
        });
      }
    });
  } catch { /* ignore */ }
}
