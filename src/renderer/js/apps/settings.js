// DevOS — Settings app: appearance (themes, effects), developer mode,
// shortcuts reference and about.

import { devos } from '../core/bridge.js';
import { state, set } from '../core/state.js';
import { icon } from '../ui/icons.js';
import { createWindow } from '../wm/wm.js';
import { toast } from '../ui/toast.js';
import { THEMES, setTheme, applyEffects } from '../themes.js';

const SHORTCUTS = [
  ['Ctrl + Alt + T', 'New terminal window'],
  ['Ctrl + Alt + E', 'File Explorer'],
  ['Ctrl + Alt + V', 'Launch VS Code'],
  ['Ctrl + Alt + B', 'Browser'],
  ['Ctrl + Alt + G', 'Git panel'],
  ['Ctrl + Alt + D', 'Toggle developer mode'],
  ['Ctrl + Alt + M', 'Task manager'],
  ['Ctrl + `', 'New terminal tab'],
  ['Ctrl + L', 'Clear terminal (in input)'],
  ['Ctrl + C', 'Stop running command'],
  ['Tab', 'Autocomplete command / path'],
  ['↑ / ↓', 'Command history'],
  ['F11', 'Toggle fullscreen'],
];

let settingsCounter = 0;

export function openSettingsWindow(opts = {}) {
  settingsCounter += 1;

  const root = document.createElement('div');
  root.className = 'set-wrap';

  root.innerHTML = `
    <div class="set-section" data-section="appearance">
      <h3>Appearance — themes</h3>
      <div class="theme-grid" data-region="themes"></div>
    </div>

    <div class="set-section">
      <h3>Desktop effects</h3>
      <div data-region="effects"></div>
    </div>

    <div class="set-section">
      <h3>Developer</h3>
      <div data-region="dev"></div>
    </div>

    <div class="set-section">
      <h3>Keyboard shortcuts</h3>
      <div class="shortcut-table" data-region="shortcuts"></div>
    </div>

    <div class="set-section">
      <h3>About</h3>
      <div class="about-box">
        <span class="logo">${icon('devosLogo')}</span>
        <div>
          <div style="font-weight:700;font-size:15px;letter-spacing:1px;">DevOS <span class="dim" style="font-weight:400;">developer shell</span></div>
          <div class="dim" style="margin-top:4px;">A command-driven, terminal-first desktop shell — not an emulator, no VM.</div>
          <div class="kv-table" style="margin-top:10px;" data-region="about"></div>
        </div>
      </div>
    </div>
  `;

  // ---- themes ----
  const themeGrid = root.querySelector('[data-region="themes"]');
  for (const t of THEMES) {
    const card = document.createElement('div');
    card.className = `theme-card${state.theme === t.id ? ' active' : ''}`;
    card.innerHTML = `
      <div class="swatch" style="background:${t.bg};">
        <i style="background:${t.accent};box-shadow:0 0 8px ${t.accent};"></i>
        <i style="background:${t.panel};border:1px solid ${t.accent}44;"></i>
        <i style="background:${t.accent}33;"></i>
      </div>
      <div class="meta"><div class="n">${t.name}</div><div class="c">${t.cmd}</div></div>`;
    card.addEventListener('click', () => {
      setTheme(t.id);
      themeGrid.querySelectorAll('.theme-card').forEach((c) => c.classList.remove('active'));
      card.classList.add('active');
    });
    themeGrid.appendChild(card);
  }

  // ---- effects ----
  const effectRows = [
    ['scanlines', 'CRT scanlines', 'Subtle horizontal scanline overlay'],
    ['grid', 'Grid wallpaper', 'Animated background grid'],
    ['matrixRain', 'Matrix rain', 'Falling glyph rain (always on in Matrix theme)'],
    ['glow', 'Neon glow', 'Glowing accents and focus shadows'],
    ['flicker', 'CRT flicker', 'Rare refresh flicker (retro feel)'],
    ['bootSequence', 'Boot sequence', 'Play the boot animation at startup'],
  ];
  const effectsHost = root.querySelector('[data-region="effects"]');
  for (const [key, label, sub] of effectRows) {
    const row = document.createElement('div');
    row.className = 'set-row';
    row.innerHTML = `<div><div class="lbl">${label}</div><div class="sub">${sub}</div></div><div class="switch${state.effects[key] ? ' on' : ''}"></div>`;
    row.querySelector('.switch').addEventListener('click', (e) => {
      const el = e.currentTarget;
      el.classList.toggle('on');
      const next = { ...state.effects, [key]: el.classList.contains('on') };
      set({ effects: next });
      applyEffects(next);
      devos.cfg.set({ effects: next }).catch(() => {});
    });
    effectsHost.appendChild(row);
  }

  // ---- developer ----
  const devHost = root.querySelector('[data-region="dev"]');
  const devRow = document.createElement('div');
  devRow.className = 'set-row';
  devRow.innerHTML = `
    <div><div class="lbl">Developer mode</div>
    <div class="sub">HUD with CPU/RAM/disk/net, git branch, quick actions, terminal-heavy layout</div></div>
    <div class="switch${state.developerMode ? ' on' : ''}"></div>`;
  devRow.querySelector('.switch').addEventListener('click', (e) => {
    const el = e.currentTarget;
    el.classList.toggle('on');
    const on = el.classList.contains('on');
    set({ developerMode: on });
    devos.cfg.set({ developerMode: on }).catch(() => {});
    toast('Developer mode', on ? 'Enabled — HUD active' : 'Disabled', 'ok');
  });
  devHost.appendChild(devRow);

  const winRow = document.createElement('div');
  winRow.className = 'set-row';
  winRow.innerHTML = `
    <div><div class="lbl">Open Windows Settings</div>
    <div class="sub">Launch the real ms-settings: panel on Windows</div></div>
    <button class="btn">${icon('external')} open</button>`;
  winRow.querySelector('button').addEventListener('click', async () => {
    const res = await devos.sh.launch('windows-settings');
    if (!res.ok) toast('Windows Settings', res.message, 'err');
  });
  devHost.appendChild(winRow);

  const projectRow = document.createElement('div');
  projectRow.className = 'set-row';
  projectRow.innerHTML = `
    <div><div class="lbl">Active project</div>
    <div class="sub" data-region="proj">${state.activeProject || 'Set by File Explorer / Git panel — used for the HUD git badge'}</div></div>
    <button class="btn">${icon('folder')} browse</button>`;
  projectRow.querySelector('button').addEventListener('click', async () => {
    const dir = await devos.fs.pickFolder('Select project folder');
    if (dir) {
      set({ activeProject: dir });
      devos.cfg.set({ activeProject: dir }).catch(() => {});
      projectRow.querySelector('[data-region="proj"]').textContent = dir;
    }
  });
  devHost.appendChild(projectRow);

  // ---- shortcuts ----
  const scHost = root.querySelector('[data-region="shortcuts"]');
  for (const [k, d] of SHORTCUTS) {
    const key = document.createElement('kbd');
    key.textContent = k;
    const desc = document.createElement('span');
    desc.className = 'dim';
    desc.textContent = d;
    scHost.appendChild(key);
    scHost.appendChild(desc);
  }

  // ---- about ----
  (async () => {
    const about = root.querySelector('[data-region="about"]');
    const [ver, info] = await Promise.all([devos.app.version().catch(() => ({})), devos.sys.info().catch(() => ({}))]);
    about.innerHTML = `
      <span class="k">version</span><span class="v">${ver.version || '1.0.0'}</span>
      <span class="k">electron</span><span class="v">${ver.electron || '—'}</span>
      <span class="k">host</span><span class="v">${info.hostname || '—'}</span>
      <span class="k">os</span><span class="v">${info.osVersion || '—'}</span>
      <span class="k">cpu</span><span class="v">${(info.cpuModel || '—').slice(0, 42)}</span>`;
  })();

  const win = createWindow({
    id: `settings-${settingsCounter}`,
    title: 'Settings',
    iconName: 'settings',
    width: 720,
    height: 560,
    minW: 520,
    minH: 400,
    singleton: true,
    content: root,
  });

  if (opts.section === 'appearance') {
    root.querySelector('[data-section="appearance"]').scrollIntoView({ behavior: 'smooth' });
  }

  return win;
}
