// DevOS — application registry.
// Single source of truth used by desktop icons, the Start menu, terminal
// `open` commands and the taskbar.

import { devos } from '../core/bridge.js';
import { toast } from '../ui/toast.js';

import { openTerminalWindow } from './terminal.js';
import { openFilesWindow } from './files.js';
import { openSettingsWindow } from './settings.js';
import { openTaskManagerWindow } from './taskmanager.js';
import { openGitWindow } from './git.js';
import { openDockerWindow } from './docker.js';
import { openBrowserWindow } from './browser.js';

export const APPS = [
  {
    id: 'terminal',
    title: 'Terminal',
    icon: 'terminal',
    cmd: 'open terminal',
    keywords: 'shell cmd console powershell prompt',
    desc: 'Command shell with history, autocomplete and tabs',
    singleton: false,
    open: (opts) => openTerminalWindow(opts),
  },
  {
    id: 'files',
    title: 'File Explorer',
    icon: 'folder',
    cmd: 'open files',
    keywords: 'explorer folders files browser disk',
    desc: 'Browse the real filesystem, open in VS Code or Terminal',
    singleton: false,
    open: (opts) => openFilesWindow(opts),
  },
  {
    id: 'vscode',
    title: 'VS Code',
    icon: 'code',
    cmd: 'open vscode',
    keywords: 'code editor ide visualstudio',
    desc: 'Launch the real Visual Studio Code install',
    singleton: false,
    open: async (opts) => {
      const dir = opts?.dir || undefined;
      const res = await devos.sh.launch('vscode', dir);
      if (res.ok) toast('VS Code', res.message || 'Launching Visual Studio Code…', 'ok');
      else {
        toast('VS Code', `${res.message}${res.hint ? ` — ${res.hint}` : ''}`, 'err', 7000);
        if (res.url) await devos.sh.openExternal(res.url);
      }
      return null;
    },
  },
  {
    id: 'browser',
    title: 'Browser',
    icon: 'globe',
    cmd: 'open browser',
    keywords: 'web internet url http links',
    desc: 'Open URLs in your default browser',
    singleton: true,
    open: (opts) => openBrowserWindow(opts),
  },
  {
    id: 'git',
    title: 'Git',
    icon: 'git',
    cmd: 'open git',
    keywords: 'version control repo commit branch push pull',
    desc: 'Branches, status, log and quick git actions',
    singleton: true,
    open: (opts) => openGitWindow(opts),
  },
  {
    id: 'docker',
    title: 'Docker',
    icon: 'docker',
    cmd: 'open docker',
    keywords: 'containers images whale devops',
    desc: 'Containers, images and Docker Desktop launcher',
    singleton: true,
    open: (opts) => openDockerWindow(opts),
  },
  {
    id: 'taskmgr',
    title: 'Task Manager',
    icon: 'gauge',
    cmd: 'open taskmgr',
    keywords: 'processes cpu ram performance monitor system',
    desc: 'Live system stats and running processes',
    singleton: true,
    open: (opts) => openTaskManagerWindow(opts),
  },
  {
    id: 'settings',
    title: 'Settings',
    icon: 'settings',
    cmd: 'open settings',
    keywords: 'preferences config themes appearance developer',
    desc: 'Themes, effects, developer mode and about',
    singleton: true,
    open: (opts) => openSettingsWindow(opts),
  },
];

export function appById(id) {
  return APPS.find((a) => a.id === id);
}

/**
 * Open an app window (or trigger its action). Returns the window handle if
 * one was created.
 */
export function openApp(id, opts = {}) {
  const app = appById(id);
  if (!app) {
    toast('DevOS', `Unknown app: ${id}`, 'err');
    return null;
  }
  try {
    return app.open(opts);
  } catch (err) {
    console.error(`[registry] failed to open ${id}`, err);
    toast(app.title, `Failed to open: ${err.message}`, 'err');
    return null;
  }
}
