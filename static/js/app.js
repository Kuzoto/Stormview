import { html, render, useState, useEffect } from '../vendor/preact-htm.js';
import { loadScenario, useStore, set, get, phase, isLive } from './store.js';
import { startLive } from './live.js';
import { log, flush } from './log.js';
import { health } from './api.js';
import { Icon, AlertBanner, SheetHost, Toasts, NotifBanner, Modal, nav, navTab } from './ui.js';

import { LockScreen } from './screens/lock.js';
import { Home } from './screens/home.js';
import { Impact } from './screens/impact.js';
import { MapScreen } from './screens/map.js';
import { Ask } from './screens/ask.js';
import { CheckIn } from './screens/checkin.js';
import { More } from './screens/more.js';
import { Forecast } from './screens/forecast.js';
import { Reports } from './screens/reports.js';
import { Sources } from './screens/sources.js';
import { Places } from './screens/places.js';
import { Admin } from './screens/admin.js';
import { Join } from './screens/join.js';
import { startCircle } from './circle.js';

// ---------------------------------------------------------------- hash router with a back stack
function parseHash() {
  const h = location.hash.replace(/^#/, '') || (isLive() ? '/home' : '/lock');
  const [path, qs] = h.split('?');
  return { path, parts: path.split('/').filter(Boolean), query: Object.fromEntries(new URLSearchParams(qs || '')) };
}
const stack = [];
let lastDir = 'fade';
function trackNav() {
  const h = location.hash || (isLive() ? '#/home' : '#/lock');
  if (window.__tabNav) { stack.length = 0; stack.push(h); window.__tabNav = false; lastDir = 'fade'; }
  else if (stack.length > 1 && stack[stack.length - 2] === h) { stack.pop(); lastDir = 'back'; }
  else if (stack[stack.length - 1] !== h) { stack.push(h); lastDir = stack.length > 1 ? 'push' : 'fade'; }
  window.__navDepth = stack.length - 1;
}

function useRoute() {
  const [r, setR] = useState(parseHash());
  useEffect(() => {
    // Closing any open sheet on navigation makes the Android/browser back button dismiss it.
    const on = () => { trackNav(); if (get().sheet) set({ sheet: null }); setR(parseHash()); };
    trackNav();
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}

const TABS = [
  { path: '/home', label: 'Home', icon: 'home' },
  { path: '/map', label: 'Map', icon: 'map' },
  { path: '/checkin', label: 'Check-In', icon: 'shield' },
  { path: '/ask', label: 'Ask / Help', icon: 'chat', accent: true },
  { path: '/more', label: 'More', icon: 'more' },
];
const TAB_OF = { impact: '/home', home: '/home', map: '/map', checkin: '/checkin', ask: '/ask',
  more: '/more', forecast: '/more', reports: '/more', sources: '/more', places: '/more', join: '/checkin' };

function TabBar({ route }) {
  const s = useStore();
  const active = TAB_OF[route.parts[0]] || '/home';
  const lvl = phase(s).level;
  const pinged = isLive(s) && s.circleLive && (s.circleLive.pings || []).length > 0;
  const needsCheckin = pinged || (s.checkin.status === 'none' && (isLive(s) ? lvl === 'warning' : lvl !== 'clear'));
  return html`<nav class="tabbar" aria-label="Main">
    ${TABS.map((t) => html`<button class=${'tab' + (active === t.path ? ' on' : '') + (t.accent ? ' accent' : '')}
        aria-current=${active === t.path ? 'page' : undefined} onClick=${() => navTab(t.path)} data-log=${'tab ' + t.label}>
      <span class="tab-ic"><${Icon} n=${t.icon} size=${24} />${t.path === '/checkin' && needsCheckin ? html`<span class="badge-dot"></span>` : ''}</span>
      <span class="tab-lbl">${t.label}</span>
    </button>`)}
  </nav>`;
}

// ---------------------------------------------------------------- study timer + Likert completion question
function TimerPill() {
  const s = useStore();
  const [, tick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => {
      tick((x) => x + 1);
      const st = get();
      if (st.timer && !st.likertOpen && Date.now() >= st.timer.startedAt + st.timer.durationMs) {
        log('timer_end', '', { durationMs: st.timer.durationMs });
        set({ likertOpen: true });
      }
    }, 250);
    return () => clearInterval(i);
  }, []);
  if (!s.timer) return null;
  const left = Math.max(0, s.timer.startedAt + s.timer.durationMs - Date.now());
  if (!s.study.showTimer) return null;
  return html`<div class=${'timer-pill' + (left < 10000 ? ' low' : '')}>${Math.ceil(left / 1000)}s</div>`;
}

function Likert() {
  const s = useStore();
  const [safety, setSafety] = useState(null);
  const [informed, setInformed] = useState(null);
  if (!s.likertOpen) return null;
  const scale = (val, setV, lo, hi) => html`<div class="likert">
    ${[1, 2, 3, 4, 5].map((i) => html`<button class=${'lk' + (val === i ? ' on' : '')} onClick=${() => setV(i)}>${i}</button>`)}
    <div class="lk-ends"><span>${lo}</span><span>${hi}</span></div></div>`;
  const submit = () => {
    log('likert', 'task_end', { safety, informed, condition: s.study.condition });
    flush();
    set({ likertOpen: false, timer: null, likertDone: { safety, informed, at: Date.now() } });
  };
  return html`<${Modal} title="Time's up. Two quick questions" onClose=${() => {}}>
    <p class="small muted">Answer based on what you found.</p>
    <div class="mt12"><strong>How safe do you feel about your situation right now?</strong></div>
    ${scale(safety, setSafety, 'Not at all safe', 'Very safe')}
    <div class="mt12"><strong>How informed do you feel about power, water and shelter where you are?</strong></div>
    ${scale(informed, setInformed, 'Not informed', 'Very informed')}
    <button class="btn primary full mt12" disabled=${!safety || !informed} onClick=${submit}>Submit</button>
  </${Modal}>`;
}

// ---------------------------------------------------------------- shell
function StatusBar() {
  const s = useStore();
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick((x) => x + 1), 20000); return () => clearInterval(i); }, []);
  // Live mode shows the real time; the scenario shows its simulated clock.
  const clk = isLive(s) ? new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : phase(s).clock;
  return html`<div class="fake-status" aria-hidden="true"><span>${clk.replace(/ [AP]M$/, '')}</span>
    <span class="fs-r">${s.offline ? 'No Service' : '●●●● 5G'} ▮</span></div>`;
}

