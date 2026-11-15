'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Event channels the renderer is allowed to subscribe to.
const EVENT_CHANNELS = new Set(['sys:stats', 'term:data', 'term:exit']);

const on = (channel, callback) => {
  if (!EVENT_CHANNELS.has(channel)) throw new Error(`Channel not allowed: ${channel}`);
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('devos', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },

  sys: {
    info: () => invoke('sys:info'),
    subscribe: () => invoke('sys:stats:subscribe'),
    unsubscribe: () => invoke('sys:stats:unsubscribe'),
    processes: () => invoke('sys:processes'),
    kill: (pid) => invoke('sys:kill', { pid }),
    drives: () => invoke('sys:drives'),
  },

  fs: {
    list: (dir) => invoke('fs:list', { dir }),
    read: (path, max) => invoke('fs:read', { path, max }),
    write: (path, content) => invoke('fs:write', { path, content }),
    mkdir: (path) => invoke('fs:mkdir', { path }),
    del: (path, recursive = true) => invoke('fs:delete', { path, recursive }),
    rename: (path, newPath) => invoke('fs:rename', { path, newPath }),
    search: (dir, query, limit) => invoke('fs:search', { dir, query, limit }),
    home: () => invoke('fs:home'),
    pickFolder: (title) => invoke('fs:pickFolder', { title }),
  },

  sh: {
    launch: (app, arg) => invoke('sh:launch', { app, arg }),
    openExternal: (url) => invoke('sh:openExternal', { url }),
    openPath: (path) => invoke('sh:openPath', { path }),
    showInFolder: (path) => invoke('sh:showInFolder', { path }),
    detect: () => invoke('sh:detect'),
  },

  term: {
    exec: (sessionId, command) => invoke('term:exec', { sessionId, command }),
    kill: (runId) => invoke('term:kill', { runId }),
    cwd: (sessionId, setCwd) => invoke('term:cwd', { sessionId, setCwd }),
  },

  git: {
    status: (cwd) => invoke('git:status', { cwd }),
    log: (cwd, n) => invoke('git:log', { cwd, n }),
    run: (cwd, args) => invoke('git:run', { cwd, args }),
  },

  tool: {
    run: (tool, args) => invoke('tool:run', { tool, args }),
  },

  cfg: {
    get: () => invoke('cfg:get'),
    set: (patch) => invoke('cfg:set', patch),
  },

  win: {
    controls: (action) => invoke('win:controls', { action }),
  },

  app: {
    version: () => invoke('app:version'),
    quit: () => invoke('app:quit'),
    notify: (title, body) => invoke('app:notify', { title, body }),
  },

  // Subscriptions
  onSysStats: (cb) => on('sys:stats', cb),
  onTermData: (cb) => on('term:data', cb),
  onTermExit: (cb) => on('term:exit', cb),
});
