#!/usr/bin/env node
'use strict';

// DevOS — smoke test.
// Verifies syntax of every source file, checks that preload/IPC channel
// names match, and validates that index.html references only existing files.

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
let failures = 0;

function ok(label) { console.log(`  ✓ ${label}`); }
function fail(label, extra = '') { failures += 1; console.error(`  ✗ ${label} ${extra}`); }

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function checkSyntax(file, mode) {
  const args = ['--check'];
  if (mode === 'esm') {
    // Copy to a temp .mjs so Node parses it as an ES module.
    const tmp = path.join(require('os').tmpdir(), `devos-check-${Date.now()}-${path.basename(file)}.mjs`);
    fs.copyFileSync(file, tmp);
    const res = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
    fs.unlinkSync(tmp);
    return res;
  }
  return spawnSync(process.execPath, [...args, file], { encoding: 'utf8' });
}

console.log('DevOS smoke test');
console.log('----------------');

// 1. Syntax checks
const mainFiles = walk(path.join(ROOT, 'src', 'main')).concat(walk(path.join(ROOT, 'src', 'preload')));
for (const file of mainFiles) {
  const res = checkSyntax(file, 'cjs');
  res.status === 0 ? ok(`syntax ${path.relative(ROOT, file)}`) : fail(`syntax ${path.relative(ROOT, file)}`, res.stderr);
}

const rendererJs = walk(path.join(ROOT, 'src', 'renderer', 'js')).filter((f) => f.endsWith('.js'));
for (const file of rendererJs) {
  const res = checkSyntax(file, 'esm');
  res.status === 0 ? ok(`syntax ${path.relative(ROOT, file)}`) : fail(`syntax ${path.relative(ROOT, file)}`, res.stderr);
}

// 2. index.html references exist
const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:href|src)="(\.[^"]+)"/g)].map((m) => m[1]);
for (const ref of refs) {
  const target = path.join(ROOT, 'src', 'renderer', ref);
  fs.existsSync(target) ? ok(`asset ${ref}`) : fail(`asset ${ref}`, '— referenced by index.html but missing');
}

// 3. Preload channels vs ipc handlers
const preload = fs.readFileSync(path.join(ROOT, 'src', 'preload', 'preload.js'), 'utf8');
const ipc = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipc.js'), 'utf8');
const invoked = [...preload.matchAll(/invoke\('([a-z:]+)'/gi)].map((m) => m[1]);
for (const ch of invoked) {
  ipc.includes(`'${ch}'`) ? ok(`ipc channel ${ch}`) : fail(`ipc channel ${ch}`, '— invoked in preload but not registered in main');
}

// 3b. Payload shape consistency: preload sends `{ key: … }` objects, so every
// main-process handler for that channel must reference the same keys.
const invokeCalls = [...preload.matchAll(/invoke\('([a-z:]+)',\s*\{([^}]*)\}\)/gi)];
for (const [, ch, keysRaw] of invokeCalls) {
  const keys = keysRaw.split(',').map((k) => k.trim().split(':')[0].trim()).filter(Boolean);
  if (!keys.length) continue;
  const handlerMatch = ipc.match(new RegExp(`ipcMain\\.handle\\('${ch.replace(/:/g, '\\:')}',[^)]*\\)([\\s\\S]{0,400})`));
  if (!handlerMatch) continue; // already reported by 3 if missing
  const body = handlerMatch[1];
  // Extract destructured names from the handler's parameter list plus first lines.
  const paramArea = body.slice(0, 200);
  const destructured = [...paramArea.matchAll(/\{\s*([^}]*)\s*\}\s*=/g)].flatMap((m) =>
    m[1].split(',').map((s) => s.trim().split(':')[0].replace(/ =.*/, '').trim()));
  const missing = keys.filter((k) => !destructured.includes(k) && !paramArea.includes(`.${k}`) && !paramArea.includes(k));
  if (destructured.length && missing.length) {
    fail(`ipc payload ${ch}`, `— preload sends { ${keys.join(', ')} } but handler destructures [${destructured.join(', ')}]`);
  } else {
    ok(`ipc payload ${ch} { ${keys.join(', ')} }`);
  }
}

// 4. Critical files exist
for (const rel of ['package.json', 'assets/icons/devos.png', 'assets/icons/devos.ico', 'assets/icons/tray.png']) {
  fs.existsSync(path.join(ROOT, rel)) ? ok(`present ${rel}`) : fail(`present ${rel}`, '— run npm run build:icon');
}

console.log('----------------');
if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('All checks passed.');
