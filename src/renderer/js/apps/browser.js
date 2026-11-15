// DevOS — Browser app: launches URLs in the user's real default browser
// (per DevOS philosophy: real apps, no simulated web view).

import { devos } from '../core/bridge.js';
import { icon } from '../ui/icons.js';
import { createWindow } from '../wm/wm.js';
import { toast } from '../ui/toast.js';

const QUICK_LINKS = [
  { label: 'GitHub', url: 'https://github.com' },
  { label: 'Stack Overflow', url: 'https://stackoverflow.com' },
  { label: 'MDN', url: 'https://developer.mozilla.org' },
  { label: 'npm', url: 'https://www.npmjs.com' },
  { label: 'Docker Hub', url: 'https://hub.docker.com' },
  { label: 'VS Code Docs', url: 'https://code.visualstudio.com/docs' },
  { label: 'DevDocs', url: 'https://devdocs.io' },
  { label: 'Can I use', url: 'https://caniuse.com' },
];

let browserCounter = 0;

export function openBrowserWindow(opts = {}) {
  browserCounter += 1;

  const root = document.createElement('div');
  root.className = 'brw-wrap';

  root.innerHTML = `
    <div class="brw-logo">${icon('globe')}</div>
    <div style="text-align:center;">
      <div style="font-family:var(--font-mono);font-size:15px;color:var(--text);">open in default browser</div>
      <div class="dim" style="font-size:11.5px;margin-top:4px;">DevOS launches your real system browser — no embedded sandbox.</div>
    </div>
    <div class="brw-bar">
      <input type="url" placeholder="https://…  or search term" data-region="url" spellcheck="false" />
      <button class="btn primary" data-act="go">open ${icon('external')}</button>
    </div>
    <div class="brw-links" data-region="links"></div>
  `;

  const urlInput = root.querySelector('[data-region="url"]');
  const linksHost = root.querySelector('[data-region="links"]');

  const win = createWindow({
    id: `browser-${browserCounter}`,
    title: 'Browser',
    iconName: 'globe',
    width: 560,
    height: 400,
    minW: 420,
    minH: 300,
    singleton: true,
    content: root,
  });

  function normalizeUrl(input) {
    const value = input.trim();
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) return value;
    if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(value)) return `https://${value}`;
    return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
  }

  async function go(input) {
    const url = normalizeUrl(input);
    if (!url) { toast('Browser', 'Enter a URL or search term', 'err'); return; }
    const res = await devos.sh.launch('browser', url);
    if (res.ok) toast('Browser', `Opening ${url}`, 'ok');
    else toast('Browser', res.message || 'Failed to open browser', 'err');
  }

  root.querySelector('[data-act="go"]').addEventListener('click', () => go(urlInput.value));
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') go(urlInput.value);
  });

  for (const link of QUICK_LINKS) {
    const chip = document.createElement('button');
    chip.className = 'btn';
    chip.textContent = link.label;
    chip.addEventListener('click', () => go(link.url));
    linksHost.appendChild(chip);
  }

  if (opts.url) {
    urlInput.value = opts.url;
    setTimeout(() => go(opts.url), 200);
  }

  setTimeout(() => urlInput.focus(), 150);

  return win;
}
