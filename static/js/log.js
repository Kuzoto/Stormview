// Study event logging: batches events and POSTs them to /api/log (server writes logs/<pid>.jsonl).
import { get, set } from './store.js';

let queue = [];
let timerHandle = null;

export function log(type, target = '', detail = null) {
  const s = get();
  const now = Date.now();
  const ev = {
    pid: s.study.pid || 'anon',
    condition: s.study.condition,
    session: s.study.session,
    ts: now,
    iso: new Date(now).toISOString(),
    type,
    screen: location.hash.replace(/^#\/?/, '') || 'home',
    target,
    detail,
    phase: s.phase,
    taskElapsedMs: s.timer ? now - s.timer.startedAt : null,
  };
  queue.push(ev);
  if (!timerHandle) timerHandle = setTimeout(flush, 2500);
}

export async function flush() {
  timerHandle = null;
  if (!queue.length) return;
  const batch = queue;
  queue = [];
  try {
    await fetch('api/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events: batch }), keepalive: true });
  } catch (e) {
    queue = batch.concat(queue); // retry later
  }
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

// Log every tap on an element with data-log (or a button/link) – lightweight click tracking.
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-log], button, a');
  if (!el) return;
  const label = el.getAttribute('data-log') || el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 40);
  log('tap', label);
}, true);
