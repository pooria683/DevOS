// DevOS — Docker panel: version, containers, images, Docker Desktop launcher.

import { devos } from '../core/bridge.js';
import { icon } from '../ui/icons.js';
import { createWindow } from '../wm/wm.js';
import { toast } from '../ui/toast.js';

let dockCounter = 0;

export function openDockerWindow() {
  dockCounter += 1;

  const root = document.createElement('div');
  root.className = 'dock-wrap';

  root.innerHTML = `
    <div class="dock-status">
      <span class="chip" data-region="status">checking docker…</span>
      <span data-region="version" class="dim"></span>
      <div style="flex:1;"></div>
      <button class="btn small" data-act="refresh">${icon('refresh')} refresh</button>
      <button class="btn small" data-act="desktop">${icon('external')} Docker Desktop</button>
    </div>
    <div class="tm-tabs">
      <div class="tm-tab active" data-tab="ps">Containers</div>
      <div class="tm-tab" data-tab="images">Images</div>
    </div>
    <div style="flex:1;overflow:auto;" data-region="table-host"></div>
    <div class="app-toolbar" style="border-top:1px solid var(--border);border-bottom:none;gap:6px;">
      <span class="faint mono" style="font-size:10.5px;">select a container:</span>
      <button class="btn small" data-act="start">${icon('play')} start</button>
      <button class="btn small" data-act="stop">${icon('stop')} stop</button>
      <button class="btn small" data-act="logs">${icon('fileText')} logs</button>
      <input type="text" data-region="cid" placeholder="container id" style="width:130px;" />
    </div>
  `;

  const statusChip = root.querySelector('[data-region="status"]');
  const versionEl = root.querySelector('[data-region="version"]');
  const tableHost = root.querySelector('[data-region="table-host"]');
  const cidInput = root.querySelector('[data-region="cid"]');

  const win = createWindow({
    id: `docker-${dockCounter}`,
    title: 'Docker',
    iconName: 'docker',
    width: 780,
    height: 480,
    minW: 560,
    minH: 340,
    singleton: true,
    content: root,
  });

  let available = false;
  let currentTab = 'ps';
  let selectedRow = null;

  function renderTable(headers, rows, selectable = false) {
    tableHost.innerHTML = `
      <table class="dock-table">
        <thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${rows.length
          ? rows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')
          : `<tr><td colspan="${headers.length}" class="dim" style="padding:16px;">nothing to show</td></tr>`}</tbody>
      </table>`;
    if (selectable) {
      tableHost.querySelectorAll('tbody tr').forEach((tr) => {
        tr.addEventListener('click', () => {
          tableHost.querySelectorAll('tbody tr').forEach((r) => (r.style.background = ''));
          tr.style.background = 'var(--accent-soft)';
          selectedRow = tr.firstChild.textContent;
          cidInput.value = selectedRow;
        });
      });
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderOutput(title, text) {
    renderTable([title], text.trim() ? text.trim().split(/\r?\n/).map((l) => [l]) : []);
  }

  async function runDocker(args) {
    return devos.tool.run('docker', args);
  }

  async function refresh() {
    statusChip.textContent = 'checking docker…';
    statusChip.className = 'chip';
    versionEl.textContent = '';

    const ver = await runDocker(['--version']);
    available = ver.code === 0 && !ver.error;
    if (!available) {
      statusChip.textContent = 'docker not detected';
      statusChip.className = 'chip err';
      versionEl.textContent = ver.stderr || '';
      renderTable('Docker', ['Docker is not installed or not running on this system.'].map((t) => [t]));
      return;
    }
    statusChip.textContent = 'docker running';
    statusChip.className = 'chip ok';
    versionEl.textContent = ver.stdout.trim();

    if (currentTab === 'ps') await loadContainers();
    else await loadImages();
  }

  async function loadContainers() {
    const res = await runDocker(['ps', '-a', '--format', '{{.ID}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}\t{{.Names}}']);
    if (res.code !== 0) {
      renderTable('Error', [(res.stderr || 'docker ps failed').split('\n')].map((t) => [t]));
      return;
    }
    const rows = res.stdout.trim().split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'));
    renderTable(['Container ID', 'Image', 'Status', 'Ports', 'Names'], rows, true);
  }

  async function loadImages() {
    const res = await runDocker(['images', '--format', '{{.Repository}}\t{{.Tag}}\t{{.Size}}']);
    if (res.code !== 0) {
      renderTable('Error', [(res.stderr || 'docker images failed')].map((t) => [t]));
      return;
    }
    const rows = res.stdout.trim().split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'));
    renderTable(['Repository', 'Tag', 'Size'], rows);
  }

  root.querySelectorAll('.tm-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      root.querySelectorAll('.tm-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      currentTab = tab.dataset.tab;
      refresh();
    });
  });

  root.querySelector('[data-act="refresh"]').addEventListener('click', refresh);
  root.querySelector('[data-act="desktop"]').addEventListener('click', async () => {
    const res = await devos.sh.launch('docker');
    if (!res.ok) toast('Docker', `${res.message}${res.hint ? ` — ${res.hint}` : ''}`, 'err', 7000);
    else toast('Docker', res.message || 'Launching Docker Desktop…', 'ok');
  });

  const containerAction = async (sub) => {
    const cid = cidInput.value.trim();
    if (!cid) { toast('Docker', 'Select a container first', 'err'); return; }
    if (sub === 'logs') {
      const res = await runDocker(['logs', '--tail', '50', cid]);
      renderOutput(`logs ${cid}`, res.stdout || res.stderr || '(no output)');
      return;
    }
    const res = await runDocker([sub, cid]);
    toast('Docker', res.code === 0 ? `${sub} ${cid} — ok` : (res.stderr || `${sub} failed`), res.code === 0 ? 'ok' : 'err');
    refresh();
  };

  root.querySelector('[data-act="start"]').addEventListener('click', () => containerAction('start'));
  root.querySelector('[data-act="stop"]').addEventListener('click', () => containerAction('stop'));
  root.querySelector('[data-act="logs"]').addEventListener('click', () => containerAction('logs'));

  refresh();

  return win;
}
