// DevOS — Developer Mode HUD.
// Terminal-heavy top bar: live CPU/RAM/disk, network status, git branch of the
// active project, quick actions and keyboard shortcut hints.

import { devos } from '../core/bridge.js';
import { state, set, on } from '../core/state.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { openApp } from '../apps/registry.js';

let hudEl = null;
let unsub = null;
let gitTimer = null;

export function initHud() {
  hudEl = document.getElementById('hud');
  hudEl.innerHTML = `
    <div class="hud-cell"><span class="hud-brand">DEV-MODE</span></div>
    <div class="hud-cell" data-cell="cpu">${icon('cpu')}<span>CPU</span><b class="kpi">--%</b></div>
    <div class="hud-cell" data-cell="ram">${icon('ram')}<span>RAM</span><b class="kpi">--%</b></div>
    <div class="hud-cell optional" data-cell="disk">${icon('disk')}<span>DISK</span><b class="kpi">--%</b></div>
    <div class="hud-cell optional" data-cell="net">${icon('net')}<span>NET</span><b class="kpi">--</b></div>
    <div class="hud-cell optional" data-cell="git">${icon('branch')}<span class="hud-branch">no repo</span></div>
    <div class="hud-actions">
      <button class="hud-btn" data-act="terminal">terminal</button>
      <button class="hud-btn" data-act="run">npm run dev</button>
      <button class="hud-btn" data-act="git">git status</button>
      <button class="hud-btn" data-act="files">files</button>
      <button class="hud-btn" data-act="vscode">vscode</button>
    </div>
  `;

  hudEl.querySelector('[data-act="terminal"]').addEventListener('click', () => openApp('terminal'));
  hudEl.querySelector('[data-act="run"]').addEventListener('click', () => runQuickCommand('npm run dev'));
  hudEl.querySelector('[data-act="git"]').addEventListener('click', () => runQuickCommand('git status'));
  hudEl.querySelector('[data-act="files"]').addEventListener('click', () => openApp('files'));
  hudEl.querySelector('[data-act="vscode"]').addEventListener('click', async () => {
    const r = await devos.sh.launch('vscode', state.activeProject || undefined);
    if (!r.ok) toast('VS Code', r.message, 'err');
    else toast('VS Code', r.message || 'Launching…', 'ok');
  });

  on('change:developerMode', (enabled) => setDevMode(enabled));
  if (state.developerMode) setDevMode(true);
}

function setDevMode(enabled) {
  document.body.classList.toggle('dev-mode', enabled);
  hudEl.classList.toggle('hidden', !enabled);
  if (enabled) {
    startStats();
    startGitWatcher();
  } else {
    unsub?.();
    unsub = null;
    devos.sys.unsubscribe?.().catch(() => {});
    clearInterval(gitTimer);
    gitTimer = null;
  }
}

function startStats() {
  if (unsub) return;
  devos.sys.subscribe().catch(() => {});
  unsub = devos.onSysStats((s) => renderStats(s));
}

function renderStats(s) {
  const cpuCell = hudEl.querySelector('[data-cell="cpu"]');
  const ramCell = hudEl.querySelector('[data-cell="ram"]');
  const diskCell = hudEl.querySelector('[data-cell="disk"]');
  const netCell = hudEl.querySelector('[data-cell="net"]');
  if (!cpuCell) return;

  const cpu = Math.round(s.cpuPercent);
  cpuCell.querySelector('.kpi').textContent = `${cpu}%`;
  cpuCell.classList.toggle('hot', cpu > 60);
  cpuCell.classList.toggle('critical', cpu > 85);

  const memPct = Math.round((s.memUsed / s.memTotal) * 100);
  ramCell.querySelector('.kpi').textContent = `${memPct}%`;
  ramCell.classList.toggle('hot', memPct > 75);
  ramCell.classList.toggle('critical', memPct > 90);

  const drive = (s.drives || [])[0];
  if (drive && drive.total > 0) {
    const used = Math.round(((drive.total - drive.free) / drive.total) * 100);
    diskCell.querySelector('.kpi').textContent = `${used}%`;
    diskCell.classList.toggle('hot', used > 85);
    diskCell.classList.toggle('critical', used > 95);
  }

  const upCount = (s.network || []).filter((n) => n.up && !n.internal).length;
  const kpi = netCell.querySelector('.kpi');
  kpi.textContent = upCount > 0 ? 'online' : 'offline';
  netCell.classList.toggle('critical', upCount === 0);
}

function startGitWatcher() {
  clearInterval(gitTimer);
  const update = async () => {
    const cell = hudEl.querySelector('[data-cell="git"] .hud-branch');
    if (!cell) return;
    const dir = state.activeProject;
    if (!dir) { cell.textContent = 'no project'; return; }
    const st = await devos.git.status(dir).catch(() => null);
    if (st?.ok) {
      const dirty = st.entries.length ? ` ±${st.entries.length}` : '';
      cell.textContent = `⎇ ${st.branch}${dirty}`;
    } else {
      cell.textContent = 'no repo';
    }
  };
  update();
  gitTimer = setInterval(update, 10000);
  on('change:activeProject', update);
}

async function runQuickCommand(cmd) {
  const win = openApp('terminal', { runCommand: cmd });
  if (!win) toast('Terminal', 'Could not open terminal', 'err');
}
