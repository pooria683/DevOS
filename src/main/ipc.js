'use strict';

const { ipcMain, shell, dialog, app, Notification, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec, kill, getCwd, closeSession, runTool } = require('./exec');
const launcher = require('./launcher');
const stats = require('./stats');

const isSafePath = (p) => typeof p === 'string' && p.length > 0 && p.length < 4096 && !p.includes('\0');

function asDir(p) {
  if (!isSafePath(p)) return os.homedir();
  try {
    return fs.statSync(p).isDirectory() ? p : path.dirname(p);
  } catch {
    return os.homedir();
  }
}

function listDir(dir) {
  const root = asDir(dir);
  const raw = fs.readdirSync(root, { withFileTypes: true });
  const entries = [];
  for (const e of raw) {
    const full = path.join(root, e.name);
    let type = e.isDirectory() ? 'dir' : 'file';
    let size = 0;
    let mtime = 0;
    try {
      const st = fs.statSync(full);
      if (!e.isDirectory() && !e.isFile()) continue; // skip sockets etc.
      type = st.isDirectory() ? 'dir' : 'file';
      size = st.size;
      mtime = st.mtimeMs;
    } catch {
      // Unreadable entry (permission) — still list it, stat as unknown.
    }
    entries.push({
      name: e.name,
      path: full,
      type,
      size,
      mtime,
      ext: type === 'file' ? path.extname(e.name).slice(1).toLowerCase() : '',
    });
  }
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
  return { path: root, entries };
}

function searchDir(dir, query, limit = 60) {
  const root = asDir(dir);
  const q = String(query || '').toLowerCase();
  if (!q) return [];
  const results = [];
  const queue = [root];
  const maxDepth = 6;
  while (queue.length && results.length < limit) {
    const current = queue.shift();
    const depth = current.slice(root.length).split(/[\\/]/).filter(Boolean).length;
    if (depth > maxDepth) continue;
    let dirents;
    try {
      dirents = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of dirents) {
      if (results.length >= limit) break;
      const full = path.join(current, e.name);
      if (e.name.toLowerCase().includes(q)) {
        results.push({ name: e.name, path: full, type: e.isDirectory() ? 'dir' : 'file' });
      }
      if (e.isDirectory()) queue.push(full);
    }
  }
  return results;
}

