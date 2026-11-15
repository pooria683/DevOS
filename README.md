# DevOS

**A command-driven, terminal-first developer desktop shell for Windows — built with Electron.**

DevOS is **not** a Windows emulator and runs **no virtual machine**. It is a custom desktop
environment — a UI layer that lives on top of your real Windows system and reshapes it into a
dark, neon, keyboard-driven, developer-focused operating experience: part Windows desktop, part
Linux terminal, part VS Code, part cyberpunk console.

```
 ▄▄▄▄▄ ▄     ▄ ▄▄▄▄▄ ▄▄▄▄▄▄ ▄▄▄▄▄▄
 █     █     █ █     █     █     █
 ▀▀▀▀█ █     █ █     ▀▀▀▀█ █▀▀
 ▄▄▄▄█ ▀▄▄ ▄▄▀ █▄▄▄▄     █ ▀▄▄▄▄▄
```

---

## Features

### Desktop shell
- Full-screen custom desktop: dark futuristic wallpaper with animated grid, scan sweep, optional
  matrix rain, CRT scanlines, vignette and flicker effects
- Desktop icons for **Terminal, File Explorer, VS Code, Browser, Git, Docker, Settings, Task Manager**
- Frameless, draggable, 8-way resizable, minimizable, maximizable, snappable windows
  (drag to top = maximize, to sides = half-screen snap, with live snap preview)
- Bottom taskbar styled like a terminal status bar: running windows, dev-mode LED, network,
  battery, theme switcher, clock, window minimize / quit controls
- **Start menu that works like a command palette** — fuzzy searchable, fully keyboard-driven
  (`↑↓` navigate, `Enter` run, `Esc` close), showing app names, icons and command labels
  like `open terminal`, `open vscode`, `theme matrix`
- Developer-oriented right-click context menus on the desktop, icons, files and taskbar
- Boot sequence animation at startup (skippable, configurable)

### Built-in Terminal (the heart of DevOS)
- Multiple tabs, per-tab persistent working directory, command history (`↑`/`↓`)
- Ghost autocomplete suggestions (`Tab` to accept), path completion for `cd`-style arguments
- ANSI color rendering, streaming output, `Ctrl+C` to kill running commands, `Ctrl+L` to clear
- Built-in commands: `help`, `clear`, `open terminal|vscode|files|browser|settings|git|docker|taskmgr`,
  `theme dark|matrix|cyberpunk|retro|minimal|neon|solarized`, `themes`,
  `developer mode on|off`, `devos`, `history`, `exit`
- **Everything else executes in your real Windows shell** (`cmd.exe`) — `git status`, `npm run dev`,
  `dir`, `ping`, builds, whatever you run today. `cd` persists per tab.

### Real app integration (no simulations)
DevOS launches the **actual installed applications** through Electron's `shell` APIs and
detached processes:
- Windows Terminal (`wt.exe`) with fallback to Command Prompt
- Visual Studio Code (install path detection + `code` on PATH), optionally opening a folder
- Your default browser for any URL
- Windows File Explorer (`explorer.exe`) and `shell.openPath` for files and folders
- Windows Task Manager (`taskmgr.exe`)
- Git Bash (falls back to a terminal session)
- Docker Desktop
- Windows Settings (`ms-settings:`)
- Missing tools are detected (`sh.detect`) and badged, with download links offered

### Developer Mode
Toggle with `Ctrl+Alt+D`, `developer mode on`, the tray LED or Settings. DevOS becomes a
terminal-heavy, coding-first environment:
- Live HUD across the top: **CPU, RAM, Disk, Network status, git branch + dirty count** of the
  active project, and quick actions (`terminal`, `npm run dev`, `git status`, `files`, `vscode`)
- Everything updates in real time (1 s telemetry, 10 s git polling)

### File Explorer
Folder tree with lazy expansion, breadcrumbs, list/grid views, recursive search, quick access
(Home/Desktop/Documents/Downloads/Projects/drives), context menus with rename/delete/new folder,
**Open in VS Code** and **Open in Terminal** buttons — all against your real filesystem.

### Task Manager (in-app)
Live CPU / RAM / Disk / Network cards with sparkline history, drive usage bars, a sortable
process table with **End Task**, a DevOS-window manager — plus a one-click launch of the real
`taskmgr.exe`.

### Git panel & Docker panel
- Git: repository picker, branch, ahead/behind, staged/untracked status, commit log,
  commit -a / pull / push / fetch with an output console, Git Bash launcher
