'use strict';

const { shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

function fileExists(p) {
  try { return !!p && fs.existsSync(p); } catch { return false; }
}

function expandWin(p) {
  if (!p) return p;
  return p.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (_, name) => process.env[name] || '');
}

/** Detached spawn that survives DevOS and opens a visible window on Windows. */
function spawnDetached(cmd, args, opts = {}) {
  try {
    const child = spawn(cmd, args, {
      cwd: opts.cwd || undefined,
      detached: true,
      stdio: 'ignore',
      shell: !!opts.shell,
      windowsHide: false,
    });
    child.unref();
    return { ok: true };
  } catch (err) {
    return { ok: false, message: String(err && err.message || err) };
  }
}

/** Run a quick command to test availability (e.g. `where code`). */
function commandOnPath(cmd) {
  return new Promise((resolve) => {
    const probe = IS_WIN
      ? spawn('cmd.exe', ['/d', '/s', '/c', `where ${cmd}`], { windowsHide: true })
      : spawn('sh', ['-c', `command -v ${JSON.stringify(cmd)}`], { windowsHide: true });
    let out = '';
    probe.stdout && probe.stdout.on('data', (d) => { out += String(d); });
    probe.on('error', () => resolve(null));
    probe.on('close', (code) => {
      if (code === 0 && out.trim()) resolve(out.trim().split(/\r?\n/)[0]);
      else resolve(null);
    });
  });
}

const VS_CODE_PATHS = [
  '%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe',
  '%ProgramFiles%\\Microsoft VS Code\\Code.exe',
  '%ProgramFiles(x86)%\\Microsoft VS Code\\Code.exe',
].map(expandWin);

const GIT_BASH_PATHS = [
  '%ProgramFiles%\\Git\\git-bash.exe',
  '%LOCALAPPDATA%\\Programs\\Git\\git-bash.exe',
].map(expandWin);

const DOCKER_PATHS = [
  '%ProgramFiles%\\Docker\\Docker\\Docker Desktop.exe',
  '%LOCALAPPDATA%\\Docker\\Docker Desktop.exe',
].map(expandWin);

const WT_PATHS = [
  '%LOCALAPPDATA%\\Microsoft\\WindowsApps\\wt.exe',
].map(expandWin);

async function launch(appKey, arg) {
  const home = os.homedir();
  const cwd = (arg && typeof arg === 'string' && fs.existsSync(arg)) ? arg : undefined;

  switch (appKey) {
    case 'terminal': {
      if (IS_WIN) {
        const wt = WT_PATHS.find(fileExists) || await commandOnPath('wt');
        if (wt) return spawnDetached(wt, cwd ? ['-d', cwd] : []);
        // Fall back to Command Prompt in a new window at the target directory.
        return spawnDetached('cmd.exe', ['/c', 'start', 'DevOS Terminal', 'cmd.exe'], { cwd, shell: false })
          .ok ? { ok: true } : spawnDetached('cmd.exe', ['/c', 'start', 'cmd.exe'], { cwd });
      }
      if (IS_MAC) return spawnDetached('open', ['-a', 'Terminal', cwd || home]);
      for (const t of ['gnome-terminal', 'konsole', 'xfce4-terminal', 'x-terminal-emulator', 'xterm']) {
        if (await commandOnPath(t)) {
          const args = t === 'gnome-terminal' ? (cwd ? [`--working-directory=${cwd}`] : [])
            : t === 'konsole' ? (cwd ? ['--workdir', cwd] : [])
            : (cwd ? [cwd] : []);
          return spawnDetached(t, args);
        }
      }
      return { ok: false, message: 'No terminal emulator found' };
    }

    case 'vscode': {
      const local = VS_CODE_PATHS.find(fileExists);
      if (local) return spawnDetached(local, cwd ? [cwd] : []);
      const onPath = await commandOnPath(IS_WIN ? 'code' : 'code');
      if (onPath) {
        return IS_WIN
          ? spawnDetached('cmd.exe', ['/d', '/s', '/c', `start "" code${cwd ? ` "${cwd}"` : ''}`])
          : spawnDetached('code', cwd ? [cwd] : []);
      }
      return {
        ok: false,
        message: 'VS Code not found on this system',
        hint: 'Download it from https://code.visualstudio.com',
        url: 'https://code.visualstudio.com',
      };
    }

    case 'browser': {
      const url = (arg && /^https?:\/\//i.test(arg)) ? arg : 'https://github.com';
      try { await shell.openExternal(url); return { ok: true, message: `Opening ${url} in your default browser` }; }
      catch (err) { return { ok: false, message: String(err && err.message || err) }; }
    }

    case 'files': {
      const target = (arg && fs.existsSync(arg)) ? arg : home;
      const res = await shell.openPath(target);
      return res ? { ok: false, message: res } : { ok: true, message: 'Opened in File Explorer' };
    }

    case 'taskmgr': {
      if (IS_WIN) return spawnDetached('cmd.exe', ['/c', 'start', '', 'taskmgr.exe']);
      if (IS_MAC) return spawnDetached('open', ['-a', 'Activity Monitor']);
      for (const t of ['gnome-system-monitor', 'htop']) {
        if (await commandOnPath(t)) return spawnDetached(t, []);
      }
      return { ok: false, message: 'No system monitor found' };
    }

    case 'git': {
      if (IS_WIN) {
        const gb = GIT_BASH_PATHS.find(fileExists);
        if (gb) return spawnDetached(gb, [], { cwd });
      }
      if (await commandOnPath('git')) return launch('terminal', cwd);
      return {
        ok: false,
        message: 'Git not found on this system',
        hint: 'Download it from https://git-scm.com/downloads',
        url: 'https://git-scm.com/downloads',
      };
    }

    case 'docker': {
      const local = DOCKER_PATHS.find(fileExists);
      if (local) return spawnDetached(local, []);
      if (await commandOnPath('docker')) {
        return { ok: true, message: 'Docker CLI detected — starting Docker service is handled by your system' };
      }
      return {
        ok: false,
        message: 'Docker Desktop not found',
        hint: 'Download it from https://www.docker.com/products/docker-desktop',
        url: 'https://www.docker.com/products/docker-desktop',
      };
    }

    case 'windows-settings': {
      if (IS_WIN) return spawnDetached('cmd.exe', ['/c', 'start', 'ms-settings:']);
      return { ok: false, message: 'Windows Settings is only available on Windows' };
    }

    case 'explorer-here': {
      if (IS_WIN && cwd) return spawnDetached('cmd.exe', ['/c', 'start', '', 'explorer.exe', cwd]);
      return launch('files', cwd);
    }

    default:
      return { ok: false, message: `Unknown app: ${appKey}` };
  }
}

/** Feature detection used to badge Start menu entries and panels. */
async function detect() {
  const result = {
    platform: process.platform,
    vscode: false,
    wt: false,
    git: false,
    gitbash: false,
    docker: false,
    taskmgr: IS_WIN,
  };
  const checks = await Promise.all([
    commandOnPath('code'),
    commandOnPath('git'),
    commandOnPath('docker'),
    commandOnPath('node'),
    commandOnPath('npm'),
    commandOnPath('wt'),
  ]);
  result.vscode = !!checks[0] || VS_CODE_PATHS.some(fileExists);
  result.git = !!checks[1];
  result.docker = !!checks[2];
  result.node = !!checks[3];
  result.npm = !!checks[4];
  result.wt = !!checks[5] || WT_PATHS.some(fileExists);
  result.gitbash = GIT_BASH_PATHS.some(fileExists);
  return result;
}

module.exports = { launch, detect, commandOnPath };
