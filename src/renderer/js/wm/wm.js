// DevOS — window manager.
// DOM windows with drag, 8-way resize, snap zones, minimize/maximize/close,
// focus z-ordering and taskbar synchronization.

import { icon } from '../ui/icons.js';
import { emit, on } from '../core/state.js';

const layer = () => document.getElementById('windows');
const snapPreview = () => document.getElementById('snap-preview');

const wins = new Map(); // id -> win record
let zCounter = 20;
let cascade = 0;

const EDGE = 26; // snap trigger distance in px

export function getWindow(id) {
  return wins.get(id)?.api || null;
}

export function listWindows() {
  return [...wins.values()].map((w) => ({
    id: w.id,
    title: w.title,
    iconName: w.iconName,
    minimized: w.minimized,
    focused: w.focused,
  }));
}

export function createWindow(opts = {}) {
  const {
    id = `win-${Date.now()}-${Math.floor(Math.random() * 1e5)}`,
    title = 'Window',
    iconName = 'terminal',
    width = 720,
    height = 480,
    x = null,
    y = null,
    minW = 380,
    minH = 240,
    singleton = false,
    content = null,
    onClose = null,
    sub = '',
  } = opts;

  if (singleton && wins.has(id)) {
    const existing = wins.get(id);
    existing.api.restore();
    existing.api.focus();
    return existing.api;
  }

  const el = document.createElement('div');
  el.className = 'win opening';
  el.dataset.winId = id;

  const area = layer().getBoundingClientRect();
  const w = Math.min(width, area.width - 20);
  const h = Math.min(height, area.height - 20);
  let px = x ?? Math.max(10, (area.width - w) / 2 + ((cascade % 6) - 2.5) * 26);
  let py = y ?? Math.max(8, (area.height - h) / 2.4 + ((cascade % 6) - 2.5) * 22);
  cascade += 1;

  el.style.left = `${px}px`;
  el.style.top = `${py}px`;
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  el.style.zIndex = ++zCounter;

  el.innerHTML = `
    <div class="win-titlebar">
      <span class="t-icon">${icon(iconName)}</span>
      <span class="t-title"></span>
      <span class="t-sub"></span>
      <div class="t-actions">
        <button class="t-btn btn-min" title="Minimize">${icon('minus')}</button>
        <button class="t-btn btn-max" title="Maximize">${icon('square')}</button>
        <button class="t-btn close" title="Close">${icon('x')}</button>
      </div>
    </div>
    <div class="win-body"></div>
    ${['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map((d) => `<div class="rz rz-${d}" data-dir="${d}"></div>`).join('')}
  `;
  el.querySelector('.t-title').textContent = title;
  if (sub) el.querySelector('.t-sub').textContent = sub;
  if (content) el.querySelector('.win-body').appendChild(content);

  layer().appendChild(el);
  setTimeout(() => el.classList.remove('opening'), 180);

  const rec = {
    id, el, title, iconName, sub,
    minW, minH,
    minimized: false,
    maximized: false,
    focused: false,
    prevRect: null,
    onClose,
    api: null,
  };
  wins.set(id, rec);

  // ---- focus ----
  function focus() {
    for (const other of wins.values()) {
      other.focused = false;
      other.el.classList.remove('focused');
    }
    rec.focused = true;
    el.classList.add('focused');
    el.style.zIndex = ++zCounter;
    emit('wm:focus', rec.id);
    syncTaskbar();
  }
  el.addEventListener('pointerdown', () => { if (!rec.focused) focus(); }, true);

  // ---- minimize / maximize / close ----
  function minimize() {
    if (rec.minimized) return;
    rec.minimized = true;
    el.classList.add('minimizing');
    setTimeout(() => {
      el.classList.add('hidden-win');
      el.classList.remove('minimizing');
    }, 150);
    emit('wm:minimize', rec.id);
    syncTaskbar();
    focusTopmost();
  }

  function restore() {
    if (!rec.minimized) { focus(); return; }
    rec.minimized = false;
    el.classList.remove('hidden-win');
    focus();
    syncTaskbar();
  }

  function maximize() {
    if (rec.maximized) return;
    rec.prevRect = { x: px, y: py, w: el.offsetWidth, h: el.offsetHeight };
    rec.maximized = true;
    el.classList.add('maximized');
    el.style.left = '0px';
    el.style.top = '0px';
    el.style.width = '100%';
    el.style.height = '100%';
    el.querySelector('.btn-max').innerHTML = icon('restore');
    focus();
    emit('wm:maximize', rec.id);
  }

  function unmaximize() {
    if (!rec.maximized) return;
    rec.maximized = false;
    el.classList.remove('maximized');
    el.querySelector('.btn-max').innerHTML = icon('square');
    if (rec.prevRect) {
      el.style.left = `${rec.prevRect.x}px`;
      el.style.top = `${rec.prevRect.y}px`;
      el.style.width = `${rec.prevRect.w}px`;
      el.style.height = `${rec.prevRect.h}px`;
    }
    emit('wm:unmaximize', rec.id);
  }

  function close() {
    try { rec.onClose?.(); } catch (err) { console.error('[wm] onClose error', err); }
    el.classList.add('closing');
    setTimeout(() => el.remove(), 160);
    wins.delete(id);
    emit('wm:close', rec.id);
    syncTaskbar();
    focusTopmost();
  }

  // ---- dragging + snap ----
  const titlebar = el.querySelector('.win-titlebar');
  let drag = null;

  titlebar.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.t-btn')) return;
    if (e.button !== 0) return;
    e.preventDefault();
    titlebar.setPointerCapture(e.pointerId);
    drag = { startX: e.clientX, startY: e.clientY, origX: px, origY: py, moved: false, wasMaximized: rec.maximized };
  });

  titlebar.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;

    if (!drag.moved && drag.wasMaximized) {
      // Dragging a maximized window restores it under the cursor.
      unmaximize();
      drag.origX = Math.max(0, e.clientX - el.offsetWidth / 2);
      drag.origY = 0;
    }
    drag.moved = true;
    const area = layer().getBoundingClientRect();
    px = Math.min(Math.max(drag.origX + dx, -el.offsetWidth + 90), area.width - 90);
    py = Math.min(Math.max(drag.origY + dy, 0), area.height - 40);
    el.style.left = `${px}px`;
    el.style.top = `${py}px`;

    const snap = snapZone(e);
    showSnapPreview(snap, area);
  });

  titlebar.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const area = layer().getBoundingClientRect();
    const snap = drag.moved ? snapZone(e) : null;
    hideSnapPreview();
    drag = null;
    if (snap === 'max') { maximize(); return; }
    if (snap === 'left' || snap === 'right') {
      if (rec.maximized) unmaximize();
      el.style.left = snap === 'left' ? '0px' : `${Math.floor(area.width / 2)}px`;
      el.style.top = '0px';
      el.style.width = `${Math.floor(area.width / 2)}px`;
      el.style.height = '100%';
      px = parseInt(el.style.left, 10);
      py = 0;
      return;
    }
    if (rec.maximized) return;
    // Keep titlebar reachable after fling.
    if (py < 0) { py = 0; el.style.top = '0px'; }
  });
  titlebar.addEventListener('pointercancel', () => { drag = null; hideSnapPreview(); });

  function snapZone(e) {
    const m = 6;
    if (e.clientY <= m) return 'max';
    if (e.clientX <= m) return 'left';
    if (e.clientX >= window.innerWidth - m) return 'right';
    return null;
  }

  function showSnapPreview(zone, area) {
    const preview = snapPreview();
    if (!zone) { preview.classList.add('hidden'); return; }
    preview.classList.remove('hidden');
    if (zone === 'max') Object.assign(preview.style, { left: '4px', top: '4px', width: `${area.width - 8}px`, height: `${area.height - 8}px` });
    if (zone === 'left') Object.assign(preview.style, { left: '4px', top: '4px', width: `${area.width / 2 - 6}px`, height: `${area.height - 8}px` });
    if (zone === 'right') Object.assign(preview.style, { left: `${area.width / 2 + 2}px`, top: '4px', width: `${area.width / 2 - 6}px`, height: `${area.height - 8}px` });
  }
  function hideSnapPreview() { snapPreview().classList.add('hidden'); }

  // ---- resizing ----
  el.querySelectorAll('.rz').forEach((handle) => {
    handle.addEventListener('pointerdown', (e) => {
      if (rec.maximized) return;
      e.preventDefault();
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      const dir = handle.dataset.dir;
      const start = { x: e.clientX, y: e.clientY, x0: px, y0: py, w: el.offsetWidth, h: el.offsetHeight };
      const move = (ev) => {
        const dx = ev.clientX - start.x;
        const dy = ev.clientY - start.y;
        let { x0, y0, w, h } = start;
        if (dir.includes('e')) w = Math.max(minW, start.w + dx);
        if (dir.includes('s')) h = Math.max(minH, start.h + dy);
        if (dir.includes('w')) {
          w = Math.max(minW, start.w - dx);
          x0 = start.x0 + (start.w - w);
        }
        if (dir.includes('n')) {
          h = Math.max(minH, start.h - dy);
          y0 = start.y0 + (start.h - h);
        }
        px = x0; py = y0;
        el.style.left = `${x0}px`;
        el.style.top = `${y0}px`;
        el.style.width = `${w}px`;
        el.style.height = `${h}px`;
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  });

  el.querySelector('.btn-min').addEventListener('click', minimize);
  el.querySelector('.btn-max').addEventListener('click', () => (rec.maximized ? unmaximize() : maximize()));
  el.querySelector('.close').addEventListener('click', close);

  el.addEventListener('dblclick', (e) => {
    if (e.target.closest('.win-titlebar') && !e.target.closest('.t-btn')) {
      rec.maximized ? unmaximize() : maximize();
    }
  });

  function setTitle(t, s) {
    if (t !== undefined) { rec.title = t; el.querySelector('.t-title').textContent = t; }
    if (s !== undefined) { rec.sub = s; el.querySelector('.t-sub').textContent = s; }
    syncTaskbar();
  }

  function focusTopmost() {
    let top = null;
    let topZ = -1;
    for (const wRec of wins.values()) {
      if (!wRec.minimized && wRec.el.style.zIndex > topZ) { top = wRec; topZ = wRec.el.style.zIndex; }
    }
    if (top && !top.focused) top.api.focus();
    syncTaskbar();
  }

  function syncTaskbar() {
    emit('wm:changed', listWindows());
  }

  focus();
  syncTaskbar();

  rec.api = {
    id, el,
    focus, minimize, restore, maximize, unmaximize, close, setTitle,
    get minimized() { return rec.minimized; },
    get maximized() { return rec.maximized; },
    get title() { return rec.title; },
    get iconName() { return rec.iconName; },
  };
  return rec.api;
}

// Re-sync all taskbars on layout changes.
on('change:theme', () => { /* themes are pure CSS */ });
