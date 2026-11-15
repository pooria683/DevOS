// DevOS — taskbar: start button, window buttons, system tray
// (dev-mode LED, network, battery, theme switcher, clock).

import { devos } from '../core/bridge.js';
import { state, set, on } from '../core/state.js';
import { icon } from '../ui/icons.js';
import { listWindows, getWindow } from '../wm/wm.js';
import { cycleTheme } from '../themes.js';
import { openContextMenu } from '../ui/contextmenu.js';
import { openApp } from '../apps/registry.js';
import { toast } from '../ui/toast.js';

export function initTaskbar() {
  const bar = document.getElementById('taskbar');

  bar.innerHTML = `
    <div class="tb-start" title="Start (command palette)">
      <span class="logo">${icon('devosLogo')}</span>
      <span>DevOS</span>
    </div>
    <div class="tb-windows"></div>
    <div class="tb-tray">
      <div class="tray-item" data-tray="devmode" title="Developer mode (Ctrl+Alt+D)">
        ${icon('zap')}<span class="txt">DEV</span>
      </div>
      <div class="tray-item" data-tray="net" title="Network status">${icon('wifi')}</div>
      <div class="tray-item" data-tray="batt" title="Battery">
        ${icon('battery')}<span class="pct txt">—</span>
      </div>
      <div class="tray-item accent" data-tray="theme" title="Switch theme">${icon('palette')}</div>
      <div class="tray-clock" title="Click for date">
        <span class="t">--:--</span>
        <span class="d">---</span>
      </div>
      <div class="tray-item" data-tray="min" title="Minimize DevOS">${icon('minus')}</div>
      <div class="tray-item" data-tray="quit" title="Quit DevOS" style="color:var(--danger);">${icon('power')}</div>
    </div>
  `;

  const winHost = bar.querySelector('.tb-windows');
  const startBtn = bar.querySelector('.tb-start');

  startBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    import('./startmenu.js').then((m) => m.toggleStartMenu());
  });

  // ---- window buttons ----
  function renderWindows() {
    const wins = listWindows();
    winHost.innerHTML = '';
    for (const w of wins) {
      const btn = document.createElement('button');
      btn.className = `tb-win-btn${w.focused && !w.minimized ? ' active' : ''}${w.minimized ? ' minimized' : ''}`;
      btn.innerHTML = `${icon(w.iconName)}<span></span>`;
      btn.querySelector('span').textContent = w.title;
      btn.title = w.title;
      btn.addEventListener('click', () => {
        const win = getWindow(w.id);
        if (!win) return;
        if (w.minimized) win.restore();
        else if (w.focused) win.minimize();
        else win.focus();
      });
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openContextMenu(e.clientX, e.clientY, [
          { label: w.minimized ? 'Restore' : 'Minimize', icon: icon('minus'), action: () => (w.minimized ? getWindow(w.id).restore() : getWindow(w.id).minimize()) },
          { label: 'Close window', icon: icon('x'), danger: true, action: () => getWindow(w.id)?.close() },
        ]);
      });
      winHost.appendChild(btn);
    }
  }
  on('wm:changed', renderWindows);
  renderWindows();

  // ---- tray: developer mode ----
  const devItem = bar.querySelector('[data-tray="devmode"]');
  devItem.addEventListener('click', () => {
    const next = !state.developerMode;
    set({ developerMode: next });
    devos.cfg.set({ developerMode: next }).catch(() => {});
  });
  const syncDevLed = () => {
    devItem.classList.toggle('accent', state.developerMode);
    devItem.querySelector('svg').classList.toggle('dim-icon', !state.developerMode);
  };
  on('change:developerMode', syncDevLed);
  syncDevLed();

  // ---- tray: network ----
  const netItem = bar.querySelector('[data-tray="net"]');
  netItem.addEventListener('click', () => {
    navigator.onLine
      ? toast('Network', 'Connected — system interfaces reported online', 'ok')
      : toast('Network', 'No network connection detected', 'err');
  });
  const syncNet = () => {
    netItem.innerHTML = navigator.onLine ? `${icon('wifi')}` : `${icon('wifiOff')}`;
  };
  window.addEventListener('online', syncNet);
  window.addEventListener('offline', syncNet);
  syncNet();

  // ---- tray: battery ----
  const battItem = bar.querySelector('[data-tray="batt"]');
  const battPct = battItem.querySelector('.pct');
  function setBattery(level, charging) {
    battPct.textContent = level != null ? `${Math.round(level * 100)}%` : 'AC';
    battItem.title = charging ? 'Charging' : 'On battery';
  }
  if (navigator.getBattery) {
    navigator.getBattery().then((b) => {
      const sync = () => setBattery(b.level, b.charging);
      sync();
      b.addEventListener('levelchange', sync);
      b.addEventListener('chargingchange', sync);
    }).catch(() => setBattery(null));
  } else {
    setBattery(null);
  }

  // ---- tray: theme ----
  bar.querySelector('[data-tray="theme"]').addEventListener('click', () => {
    const t = cycleTheme();
    toast('Theme', `Switched to ${t.name}`, 'ok', 1800);
  });

  // ---- tray: clock ----
  const clockT = bar.querySelector('.t');
  const clockD = bar.querySelector('.d');
  function tick() {
    const now = new Date();
    clockT.textContent = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
    clockD.textContent = now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  tick();
  setInterval(tick, 1000);
  bar.querySelector('.tray-clock').addEventListener('click', () => openApp('taskmgr'));

  // ---- tray: window controls (frameless main window) ----
  bar.querySelector('[data-tray="min"]').addEventListener('click', () => devos.win.controls('minimize'));
  bar.querySelector('[data-tray="quit"]').addEventListener('click', () => devos.app.quit());
}
