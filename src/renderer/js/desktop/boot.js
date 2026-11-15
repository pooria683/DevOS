// DevOS — boot sequence overlay.

import { devos } from '../core/bridge.js';
import { state } from '../core/state.js';

export async function runBootSequence() {
  const cfg = await devos.cfg.get().catch(() => null);
  if (cfg && cfg.effects && cfg.effects.bootSequence === false) return;

  const boot = document.getElementById('boot');
  const log = document.getElementById('boot-log');
  const bar = document.getElementById('boot-bar-fill');
  if (!boot || !log) return;

  const info = state.sysInfo || {};
  const lines = [
    'DevOS v1.0.0 — developer shell',
    '',
    '[ ok ] window manager',
    '[ ok ] terminal service',
    '[ ok ] filesystem bridge',
    '[ ok ] theme engine',
    '[ ok ] ipc layer — secure (contextIsolation)',
    '',
    `host: ${info.hostname || 'devos'}  user: ${info.user || 'dev'}`,
    'starting desktop…',
  ];

  let skip = false;
  const finish = () => {
    skip = true;
    boot.classList.add('done');
    setTimeout(() => boot.remove(), 500);
    window.removeEventListener('keydown', finish);
    window.removeEventListener('pointerdown', finish);
  };
  window.addEventListener('keydown', finish, { once: true });
  window.addEventListener('pointerdown', finish, { once: true });

  let text = '';
  for (let i = 0; i < lines.length && !skip; i++) {
    const line = lines[i];
    for (let cIdx = 0; cIdx < line.length && !skip; cIdx += 2) {
      text = lines.slice(0, i).join('\n') + (i ? '\n' : '') + line.slice(0, cIdx + 2);
      log.innerHTML = colorize(text);
      await sleep(7);
    }
    bar.style.width = `${Math.round(((i + 1) / lines.length) * 100)}%`;
    await sleep(55);
  }
  log.innerHTML = colorize(lines.join('\n'));
  bar.style.width = '100%';
  await sleep(240);
  finish();
}

function colorize(text) {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return esc
    .replace(/\[ ok \]/g, '<span class="ok">[ ok ]</span>')
    .replace(/^(DevOS v[\d.]+.*)$/m, '<span class="ok">$1</span>')
    .replace(/(host:.*|starting desktop…)/g, '<span class="dim">$1</span>');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
