// DevOS — animated wallpaper: perspective grid, scan sweep, optional matrix rain.

import { state, on } from '../core/state.js';

let canvas = null;
let ctx = null;
let raf = 0;
let last = 0;
let rainColumns = [];
let time = 0;

const THEME_COLORS = {
  darkide: { grid: 'rgba(56,189,248,0.055)', accent: '34,211,238', rain: 'rgba(34,211,238,' },
  matrix: { grid: 'rgba(34,197,94,0.07)', accent: '34,197,94', rain: 'rgba(34,197,94,' },
  cyberpunk: { grid: 'rgba(255,47,179,0.07)', accent: '255,47,179', rain: 'rgba(0,229,255,' },
  retro: { grid: 'rgba(255,176,0,0.06)', accent: '255,176,0', rain: 'rgba(255,176,0,' },
  minimal: { grid: 'rgba(255,255,255,0.035)', accent: '232,232,232', rain: 'rgba(232,232,232,' },
  neon: { grid: 'rgba(0,255,163,0.07)', accent: '0,255,163', rain: 'rgba(0,255,163,' },
  solarized: { grid: 'rgba(42,161,152,0.06)', accent: '42,161,152', rain: 'rgba(42,161,152,' },
};

function colors() {
  return THEME_COLORS[state.theme] || THEME_COLORS.darkide;
}

function resize() {
  if (!canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  initRain();
}

function initRain() {
  const cols = Math.floor(window.innerWidth / 18);
  rainColumns = Array.from({ length: cols }, () => ({
    y: Math.random() * -window.innerHeight,
    speed: 60 + Math.random() * 140,
    trail: 8 + Math.floor(Math.random() * 14),
  }));
}

function drawGrid(c) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  ctx.strokeStyle = c.grid;
  ctx.lineWidth = 1;
  const gap = 44;
  ctx.beginPath();
  for (let x = (time * 0.004) % gap; x < w; x += gap) {
    ctx.moveTo(Math.floor(x) + 0.5, 0);
    ctx.lineTo(Math.floor(x) + 0.5, h);
  }
  for (let y = (time * 0.008) % gap; y < h; y += gap) {
    ctx.moveTo(0, Math.floor(y) + 0.5);
    ctx.lineTo(w, Math.floor(y) + 0.5);
  }
  ctx.stroke();
}

function drawRain(c, dt) {
  const w = window.innerWidth;
  const fontSize = 14;
  ctx.font = `${fontSize}px "Cascadia Code", Consolas, monospace`;
  const chars = 'アイウエオカキクケコサシスセソ0123456789ABCDEF<>/\\{}[]$#*+=';
  rainColumns.forEach((col, i) => {
    col.y += col.speed * dt;
    if (col.y - col.trail * fontSize > window.innerHeight) {
      col.y = Math.random() * -200;
      col.speed = 60 + Math.random() * 140;
    }
    for (let t = 0; t < col.trail; t++) {
      const y = col.y - t * fontSize;
      if (y < -fontSize || y > window.innerHeight + fontSize) continue;
      const alpha = t === 0 ? 0.85 : 0.32 * (1 - t / col.trail);
      const ch = chars[(i * 7 + t * 13 + Math.floor(time / 120)) % chars.length];
      ctx.fillStyle = `${c.rain}${alpha.toFixed(2)})`;
      ctx.fillText(ch, i * 18, y);
    }
  });
}

function drawSweep(c) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const sweepY = ((time * 0.045) % (h + 220)) - 110;
  const grad = ctx.createLinearGradient(0, sweepY - 80, 0, sweepY + 80);
  grad.addColorStop(0, `rgba(${c.accent},0)`);
  grad.addColorStop(0.5, `rgba(${c.accent},0.045)`);
  grad.addColorStop(1, `rgba(${c.accent},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, sweepY - 80, w, 160);
}

function frame(ts) {
  raf = requestAnimationFrame(frame);
  if (document.hidden) return;
  if (ts - last < 33) return; // ~30 fps
  const dt = Math.min(0.1, (ts - last) / 1000);
  last = ts;
  time = ts;

  const c = colors();
  const w = window.innerWidth;
  const h = window.innerHeight;
  ctx.clearRect(0, 0, w, h);

  if (state.effects?.grid) drawGrid(c);
  drawSweep(c);
  if (state.effects?.matrixRain || state.theme === 'matrix') drawRain(c, dt);
}

export function initWallpaper() {
  canvas = document.getElementById('wallpaper');
  ctx = canvas.getContext('2d');
  window.addEventListener('resize', resize);
  resize();
  raf = requestAnimationFrame(frame);
  on('change:theme', () => { time = 0; initRain(); });
}

export function refreshWallpaper() {
  time = 0;
  if (ctx) initRain();
}
