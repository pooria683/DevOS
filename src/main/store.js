'use strict';

const path = require('path');
const fs = require('fs');

const DEFAULTS = {
  theme: 'darkide',
  developerMode: false,
  startMaximized: true,
  effects: {
    scanlines: true,
    grid: true,
    matrixRain: false,
    glow: true,
    flicker: false,
    bootSequence: true,
  },
  desktopIcons: {},
  activeProject: '',
};

/**
 * Minimal JSON config store persisted in the app's userData directory.
 * No external dependencies; debounced writes.
 */
class ConfigStore {
  constructor() {
    this._ready = false;
    this._data = { ...DEFAULTS, effects: { ...DEFAULTS.effects }, desktopIcons: {} };
    this._timer = null;
    try {
      const { app } = require('electron');
      if (app.isReady ? app.isReady() : true) this._load();
      else app.whenReady().then(() => this._load());
    } catch {
      this._ready = true;
    }
  }

  _file() {
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'devos-config.json');
  }

  _load() {
    try {
      const file = this._file();
      if (fs.existsSync(file)) {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        this._data = this._merge(this._data, parsed);
      }
    } catch {
      // Corrupt config: fall back to defaults.
    }
    this._ready = true;
  }

  _merge(base, patch) {
    const out = Array.isArray(base) ? [...base] : { ...base };
    for (const k of Object.keys(patch || {})) {
      const v = patch[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
        out[k] = this._merge(base[k], v);
      } else if (v !== undefined) {
        out[k] = v;
      }
    }
    return out;
  }

  get all() {
    return this._data;
  }

  get(key) {
    return this._data[key];
  }

  set(key, value) {
    this._data = this._merge(this._data, { [key]: value });
    this._save();
  }

  patch(obj) {
    this._data = this._merge(this._data, obj || {});
    this._save();
  }

  _save() {
    if (!this._ready) return;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      try {
        fs.mkdirSync(path.dirname(this._file()), { recursive: true });
        fs.writeFileSync(this._file(), JSON.stringify(this._data, null, 2), 'utf8');
      } catch {
        // Disk may be unavailable; keep running with in-memory config.
      }
    }, 150);
  }
}

module.exports = { ConfigStore, DEFAULTS };
