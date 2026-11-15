// DevOS — Git panel: branch, status, log, quick actions, output console.

import { devos } from '../core/bridge.js';
import { state, set } from '../core/state.js';
import { icon } from '../ui/icons.js';
import { createWindow } from '../wm/wm.js';
import { toast } from '../ui/toast.js';

let gitCounter = 0;

export function openGitWindow(opts = {}) {
  gitCounter += 1;

  const root = document.createElement('div');
  root.className = 'git-wrap';

  root.innerHTML = `
    <div class="app-toolbar">
      <input type="text" data-region="repo" placeholder="repository path…" style="flex:1;min-width:140px;" />
      <button class="btn small" data-act="browse">${icon('folder')} browse</button>
      <button class="btn small" data-act="refresh">${icon('refresh')} refresh</button>
      <div class="chip" data-region="branch">${icon('branch')} —</div>
      <div class="chip" data-region="sync">sync —</div>
    </div>
    <div class="tm-tabs">
      <div class="tm-tab active" data-tab="status">Status</div>
      <div class="tm-tab" data-tab="log">Log</div>
    </div>
    <div class="git-list" data-body="status"></div>
    <div class="git-list hidden" data-body="log"></div>
    <div class="app-toolbar" style="border-top:1px solid var(--border);border-bottom:none;">
      <input type="text" data-region="msg" placeholder="commit message…" style="flex:1;min-width:120px;" />
      <button class="btn small" data-act="commit">${icon('check')} commit -a</button>
      <button class="btn small" data-act="pull">${icon('download')} pull</button>
      <button class="btn small" data-act="push">${icon('upload')} push</button>
      <button class="btn small" data-act="fetch">${icon('refresh')} fetch</button>
      <button class="btn small" data-act="gitbash">${icon('terminal')} git bash</button>
    </div>
    <div class="git-console" data-region="console"></div>
  `;

  const regions = {
    repo: root.querySelector('[data-region="repo"]'),
    branch: root.querySelector('[data-region="branch"]'),
    sync: root.querySelector('[data-region="sync"]'),
    status: root.querySelector('[data-body="status"]'),
    log: root.querySelector('[data-body="log"]'),
    console: root.querySelector('[data-region="console"]'),
    msg: root.querySelector('[data-region="msg"]'),
  };

  const win = createWindow({
    id: `git-${gitCounter}`,
    title: 'Git',
    iconName: 'git',
    width: 720,
    height: 560,
    minW: 540,
    minH: 380,
    singleton: true,
    content: root,
  });

  let cwd = opts.dir || state.activeProject || '';

  function logLine(text, cls = '') {
    const line = document.createElement('div');
    line.className = cls;
    line.textContent = text;
    regions.console.appendChild(line);
    regions.console.scrollTop = regions.console.scrollHeight;
    while (regions.console.children.length > 300) regions.console.firstChild.remove();
  }

  function logCmd(args) {
    logLine(`$ git ${args.join(' ')}`, 'cmd');
  }

  async function run(args, { quiet = false } = {}) {
    if (!cwd) return { code: -1, stdout: '', stderr: 'no repository selected' };
    if (!quiet) logCmd(args);
    const res = await devos.git.run(cwd, args);
    if (res.stdout?.trim()) logLine(res.stdout.trimEnd());
    if (res.stderr?.trim()) logLine(res.stderr.trimEnd(), 'err');
    if (res.code === 0 && !quiet) logLine('(ok)', 'cmd');
    return res;
  }

  async function refresh() {
    if (!cwd) {
      regions.branch.innerHTML = `${icon('branch')} no repo`;
      regions.sync.textContent = 'pick a repository';
      return;
    }
    regions.repo.value = cwd;
    const st = await devos.git.status(cwd).catch(() => null);
    if (!st || !st.ok) {
      regions.branch.innerHTML = `${icon('branch')} —`;
      regions.sync.textContent = st?.notRepo ? 'not a git repository' : 'git unavailable';
      regions.status.innerHTML = `<div class="app-empty">${icon('git')} ${st?.notRepo ? 'this folder is not a git repository' : 'git is not available'}</div>`;
      regions.log.innerHTML = '';
      return;
    }
    set({ activeProject: cwd });
    devos.cfg.set({ activeProject: cwd }).catch(() => {});

    regions.branch.innerHTML = `${icon('branch')} ${st.branch}`;
    regions.sync.textContent = st.ahead || st.behind ? `↑${st.ahead} ↓${st.behind}` : 'up to date';
    regions.sync.className = `chip ${st.ahead || st.behind ? 'warn' : 'ok'}`;

    regions.status.innerHTML = '';
    if (!st.entries.length) {
      regions.status.innerHTML = `<div class="app-empty">${icon('check')} working tree clean</div>`;
    } else {
      for (const e of st.entries) {
        const row = document.createElement('div');
        row.className = 'git-status-row';
        const staged = e.x !== ' ' && e.x !== '?';
        const untracked = e.x === '?' || e.y === '?';
        row.innerHTML = `
          <span class="git-badge ${staged ? 'staged' : untracked ? 'untracked' : ''}">${e.x === ' ' ? e.y : e.x}</span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></span>`;
        row.querySelector('span:last-child').textContent = e.path;
        regions.status.appendChild(row);
      }
    }

    const lg = await devos.git.log(cwd, 20).catch(() => null);
    regions.log.innerHTML = '';
    if (lg?.ok) {
      for (const c of lg.commits) {
        const row = document.createElement('div');
        row.className = 'git-log-row';
        row.innerHTML = `<span class="h">${c.hash}</span><span class="s"></span><span class="dim">${c.date}</span>`;
        row.querySelector('.s').textContent = c.subject;
        regions.log.appendChild(row);
      }
    } else {
      regions.log.innerHTML = `<div class="app-empty">${icon('commit')} no commits yet</div>`;
    }
  }

  root.querySelectorAll('.tm-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      root.querySelectorAll('.tm-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      regions.status.classList.toggle('hidden', tab.dataset.tab !== 'status');
      regions.log.classList.toggle('hidden', tab.dataset.tab !== 'log');
    });
  });

  regions.repo.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      cwd = regions.repo.value.trim();
      refresh();
    }
  });

  root.querySelector('[data-act="browse"]').addEventListener('click', async () => {
    const dir = await devos.fs.pickFolder('Select git repository');
    if (dir) { cwd = dir; refresh(); }
  });
  root.querySelector('[data-act="refresh"]').addEventListener('click', refresh);
  root.querySelector('[data-act="commit"]').addEventListener('click', async () => {
    const msg = regions.msg.value.trim();
    if (!msg) { toast('Git', 'Enter a commit message first', 'err'); return; }
    await run(['add', '-A']);
    await run(['commit', '-m', msg]);
    regions.msg.value = '';
    refresh();
  });
  root.querySelector('[data-act="pull"]').addEventListener('click', () => run(['pull']).then(refresh));
  root.querySelector('[data-act="push"]').addEventListener('click', () => run(['push']).then(refresh));
  root.querySelector('[data-act="fetch"]').addEventListener('click', () => run(['fetch', '--all']).then(refresh));
  root.querySelector('[data-act="gitbash"]').addEventListener('click', async () => {
    const res = await devos.sh.launch('git', cwd);
    if (!res.ok) toast('Git', `${res.message}${res.hint ? ` — ${res.hint}` : ''}`, 'err', 7000);
  });

  logLine('DevOS git console ready.', 'cmd');
  refresh();

  return win;
}
