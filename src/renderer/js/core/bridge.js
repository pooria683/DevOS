// DevOS — bridge resolution.
// In Electron, the preload script exposes `window.devos` with full IPC access.
// In a plain browser (hosted preview), we fall back to the mock bridge so the
// entire desktop remains explorable.

export let devos = window.devos ?? null;
export const isElectron = !!window.devos;

if (!devos) {
  const { buildMockBridge } = await import('./mock.js');
  devos = buildMockBridge();
  window.devos = devos;
  console.info('[DevOS] Electron bridge not detected — running in browser preview mode.');
}
