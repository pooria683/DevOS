// DevOS — built-in terminal.
// Tabs, command history, ghost suggestions, path autocomplete, ANSI colors,
// built-in DevOS commands and a real shell bridge for everything else.
//
// Output streaming is session-scoped: every data event for a tab is printed
// as it arrives (no per-run listener registration race), and run lifecycle
// (busy dot / stop button) is keyed by runId.

import { devos } from '../core/bridge.js';
import { state, set as setState } from '../core/state.js';
import { createWindow } from '../wm/wm.js';
import { openApp } from './registry.js';
import { THEMES, setTheme } from '../themes.js';

const BUILTIN_COMMANDS = [
  'help', 'clear', 'cls', 'open ', 'theme ', 'themes', 'developer mode on', 'developer mode off',
  'devmode on', 'devmode off', 'devos', 'history', 'echo ', 'date', 'whoami', 'pwd', 'cd ',
  'exit', 'git ', 'npm ', 'node ', 'docker ', 'code ', 'dir', 'ls', 'cat ', 'type ', 'mkdir ',
  'ipconfig', 'ping ', 'systeminfo', 'tasklist',
];

const OPEN_ALIASES = {
  terminal: 'terminal', term: 'terminal', cmd: 'terminal', shell: 'terminal',
  vscode: 'vscode', code: 'vscode', editor: 'vscode',
  files: 'files', explorer: 'files', folder: 'files', 'file explorer': 'files',
  browser: 'browser', web: 'browser', internet: 'browser',
  settings: 'settings', preferences: 'settings', config: 'settings',
  taskmgr: 'taskmgr', taskmanager: 'taskmgr', 'task manager': 'taskmgr', processes: 'taskmgr',
  git: 'git', docker: 'docker', themes: 'settings',
};

let windowCounter = 0;
const dataListeners = [];
const exitListeners = [];

export function initTerminalBridge() {
  devos.onTermData((evt) => dataListeners.forEach((fn) => fn(evt)));
  devos.onTermExit((evt) => exitListeners.forEach((fn) => fn(evt)));
}

