'use strict';

const { app, BrowserWindow, protocol, shell, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { ConfigStore } = require('./store');
const { registerIpc } = require('./ipc');

const isDev = process.argv.includes('--devos-dev');
const RENDERER_ROOT = path.join(__dirname, '..', 'renderer');

// Custom protocol must be registered before app.ready
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'devos',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

/** @type {BrowserWindow|null} */
let mainWindow = null;
/** @type {Tray|null} */
let tray = null;
const config = new ConfigStore();
let statsService = null;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

function serveRenderer(req) {
  try {
    const u = new URL(req.url);
    let pathname = decodeURIComponent(u.pathname || '/index.html');
    if (pathname === '/' || pathname === '') pathname = '/index.html';
    const filePath = path.normalize(path.join(RENDERER_ROOT, pathname));
    if (!filePath.startsWith(path.normalize(RENDERER_ROOT + path.sep)) && filePath !== RENDERER_ROOT) {
      return new Response('Forbidden', { status: 403 });
    }
    const data = fs.readFileSync(filePath);
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    return new Response(data, { headers: { 'Content-Type': type, 'Cache-Control': 'no-cache' } });
  } catch {
    return new Response('Not Found', { status: 404 });
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    frame: false,
    backgroundColor: '#05070d',
    title: 'DevOS',
    icon: path.join(__dirname, '..', '..', 'assets', 'icons', 'devos.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  win.loadURL('devos://shell/index.html');

  win.once('ready-to-show', () => {
    if (config.get('startMaximized') !== false) win.maximize();
    win.show();
    win.focus();
  });

  // Keep the shell self-contained: external links go to the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('devos://')) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  if (isDev) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  win.on('closed', () => { mainWindow = null; });
  return win;
}

function createTray() {
  try {
    const iconPath = path.join(__dirname, '..', '..', 'assets', 'icons', 'tray.png');
    if (!fs.existsSync(iconPath)) return;
    tray = new Tray(nativeImage.createFromPath(iconPath));
    tray.setToolTip('DevOS — developer shell');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show DevOS', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
      { type: 'separator' },
      { label: 'Quit DevOS', click: () => app.quit() },
    ]));
    tray.on('click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
  } catch {
    // Tray is a nice-to-have; ignore platforms where it fails.
  }
}

app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

app.whenReady().then(() => {
  protocol.handle('devos', serveRenderer);

  registerIpc({
    getWindow: () => mainWindow,
    config,
    isDev,
    setStatsService: (s) => { statsService = s; },
    getStatsService: () => statsService,
  });

  mainWindow = createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    else if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

// Hardening: block any tampering with the shell window from web content.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault());
});
