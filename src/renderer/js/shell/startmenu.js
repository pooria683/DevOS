// DevOS — Start menu: command-palette style, searchable, keyboard-driven.

import { devos } from '../core/bridge.js';
import { state, set } from '../core/state.js';
import { icon } from '../ui/icons.js';
import { APPS, openApp } from '../apps/registry.js';
import { THEMES, setTheme } from '../themes.js';

const menu = () => document.getElementById('startmenu');

let isOpen = false;

export function toggleStartMenu() {
  isOpen ? closeStartMenu() : openStartMenu();
}

export function openStartMenu(prefill = '') {
  const host = menu();
  isOpen = true;
  host.classList.remove('hidden');
  document.querySelector('.tb-start')?.classList.add('open');

  host.innerHTML = `
    <div class="sm-head">
      <span class="prompt">❯</span>
      <input id="sm-search" type="text" placeholder="run a command — try “open vscode” or “theme matrix”…" spellcheck="false" autocomplete="off" />
      <span class="faint mono" style="font-size:10px;">ESC</span>
    </div>
    <div class="sm-list" data-region="list"></div>
    <div class="sm-foot">
      <div class="keys">
        <span><kbd>↑↓</kbd> navigate</span>
        <span><kbd>Enter</kbd> run</span>
        <span><kbd>Esc</kbd> close</span>
      </div>
      <div class="power" title="Quit DevOS">${icon('power')} quit</div>
    </div>
  `;

  const input = host.querySelector('#sm-search');
  const listHost = host.querySelector('[data-region="list"]');
  host.querySelector('.power').addEventListener('click', () => {
    devos.app.quit();
  });

  // Build entries
  const entries = [];

  for (const app of APPS) {
    entries.push({
      section: 'Apps',
      name: app.title,
      cmd: app.cmd,
      desc: app.desc,
      iconName: app.icon,
      keywords: app.keywords,
      action: () => openApp(app.id),
    });
  }

  for (const t of THEMES) {
    entries.push({
      section: 'Commands',
      name: t.name,
      cmd: t.cmd,
      iconName: 'palette',
      keywords: `theme color appearance ${t.name}`,
      action: () => setTheme(t.id),
    });
  }

  entries.push(
    {
      section: 'Commands',
      name: 'Developer mode on',
      cmd: 'developer mode on',
      iconName: 'zap',
      keywords: 'devmode hud stats terminal',
      action: () => { set({ developerMode: true }); devos.cfg.set({ developerMode: true }).catch(() => {}); },
    },
    {
      section: 'Commands',
      name: 'Developer mode off',
      cmd: 'developer mode off',
      iconName: 'zap',
      keywords: 'devmode hud stats',
      action: () => { set({ developerMode: false }); devos.cfg.set({ developerMode: false }).catch(() => {}); },
    },
    {
      section: 'Commands',
      name: 'Open Windows Settings',
      cmd: 'start ms-settings:',
      iconName: 'settings',
      keywords: 'system windows control panel',
      action: async () => {
        const r = await devos.sh.launch('windows-settings');
        if (!r.ok) toast(r.message);
      },
    },
    {
      section: 'Commands',
      name: 'Open GitHub',
      cmd: 'open https://github.com',
      iconName: 'external',
      keywords: 'web browser url',
      action: () => devos.sh.openExternal('https://github.com'),
    },
  );

  function toast(msg) {
    import('../ui/toast.js').then((m) => m.toast('Windows Settings', msg, 'err'));
  }

  let filtered = entries;
  let selected = 0;

  function render() {
    listHost.innerHTML = '';
    if (!filtered.length) {
      listHost.innerHTML = `<div class="sm-empty">no matching command — try “help” in the terminal</div>`;
      return;
    }
    let lastSection = '';
    filtered.forEach((entry, i) => {
      if (entry.section !== lastSection) {
        const sec = document.createElement('div');
        sec.className = 'sm-section';
        sec.textContent = entry.section;
        listHost.appendChild(sec);
        lastSection = entry.section;
      }
      const item = document.createElement('div');
      item.className = `sm-item${i === selected ? ' selected' : ''}`;
      item.innerHTML = `
        <span class="ic">${icon(entry.iconName)}</span>
        <span class="tx">
          <div class="n"></div>
          <div class="c"><b>${entry.cmd}</b>${entry.desc ? ` — ${entry.desc}` : ''}</div>
        </span>`;
      item.querySelector('.n').textContent = entry.name;
      item.addEventListener('click', () => {
        closeStartMenu();
        entry.action();
      });
      listHost.appendChild(item);
    });
    const sel = listHost.querySelector('.sm-item.selected');
    sel?.scrollIntoView({ block: 'nearest' });
  }

  function filter(q) {
    const query = q.trim().toLowerCase();
    if (!query) {
      filtered = entries.slice();
    } else {
      filtered = entries.filter((e) =>
        e.name.toLowerCase().includes(query) ||
        e.cmd.toLowerCase().includes(query) ||
        (e.keywords || '').toLowerCase().includes(query)
      );
    }
    selected = 0;
    render();
  }

  input.addEventListener('input', () => filter(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selected = Math.min(filtered.length - 1, selected + 1);
      render();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selected = Math.max(0, selected - 1);
      render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const entry = filtered[selected];
      if (entry) {
        closeStartMenu();
        entry.action();
      }
    } else if (e.key === 'Escape') {
      closeStartMenu();
    }
  });

  filter(prefill);
  setTimeout(() => input.focus(), 30);
}

export function closeStartMenu() {
  const host = menu();
  isOpen = false;
  host.classList.add('hidden');
  host.innerHTML = '';
  document.querySelector('.tb-start')?.classList.remove('open');
}

export function isStartMenuOpen() {
  return isOpen;
}

export function initStartMenu() {
  window.addEventListener('mousedown', (e) => {
    if (isOpen && !menu().contains(e.target) && !e.target.closest('.tb-start')) {
      closeStartMenu();
    }
  });
}
