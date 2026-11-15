'use strict';

const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const IS_WIN = process.platform === 'win32';

/**
 * Terminal session registry.
 *
 * Sessions are lightweight: each holds a persistent working directory (like a
 * real shell keeps its cwd) plus the set of live child processes. Commands run
 * through the platform shell (cmd.exe on Windows, sh on unix) and stream
 * stdout/stderr back to the renderer over IPC.
 */
const sessions = new Map(); // sessionId -> { cwd, runs: Map<runId, ChildProcess> }
let runCounter = 0;

function getSession(id) {
  let s = sessions.get(id);
  if (!s) {
    s = { cwd: os.homedir(), runs: new Map() };
    sessions.set(id, s);
  }
  return s;
}

function closeSession(id) {
  const s = sessions.get(id);
  if (!s) return;
  for (const run of s.runs.values()) killRun(run);
  sessions.delete(id);
}

function killRun(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  try {
    if (IS_WIN) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    } else {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }
  } catch { /* already gone */ }
}

function normalizeCwd(dir) {
  if (!dir || typeof dir !== 'string') return os.homedir();
  const clean = dir.replace(/^"|"$/g, '').trim() || os.homedir();
  const resolved = path.resolve(clean);
  try {
    return fs.statSync(resolved).isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}

/**
 * Execute a command inside a session.
 * @returns {{ runId: string|null, cwd: string, error?: string }}
 */
function exec(sessionId, command, sender) {
  const session = getSession(sessionId);
  const cmd = String(command || '').trim();

  if (!cmd) return { runId: null, cwd: session.cwd };

  // `cd` is handled by the session itself so the working directory persists
  // across commands (we don't run a persistent shell process).
  const cdMatch = cmd.match(/^cd\s*(.*)$/i);
  if (cdMatch && !/[&|;]/.test(cmd)) {
    let target = cdMatch[1].trim();
    if (!target || target === '~') target = os.homedir();
    if (target === '-') return { runId: null, cwd: session.cwd, error: 'cd - is not supported' };
    const next = normalizeCwd(path.resolve(session.cwd, target));
    if (!next) {
      const msg = `The system cannot find the path specified: ${target}\r\n`;
      sender.send('term:data', { sessionId, runId: null, stream: 'err', text: msg });
      return { runId: null, cwd: session.cwd };
    }
    session.cwd = next;
    return { runId: null, cwd: next };
  }

  const runId = `run-${Date.now()}-${++runCounter}`;
  const shellCmd = IS_WIN ? 'cmd.exe' : 'sh';
  const shellArgs = IS_WIN ? ['/d', '/s', '/c', cmd] : ['-c', cmd];

  let child;
  try {
    child = spawn(shellCmd, shellArgs, {
      cwd: session.cwd,
      env: { ...process.env, TERM: 'xterm-256color', FORCE_COLOR: '1' },
      windowsHide: true,
    });
  } catch (err) {
    sender.send('term:data', { sessionId, runId, stream: 'err', text: `Failed to start: ${err}\r\n` });
    sender.send('term:exit', { sessionId, runId, code: 1 });
    return { runId, cwd: session.cwd };
  }

  session.runs.set(runId, child);

  child.stdout && child.stdout.on('data', (chunk) => {
    sender.send('term:data', { sessionId, runId, stream: 'out', text: chunk.toString('utf8') });
  });
  child.stderr && child.stderr.on('data', (chunk) => {
    sender.send('term:data', { sessionId, runId, stream: 'err', text: chunk.toString('utf8') });
  });
  child.on('error', (err) => {
    sender.send('term:data', { sessionId, runId, stream: 'err', text: `${err}\r\n` });
  });
  child.on('close', (code, signal) => {
    session.runs.delete(runId);
    sender.send('term:exit', { sessionId, runId, code: signal ? 130 : (code ?? 0) });
  });

  return { runId, cwd: session.cwd };
}

function kill(runId) {
  for (const session of sessions.values()) {
    const child = session.runs.get(runId);
    if (child) {
      killRun(child);
      return { ok: true };
    }
  }
  return { ok: false, message: 'No such run' };
}

function getCwd(sessionId, setCwd) {
  const session = getSession(sessionId);
  if (setCwd) {
    const next = normalizeCwd(setCwd);
    if (next) session.cwd = next;
  }
  return { cwd: session.cwd };
}

/** One-shot execution of a tool with argument array (no shell interpolation). */
function runTool(tool, args) {
  const allow = new Set(['git', 'docker', 'npm', 'node', 'npx', 'code', 'pnpm', 'yarn', 'tasklist', 'ps', 'uname', 'df', 'wmic', 'powershell']);
  if (!allow.has(tool)) {
    return Promise.resolve({ code: -1, stdout: '', stderr: `Tool "${tool}" is not allowed` });
  }
  const safeArgs = (Array.isArray(args) ? args : [args]).map(String);
  // .cmd shims on Windows (npm, code, yarn…) need cmd.exe to resolve; real
  // .exe tools (git, docker…) must run shell-free so user-supplied arguments
  // (e.g. commit messages) can never be interpreted by the shell.
  const needsShell = IS_WIN && ['npm', 'npx', 'pnpm', 'yarn', 'code'].includes(tool);
  const spawnCmd = needsShell && IS_WIN ? 'cmd.exe' : tool;
  const spawnArgs = needsShell ? ['/d', '/s', '/c', tool, ...safeArgs] : safeArgs;
  return new Promise((resolve) => {
    execFile(spawnCmd, spawnArgs, {
      timeout: 20000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
      shell: needsShell,
    }, (err, stdout, stderr) => {
      if (err && !stdout && !stderr && err.code === 'ENOENT') {
        resolve({ code: -1, stdout: '', stderr: `${tool} is not installed or not on PATH`, error: 'ENOENT' });
        return;
      }
      resolve({
        code: err && typeof err.code === 'number' ? err.code : (err ? 1 : 0),
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
      });
    });
  });
}

module.exports = { exec, kill, getCwd, closeSession, runTool };
