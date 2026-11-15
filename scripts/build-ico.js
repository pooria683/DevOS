#!/usr/bin/env node
'use strict';

// DevOS — build the application icon set from assets/icons/devos-src.png.
// Produces:
//   assets/icons/devos.ico  (multi-resolution Windows icon)
//   assets/icons/devos.png  (512px, used for the window icon)
//   assets/icons/tray.png   (32px, used for the tray)
//
// Requires ImageMagick (`convert` or `magick`) on PATH.

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'icons', 'devos-src.png');
const OUT = path.join(ROOT, 'assets', 'icons');

if (!fs.existsSync(SRC)) {
  console.error(`Source icon not found: ${SRC}`);
  process.exit(1);
}

function findMagick() {
  for (const cmd of ['magick', 'convert']) {
    try {
      execFileSync(cmd, ['-version'], { stdio: 'ignore' });
      return cmd;
    } catch { /* try next */ }
  }
  console.error('ImageMagick not found. Install it or run: npm run build:icon');
  process.exit(1);
}

const magick = findMagick();

console.log('Building devos.ico (256/128/64/48/32/16)…');
execFileSync(magick, [
  SRC,
  '-resize', '256x256',
  '-define', 'icon:auto-resize=256,128,64,48,32,16',
  path.join(OUT, 'devos.ico'),
], { stdio: 'inherit' });

console.log('Building devos.png (512)…');
execFileSync(magick, [SRC, '-resize', '512x512', path.join(OUT, 'devos.png')], { stdio: 'inherit' });

console.log('Building tray.png (32)…');
execFileSync(magick, [SRC, '-resize', '32x32', path.join(OUT, 'tray.png')], { stdio: 'inherit' });

console.log('Icon set built.');
