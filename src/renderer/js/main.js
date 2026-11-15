// DevOS — renderer bootstrap.

import { devos } from './core/bridge.js';
import { state, set } from './core/state.js';
import { initTheme } from './themes.js';
import { initWallpaper } from './desktop/wallpaper.js';
import { runBootSequence } from './desktop/boot.js';
import { initHud } from './desktop/hud.js';
import { initDesktopIcons } from './desktop/icons.js';
import { initTaskbar } from './shell/taskbar.js';
import { initStartMenu } from './shell/startmenu.js';
import { initShortcuts } from './shell/shortcuts.js';
import { initContextMenuGlobal } from './ui/contextmenu.js';
import { initTerminalBridge } from './apps/terminal.js';
import { toast } from './ui/toast.js';

async function boot() {
  // Load persisted config + system info before first paint of UI state.
  try {
    const [cfg, info, detect] = await Promise.all([
      devos.cfg.get().catch(() => ({})),
      devos.sys.info().catch(() => ({})),
      devos.sh.detect().catch(() => ({})),
    ]);
    if (cfg?.desktopIcons) state.persistedIcons = cfg.desktopIcons;
    set({
      sysInfo: info,
      detect,
      username: info.user || 'dev',
      hostname: info.hostname || 'devos',
    });
  } catch {
    // Keep defaults; the desktop still boots.
  }

  await initTheme();
  initWallpaper();
  initContextMenuGlobal();
  initTerminalBridge();
  initTaskbar();
  initStartMenu();
  initDesktopIcons();
  initHud();
  initShortcuts();

  state.booted = true;

  if (devos.platform !== 'browser') {
    runBootSequence();
  } else {
    document.getElementById('boot')?.remove();
  }

  // Terminal is the visual center of DevOS — open one at startup.
  const { openApp } = await import('./apps/registry.js');
  setTimeout(() => openApp('terminal'), 250);

  if (devos.platform === 'browser') {
    toast('DevOS preview', 'Running in browser preview mode — app launches and shell commands are simulated.', 'ok', 6500);
  }
}

boot().catch((err) => {
  console.error('[DevOS] boot failed', err);
  document.body.innerHTML = `<pre style="color:#f87171;font-family:monospace;padding:24px;">DevOS boot failed: ${err.message}\n${err.stack || ''}</pre>`;
});