function registerIpc(ctx) {
  const { config, getStatsService, setStatsService, getWindow } = ctx;

  // ---------- system ----------
  ipcMain.handle('sys:info', () => stats.basicInfo());

  ipcMain.handle('sys:stats:subscribe', (e) => {
    const wc = e.sender;
    let service = getStatsService();
    if (!service) {
      let prev = stats.cpuTimes();
      let timer = null;
      let refs = 0;
      let driveSeed = [];
      let lastDriveAt = 0;
      const tick = async () => {
        const snap = stats.snapshot({ cpu: prev });
        prev = stats.cpuTimes();
        snap.drives = driveSeed.length ? driveSeed : snap.drives;
        try { wc.send('sys:stats', snap); } catch { /* window closed */ }
        if (Date.now() - lastDriveAt > 20000) {
          lastDriveAt = Date.now();
          driveSeed = await stats.drives(true);
        }
      };
      service = {
        subscribe() {
          refs += 1;
          if (!timer) {
            lastDriveAt = 0;
            tick();
            timer = setInterval(tick, 1000);
          }
        },
        unsubscribe() {
          refs -= 1;
          if (refs <= 0 && timer) { clearInterval(timer); timer = null; refs = 0; }
        },
      };
      setStatsService(service);
    }
    service.subscribe();
    return { ok: true };
  });

  ipcMain.handle('sys:stats:unsubscribe', () => {
    getStatsService()?.unsubscribe();
    return { ok: true };
  });

  ipcMain.handle('sys:processes', () => stats.processes());
  ipcMain.handle('sys:kill', (_e, { pid } = {}) => stats.killProcess(pid));
  ipcMain.handle('sys:drives', () => stats.drives(true));

  // ---------- filesystem ----------
  ipcMain.handle('fs:list', (_e, { dir } = {}) => listDir(dir));
  ipcMain.handle('fs:home', () => os.homedir());

  ipcMain.handle('fs:read', (_e, { path: p, max = 262144 } = {}) => {
    if (!isSafePath(p)) throw new Error('Invalid path');
    const st = fs.statSync(p);
    if (st.isDirectory()) throw new Error('Is a directory');
    const fd = fs.openSync(p, 'r');
    try {
      const len = Math.min(st.size, Math.max(1, Math.min(1048576, Number(max) || 262144)));
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, 0);
      return { path: p, content: buf.toString('utf8'), truncated: st.size > len, size: st.size };
    } finally {
      fs.closeSync(fd);
    }
  });

  ipcMain.handle('fs:write', (_e, { path: p, content = '' } = {}) => {
    if (!isSafePath(p)) throw new Error('Invalid path');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, String(content ?? ''), 'utf8');
    return { ok: true };
  });

  ipcMain.handle('fs:mkdir', (_e, { path: p } = {}) => {
    if (!isSafePath(p)) throw new Error('Invalid path');
    fs.mkdirSync(p, { recursive: true });
    return { ok: true };
  });

  ipcMain.handle('fs:delete', (_e, { path: p, recursive = true } = {}) => {
    if (!isSafePath(p)) throw new Error('Invalid path');
    fs.rmSync(p, { recursive: !!recursive, force: true });
    return { ok: true };
  });

  ipcMain.handle('fs:rename', (_e, { path: p, newPath } = {}) => {
    if (!isSafePath(p) || !isSafePath(newPath)) throw new Error('Invalid path');
    fs.renameSync(p, newPath);
    return { ok: true };
  });

  ipcMain.handle('fs:search', (_e, { dir, query, limit } = {}) => searchDir(dir, query, limit));

  ipcMain.handle('fs:pickFolder', async (e, { title } = {}) => {
    const win = BrowserWindow.fromWebContents(e.sender) || getWindow();
    const res = await dialog.showOpenDialog(win, {
      title: String(title || 'Select folder'),
      defaultPath: os.homedir(),
      properties: ['openDirectory'],
    });
    return res.canceled ? null : res.filePaths[0];
  });

  // ---------- shell / real app integration ----------
  ipcMain.handle('sh:launch', (_e, { app: appKey, arg } = {}) => launcher.launch(String(appKey || ''), arg));
  ipcMain.handle('sh:detect', () => launcher.detect());

  ipcMain.handle('sh:openExternal', (_e, { url } = {}) => {
    const u = String(url || '');
    if (!/^https?:\/\//i.test(u)) throw new Error('Only http(s) URLs are allowed');
    return shell.openExternal(u).then(() => ({ ok: true }));
  });

  ipcMain.handle('sh:openPath', async (_e, { path: p } = {}) => {
    if (!isSafePath(p)) throw new Error('Invalid path');
    const err = await shell.openPath(p);
    return err ? { ok: false, message: err } : { ok: true };
  });

  ipcMain.handle('sh:showInFolder', (_e, { path: p } = {}) => {
    if (!isSafePath(p)) throw new Error('Invalid path');
    shell.showItemInFolder(p);
    return { ok: true };
  });

  // ---------- terminal ----------
  ipcMain.handle('term:exec', (e, { sessionId, command } = {}) => {
    if (!sessionId || typeof sessionId !== 'string') throw new Error('Invalid session');
    return exec(sessionId, command, e.sender);
  });
  ipcMain.handle('term:kill', (_e, { runId } = {}) => kill(String(runId || '')));
  ipcMain.handle('term:cwd', (_e, { sessionId, setCwd } = {}) => getCwd(sessionId, setCwd));

  // ---------- git / tools ----------
  ipcMain.handle('git:status', (_e, { cwd } = {}) => runTool('git', ['-C', asDir(cwd), 'status', '--porcelain=v1', '-b'])
    .then((r) => {
      if (r.code !== 0 && !r.stdout) {
        return { ok: false, error: r.stderr || 'git status failed', notRepo: /not a git repository/i.test(r.stderr) };
      }
      const lines = r.stdout.split(/\r?\n/).filter(Boolean);
      let branch = '';
      let ahead = 0;
      let behind = 0;
      const entries = [];
      for (const line of lines) {
        if (line.startsWith('##')) {
          const m = line.match(/^##\s+([^.\s]+)/);
          branch = m ? m[1] : '';
          const ab = line.match(/ahead (\d+)/);
          const bb = line.match(/behind (\d+)/);
          ahead = ab ? parseInt(ab[1], 10) : 0;
          behind = bb ? parseInt(bb[1], 10) : 0;
        } else {
          const x = line[0];
          const y = line[1];
          entries.push({ x, y, path: line.slice(3) });
        }
      }
      return { ok: true, branch, ahead, behind, entries };
    }));

  ipcMain.handle('git:log', (_e, { cwd, n = 15 } = {}) => runTool('git', ['-C', asDir(cwd), 'log', `-${Math.min(50, Math.max(1, Number(n) || 15))}`, '--pretty=format:%h%x09%s%x09%an%x09%ar'])
    .then((r) => {
      if (r.code !== 0 && !r.stdout) return { ok: false, error: r.stderr || 'git log failed' };
      const commits = r.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
        const [hash, subject, author, date] = line.split('\t');
        return { hash, subject, author, date };
      });
      return { ok: true, commits };
    }));

  ipcMain.handle('git:run', (_e, { cwd, args } = {}) => {
    if (!Array.isArray(args) || !args.length || args.some((a) => typeof a !== 'string')) {
      return Promise.resolve({ code: -1, stdout: '', stderr: 'Invalid git arguments' });
    }
    return runTool('git', ['-C', asDir(cwd), ...args]);
  });

  ipcMain.handle('tool:run', (_e, { tool, args } = {}) => runTool(String(tool || ''), args));

  // ---------- config ----------
  ipcMain.handle('cfg:get', () => config.all);
  ipcMain.handle('cfg:set', (_e, patch) => {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid config patch');
    config.patch(patch);
    return config.all;
  });

  // ---------- window controls ----------
  ipcMain.handle('win:controls', (e, { action } = {}) => {
    const win = BrowserWindow.fromWebContents(e.sender) || getWindow();
    if (!win) return { ok: false };
    switch (String(action || '')) {
      case 'minimize': win.minimize(); break;
      case 'maximize': win.maximize(); break;
      case 'toggleMaximize': win.isMaximized() ? win.unmaximize() : win.maximize(); break;
      case 'close': win.close(); break;
      case 'fullscreen': win.setFullScreen(!win.isFullScreen()); break;
      default: return { ok: false, message: 'Unknown action' };
    }
    return { ok: true };
  });

  // ---------- app ----------
  ipcMain.handle('app:version', () => ({ version: app.getVersion(), electron: process.versions.electron }));
  ipcMain.handle('app:quit', () => app.quit());
  ipcMain.handle('app:notify', (_e, { title, body } = {}) => {
    try {
      if (Notification.isSupported()) {
        new Notification({ title: String(title || 'DevOS'), body: String(body || ''), silent: true }).show();
        return { ok: true, native: true };
      }
    } catch { /* fall through */ }
    return { ok: false, native: false };
  });
}

module.exports = { registerIpc, closeSession };
