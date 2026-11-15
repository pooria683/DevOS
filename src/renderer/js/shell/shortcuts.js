// DevOS — global in-app keyboard shortcuts.

import { devos } from '../core/bridge.js';
import { state, set } from '../core/state.js';
import { openApp } from '../apps/registry.js';
import { openTerminalWindow } from '../apps/terminal.js';
import { isStartMenuOpen, closeStartMenu, toggleStartMenu } from './startmenu.js';

export function initShortcuts() {
  window.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey && e.altKey;

    if (mod) {
      switch (e.key.toLowerCase()) {
        case 't': e.preventDefault(); openApp('terminal'); return;
        case 'e': e.preventDefault(); openApp('files'); return;
        case 'v': e.preventDefault(); openApp('vscode'); return;
        case 'b': e.preventDefault(); openApp('browser'); return;
        case 'g': e.preventDefault(); openApp('git'); return;
        case 'm': e.preventDefault(); openApp('taskmgr'); return;
        case 'd': {
          e.preventDefault();
          const next = !state.developerMode;
          set({ developerMode: next });
          devos.cfg.set({ developerMode: next }).catch(() => {});
          return;
        }
        default: break;
      }
    }

    if (e.ctrlKey && e.key === '`') {
      e.preventDefault();
      openTerminalWindow();
      return;
    }

    if (e.key === 'F11') {
      e.preventDefault();
      devos.win.controls('fullscreen');
      return;
    }

    if (e.key === 'Escape' && isStartMenuOpen()) {
      closeStartMenu();
      return;
    }

    if ((e.key === 'Meta' || (e.ctrlKey && e.key === ' ')) && !e.repeat) {
      // Win key inside the shell opens the command palette.
      if (e.key === 'Meta') {
        e.preventDefault();
        toggleStartMenu();
      }
    }
  });
}
