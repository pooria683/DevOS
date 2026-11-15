// DevOS — browser preview mock bridge.
// When DevOS runs outside Electron (e.g. the hosted preview), this module
// provides the exact same API surface as the real preload bridge, backed by
// a virtual filesystem and simulated telemetry, so the whole desktop can be
// explored in a plain browser.

import { state, emit } from './state.js';

const STORAGE_KEY = 'devos-mock-fs-v1';
const CFG_KEY = 'devos-mock-cfg-v1';

let now = Date.now();

function seedFs() {
  const t = now - 86400000 * 3;
  const f = (content) => content;
  return {
    type: 'dir',
    children: {
      home: {
        type: 'dir',
        children: {
          dev: {
            type: 'dir',
            children: {
              projects: {
                type: 'dir',
                children: {
                  'neon-dashboard': {
                    type: 'dir',
                    children: {
                      src: {
                        type: 'dir',
                        children: {
                          'index.js': { type: 'file', content: f(`import { boot } from './core/boot.js';\n\n// DevOS sample project\nboot({ theme: 'matrix', hud: true });\n`) },
                          'styles.css': { type: 'file', content: f(':root {\n  --accent: #22d3ee;\n  --bg: #05070d;\n}\n\nbody {\n  background: var(--bg);\n  color: #d7e3f4;\n  font-family: "Cascadia Code", monospace;\n}\n') },
                          'core': { type: 'dir', children: { 'boot.js': { type: 'file', content: f('export function boot(opts = {}) {\n  console.log("booting with", opts);\n}\n') } } },
                        },
                      },
                      'package.json': { type: 'file', content: f(`{\n  "name": "neon-dashboard",\n  "version": "0.3.1",\n  "scripts": {\n    "dev": "vite",\n    "build": "vite build"\n  },\n  "dependencies": {\n    "chart.js": "^4.4.1"\n  }\n}\n`) },
                      'README.md': { type: 'file', content: f('# neon-dashboard\n\nA demo repository inside the DevOS browser preview.\n\n- `npm run dev` starts the dev server\n- `git status` shows the working tree\n') },
                      '.git': { type: 'dir', children: {} },
                    },
                  },
                  'dotfiles': {
                    type: 'dir',
                    children: {
                      '.vimrc': { type: 'file', content: f('set number\nsyntax on\ncolorscheme slate\n') },
                      '.gitconfig': { type: 'file', content: f('[user]\n  name = DevOS User\n  email = dev@devos.local\n') },
                    },
                  },
                },
              },
              'welcome.txt': { type: 'file', content: f(`DevOS browser preview\n=====================\nThis is a fully simulated environment.\n\nIn the real Electron app on Windows this terminal executes\nreal shell commands, launches VS Code, Windows Terminal,\nTask Manager, Docker Desktop and your default browser.\n`) },
            },
          },
        },
      },
    },
  };
}

let fsRoot;
try {
  fsRoot = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') || seedFs();
} catch {
  fsRoot = seedFs();
}

function saveFs() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(fsRoot)); } catch { /* quota */ }
}

