#!/usr/bin/env node
'use strict';

// DevOS — DOM runtime test.
// Boots the real renderer modules (browser preview mode / mock bridge) inside
// jsdom and exercises the desktop, terminal, theming and window manager.

const { JSDOM } = require('jsdom');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'src', 'renderer');
const errors = [];

function stubCanvas(dom) {
  const noop = () => {};
  const ctxStub = new Proxy({}, {
    get(target, prop) {
      if (prop === 'createLinearGradient') return () => ({ addColorStop: noop });
      if (prop === 'measureText') return () => ({ width: 10 });
      return typeof prop === 'string' ? noop : undefined;
    },
    set() { return true; },
  });
  dom.window.HTMLCanvasElement.prototype.getContext = () => ctxStub;
}

async function main() {
  const dom = await JSDOM.fromFile(path.join(ROOT, 'index.html'), {
    url: 'http://localhost:4173/',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });

  const { window } = dom;
  stubCanvas(dom);
  window.addEventListener('error', (e) => errors.push(`window.onerror: ${e.message}`));
  // jsdom lacks scrollIntoView (browsers have it).
  window.Element.prototype.scrollIntoView = function scrollIntoView() {};

  // Expose DOM globals for the ES modules (they assume a browser environment).
  globalThis.window = window;
  globalThis.document = window.document;
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  globalThis.localStorage = window.localStorage;
  globalThis.location = window.location;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.HTMLInputElement = window.HTMLInputElement;
  globalThis.HTMLCanvasElement = window.HTMLCanvasElement;
  globalThis.Element = window.Element;
  globalThis.Node = window.Node;
  globalThis.Event = window.Event;
  globalThis.KeyboardEvent = window.KeyboardEvent;
  globalThis.MouseEvent = window.MouseEvent;
  globalThis.CustomEvent = window.CustomEvent;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);

  const boot = await import('../src/renderer/js/main.js');
  await boot; // module has no default export; import side effects run boot()
  await new Promise((r) => setTimeout(r, 900)); // let boot(), terminal open, mocks settle

  const doc = window.document;
  const results = [];
  const check = (label, cond) => {
    results.push([label, !!cond]);
    if (!cond) console.error(`  ✗ ${label}`);
    else console.log(`  ✓ ${label}`);
  };

  // Desktop structure
  check('taskbar rendered', doc.querySelector('#taskbar .tb-start') !== null);
  check('desktop icons rendered (8 apps)', doc.querySelectorAll('.desk-icon').length === 8);
  check('terminal window auto-opened', doc.querySelectorAll('.win').length >= 1);
  check('terminal output has banner', (doc.querySelector('.term-output')?.textContent || '').includes('help'));

  // Terminal interaction via the mock bridge
  const input = doc.querySelector('.term-input-row input');
  const output = doc.querySelector('.term-output');
  const type = async (cmd) => {
    input.value = cmd;
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((r) => setTimeout(r, 80));
  };

  await type('help');
  check('terminal: help command', output.textContent.includes('show this help'));

  await type('theme matrix');
  check('terminal: theme matrix switches body theme', doc.body.dataset.theme === 'matrix');

  await type('theme dark');
  check('terminal: theme dark switches back', doc.body.dataset.theme === 'darkide');

  await type('themes');
  check('terminal: themes list', output.textContent.includes('theme solarized'));

  await type('devos');
  check('terminal: devos banner', output.textContent.includes('cpu'));

  await type('ls');
  check('terminal: ls lists virtual FS', output.textContent.includes('projects'));

  await type('open files');
  await new Promise((r) => setTimeout(r, 500));
  check('terminal: open files opens explorer window', (output.textContent).includes('Opening files'));

  // Files window content (mock FS)
  const fileRows = [...doc.querySelectorAll('.win')].filter((w) => w.querySelector('.fx-crumbs'));
  check('file explorer window rendered', fileRows.length >= 1);
  check('file explorer lists mock folders', [...doc.querySelectorAll('.fx-row .nm')].some((el) => el.textContent === 'projects'));

  // Start menu
  const sm = doc.getElementById('startmenu');
  const { openStartMenu, closeStartMenu } = await import('../src/renderer/js/shell/startmenu.js');
  openStartMenu('vscode');
  check('start menu opens and filters', sm.querySelectorAll('.sm-item').length >= 1 &&
    [...sm.querySelectorAll('.sm-item .n')].some((n) => n.textContent.includes('VS Code')));
  closeStartMenu();

  // Window manager: create, minimize, restore, close
  const wm = await import('../src/renderer/js/wm/wm.js');
  const testWin = wm.createWindow({ id: 'test-win', title: 'Test', iconName: 'git', width: 400, height: 300, content: Object.assign(doc.createElement('div'), { textContent: 'hi' }) });
  check('wm: window created', doc.querySelectorAll('.win').length >= 2);
  testWin.minimize();
  await new Promise((r) => setTimeout(r, 250));
  check('wm: minimize hides window', testWin.el.classList.contains('hidden-win'));
  testWin.restore();
  check('wm: restore unhides window', !testWin.el.classList.contains('hidden-win'));
  testWin.close();
  await new Promise((r) => setTimeout(r, 250));
  check('wm: close removes window', !wm.getWindow('test-win'));

  // Developer mode HUD
  const { set } = await import('../src/renderer/js/core/state.js');
  set({ developerMode: true });
  await new Promise((r) => setTimeout(r, 150));
  check('hud: dev mode shows HUD', !doc.getElementById('hud').classList.contains('hidden'));
  set({ developerMode: false });

  // Toasts
  const { toast } = await import('../src/renderer/js/ui/toast.js');
  toast('Hello', 'World', 'ok');
  check('toast rendered', doc.querySelector('#toasts .toast') !== null);

  // Settings window
  const { openApp } = await import('../src/renderer/js/apps/registry.js');
  openApp('settings');
  await new Promise((r) => setTimeout(r, 150));
  check('settings opens with theme cards', doc.querySelectorAll('.theme-card').length === 7);

  // Task manager
  openApp('taskmgr');
  await new Promise((r) => setTimeout(r, 150));
  check('task manager renders stat cards', doc.querySelectorAll('.tm-card').length === 4);

  // Git panel (mock repo state)
  openApp('git');
  await new Promise((r) => setTimeout(r, 200));
  check('git panel shows branch', [...doc.querySelectorAll('.chip')].some((c) => c.textContent.includes('main')));

  // Docker panel (mock docker)
  openApp('docker');
  await new Promise((r) => setTimeout(r, 200));
  check('docker panel lists containers', [...doc.querySelectorAll('.dock-table td')].some((c) => c.textContent.includes('devos-db')));

  // Browser app
  openApp('browser');
  await new Promise((r) => setTimeout(r, 100));
  check('browser app renders quick links', doc.querySelectorAll('.brw-links .btn').length >= 6);

  const failures = results.filter(([, ok]) => !ok).length;
  if (errors.length) {
    console.error('\nRuntime errors:');
    errors.forEach((e) => console.error('  ' + e));
  }
  console.log('----------------');
  console.log(failures === 0 && errors.length === 0
    ? `DOM test passed (${results.length} checks).`
    : `${failures} DOM check(s) failed, ${errors.length} runtime error(s).`);
  window.close();
  process.exit(failures || errors.length ? 1 : 0);
}

process.on('unhandledRejection', (err) => {
  errors.push(`unhandledRejection: ${err && err.stack || err}`);
});

main().catch((err) => {
  console.error('DOM test crashed:', err);
  process.exit(1);
});
