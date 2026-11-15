// DevOS — toast notifications (bottom-right, above taskbar).

import { icon } from './icons.js';

const container = () => document.getElementById('toasts');

export function toast(title, body = '', kind = 'info', ms = 4200) {
  const host = container();
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast${kind === 'err' ? ' err' : kind === 'ok' ? ' ok' : ''}`;
  const iconName = kind === 'err' ? 'alert' : kind === 'ok' ? 'check' : 'info';
  el.innerHTML = `
    <span class="ti">${icon(iconName)}</span>
    <div>
      <div class="tt"></div>
      <div class="tb"></div>
    </div>`;
  el.querySelector('.tt').textContent = title;
  el.querySelector('.tb').textContent = body;
  el.addEventListener('click', () => dismiss());
  host.appendChild(el);

  const timer = setTimeout(() => dismiss(), ms);
  function dismiss() {
    clearTimeout(timer);
    el.classList.add('out');
    setTimeout(() => el.remove(), 280);
  }
  // Keep at most 5 toasts.
  while (host.children.length > 5) host.firstChild.remove();
  return dismiss;
}