function norm(p) {
  const abs = String(p || '/home/dev').replaceAll('\\', '/');
  const parts = [];
  for (const seg of abs.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return '/' + parts.join('/');
}

function nodeAt(p) {
  const clean = norm(p);
  if (clean === '/') return fsRoot;
  let node = fsRoot;
  for (const seg of clean.slice(1).split('/')) {
    if (!node || node.type !== 'dir') return null;
    node = node.children[seg];
  }
  return node ?? null;
}

function parentOf(p) {
  const clean = norm(p);
  const idx = clean.lastIndexOf('/');
  return idx <= 0 ? '/' : clean.slice(0, idx);
}

function baseName(p) {
  const clean = norm(p);
  return clean === '/' ? '/' : clean.slice(clean.lastIndexOf('/') + 1);
}

function entryFor(path, node) {
  return {
    name: baseName(path),
    path: norm(path),
    type: node.type,
    size: node.type === 'file' ? node.content.length : 0,
    mtime: node.mtime || now,
    ext: node.type === 'file' ? (baseName(path).includes('.') ? baseName(path).split('.').pop().toLowerCase() : '') : '',
  };
}

function list(dir) {
  const path = norm(dir);
  const node = nodeAt(path);
  if (!node) throw new Error(`No such directory: ${path}`);
  if (node.type !== 'dir') throw new Error(`Not a directory: ${path}`);
  const entries = Object.entries(node.children)
    .map(([name, child]) => entryFor(`${path === '/' ? '' : path}/${name}`, child))
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  return { path, entries };
}

function search(dir, query, limit = 40) {
  const q = String(query || '').toLowerCase();
  if (!q) return [];
  const out = [];
  const walk = (p, node, depth) => {
    if (out.length >= limit || depth > 6 || !node || node.type !== 'dir') return;
    for (const [name, child] of Object.entries(node.children)) {
      const cp = `${p === '/' ? '' : p}/${name}`;
      if (name.toLowerCase().includes(q)) out.push({ name, path: cp, type: child.type });
      if (child.type === 'dir') walk(cp, child, depth + 1);
    }
  };
  walk(norm(dir), nodeAt(dir), 0);
  return out;
}

// ---- simulated telemetry ----
function fakeStats() {
  const load = (base, spread) => Math.max(0, Math.min(100, base + (Math.random() - 0.5) * spread));
  return {
    cpuPercent: load(23, 30),
    cpuCores: 8,
    memUsed: 9.1e9,
    memTotal: 16.6e9,
    uptime: Math.floor(performance.now() / 1000) + 4271,
    network: [
      { name: 'Ethernet', up: true, address: '192.168.1.42', internal: false },
      { name: 'Loopback', up: true, address: '127.0.0.1', internal: true },
    ],
    drives: [{ id: 'C:\\', total: 512e9, free: 198e9 }],
  };
}

const statsSubs = new Set();
let statsTimer = null;
let statRefs = 0;
function ensureStatsTimer() {
  if (statsTimer) return;
  statsTimer = setInterval(() => {
    const snap = fakeStats();
    statsSubs.forEach((cb) => cb(snap));
  }, 1000);
}

// ---- simulated command execution ----
let runCounter = 0;
const mockCwd = new Map();

function mockExec(sessionId, command) {
  const cwd = mockCwd.get(sessionId) || '/home/dev';
  const cmd = String(command || '').trim();
  const runId = `mock-run-${++runCounter}`;
  const emitOut = (text, stream = 'out') => {
    queueMicrotask(() => dataSubs.forEach((cb) => cb({ sessionId, runId, stream, text })));
  };
  const finish = (code = 0) => {
    queueMicrotask(() => exitSubs.forEach((cb) => cb({ sessionId, runId, code })));
  };

  const lower = cmd.toLowerCase();
  const cd = cmd.match(/^cd\s*(.*)$/i);
  if (cd && !/[&|;]/.test(cmd)) {
    const target = cd[1].trim() || '/home/dev';
    const next = norm(target.startsWith('/') ? target : `${cwd}/${target}`);
    const node = nodeAt(next);
    if (node && node.type === 'dir') {
      mockCwd.set(sessionId, next);
      return { runId: null, cwd: next };
    }
    emitOut(`The system cannot find the path specified: ${target}\r\n`, 'err');
    return { runId: null, cwd };
  }

  const out = (text) => { emitOut(text); finish(0); return { runId, cwd }; };

  if (/^(ls|dir)(\s|$)/.test(lower)) {
    try {
      const { entries } = list(cmd.split(/\s+/)[1] ? norm(`${cwd}/${cmd.split(/\s+/)[1]}`) : cwd);
      out(entries.map((e) => (e.type === 'dir' ? `\u001b[36m${e.name}/\u001b[0m` : e.name)).join('   ') + '\r\n');
    } catch (e) { emitOut(String(e.message) + '\r\n', 'err'); finish(1); }
    return { runId, cwd };
  }
  if (/^cat\s/.test(lower)) {
    const node = nodeAt(norm(`${cwd}/${cmd.slice(4).trim()}`));
    if (node && node.type === 'file') out(node.content + '\r\n');
    else { emitOut(`cat: ${cmd.slice(4)}: No such file\r\n`, 'err'); finish(1); }
    return { runId, cwd };
  }
  if (/^echo\s/.test(lower)) { out(cmd.slice(5) + '\r\n'); return { runId, cwd }; }
  if (/^pwd$/i.test(cmd)) { out(cwd + '\r\n'); return { runId, cwd }; }
  if (/^whoami$/i.test(cmd)) { out('dev\\devos\r\n'); return { runId, cwd }; }
  if (/^date/i.test(cmd)) { out(new Date().toString() + '\r\n'); return { runId, cwd }; }
  if (/^git\s+status/.test(lower)) {
    out(`On branch \u001b[32mmain\u001b[0m\r\nYour branch is up to date with 'origin/main'.\r\n\r\nChanges not staged for commit:\r\n  \u001b[33mmodified:   src/index.js\u001b[0m\r\n\r\nUntracked files:\r\n  \u001b[31mnotes.txt\u001b[0m\r\n\r\nno changes added to commit\r\n`);
    return { runId, cwd };
  }
  if (/^git\s+(log|branch)/.test(lower)) {
    out(`\u001b[33mmain\u001b[0m\r\n* \u001b[36ma1b2c3d\u001b[0m feat: add devmode HUD stats\r\n* \u001b[36me4f5a6b\u001b[0m fix: terminal autocomplete ghost text\r\n* \u001b[36m7890bcd\u001b[0m chore: bump electron\r\n`);
    return { runId, cwd };
  }
  if (/^npm\s+run\s+dev/.test(lower)) {
    emitOut('\r\n> neon-dashboard@0.3.1 dev\r\n> vite\r\n\r\n');
    const lines = [
      '\u001b[32m  VITE v5.0.10\u001b[0m  ready in 214 ms\r\n\r  \u001b[2m➜\u001b[0m  \u001b[36mLocal\u001b[0m:   \u001b[36mhttp://localhost:5173/\u001b[0m\r\n  \u001b[2m➜\u001b[0m  press \u001b[36mh + enter\u001b[0m to show help\r\n',
    ];
    let i = 0;
    const timer = setInterval(() => {
      if (i < lines.length) emitOut(lines[i++]);
      else { clearInterval(timer); finish(0); }
    }, 350);
    return { runId, cwd };
  }
  if (/^npm\s/.test(lower)) { out('\r\n> devos-preview\r\n[preview] npm output is simulated in the browser preview\r\n'); return { runId, cwd }; }
  if (/^cls$/i.test(cmd)) { return { runId: null, cwd }; }
  emitOut(`[preview] "${cmd}" runs the real Windows shell inside the DevOS Electron app.\r\nIn this browser preview only simulated commands are available (try: ls, cat, git status, npm run dev).\r\n`, 'err');
  finish(1);
  return { runId, cwd };
}

// ---- subscriptions ----
const dataSubs = new Set();
const exitSubs = new Set();

const listenerBus = {
  data: dataSubs,
  exit: exitSubs,
};

// ---- config ----
function cfgGet() {
  try { return { ...seedCfg(), ...JSON.parse(localStorage.getItem(CFG_KEY) || '{}') }; }
  catch { return seedCfg(); }
}
function seedCfg() {
  return {
    theme: 'darkide',
    developerMode: false,
    startMaximized: true,
    effects: { scanlines: true, grid: true, matrixRain: false, glow: true, flicker: false, bootSequence: true },
    desktopIcons: {},
    activeProject: '',
  };
}
function cfgSet(patch) {
  const next = { ...cfgGet(), ...(patch || {}) };
  try { localStorage.setItem(CFG_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}

export function buildMockBridge() {
  return {
    platform: 'browser',
    versions: { electron: 'preview', chrome: navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] || '?', node: 'preview' },

    sys: {
      info: async () => ({
        hostname: 'devos-preview',
        user: 'dev',
        platform: 'browser',
        osVersion: 'DevOS Browser Preview',
        arch: navigator.platform || 'web',
        cpuModel: 'Simulated 8-core CPU',
        cpuCores: 8,
        totalMem: 16.6e9,
        uptime: 4271,
      }),
      subscribe: async () => { statRefs += 1; ensureStatsTimer(); return { ok: true }; },
      unsubscribe: async () => {
        statRefs = Math.max(0, statRefs - 1);
        if (statRefs === 0 && statsTimer) { clearInterval(statsTimer); statsTimer = null; }
        return { ok: true };
      },
      processes: async () => [
        { pid: 4, name: 'System', cpu: 0.4, mem: 144 * 1024 * 1024 },
        { pid: 1284, name: 'explorer.exe', cpu: 1.2, mem: 88 * 1024 * 1024 },
        { pid: 3012, name: 'Code.exe', cpu: 4.6, mem: 412 * 1024 * 1024 },
        { pid: 4088, name: 'DevOS.exe', cpu: 2.1, mem: 236 * 1024 * 1024 },
        { pid: 5310, name: 'docker.exe', cpu: 0.8, mem: 190 * 1024 * 1024 },
        { pid: 6122, name: 'WindowsTerminal.exe', cpu: 0.5, mem: 74 * 1024 * 1024 },
      ],
      kill: async () => ({ ok: true }),
      drives: async () => [{ id: 'C:\\', total: 512e9, free: 198e9 }],
    },

    fs: {
      list: async (dir) => list(dir),
      read: async (path) => {
        const node = nodeAt(path);
        if (!node || node.type !== 'file') throw new Error(`No such file: ${path}`);
        return { path: norm(path), content: node.content, truncated: false, size: node.content.length };
      },
      write: async (path, content) => {
        const parent = nodeAt(parentOf(path));
        if (!parent || parent.type !== 'dir') throw new Error('Parent folder missing');
        const name = baseName(path);
        parent.children[name] = { type: 'file', content: String(content ?? ''), mtime: Date.now() };
        saveFs();
        return { ok: true };
      },
      mkdir: async (path) => {
        const parent = nodeAt(parentOf(path));
        if (!parent || parent.type !== 'dir') throw new Error('Parent folder missing');
        parent.children[baseName(path)] = { type: 'dir', children: {}, mtime: Date.now() };
        saveFs();
        return { ok: true };
      },
      del: async (path) => {
        const parent = nodeAt(parentOf(path));
        if (parent?.children) { delete parent.children[baseName(path)]; saveFs(); }
        return { ok: true };
      },
      rename: async (path, newPath) => {
        const node = nodeAt(path);
        const parent = nodeAt(parentOf(path));
        const newParent = nodeAt(parentOf(newPath));
        if (!node || !parent || !newParent) throw new Error('Invalid rename');
        delete parent.children[baseName(path)];
        newParent.children[baseName(newPath)] = node;
        saveFs();
        return { ok: true };
      },
      search: async (dir, query, limit) => search(dir, query, limit),
      home: async () => '/home/dev',
      pickFolder: async () => '/home/dev/projects',
    },

    sh: {
      launch: async (app) => {
        emit('mock:launch', app);
        return { ok: true, message: `Browser preview — on Windows this launches the real app: ${app}` };
      },
      openExternal: async (url) => { window.open(url, '_blank', 'noopener'); return { ok: true }; },
      openPath: async (path) => { emit('mock:launch', `open ${path}`); return { ok: true, message: `Preview: would open ${path}` }; },
      showInFolder: async (path) => { emit('mock:launch', `reveal ${path}`); return { ok: true }; },
      detect: async () => ({ platform: 'browser', vscode: true, wt: true, git: true, gitbash: true, docker: true, node: true, npm: true, taskmgr: true }),
    },

    term: {
      exec: async (sessionId, command) => mockExec(sessionId, command),
      kill: async () => ({ ok: true }),
      cwd: async (sessionId, setCwd) => {
        if (setCwd) mockCwd.set(sessionId, norm(setCwd));
        return { cwd: mockCwd.get(sessionId) || '/home/dev' };
      },
    },

    git: {
      status: async () => ({
        ok: true,
        branch: 'main',
        ahead: 0,
        behind: 0,
        entries: [
          { x: 'M', y: ' ', path: 'src/index.js' },
          { x: '?', y: ' ', path: 'notes.txt' },
        ],
      }),
      log: async () => ({
        ok: true,
        commits: [
          { hash: 'a1b2c3d', subject: 'feat: add devmode HUD stats', author: 'DevOS User', date: '2 hours ago' },
          { hash: 'e4f5a6b', subject: 'fix: terminal autocomplete ghost text', author: 'DevOS User', date: 'yesterday' },
          { hash: '7890bcd', subject: 'chore: bump electron', author: 'DevOS User', date: '3 days ago' },
        ],
      }),
      run: async (cwd, args) => ({
        code: 0,
        stdout: `[preview] git ${args.join(' ')} — real git runs inside the Electron app\r\n`,
        stderr: '',
      }),
    },

    tool: {
      run: async (tool, args) => {
        if (tool === 'docker' && args[0] === '--version') {
          return { code: 0, stdout: 'Docker version 27.3.1, build ce12230 (simulated)\r\n', stderr: '' };
        }
        if (tool === 'docker' && args[0] === 'ps') {
          return {
            code: 0,
            stdout: [
              ['CONTAINER ID', 'IMAGE', 'STATUS', 'PORTS', 'NAMES'],
              ['9f3ce2a71b04', 'postgres:16', 'Up 3 hours', '5432->5432', 'devos-db'],
              ['c81a07d4e9f2', 'redis:7-alpine', 'Up 3 hours', '6379->6379', 'devos-cache'],
              ['42be8c05aa13', 'node:20', 'Exited (0)', '', 'ci-runner'],
            ].map((r) => r.join('\t')).join('\r\n'),
            stderr: '',
          };
        }
        if (tool === 'docker' && args[0] === 'images') {
          return {
            code: 0,
            stdout: [
              ['REPOSITORY', 'TAG', 'SIZE'],
              ['postgres', '16', '431MB'],
              ['redis', '7-alpine', '41MB'],
              ['node', '20', '1.1GB'],
            ].map((r) => r.join('\t')).join('\r\n'),
            stderr: '',
          };
        }
        return { code: 0, stdout: `[preview] ${tool} ${args.join(' ')} (simulated)\r\n`, stderr: '' };
      },
    },

    cfg: {
      get: async () => cfgGet(),
      set: async (patch) => cfgSet(patch),
    },

    win: {
      controls: async () => ({ ok: false, message: 'Window controls require the Electron app' }),
    },

    app: {
      version: async () => ({ version: '1.0.0-preview', electron: 'preview' }),
      quit: async () => { emit('mock:launch', 'quit'); },
      notify: async (title, body) => { emit('mock:notify', { title, body }); return { ok: true, native: false }; },
    },

    onSysStats: (cb) => { ensureStatsTimer(); statsSubs.add(cb); return () => statsSubs.delete(cb); },
    onTermData: (cb) => { listenerBus.data.add(cb); return () => listenerBus.data.delete(cb); },
    onTermExit: (cb) => { listenerBus.exit.add(cb); return () => listenerBus.exit.delete(cb); },
  };
}

export { state as mockState };