- Docker: version detection, container list (start/stop/logs), image list, Docker Desktop launcher

### Themes
Seven full themes — **Dark IDE, Matrix, Cyberpunk, Retro Terminal, Minimal Black, Neon Green,
Solarized Dark** — each re-skinning backgrounds, accents, window borders, terminal colors,
wallpaper effects and glow. Switch via Start menu, terminal (`theme matrix`), tray or Settings.

### Keyboard shortcuts
| Keys | Action |
|---|---|
| `Ctrl+Alt+T` | New terminal |
| `Ctrl+Alt+E` | File Explorer |
| `Ctrl+Alt+V` | Launch VS Code |
| `Ctrl+Alt+B` | Browser |
| `Ctrl+Alt+G` | Git panel |
| `Ctrl+Alt+M` | Task manager |
| `Ctrl+Alt+D` | Toggle developer mode |
| `Ctrl+\`` | New terminal tab |
| `Ctrl+L` / `Ctrl+C` | Clear / kill (terminal) |
| `Tab`, `↑`/`↓` | Autocomplete, history |
| `F11` | Fullscreen |

---

## Getting started (Windows)

```powershell
npm install     # downloads Electron for your platform
npm start       # launch DevOS
```

Or run during development with DevTools:

```powershell
npm run dev
```

Package a Windows installer (NSIS, x64, per-user, desktop shortcut):

```powershell
npm run dist    # requires electron-builder (npx) and assets/icons/devos.ico (already included)
```

### Browser preview (optional, non-Electron)

```bash
npm run preview   # http://localhost:4173
```

Serves the exact same renderer in a normal browser. Every Electron capability is transparently
replaced by a simulated bridge (virtual filesystem, fake telemetry, simulated app launches), so
the UI can be explored anywhere. The real experience is `npm start` on Windows.

---

## Architecture

```
src/
├─ main/                 Electron main process (Node side)
│  ├─ main.js            app lifecycle, devos:// protocol, frameless window, tray
│  ├─ ipc.js             all ipcMain handlers (fs, shell, terminal, git, stats, config…)
│  ├─ launcher.js        real-app launching (wt, code, explorer, taskmgr, docker, git-bash)
│  ├─ exec.js            terminal sessions: persistent cwd, streamed stdio, process kill
│  ├─ stats.js           CPU/RAM/disk/network/process telemetry (PowerShell/tasklist/df/ps)
│  └─ store.js           JSON config store (userData/devos-config.json)
├─ preload/preload.js    contextBridge — the only surface the renderer can touch
└─ renderer/             the desktop itself (vanilla ES modules, zero frameworks)
   ├─ index.html         CSP-protected shell
   ├─ styles/            base, themes, desktop, windows, taskbar, start menu, terminal, apps
   └─ js/
      ├─ main.js         bootstrap
      ├─ core/           state (pub/sub), bridge resolution, browser mock bridge
      ├─ wm/             window manager (drag/resize/snap/z-order)
      ├─ desktop/        wallpaper canvas, icons, boot sequence, dev-mode HUD
      ├─ shell/          taskbar + tray, start menu, shortcuts
      ├─ themes.js       theme engine
      ├─ ui/             icons, toasts, context menu
      └─ apps/           terminal, files, settings, task manager, git, docker, browser
scripts/
├─ preview-server.js     static server for browser preview
├─ build-ico.js          icon pipeline (ImageMagick → .ico/.png/.tray)
├─ smoke-test.js         syntax + IPC-channel + asset integrity checks
└─ dom-test.js           boots the real renderer in jsdom; 25 end-to-end checks
```

### Security model
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`
- One narrow preload bridge (`window.devos`) with allow-listed IPC channels
- Custom `devos://` protocol serves only files under `src/renderer` (path-traversal guarded)
- `shell.openExternal` restricted to `http(s)`; navigation away from the shell is blocked
- Renderer CSP: `script-src 'self'`, no remote origins, `frame-src 'none'`

### Performance
- No frameworks, no bundler — native ES modules, instant startup
- Wallpaper canvas capped at ~30 fps and paused when hidden; DPR-clamped rendering
- Telemetry runs only while the app is visible; output buffers are trimmed

---

## Tests

```bash
npm test         # smoke test (syntax, IPC channel pairing, assets) + DOM runtime test
npm run build:icon   # rebuild icons from assets/icons/devos-src.png (needs ImageMagick)
```

## License

MIT