function Screen({ route }) {
  const p = route.parts[0] || 'lock';
  switch (p) {
    case 'lock': return html`<${LockScreen} />`;
    case 'home': return html`<${Home} />`;
    case 'impact': return html`<${Impact} id=${route.parts[1]} />`;
    case 'map': return html`<${MapScreen} query=${route.query} />`;
    case 'ask': return html`<${Ask} query=${route.query} />`;
    case 'checkin': return html`<${CheckIn} />`;
    case 'more': return html`<${More} />`;
    case 'forecast': return html`<${Forecast} />`;
    case 'reports': return html`<${Reports} />`;
    case 'sources': return html`<${Sources} />`;
    case 'places': return html`<${Places} />`;
    case 'admin': return html`<${Admin} />`;
    case 'join': return html`<${Join} code=${route.parts[1]} />`;
    default: return html`<${Home} />`;
  }
}

function App() {
  const route = useRoute();
  const p = route.parts[0] || 'lock';
  useEffect(() => { log('view', route.path, route.query && Object.keys(route.query).length ? route.query : null); }, [route.path, JSON.stringify(route.query)]);
  const chrome = p !== 'lock' && p !== 'admin';
  return html`<div class=${'app' + (p === 'lock' ? ' is-lock' : '')}>
    <${StatusBar} />
    <${NotifBanner} />
    ${chrome ? html`<${AlertBanner} />` : ''}
    <${TimerPill} />
    <main class=${'screen enter-' + lastDir} key=${route.path}><${Screen} route=${route} /></main>
    ${chrome ? html`<${TabBar} route=${route} />` : ''}
    <${SheetHost} />
    <${Toasts} />
    <${Likert} />
  </div>`;
}

// ---------------------------------------------------------------- boot
(async function boot() {
  await loadScenario();
  if (new URLSearchParams(location.search).get('admin') === '1') {
    history.replaceState(null, '', location.pathname + '#/admin');
  }
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  document.documentElement.classList.toggle('standalone', !!standalone);
  render(html`<${App} />`, document.getElementById('app'));
  health();
  if (isLive()) { startLive(); if (get().profile && get().profile.token) startCircle(); }
  window.addEventListener('online', () => { if (get().offline === 'auto') set({ offline: false }); });
  window.addEventListener('offline', () => set({ offline: 'auto' }));
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
