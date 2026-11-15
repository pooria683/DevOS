// DevOS — Task Manager: live system stats with sparklines + process table
// with End Task, plus a shortcut to the real Windows Task Manager.

import { devos } from '../core/bridge.js';
import { icon } from '../ui/icons.js';
import { createWindow } from '../wm/wm.js';
import { toast } from '../ui/toast.js';
import { listWindows } from '../wm/wm.js';

const HISTORY = 60; // samples per sparkline

let tmCounter = 0;

export function openTaskManagerWindow() {
  tmCounter += 1;

  const root = document.createElement('div');
  root.style.cssText = 'flex:1;display:flex;flex-direction:column;min-height:0;';

  root.innerHTML = `
    <div class="tm-tabs">
      <div class="tm-tab active" data-tab="system">System</div>
      <div class="tm-tab" data-tab="processes">Processes</div>
      <div class="tm-tab" data-tab="windows">DevOS windows</div>
      <div style="flex:1;"></div>
      <div style="padding:5px 8px;"><button class="btn small" data-act="real">${icon('external')} taskmgr.exe</button></div>
    </div>
    <div class="tm-body" data-body="system">
      <div class="tm-cards">
        <div class="tm-card" data-card="cpu">
          <div class="h"><span>CPU</span><span class="dim" data-sub></span></div>
          <div class="v"><span data-val>0</span><small>%</small></div>
          <canvas></canvas>
        </div>
        <div class="tm-card" data-card="ram">
          <div class="h"><span>Memory</span><span class="dim" data-sub></span></div>
          <div class="v"><span data-val>0</span><small>%</small></div>
          <canvas></canvas>
        </div>
        <div class="tm-card" data-card="disk">
          <div class="h"><span>Disk</span><span class="dim" data-sub></span></div>
          <div class="v"><span data-val>0</span><small>%</small></div>
          <canvas></canvas>
        </div>
        <div class="tm-card" data-card="net">
          <div class="h"><span>Network</span><span class="dim" data-sub></span></div>
          <div class="v"><span data-val>0</span><small>up</small></div>
          <canvas></canvas>
        </div>
      </div>
      <div class="tm-drives" data-region="drives"></div>
    </div>
    <div class="tm-body hidden" data-body="processes">
      <div class="app-toolbar" style="border:none;padding:0 0 8px;">
        <input type="search" placeholder="filter processes…" data-region="procfilter" />
        <button class="btn small" data-act="refresh-proc">${icon('refresh')} refresh</button>
        <button class="btn small danger" data-act="kill">${icon('stop')} end task</button>
      </div>
      <div style="flex:1;overflow:auto;">
        <table class="tm-table">
          <thead><tr>
            <th data-sort="pid">PID</th><th data-sort="name">Name</th>
            <th class="num" data-sort="cpu">CPU %</th><th class="num" data-sort="mem">Memory</th>
          </tr></thead>
          <tbody data-region="procrows"></tbody>
        </table>
      </div>
    </div>
    <div class="tm-body hidden" data-body="windows">
      <div data-region="devoswins"></div>
    </div>
    <div class="app-footer">
      <span data-region="uptime">uptime —</span>
      <span data-region="updated"></span>
    </div>
  `;

  const win = createWindow({
    id: `taskmgr-${tmCounter}`,
    title: 'Task Manager',
    iconName: 'gauge',
    width: 760,
    height: 520,
    minW: 560,
    minH: 380,
    singleton: true,
    content: root,
  });

  // ---- sparkline state ----
  const hist = { cpu: [], ram: [], disk: [], net: [] };
  let selectedPid = null;
  let sortKey = 'mem';
  let sortDir = -1;
  let processes = [];
  let pollTimer = null;

  const canvases = {};
  root.querySelectorAll('.tm-card').forEach((card) => {
    canvases[card.dataset.card] = card.querySelector('canvas');
  });

  function drawSpark(card, data) {
    const canvas = canvases[card];
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 140;
    const h = canvas.clientHeight || 34;
    if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (data.length < 2) return;
    const accent = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#22d3ee';
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = (i / (HISTORY - 1)) * w;
      const y = h - (Math.min(100, v) / 100) * (h - 3) - 1.5;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = `${accent}18`;
    ctx.fill();
  }

  function renderStats(s) {
    hist.cpu.push(s.cpuPercent);
    hist.ram.push((s.memUsed / s.memTotal) * 100);
    const drive = (s.drives || [])[0];
    hist.disk.push(drive && drive.total ? ((drive.total - drive.free) / drive.total) * 100 : 0);
    hist.net.push((s.network || []).filter((n) => n.up && !n.internal).length);
    for (const k of Object.keys(hist)) {
      while (hist[k].length > HISTORY) hist[k].shift();
    }

    root.querySelector('[data-card="cpu"] [data-val]').textContent = Math.round(s.cpuPercent);
    root.querySelector('[data-card="cpu"] [data-sub]').textContent = `${s.cpuCores} cores`;
    root.querySelector('[data-card="ram"] [data-val]').textContent = Math.round((s.memUsed / s.memTotal) * 100);
    root.querySelector('[data-card="ram"] [data-sub]').textContent = `${(s.memUsed / 1073741824).toFixed(1)} / ${(s.memTotal / 1073741824).toFixed(1)} GB`;
    root.querySelector('[data-card="disk"] [data-val]').textContent = Math.round(hist.disk.at(-1) || 0);
    root.querySelector('[data-card="net"] [data-val]').textContent = hist.net.at(-1) || 0;

    for (const k of ['cpu', 'ram', 'disk', 'net']) drawSpark(k, hist[k]);

    const uptime = s.uptime || 0;
    const d = Math.floor(uptime / 86400);
    const h = Math.floor((uptime % 86400) / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    root.querySelector('[data-region="uptime"]').textContent = `uptime ${d ? `${d}d ` : ''}${h}h ${m}m`;
    root.querySelector('[data-region="updated"]').textContent = `updated ${new Date().toLocaleTimeString()}`;

    const drivesHost = root.querySelector('[data-region="drives"]');
    drivesHost.innerHTML = (s.drives || []).map((d) => {
      const pct = d.total ? Math.round(((d.total - d.free) / d.total) * 100) : 0;
      return `<div class="tm-drive"><span>${d.id}</span><div class="bar"><i style="width:${pct}%"></i></div><span class="dim">${pct}% used · ${((d.free || 0) / 1073741824).toFixed(0)} GB free</span></div>`;
    }).join('');
  }

  function startStats() {
    devos.sys.subscribe().catch(() => {});
  }
  const statsHandler = (s) => {
    if (win.minimized) return;
    renderStats(s);
  };

  // ---- processes ----
  async function loadProcesses() {
    processes = await devos.sys.processes().catch(() => []);
    renderProcesses();
  }

  function renderProcesses() {
    const filter = (root.querySelector('[data-region="procfilter"]').value || '').toLowerCase();
    const rows = processes
      .filter((p) => !filter || p.name.toLowerCase().includes(filter) || String(p.pid).includes(filter))
      .sort((a, b) => {
        const av = sortKey === 'name' ? a.name.toLowerCase() : (a[sortKey] || 0);
        const bv = sortKey === 'name' ? b.name.toLowerCase() : (b[sortKey] || 0);
        return (av > bv ? 1 : av < bv ? -1 : 0) * sortDir;
      })
      .slice(0, 400);

    const tbody = root.querySelector('[data-region="procrows"]');
    tbody.innerHTML = '';
    for (const p of rows) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${p.pid}</td><td></td><td class="num">${p.cpu ?? '—'}</td><td class="num">${fmtMem(p.mem)}</td>`;
      tr.querySelector('td:nth-child(2)').textContent = p.name;
      if (p.pid === selectedPid) tr.style.background = 'var(--accent-soft)';
      tr.addEventListener('click', () => {
        selectedPid = p.pid;
        tbody.querySelectorAll('tr').forEach((r) => (r.style.background = ''));
        tr.style.background = 'var(--accent-soft)';
      });
      tbody.appendChild(tr);
    }
  }

  function fmtMem(bytesOrPct) {
    if (bytesOrPct == null) return '—';
    if (bytesOrPct > 1024) return `${(bytesOrPct / 1048576).toFixed(0)} MB`; // windows: bytes
    return `${bytesOrPct.toFixed(1)} %`; // unix: percent
  }

  // ---- tabs ----
  root.querySelectorAll('.tm-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      root.querySelectorAll('.tm-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      root.querySelectorAll('.tm-body').forEach((b) => b.classList.add('hidden'));
      root.querySelector(`[data-body="${tab.dataset.tab}"]`).classList.remove('hidden');
      if (tab.dataset.tab === 'processes') loadProcesses();
      if (tab.dataset.tab === 'windows') renderDevosWindows();
    });
  });

  function renderDevosWindows() {
    const host = root.querySelector('[data-region="devoswins"]');
    const wins = listWindows();
    host.innerHTML = `
      <table class="tm-table">
        <thead><tr><th>Title</th><th>State</th><th style="width:80px;"></th></tr></thead>
        <tbody>${wins.map((w) => `
          <tr><td>${w.title}</td><td>${w.minimized ? 'minimized' : w.focused ? 'focused' : 'open'}</td>
          <td><button class="btn small danger" data-close="${w.id}">close</button></td></tr>`).join('') || '<tr><td colspan="3" class="dim">no windows open</td></tr>'}
        </tbody>
      </table>`;
    host.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => {
        import('../wm/wm.js').then((m) => m.getWindow(btn.dataset.close)?.close());
        setTimeout(renderDevosWindows, 250);
      });
    });
  }

  // ---- actions ----
  root.querySelector('[data-act="real"]').addEventListener('click', async () => {
    const res = await devos.sh.launch('taskmgr');
    if (!res.ok) toast('Task Manager', res.message, 'err');
    else toast('Task Manager', 'Launching Windows Task Manager…', 'ok');
  });
  root.querySelector('[data-act="refresh-proc"]').addEventListener('click', loadProcesses);
  root.querySelector('[data-act="kill"]').addEventListener('click', async () => {
    if (!selectedPid) { toast('Task Manager', 'Select a process first', 'err'); return; }
    const res = await devos.sys.kill(selectedPid);
    toast('Task Manager', res.ok ? `Terminated PID ${selectedPid}` : (res.message || 'Failed'), res.ok ? 'ok' : 'err');
    selectedPid = null;
    loadProcesses();
  });
  root.querySelectorAll('th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      sortDir = sortKey === key ? -sortDir : -1;
      sortKey = key;
      renderProcesses();
    });
  });

  // ---- lifecycle ----
  devos.onSysStats(statsHandler);
  startStats();
  pollTimer = setInterval(() => {
    if (!win.minimized && !root.querySelector('[data-body="processes"]').classList.contains('hidden')) {
      loadProcesses();
    }
  }, 4000);

  const origClose = win.close.bind(win);
  win.close = () => {
    clearInterval(pollTimer);
    devos.sys.unsubscribe().catch(() => {});
    origClose();
  };

  return win;
}