export function openTerminalWindow(opts = {}) {
  windowCounter += 1;
  const sessionGroupId = `term-${Date.now()}`;

  const root = document.createElement('div');
  root.className = 'term-wrap';

  root.innerHTML = `
    <div class="term-tabs">
      <div class="term-tabs-list" style="display:flex;flex:1;overflow-x:auto;scrollbar-width:none;"></div>
      <button class="term-new-tab" title="New tab (Ctrl+T)">+</button>
    </div>
    <div class="term-panes" style="flex:1;display:flex;min-height:0;"></div>
  `;
  const tabsList = root.querySelector('.term-tabs-list');
  const panes = root.querySelector('.term-panes');

  const sessions = [];
  let active = null;

  // ---- shared helpers ----
  function esc(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** Minimal ANSI SGR renderer — colors, bold, dim, italic, underline. */
  function ansiToHtml(text) {
    let out = '';
    let openSpans = 0;
    const re = /\x1b\[([0-9;]*)m/g;
    let match;
    let lastIdx = 0;
    while ((match = re.exec(text)) !== null) {
      out += esc(text.slice(lastIdx, match.index));
      lastIdx = re.lastIndex;
      const codes = (match[1] || '0').split(';').map((n) => parseInt(n || '0', 10));
      for (let k = 0; k < openSpans; k++) out += '</span>';
      openSpans = 0;
      let cls = '';
      for (const code of codes) {
        if (code === 0) cls = '';
        else if (code === 1) cls += ' ansi-b';
        else if (code === 2) cls += ' ansi-d';
        else if (code === 3) cls += ' ansi-i';
        else if (code === 4) cls += ' ansi-u';
        else if (code >= 30 && code <= 37) cls += ` ansi-fg${code - 30}`;
        else if (code >= 90 && code <= 97) cls += ` ansi-fg${code - 90 + 8}`;
        else if (code === 39) cls = cls.replace(/ ansi-fg\d+/g, '');
      }
      if (cls.trim()) { out += `<span class="${cls.trim()}">`; openSpans += 1; }
    }
    out += esc(text.slice(lastIdx));
    return out;
  }

  function createSession(initialDir) {
    const id = `${sessionGroupId}-s${sessions.length + 1}`;
    const pane = document.createElement('div');
    pane.style.cssText = 'flex:1;display:flex;min-width:0;';
    pane.innerHTML = `
      <div style="flex:1;display:flex;flex-direction:column;min-width:0;">
        <div class="term-output"></div>
        <div class="term-input-row">
          <span class="t-prompt"></span>
          <input type="text" spellcheck="false" autocomplete="off" aria-label="terminal input" />
          <button class="term-stop hidden" title="Kill running command (Ctrl+C)">■ stop</button>
          <div class="term-suggest hidden"></div>
        </div>
      </div>
    `;
    const output = pane.querySelector('.term-output');
    const input = pane.querySelector('input');
    const promptEl = pane.querySelector('.t-prompt');
    const stopBtn = pane.querySelector('.term-stop');
    const suggestEl = pane.querySelector('.term-suggest');

    const session = {
      id,
      pane,
      output,
      input,
      promptEl,
      stopBtn,
      suggestEl,
      cwd: '',
      history: [],
      histIdx: -1,
      runs: new Map(),      // runId -> { stop() }
      pendingRunId: null,
      name: 'shell',
    };

    // Tab chip
    const tab = document.createElement('div');
    tab.className = 'term-tab';
    tab.innerHTML = `<span class="busy-dot hidden"></span><span class="shell-name"></span><span class="x">✕</span>`;
    tab.querySelector('.shell-name').textContent = `shell ${sessions.length + 1}`;
    tab.addEventListener('click', () => activateSession(session));
    tab.querySelector('.x').addEventListener('click', (e) => {
      e.stopPropagation();
      closeSession(session);
    });
    session.tabEl = tab;
    tabsList.appendChild(tab);
    panes.appendChild(pane);

    sessions.push(session);

    // ---- streaming output (session-scoped, race-free) ----
    session.handleData = (evt) => {
      if (evt.sessionId !== session.id) return;
      const cls = evt.stream === 'err' ? 't-err' : '';
      const lines = evt.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
      for (const line of lines) {
        if (line === '' && lines.length === 1) continue;
        print(session, line, cls);
      }
    };
    session.handleExit = (evt) => {
      if (evt.sessionId !== session.id || evt.runId !== session.pendingRunId) return;
      session.pendingRunId = null;
      session.runs.delete(evt.runId);
      tab.querySelector('.busy-dot').classList.add('hidden');
      stopBtn.classList.add('hidden');
      if (evt.code !== 0 && evt.code !== 130) print(session, `process exited with code ${evt.code}`, 't-dim');
      if (active === session) input.focus();
    };
    dataListeners.push(session.handleData);
    exitListeners.push(session.handleExit);

    // ---- interaction ----
    input.addEventListener('keydown', (e) => onInputKey(session, e));
    input.addEventListener('input', () => updateSuggestion(session));
    output.addEventListener('click', () => {
      if (!window.getSelection().toString()) input.focus();
    });
    stopBtn.addEventListener('click', () => killActiveRun(session));

    setCwd(session, initialDir || '').then(() => printBanner(session));

    return session;
  }

  function activateSession(session) {
    if (active === session) return;
    active = session;
    sessions.forEach((s) => {
      s.pane.style.display = s === session ? '' : 'none';
      s.tabEl.classList.toggle('active', s === session);
    });
    session.input.focus();
    scrollBottom(session);
  }

  function closeSession(session) {
    session.runs.forEach((run) => run.stop());
    session.tabEl.remove();
    session.pane.remove();
    const dIdx = dataListeners.indexOf(session.handleData);
    if (dIdx >= 0) dataListeners.splice(dIdx, 1);
    const eIdx = exitListeners.indexOf(session.handleExit);
    if (eIdx >= 0) exitListeners.splice(eIdx, 1);
    const idx = sessions.indexOf(session);
    sessions.splice(idx, 1);
    if (!sessions.length) {
      win.close();
      return;
    }
    if (active === session) activateSession(sessions[Math.max(0, idx - 1)]);
  }

  function removeSession(session) {
    session.runs.forEach((run) => run.stop());
    const dIdx = dataListeners.indexOf(session.handleData);
    if (dIdx >= 0) dataListeners.splice(dIdx, 1);
    const eIdx = exitListeners.indexOf(session.handleExit);
    if (eIdx >= 0) exitListeners.splice(eIdx, 1);
  }

  // ---- output helpers ----
  function print(session, text, cls = '') {
    const line = document.createElement('div');
    line.className = `t-line ${cls}`;
    line.innerHTML = ansiToHtml(text);
    session.output.appendChild(line);
    trimOutput(session);
    scrollBottom(session);
  }

  function printHtml(session, html) {
    const line = document.createElement('div');
    line.className = 't-line';
    line.innerHTML = html;
    session.output.appendChild(line);
    trimOutput(session);
    scrollBottom(session);
  }

  function trimOutput(session) {
    while (session.output.children.length > 1400) session.output.firstChild.remove();
  }

  function scrollBottom(session) {
    session.output.scrollTop = session.output.scrollHeight;
  }

  function printPromptLine(session, cmd) {
    printHtml(session, `<div class="t-cmd"><span class="t-prompt">${promptLabel(session)}</span> ${esc(cmd)}</div>`);
  }

  function promptLabel(session) {
    const short = session.cwd.replace(/^\/home\/[^/]+/, '~').replace(/^[A-Z]:\\[^\\]*/, (m) => m.slice(0, 2));
    return `<span class="t-path">${esc(short)}</span> <span>❯</span>`;
  }

  function setCwd(session, dir) {
    return devos.term.cwd(session.id, dir || undefined).then((r) => {
      session.cwd = r.cwd;
      session.promptEl.innerHTML = promptLabel(session);
      return r.cwd;
    });
  }

  function printBanner(session) {
    printHtml(session, `
<span class="t-accent ansi-b"> ▄▄▄▄▄ ▄     ▄ ▄▄▄▄▄ ▄▄▄▄▄▄ ▄▄▄▄▄▄ </span>
<span class="t-accent ansi-b"> █     █     █ █     █     █     █ </span>
<span class="t-accent ansi-b"> ▀▀▀▀█ █     █ █     ▀▀▀▀█ █▀▀    </span>
<span class="t-accent ansi-b"> ▄▄▄▄█ ▀▄▄ ▄▄▀ █▄▄▄▄     █ ▀▄▄▄▄▄ </span>
<span class="t-dim"> developer shell · type <span class="t-ok">help</span> for built-in commands</span>`);
    print(session, '');
  }

  function printHelp(session) {
    const rows = [
      ['help', 'show this help'],
      ['clear', 'clear the terminal (Ctrl+L)'],
      ['open terminal | vscode | files | browser | settings | git | docker | taskmgr', 'open apps'],
      ['theme dark | matrix | cyberpunk | retro | minimal | neon | solarized', 'switch theme'],
      ['themes', 'list available themes'],
      ['developer mode on | off', 'toggle developer mode'],
      ['devos', 'system information banner'],
      ['history', 'show command history'],
      ['exit', 'close this tab'],
      ['<any shell command>', 'runs in the real system shell (cd persists per tab)'],
    ];
    printHtml(session, rows.map(([c, d]) =>
      `<div><span class="t-ok">${esc(c)}</span> <span class="t-dim">— ${esc(d)}</span></div>`).join(''));
  }

  function printDevosBanner(session) {
    const info = state.sysInfo || {};
    const uptime = info.uptime ? formatUptime(info.uptime) : '—';
    const mem = info.totalMem ? `${(info.totalMem / 1073741824).toFixed(1)} GB` : '—';
    printHtml(session, `
<span class="t-accent ansi-b">        DevOS</span> <span class="t-dim">v1.0.0</span>
<span class="t-dim">host</span>     ${esc(info.hostname || '—')}
<span class="t-dim">user</span>     ${esc(info.user || '—')}
<span class="t-dim">os</span>       ${esc(info.osVersion || '—')} <span class="t-dim">(${esc(info.arch || '')})</span>
<span class="t-dim">cpu</span>      ${esc(info.cpuModel || '—')} <span class="t-dim">(${info.cpuCores || '?'} cores)</span>
<span class="t-dim">memory</span>   ${mem}
<span class="t-dim">uptime</span>   ${uptime}
<span class="t-dim">shell</span>    devos-term ${devos.platform === 'browser' ? '(browser preview)' : `(${devos.platform})`}`);
  }

  function formatUptime(sec) {
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return `${d ? `${d}d ` : ''}${h ? `${h}h ` : ''}${m}m`;
  }

  // ---- command handling ----
  async function runCommand(session, raw) {
    const cmd = raw.trim();
    if (!cmd) return;

    session.history.push(cmd);
    if (session.history.length > 200) session.history.shift();
    session.histIdx = -1;
    printPromptLine(session, cmd);
    hideSuggestion(session);

    const lower = cmd.toLowerCase();

    // Built-ins first
    if (lower === 'help' || lower === '?') { printHelp(session); return; }
    if (lower === 'clear' || lower === 'cls') { session.output.innerHTML = ''; return; }
    if (lower === 'themes') {
      printHtml(session, THEMES.map((t) =>
        `<div><span class="t-accent">${esc(t.cmd)}</span> <span class="t-dim">— ${esc(t.name)}</span></div>`).join(''));
      return;
    }
    if (lower.startsWith('theme ')) {
      const arg = lower.slice(6).trim();
      const aliases = { dark: 'darkide', darkide: 'darkide', ide: 'darkide', matrix: 'matrix', cyberpunk: 'cyberpunk', retro: 'retro', minimal: 'minimal', black: 'minimal', neon: 'neon', green: 'neon', solarized: 'solarized' };
      const id = aliases[arg];
      if (id) {
        setTheme(id);
        print(session, `Theme set to ${THEMES.find((t) => t.id === id).name}`, 't-ok');
      } else {
        print(session, `Unknown theme "${arg}". Try: themes`, 't-err');
      }
      return;
    }
    if (/^developer mode (on|off)$/.test(lower) || /^(devmode) (on|off)$/.test(lower)) {
      const on = lower.endsWith('on');
      setState({ developerMode: on });
      devos.cfg.set({ developerMode: on }).catch(() => {});
      print(session, `Developer mode ${on ? 'enabled' : 'disabled'}`, on ? 't-ok' : 't-warn');
      return;
    }
    if (lower === 'devos' || lower === 'neofetch') { printDevosBanner(session); return; }
    if (lower === 'history') {
      session.history.forEach((h, i) => printHtml(session, `<span class="t-dim">${String(i + 1).padStart(3)}</span>  ${esc(h)}`));
      return;
    }
    if (lower === 'exit') { closeSession(session); return; }
    if (lower.startsWith('open ') || lower === 'start ') {
      const target = lower.replace(/^(open|start)\s+/, '').trim().replace(/\.$/, '');
      if (target === 'themes') {
        openApp('settings', { section: 'appearance' });
        print(session, 'Opening Settings → Appearance', 't-ok');
        return;
      }
      const appId = OPEN_ALIASES[target];
      if (appId) {
        openApp(appId, target === 'files' || target === 'explorer' || target === 'folder' ? { dir: session.cwd } : {});
        print(session, `Opening ${appId}…`, 't-ok');
        return;
      }
      print(session, `Don't know how to open "${target}". Try: open terminal | vscode | files | browser | settings | git | docker | taskmgr`, 't-err');
      return;
    }

    // Everything else goes to the real shell bridge (cd handled backend-side).
    try {
      const res = await devos.term.exec(session.id, cmd);
      if (res.cwd && res.cwd !== session.cwd) {
        session.cwd = res.cwd;
        session.promptEl.innerHTML = promptLabel(session);
      }
      if (res.error) print(session, res.error, 't-err');
      if (res.runId) markBusy(session, res.runId);
    } catch (err) {
      print(session, `exec failed: ${err.message}`, 't-err');
    }
  }

  function markBusy(session, runId) {
    session.pendingRunId = runId;
    session.runs.set(runId, { stop: () => devos.term.kill(runId) });
    session.tabEl.querySelector('.busy-dot').classList.remove('hidden');
    session.stopBtn.classList.remove('hidden');
  }

  function killActiveRun(session) {
    session.runs.forEach((run) => run.stop());
    print(session, '^C', 't-dim');
  }

  // ---- input key handling ----
  function onInputKey(session, e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      runCommand(session, session.input.value);
      session.input.value = '';
      hideSuggestion(session);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!session.history.length) return;
      session.histIdx = session.histIdx === -1 ? session.history.length - 1 : Math.max(0, session.histIdx - 1);
      session.input.value = session.history[session.histIdx];
      moveCaretEnd(session.input);
      updateSuggestion(session);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (session.histIdx === -1) return;
      session.histIdx += 1;
      if (session.histIdx >= session.history.length) {
        session.histIdx = -1;
        session.input.value = '';
      } else {
        session.input.value = session.history[session.histIdx];
      }
      updateSuggestion(session);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      complete(session);
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      session.output.innerHTML = '';
    } else if (e.key === 'c' && e.ctrlKey && session.runs.size) {
      e.preventDefault();
      killActiveRun(session);
    } else if (e.key === 't' && e.ctrlKey) {
      e.preventDefault();
      newTab();
    } else if (e.key === 'Escape') {
      hideSuggestion(session);
    }
  }

  function moveCaretEnd(input) {
    const len = input.value.length;
    input.setSelectionRange(len, len);
  }

  // ---- autocomplete ----
  function updateSuggestion(session) {
    const value = session.input.value.trim().toLowerCase();
    if (!value || value.includes(' ')) { hideSuggestion(session); return; }
    const match = BUILTIN_COMMANDS.find((c) => c.startsWith(value) && c !== value);
    if (match) {
      const rest = match.slice(value.length);
      session.suggestEl.innerHTML = `${esc(session.input.value)}<b>${esc(rest)}</b> <span class="t-dim">Tab</span>`;
      session.suggestEl.classList.remove('hidden');
      session._suggest = match;
    } else {
      hideSuggestion(session);
    }
  }

  function hideSuggestion(session) {
    session.suggestEl.classList.add('hidden');
    session._suggest = null;
  }

  async function complete(session) {
    const value = session.input.value;
    const parts = value.split(/\s+/);
    const lastPart = parts[parts.length - 1] || '';

    // Path completion
    if (lastPart.includes('/') || lastPart.includes('\\') || parts.length > 1) {
      const sep = lastPart.includes('\\') ? '\\' : '/';
      const dirPart = lastPart.slice(0, lastPart.lastIndexOf(sep)) || '.';
      const stub = lastPart.slice(lastPart.lastIndexOf(sep) + 1);
      try {
        const target = normJoin(session.cwd, dirPart);
        const { entries } = await devos.fs.list(target);
        const matches = entries.filter((en) => en.name.toLowerCase().startsWith(stub.toLowerCase()));
        if (matches.length === 1) {
          parts[parts.length - 1] = value.slice(0, value.length - lastPart.length) + joinPath(dirPart === '.' ? '' : dirPart, matches[0].name) + (matches[0].type === 'dir' ? sep : '');
          session.input.value = parts.join(' ');
        } else if (matches.length > 1) {
          print(session, matches.map((m) => (m.type === 'dir' ? `${m.name}${sep}` : m.name)).join('   '), 't-dim');
          const prefix = commonPrefix(matches.map((m) => m.name));
          if (prefix.length > stub.length) {
            parts[parts.length - 1] = value.slice(0, value.length - lastPart.length) + joinPath(dirPart === '.' ? '' : dirPart, prefix);
            session.input.value = parts.join(' ');
          }
        }
      } catch { /* not a directory — ignore */ }
      return;
    }

    // Command completion
    if (session._suggest) {
      session.input.value = session._suggest;
      hideSuggestion(session);
      return;
    }
    const matches = BUILTIN_COMMANDS.filter((c) => c.startsWith(lastPart.toLowerCase()));
    if (matches.length === 1) session.input.value = matches[0];
    else if (matches.length > 1) print(session, matches.map((m) => m.trim()).join('   '), 't-dim');
  }

  function normJoin(base, rel) {
    const clean = rel.replaceAll('\\', '/');
    if (clean.startsWith('/')) return clean;
    const stack = base.split('/').filter(Boolean);
    for (const seg of clean.split('/').filter(Boolean)) {
      if (seg === '.') continue;
      if (seg === '..') stack.pop();
      else stack.push(seg);
    }
    return '/' + stack.join('/');
  }

  function joinPath(dir, name) {
    return dir ? `${dir}/${name}` : name;
  }

  function commonPrefix(strings) {
    if (!strings.length) return '';
    let prefix = strings[0];
    for (const s of strings) {
      while (!s.toLowerCase().startsWith(prefix.toLowerCase())) {
        prefix = prefix.slice(0, -1);
        if (!prefix) return '';
      }
    }
    return prefix;
  }

  // ---- window ----
  function newTab() {
    const s = createSession(active?.cwd);
    activateSession(s);
  }

  root.querySelector('.term-new-tab').addEventListener('click', newTab);

  const win = createWindow({
    id: `terminal-${windowCounter}`,
    title: 'Terminal',
    iconName: 'terminal',
    sub: devos.platform === 'browser' ? 'preview' : 'shell',
    width: 780,
    height: 500,
    minW: 420,
    minH: 260,
    content: root,
    onClose: () => {
      sessions.forEach(removeSession);
    },
  });

  createSession(opts.dir || '');
  activateSession(sessions[0]);

  if (opts.runCommand) {
    setTimeout(() => runCommand(sessions[0], opts.runCommand), 300);
  }

  return win;
}
