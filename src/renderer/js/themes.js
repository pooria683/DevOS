// DevOS — theme engine.

import { devos } from './core/bridge.js';
import { state, set, on } from './core/state.js';

export const THEMES = [
  { id: 'darkide', name: 'Dark IDE', cmd: 'theme dark', accent: '#22d3ee', bg: '#05070d', panel: '#0c1220' },
  { id: 'matrix', name: 'Matrix', cmd: 'theme matrix', accent: '#22c55e', bg: '#000600', panel: '#031103' },
  { id: 'cyberpunk', name: 'Cyberpunk', cmd: 'theme cyberpunk', accent: '#ff2fb3', bg: '#0b0416', panel: '#160a26' },
  { id: 'retro', name: 'Retro Terminal', cmd: 'theme retro', accent: '#ffb000', bg: '#0d0800', panel: '#191100' },
  { id: 'minimal', name: 'Minimal Black', cmd: 'theme minimal', accent: '#e8e8e8', bg: '#060606', panel: '#0e0e0e' },
  { id: 'neon', name: 'Neon Green', cmd: 'theme neon', accent: '#00ffa3', bg: '#010a08', panel: '#031a15' },
  { id: 'solarized', name: 'Solarized Dark', cmd: 'theme solarized', accent: '#2aa198', bg: '#00212b', panel: '012733' },
];

export function themeById(id) {
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

export function applyTheme(id) {
  const theme = themeById(id);
  document.body.dataset.theme = theme.id;
  set({ theme: theme.id });
  import('./desktop/wallpaper.js').then((m) => m.refreshWallpaper());
}

export function setTheme(id, persist = true) {
  applyTheme(id);
  if (persist) devos.cfg.set({ theme: themeById(id).id }).catch(() => {});
}

export function cycleTheme() {
  const idx = THEMES.findIndex((t) => t.id === state.theme);
  const next = THEMES[(idx + 1) % THEMES.length];
  setTheme(next.id);
  return next;
}

export function applyEffects(effects) {
  const e = { ...state.effects, ...effects };
  set({ effects: e });
  document.body.classList.toggle('no-glow', !e.glow);
  document.querySelector('.fx-scanlines')?.classList.toggle('hidden', !e.scanlines);
  document.querySelector('.fx-flicker')?.classList.toggle('hidden', !e.flicker);
}

export async function initTheme() {
  try {
    const cfg = await devos.cfg.get();
    if (cfg?.theme) applyTheme(cfg.theme);
    if (cfg?.effects) applyEffects(cfg.effects);
    if (typeof cfg?.developerMode === 'boolean') set({ developerMode: cfg.developerMode });
    if (cfg?.activeProject) set({ activeProject: cfg.activeProject });
  } catch {
    applyTheme('darkide');
  }
  // Guard against re-entrancy: applyTheme itself sets state.theme, which
  // would otherwise re-trigger this listener in a loop.
  on('change:theme', (id) => {
    if (document.body.dataset.theme !== id) applyTheme(id);
  });
}
