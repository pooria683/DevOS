// DevOS — global state with tiny pub/sub.

const listeners = new Map(); // key -> Set<fn>

export const state = {
  booted: false,
  theme: 'darkide',
  effects: { scanlines: true, grid: true, matrixRain: false, glow: true, flicker: false, bootSequence: true },
  developerMode: false,
  activeProject: '',      // directory considered the "current project" (HUD/git)
  sysInfo: null,
  detect: null,
  username: 'dev',
  hostname: 'devos',
};

export function get(key) {
  return state[key];
}

export function set(patch) {
  Object.assign(state, patch);
  emit('change', patch);
  for (const key of Object.keys(patch)) emit(`change:${key}`, state[key]);
}

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event)?.delete(fn);
}

export function emit(event, payload) {
  listeners.get(event)?.forEach((fn) => {
    try { fn(payload); } catch (err) { console.error(`[state] listener error for ${event}:`, err?.stack || err); }
  });
}
