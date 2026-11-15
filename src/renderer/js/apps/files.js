// DevOS — developer File Explorer.
// Folder tree, breadcrumbs, list/grid views, search, quick actions
// (open in VS Code / Terminal / system explorer), real filesystem.

import { devos } from '../core/bridge.js';
import { state, set } from '../core/state.js';
import { icon } from '../ui/icons.js';
import { createWindow } from '../wm/wm.js';
import { toast } from '../ui/toast.js';
import { openContextMenu } from '../ui/contextmenu.js';
import { openApp } from './registry.js';

const QUICK_DIRS = (home) => [
  { label: 'Home', path: home, iconName: 'home' },
  { label: 'Desktop', path: `${home}\\Desktop`, alt: `${home}/Desktop`, iconName: 'grid' },
  { label: 'Documents', path: `${home}\\Documents`, alt: `${home}/Documents`, iconName: 'fileText' },
  { label: 'Downloads', path: `${home}\\Downloads`, alt: `${home}/Downloads`, iconName: 'download' },
  { label: 'Projects', path: `${home}\\projects`, alt: `${home}/projects`, iconName: 'branch' },
];

let filesCounter = 0;

export function openFilesWindow(opts = {}) {
  filesCounter += 1;

  const root = document.createElement('div');
  root.style.cssText = 'flex:1;display:flex;flex-direction:column;min-height:0;';

  root.innerHTML = `
    <div class="app-toolbar">
      <button class="btn small" data-act="back" title="Back">${icon('arrowLeft')}</button>
      <button class="btn small" data-act="up" title="Up one level">${icon('arrowUp')}</button>
      <button class="btn small" data-act="refresh" title="Refresh">${icon('refresh')}</button>
      <div class="sep"></div>
      <button class="btn small" data-act="code" title="Open in VS Code">${icon('code')} code</button>
      <button class="btn small" data-act="term" title="Open in Terminal">${icon('terminal')} term</button>
      <div class="sep"></div>
      <button class="btn small" data-act="mkdir">${icon('folder')} new folder</button>
      <div class="sep"></div>
      <input type="search" placeholder="search current folder…" data-act="search" />
      <button class="btn small" data-act="view" title="Toggle list/grid view">${icon('list')}</button>
    </div>
    <div class="fx-layout">
      <div class="fx-side">
        <div class="side-head">Quick access</div>
        <div data-region="quick"></div>
        <div class="side-head">Folders</div>
        <div data-region="tree"></div>
      </div>
      <div class="fx-main">
        <div class="fx-crumbs" data-region="crumbs"></div>
        <div class="fx-scroll" tabindex="0">
          <div data-region="content"></div>
        </div>
      </div>
    </div>
    <div class="app-footer">
      <span data-region="count">—</span>
      <span data-region="sel" style="overflow:hidden;text-overflow:ellipsis;"></span>
    </div>
  `;

  const regions = {
    quick: root.querySelector('[data-region="quick"]'),
    tree: root.querySelector('[data-region="tree"]'),
    crumbs: root.querySelector('[data-region="crumbs"]'),
    content: root.querySelector('[data-region="content"]'),
    count: root.querySelector('[data-region="count"]'),
    sel: root.querySelector('[data-region="sel"]'),
    search: root.querySelector('[data-act="search"]'),
  };

  let home = '';
  let cwd = opts.dir || '';
  let view = 'list';
  let history = [];
  let future = [];
  let selectedPath = null;
  let searchMode = false;
  let searchResults = [];
  const expanded = new Set();
  const treeCache = new Map();

  const win = createWindow({
    id: `files-${filesCounter}`,
    title: 'File Explorer',
    iconName: 'folder',
    width: 900,
    height: 560,
    minW: 620,
    minH: 360,
    content: root,
  });

  // ---- helpers ----
  function isDir(entry) { return entry.type === 'dir'; }

  function fmtSize(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${(bytes / 1073741824).toFixed(1)} GB`;
  }

  function fmtDate(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    return d.toLocaleDateString(undefined, { year: '2-digit', month: 'short', day: 'numeric' });
  }

  function fileIcon(entry) {
    if (entry.type === 'dir') return icon('folder');
    const ext = (entry.ext || '').toLowerCase();
    if (['js', 'mjs', 'ts', 'jsx', 'tsx', 'py', 'rs', 'go', 'c', 'cpp', 'h', 'java', 'rb', 'php', 'sh', 'ps1', 'bat', 'cmd'].includes(ext)) return icon('fileCode');
    if (ext === 'json') return icon('fileJson');
    if (['md', 'txt', 'log', 'rst'].includes(ext)) return icon('fileText');
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'].includes(ext)) return icon('image');
    if (['zip', 'gz', 'tar', 'rar', '7z'].includes(ext)) return icon('zip');
    return icon('file');
  }

  function splitPath(p) {
    return p.split(/[\\/]+/).filter(Boolean);
  }

  function joinPath(base, name) {
    const sep = base.includes('\\') || /^[A-Z]:/i.test(base) ? '\\' : '/';
    if (base.endsWith(sep)) return base + name;
    return base + sep + name;
  }

  function parentPath(p) {
    const parts = splitPath(p);
    parts.pop();
    if (/^[A-Z]:$/i.test(parts[0] || '')) return parts[0] + '\\';
    return parts.length ? parts.join(p.includes('\\') && !p.includes('/') ? '\\' : '/') : p;
  }

  function pathSep(p) {
    return p.includes('\\') && !p.includes('/') ? '\\' : '/';
  }

  function setProjectDir(dir) {
    set({ activeProject: dir });
    devos.cfg.set({ activeProject: dir }).catch(() => {});
  }

  // ---- navigation ----
  async function navigate(dir, { push = true } = {}) {
    dir = (dir || '').trim();
    if (!dir) return;
    try {
      const listing = await devos.fs.list(dir);
      if (push && cwd && cwd !== listing.path) {
        history.push(cwd);
        future = [];
      }
      cwd = listing.path;
      searchMode = false;
      regions.search.value = '';
      setProjectDir(cwd);
      win.setTitle('File Explorer', cwd.length > 42 ? `…${cwd.slice(-40)}` : cwd);
      renderCrumbs();
      renderContent(listing.entries);
      renderQuick();
      renderTree();
    } catch (err) {
      toast('File Explorer', `Cannot open "${dir}": ${err.message}`, 'err');
    }
  }

  function goBack() {
    if (!history.length) return;
    future.push(cwd);
    navigate(history.pop(), { push: false });
  }

  function goUp() {
    const parent = parentPath(cwd);
    if (parent && parent !== cwd) navigate(parent);
  }

  // ---- rendering ----
  function renderCrumbs() {
    const sep = pathSep(cwd);
    const parts = splitPath(cwd);
    regions.crumbs.innerHTML = '';
    let acc = '';
    parts.forEach((part, i) => {
      if (i === 0 && /^[A-Z]:$/i.test(part)) {
        acc = part + '\\';
      } else if (i === 0) {
        acc = sep + part;
      } else {
        acc = acc.endsWith('\\') || acc.endsWith('/') ? acc + part : acc + sep + part;
      }
      const crumb = document.createElement('span');
      crumb.className = 'fx-crumb';
      crumb.textContent = part;
      crumb.addEventListener('click', () => navigate(acc));
      regions.crumbs.appendChild(crumb);
      if (i < parts.length - 1) {
        const s = document.createElement('span');
        s.className = 'sep';
        s.textContent = '›';
        regions.crumbs.appendChild(s);
      }
    });
  }

  function renderContent(entries) {
    regions.content.innerHTML = '';
    regions.sel.textContent = '';

    if (!entries.length) {
      regions.content.innerHTML = `<div class="app-empty">${icon('search')} nothing here</div>`;
      regions.count.textContent = '0 items';
      return;
    }

    if (view === 'grid') {
      const grid = document.createElement('div');
      grid.className = 'fx-grid';
      for (const entry of entries) {
        const tile = document.createElement('div');
        tile.className = 'fx-tile';
        tile.innerHTML = `<span class="fi ${entry.type}">${fileIcon(entry)}</span><span class="nm"></span>`;
        tile.querySelector('.nm').textContent = entry.name;
        bindEntryEvents(tile, entry);
        grid.appendChild(tile);
      }
      regions.content.appendChild(grid);
    } else {
      const list = document.createElement('div');
      list.className = 'fx-list';
      for (const entry of entries) {
        const row = document.createElement('div');
        row.className = 'fx-row';
        row.innerHTML = `
          <span class="fi ${entry.type}">${fileIcon(entry)}</span>
          <span class="nm"></span>
          <span class="pth"></span>
          <span class="sz"></span>
          <span class="mt"></span>`;
        row.querySelector('.nm').textContent = entry.name;
        row.querySelector('.pth').textContent = searchMode ? entry.path : '';
        row.querySelector('.sz').textContent = entry.type === 'file' ? fmtSize(entry.size) : '';
        row.querySelector('.mt').textContent = fmtDate(entry.mtime);
        bindEntryEvents(row, entry);
        list.appendChild(row);
      }
      regions.content.appendChild(list);
    }

    regions.count.textContent = `${entries.length} item${entries.length === 1 ? '' : 's'}${searchMode ? ' (search)' : ''}`;
  }

  function bindEntryEvents(el, entry) {
    el.addEventListener('click', () => {
      regions.content.querySelectorAll('.selected').forEach((s) => s.classList.remove('selected'));
      el.classList.add('selected');
      selectedPath = entry.path;
      regions.sel.textContent = entry.path;
    });
    el.addEventListener('dblclick', () => openEntry(entry));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openContextMenu(e.clientX, e.clientY, [
        { label: entry.type === 'dir' ? 'Open' : 'Open file', icon: icon('chevronRight'), action: () => openEntry(entry) },
        entry.type === 'dir' ? { label: 'Open in Terminal', icon: icon('terminal'), action: () => openApp('terminal', { dir: entry.path }) } : null,
        { label: 'Open in VS Code', icon: icon('code'), action: () => openApp('vscode', { dir: entry.path }) },
        { label: 'Show in system explorer', icon: icon('external'), action: () => devos.sh.showInFolder(entry.path) },
        'separator',
        { label: 'Rename', icon: icon('edit'), key: 'F2', action: () => renameEntry(entry) },
        { label: 'Delete', icon: icon('trash'), key: 'Del', danger: true, action: () => deleteEntry(entry) },
      ].filter(Boolean));
    });
  }

  async function openEntry(entry) {
    if (entry.type === 'dir') {
      navigate(entry.path);
      return;
    }
    const res = await devos.sh.openPath(entry.path);
    if (!res.ok) toast('File Explorer', res.message || 'Cannot open file', 'err');
  }

  async function renameEntry(entry) {
    const newName = prompt('Rename to:', entry.name);
    if (!newName || newName === entry.name) return;
    try {
      const sep = pathSep(entry.path);
      const parent = parentPath(entry.path);
      await devos.fs.rename(entry.path, parent.endsWith(sep) ? parent + newName : parent + sep + newName);
      refresh();
    } catch (err) {
      toast('File Explorer', `Rename failed: ${err.message}`, 'err');
    }
  }

  async function deleteEntry(entry) {
    if (!confirm(`Delete "${entry.name}"${entry.type === 'dir' ? ' and its contents' : ''}?`)) return;
    try {
      await devos.fs.del(entry.path, true);
      refresh();
      toast('File Explorer', `Deleted ${entry.name}`, 'ok');
    } catch (err) {
      toast('File Explorer', `Delete failed: ${err.message}`, 'err');
    }
  }

  // ---- sidebar ----
  async function renderQuick() {
    if (!home) home = await devos.fs.home().catch(() => '');
    regions.quick.innerHTML = '';
    for (const q of QUICK_DIRS(home)) {
      const item = document.createElement('div');
      item.className = 'fx-tree-item';
      item.innerHTML = `${icon(q.iconName)}<span></span>`;
      item.querySelector('span').textContent = q.label;
      item.addEventListener('click', async () => {
        // Prefer the path that exists (Windows backslash first, unix fallback).
        try { await devos.fs.list(q.path); navigate(q.path); }
        catch { try { await devos.fs.list(q.alt); navigate(q.alt); } catch { navigate(q.path); } }
      });
      regions.quick.appendChild(item);
    }
    const drives = await devos.sys.drives().catch(() => []);
    for (const d of drives.slice(0, 4)) {
      const item = document.createElement('div');
      item.className = 'fx-tree-item';
      item.innerHTML = `${icon('disk')}<span></span>`;
      item.querySelector('span').textContent = `${d.id} disk`;
      item.addEventListener('click', () => navigate(d.id));
      regions.quick.appendChild(item);
    }
  }

  async function renderTree() {
    // Lazy tree under home root.
    if (!home) home = await devos.fs.home().catch(() => '');
    if (!home || treeCache.has('built')) { renderTreeNodes(regions.tree, home, 2); return; }
    treeCache.set('built', true);
    renderTreeNodes(regions.tree, home, 2);
  }

  async function renderTreeNodes(container, dir, depth) {
    container.innerHTML = '';
    if (!dir || depth <= 0) return;
    let listing;
    try { listing = await devos.fs.list(dir); } catch { return; }
    const dirs = listing.entries.filter(isDir).filter((d) => !d.name.startsWith('.'));
    for (const d of dirs.slice(0, 30)) {
      const node = document.createElement('div');
      const item = document.createElement('div');
      item.className = 'fx-tree-item';
      const isOpen = expanded.has(d.path);
      item.innerHTML = `<span class="tw">${icon(isOpen ? 'chevronDown' : 'chevronRight')}</span>${icon(isOpen ? 'folderOpen' : 'folder')}<span></span>`;
      item.querySelector('span:last-child').textContent = d.name;
      if (d.path === cwd) item.classList.add('active');
      const kids = document.createElement('div');
      kids.className = 'fx-tree-kids';
      kids.style.display = isOpen ? '' : 'none';
      item.addEventListener('click', (e) => {
        if (e.target.closest('.tw') && !isOpen) {
          expanded.add(d.path);
          if (!treeCache.has(d.path)) {
            treeCache.set(d.path, true);
            renderTreeNodes(kids, d.path, depth - 1);
          }
          kids.style.display = '';
          refreshTreeItem(item);
        } else if (e.target.closest('.tw')) {
          expanded.delete(d.path);
          kids.style.display = 'none';
          refreshTreeItem(item);
        } else {
          navigate(d.path);
        }
      });
      node.appendChild(item);
      node.appendChild(kids);
      container.appendChild(node);
    }
  }

  function refreshTreeItem(item) {
    // Re-render entire tree after expand/collapse (cheap enough at this depth).
    renderTree();
  }

  // ---- search ----
  let searchTimer = null;
  regions.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 250);
  });

  async function runSearch() {
    const q = regions.search.value.trim();
    if (!q) {
      searchMode = false;
      refresh();
      return;
    }
    searchMode = true;
    searchResults = await devos.fs.search(cwd, q, 80).catch(() => []);
    renderContent(searchResults.map((r) => ({ ...r, ext: r.name.split('.').pop().toLowerCase(), size: 0, mtime: 0 })));
    regions.count.textContent = `${searchResults.length} result${searchResults.length === 1 ? '' : 's'} for "${q}"`;
  }

  // ---- toolbar ----
  root.querySelector('[data-act="back"]').addEventListener('click', goBack);
  root.querySelector('[data-act="up"]').addEventListener('click', goUp);
  root.querySelector('[data-act="refresh"]').addEventListener('click', refresh);
  root.querySelector('[data-act="view"]').addEventListener('click', () => {
    view = view === 'list' ? 'grid' : 'list';
    refresh();
  });
  root.querySelector('[data-act="code"]').addEventListener('click', async () => {
    const res = await devos.sh.launch('vscode', cwd);
    if (!res.ok) toast('VS Code', `${res.message}${res.hint ? ` — ${res.hint}` : ''}`, 'err', 7000);
    else toast('VS Code', res.message || 'Launching…', 'ok');
  });
  root.querySelector('[data-act="term"]').addEventListener('click', () => openApp('terminal', { dir: cwd }));
  root.querySelector('[data-act="mkdir"]').addEventListener('click', async () => {
    const name = prompt('New folder name:', 'new-folder');
    if (!name) return;
    try {
      await devos.fs.mkdir(joinPath(cwd, name));
      refresh();
      toast('File Explorer', `Created ${name}`, 'ok');
    } catch (err) {
      toast('File Explorer', `mkdir failed: ${err.message}`, 'err');
    }
  });

  function refresh() {
    if (searchMode) runSearch();
    else navigate(cwd, { push: false });
  }

  // ---- context menu on empty space ----
  root.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.fx-row, .fx-tile, .fx-tree-item')) return;
    e.preventDefault();
    openContextMenu(e.clientX, e.clientY, [
      { label: 'Refresh', icon: icon('refresh'), action: refresh },
      { label: 'New folder', icon: icon('folder'), action: () => root.querySelector('[data-act="mkdir"]').click() },
      { label: 'Open in Terminal', icon: icon('terminal'), action: () => openApp('terminal', { dir: cwd }) },
      { label: 'Open in VS Code', icon: icon('code'), action: () => openApp('vscode', { dir: cwd }) },
      { label: 'Open in system explorer', icon: icon('external'), action: () => devos.sh.openPath(cwd) },
    ]);
  });

  // ---- boot ----
  (async () => {
    home = await devos.fs.home().catch(() => '');
    navigate(opts.dir || home);
  })();

  return win;
}
