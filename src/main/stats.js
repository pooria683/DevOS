'use strict';

const os = require('os');
const { spawn, execFile } = require('child_process');
const fs = require('fs');

const IS_WIN = process.platform === 'win32';

function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }
  return { idle, total };
}

function basicInfo() {
  const cpus = os.cpus();
  return {
    hostname: os.hostname(),
    user: IS_WIN ? (process.env.USERNAME || 'user') : (process.env.USER || process.env.USER_LOGNAME || 'user'),
    platform: os.platform(),
    osVersion: IS_WIN ? `${os.type()} ${os.release()}` : `${os.type()} ${os.release()}`,
    arch: os.arch(),
    cpuModel: cpus.length ? cpus[0].model.trim() : 'Unknown CPU',
    cpuCores: cpus.length,
    totalMem: os.totalmem(),
    uptime: os.uptime(),
  };
}

/** Cached drive info, refreshed at most every 20 s. */
let driveCache = { at: 0, drives: [] };

function listDrivesWin() {
  return new Promise((resolve) => {
    const ps = 'Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DriveType=3" | Select-Object DeviceID,Size,FreeSpace | ConvertTo-Json -Compress';
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 15000 }, (err, stdout) => {
      const drives = [];
      try {
        const json = JSON.parse(stdout || '[]');
        const arr = Array.isArray(json) ? json : [json];
        for (const d of arr) {
          if (d && typeof d.Size === 'number') {
            drives.push({ id: d.DeviceID || '?', total: d.Size, free: d.FreeSpace || 0 });
          }
        }
      } catch { /* PowerShell unavailable or failed */ }
      resolve(drives);
      void err;
    });
  });
}

function listDrivesUnix() {
  return new Promise((resolve) => {
    execFile('df', ['-kP', '/'], { windowsHide: true, timeout: 10000 }, (err, stdout) => {
      const drives = [];
      try {
        const lines = String(stdout || '').trim().split('\n').slice(1);
        for (const line of lines) {
          const parts = line.split(/\s+/);
          if (parts.length >= 6) {
            const total = parseInt(parts[1], 10) * 1024;
            const free = parseInt(parts[3], 10) * 1024;
            drives.push({ id: parts[5] || '/', total, free });
          }
        }
      } catch { /* ignore */ }
      resolve(drives.length ? drives : [{ id: '/', total: 0, free: 0 }]);
      void err;
    });
  });
}

async function drives(force = false) {
  const now = Date.now();
  if (!force && driveCache.drives.length && now - driveCache.at < 20000) return driveCache.drives;
  const drives = IS_WIN ? await listDrivesWin() : await listDrivesUnix();
  driveCache = { at: now, drives };
  return drives;
}

/** Snapshot of live system stats (CPU %, memory, drives, network interfaces). */
function snapshot(prev) {
  const now = cpuTimes();
  let cpuPercent = prev ? null : 0;
  if (prev && prev.cpu) {
    const dt = now.total - prev.cpu.total;
    const di = now.idle - prev.cpu.idle;
    cpuPercent = dt > 0 ? Math.min(100, Math.max(0, (1 - di / dt) * 100)) : 0;
  }
  const nets = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    const up = (addrs || []).some((a) => !a.internal && (a.family === 'IPv4' || a.family === 4));
    const ipv4 = (addrs || []).find((a) => a.family === 'IPv4' || a.family === 4);
    nets.push({ name, up, address: ipv4 ? ipv4.address : null, internal: (addrs || []).some((a) => a.internal) });
  }
  return {
    cpuPercent: cpuPercent === null ? 0 : cpuPercent,
    cpuCores: os.cpus().length,
    memUsed: os.totalmem() - os.freemem(),
    memTotal: os.totalmem(),
    uptime: os.uptime(),
    network: nets,
    drives: driveCache.drives,
  };
}

/** Running processes: tasklist on Windows, ps elsewhere. */
function processes() {
  return new Promise((resolve) => {
    if (IS_WIN) {
      execFile('tasklist', ['/fo', 'CSV', '/nh'], { windowsHide: true, timeout: 15000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
        const list = [];
        try {
          for (const line of String(stdout || '').trim().split(/\r?\n/)) {
            const m = line.match(/^"([^"]*)","(\d+)"/);
            if (!m) continue;
            const memMatch = line.match(/"([\d,]+)\sK"$/);
            const memKb = memMatch ? parseInt(memMatch[1].replace(/,/g, ''), 10) : 0;
            list.push({ pid: parseInt(m[2], 10), name: m[1], cpu: null, mem: memKb * 1024 });
          }
        } catch { /* ignore */ }
        resolve(list);
        void err;
      });
    } else {
      execFile('ps', ['-eo', 'pid=,comm=,pcpu=,pmem='], { timeout: 10000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        const list = [];
        try {
          for (const line of String(stdout || '').trim().split('\n').slice(1)) {
            const m = line.trim().match(/^(\d+)\s+(.+?)\s+([\d.]+)\s+([\d.]+)$/);
            if (m) list.push({ pid: parseInt(m[1], 10), name: m[2].split('/').pop(), cpu: parseFloat(m[3]), mem: parseFloat(m[4]) });
          }
        } catch { /* ignore */ }
        resolve(list);
        void err;
      });
    }
  });
}

function killProcess(pid) {
  const p = parseInt(pid, 10);
  if (!Number.isInteger(p) || p <= 0) return Promise.resolve({ ok: false, message: 'Invalid PID' });
  return new Promise((resolve) => {
    if (IS_WIN) {
      execFile('taskkill', ['/PID', String(p), '/F', '/T'], { windowsHide: true, timeout: 10000 }, (err) => {
        resolve(err ? { ok: false, message: String(err.message || err) } : { ok: true });
      });
    } else {
      try { process.kill(p, 'SIGTERM'); resolve({ ok: true }); }
      catch (err) { resolve({ ok: false, message: String(err.message || err) }); }
    }
  });
}

module.exports = { basicInfo, snapshot, drives, processes, killProcess, cpuTimes };
