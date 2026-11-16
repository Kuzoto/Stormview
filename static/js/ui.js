// Shared UI components.
import { html, useState, useEffect } from '../vendor/preact-htm.js';
import { SC, useStore, set, get, phase, openSheet, closeSheet, placeName } from './store.js';
import { log } from './log.js';

export const APP_NAME = 'StormWise';

// ---------------------------------------------------------------- navigation
export function nav(path) {
  if (location.hash !== '#' + path) location.hash = path;
}
export function navTab(path) { window.__tabNav = true; nav(path); }
export function back(fallback = '/home') {
  if (window.__navDepth > 0) history.back();
  else nav(fallback);
}

// ---------------------------------------------------------------- icons (inline SVG, 24px grid)
const P = {
  home: 'M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z',
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zm0 0v14m6-12v14',
  shield: 'M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3zm-3.5 9 2.5 2.5 4.5-5',
  chat: 'M4 5h16v11H8l-4 4V5zm4 5h.01M12 10h.01M16 10h.01',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  menu: 'M4 6h16M4 12h16M4 18h16',
  back: 'M15 5l-7 7 7 7',
  chev: 'M9 5l7 7-7 7',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7l1-8z',
  drop: 'M12 3s7 7.6 7 12a7 7 0 1 1-14 0c0-4.4 7-12 7-12z',
  road: 'M6 21 9 3m9 18-3-18M12 5v2m0 4v2m0 4v2',
  shelter: 'M3 11 12 4l9 7M5 10v10h14V10M10 20v-6h4v6',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zm0-11v6m0-9h.01',
  alert: 'M12 3 2 20h20L12 3zm0 6v5m0 3h.01',
  check: 'M5 12.5 10 17 19 7',
  checkc: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM7.5 12.5l3 3 6-6.5',
  q: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zm-2.5-13a2.6 2.6 0 0 1 5 1c0 2-2.5 2.2-2.5 4m0 3h.01',
  plus: 'M12 5v14M5 12h14',
  send: 'M4 12 20 4l-6 16-3-7-7-1z',
  pin: 'M12 22s7-6.4 7-12a7 7 0 1 0-14 0c0 5.6 7 12 7 12zm0-9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zm0-15v5l3 2',
  wifioff: 'M2 8.5a16 16 0 0 1 5-3m4-.5a16 16 0 0 1 11 3.5M5 12a11 11 0 0 1 4-2.4M15 9.8A11 11 0 0 1 19 12M8.5 15.5a5 5 0 0 1 7 0M12 19h.01M3 3l18 18',
  layers: 'M12 3 2 8l10 5 10-5-10-5zm-10 9 10 5 10-5M2 16l10 5 10-5',
  route: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm12-10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 15V9a4 4 0 0 1 4-4h2m-4 14h6a4 4 0 0 0 4-4V9',
  chart: 'M4 20V4m0 16h16M8 16v-5m4 5V8m4 8v-3',
  people: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 10c0-3.9 3.1-7 7-7s7 3.1 7 7M17 11a3 3 0 1 0 0-6m2 16c0-3-1.4-5.4-3.5-6.5',
  doc: 'M6 2h9l5 5v15H6V2zm9 0v5h5M9 13h8M9 17h8',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-4L10 5.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.5 2.6h4l.5-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
  x: 'M6 6l12 12M18 6 6 18',
  ext: 'M14 4h6v6m0-6L10 14M18 14v6H4V6h6',
  car: 'M5 16h14M6 16l1.5-6h9L18 16M5 16v3h2v-3m10 0v3h2v-3M8 13h.01M16 13h.01',
  edit: 'M4 20h4L20 8l-4-4L4 16v4z',
  camera: 'M4 7h4l2-3h4l2 3h4v13H4V7zm8 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
};
export function Icon({ n, size = 22, stroke = 2, cls = '' }) {
  return html`<svg class=${'ic ' + cls} width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width=${stroke} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${P[n] || P.info} /></svg>`;
}

// ---------------------------------------------------------------- markdown-lite (escaped first, so safe)
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function mdToHtml(text) {
  const lines = esc(String(text || '')).split(/\n/);
  let out = '', list = null;
  const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const close = () => { if (list) { out += `</${list}>`; list = null; } };
  for (const raw of lines) {
    const l = raw.trim();
    let m;
    if ((m = l.match(/^[-•*]\s+(.*)/))) { if (list !== 'ul') { close(); out += '<ul>'; list = 'ul'; } out += `<li>${inline(m[1])}</li>`; }
    else if ((m = l.match(/^\d+[.)]\s+(.*)/))) { if (list !== 'ol') { close(); out += '<ol>'; list = 'ol'; } out += `<li>${inline(m[1])}</li>`; }
    else if (!l) { close(); }
    else { close(); out += `<p>${inline(l)}</p>`; }
  }
  close();
  return out;
}
export const Md = ({ text, cls = '' }) => html`<div class=${'md ' + cls} dangerouslySetInnerHTML=${{ __html: mdToHtml(text) }} />`;

// ---------------------------------------------------------------- sources (D1: sources next to the claims they support)
export const SHORT = {
  nws_warn: 'NWS', nws_radar: 'NWS radar', nws_fcst: 'NWS forecast', dte: 'DTE Energy', a2water: 'City water',
  ycua: 'YCUA water', a2roads: 'City roads', wcem: 'County EM', ready: 'Ready.gov', neighbor: 'Neighbors',
};

export function SourceChip({ ids = [], claim = '', light = false }) {
  if (!ids.length) return null;
  const off = ids.filter((i) => SC.sources[i] && SC.sources[i].kind === 'official');
  const onlyCommunity = off.length === 0;
  const first = off[0] || ids[0];
  const label = SHORT[first] || first;
  const more = ids.length - 1;
  const open = (e) => {
    e.stopPropagation();
    e.preventDefault();
    log('source_open', ids.join(','), { claim });
    openSheet({ type: 'sources', ids, claim });
  };
  return html`<button class=${'src-chip' + (onlyCommunity ? ' community' : '') + (light ? ' light' : '')}
      onClick=${open} aria-label=${'Sources: ' + ids.map((i) => SC.sources[i]?.name).join(', ')} data-log=${'source chip: ' + ids.join(',')}>
    <span class="src-mark">${onlyCommunity ? '?' : '✓'}</span>${label}${more > 0 ? html`<span class="src-more">+${more}</span>` : ''}
  </button>`;
}

export function SourceList({ ids, claim }) {
  const s = useStore();
  const ph = phase(s);
  return html`<div class="sheet-body">
    ${claim ? html`<div class="claim">“${claim}”</div>` : ''}
    <div class="muted small">Reported by ${ids.length} source${ids.length > 1 ? 's' : ''} · as of ${ph.clock}</div>
    ${ids.map((id) => {
      const src = SC.sources[id];
      if (!src) return null;
      const official = src.kind === 'official';
      return html`<div class="src-row">
        <div class=${'src-badge ' + (official ? 'off' : 'com')}>${official ? '✓' : '?'}</div>
        <div class="grow">
          <div class="src-name">${src.name}</div>
          <div class="muted small">${official ? 'Official source' : 'Community report: not verified'} · ${src.org}</div>
          <div class="small">${src.about}</div>
          ${src.url && !s.offline ? html`<a class="link small" href=${src.url} target="_blank" rel="noopener">Open ${src.org} website <${Icon} n="ext" size=${13} /></a>` : ''}
        </div>
      </div>`;
    })}
    <button class="btn ghost full" onClick=${() => { closeSheet(); nav('/sources'); }}>See all sources</button>
  </div>`;
}

// ---------------------------------------------------------------- persistent alert banner (D6)
export function AlertBanner() {
  const s = useStore();
  const ph = phase(s);
  const b = ph.banner;
  const cls = s.offline ? 'offline' : ph.level;
  return html`<div class="alert-wrap">
    ${s.offline ? html`<div class="offline-strip" role="status"><${Icon} n="wifioff" size=${16} /> No connection · showing the alert received ${SC.phases[0].timeline[0].time}, last updated ${ph.clock}</div>` : ''}
    <div class=${'alert-banner ' + cls} role="button" tabindex="0" data-log="alert banner"
      onClick=${() => openSheet({ type: 'alert' })}>
      <div class="ab-icon"><${Icon} n=${ph.level === 'clear' ? 'checkc' : 'alert'} size=${26} stroke=${2.2} /></div>
      <div class="grow">
        <div class="ab-title">${b.title} <span class="ab-level">${b.levelLabel}</span></div>
        <div class="ab-sub">${b.area}${b.until ? ' · ' + b.until : ''}</div>
      </div>
      <${SourceChip} ids=${b.sourceIds} claim=${b.title + ' ' + (b.until || '')} light=${true} />
    </div>
  </div>`;
}

export function AlertSheet() {
  const s = useStore();
  const ph = phase(s);
  return html`<div class="sheet-body">
    <div class=${'pill ' + ph.level}>${ph.banner.levelLabel}</div>
    <h3 class="mt8">${ph.banner.title}</h3>
    <div class="muted small">${ph.banner.area}${ph.banner.until ? ' · ' + ph.banner.until : ''} · as of ${ph.clock}</div>
    <div class="callout mt12"><strong>${ph.action}</strong></div>
    <p class="mt12">${ph.alertText}</p>
    <div class="row gap8 mt8"><span class="muted small">Source:</span><${SourceChip} ids=${ph.banner.sourceIds} claim=${ph.banner.title} /></div>
    <div class="watchwarn mt12">
      <div><strong>Watch</strong> = conditions could produce a tornado. Be ready.</div>
      <div><strong>Warning</strong> = a tornado is happening or about to happen nearby. Shelter now.</div>
    </div>
    <button class="btn primary full mt12" onClick=${() => { closeSheet(); nav('/ask?p=meaning'); }}>Ask WeatherBoy what this means for me</button>
  </div>`;
}

// ---------------------------------------------------------------- screen header
export function Header({ title, backTo, right, onTitleHold }) {
  let holdT = null;
  const start = () => { if (onTitleHold) holdT = setTimeout(onTitleHold, 900); };
  const end = () => clearTimeout(holdT);
  return html`<header class="hdr">
    ${backTo !== undefined
      ? html`<button class="hdr-btn" aria-label="Back" onClick=${() => back(backTo || '/home')}><${Icon} n="back" /></button>`
      : html`<span class="hdr-sp"></span>`}
    <h1 class="hdr-title" onPointerDown=${start} onPointerUp=${end} onPointerLeave=${end}>${title}</h1>
    ${right || html`<span class="hdr-sp"></span>`}
  </header>`;
}

export const toneLabel = { ok: 'OK', warn: 'Caution', bad: 'Danger' };
export const Dot = ({ tone }) => html`<span class=${'dot ' + tone} aria-label=${toneLabel[tone] || tone}></span>`;

export function PlaceTag({ id }) {
  const s = useStore();
  const here = SC.meta.userLocation === id;
  return html`<span class="place-tag">${placeName(id, s)}${here ? html` <em>· you</em>` : ''}</span>`;
}

export function Segmented({ options, value, onChange, cls = '' }) {
  return html`<div class=${'seg ' + cls} role="tablist">
    ${options.map((o) => html`<button role="tab" aria-selected=${o.value === value}
      class=${'seg-btn' + (o.value === value ? ' on' : '')} onClick=${() => onChange(o.value)}>
      ${o.value === value ? html`<${Icon} n="check" size=${14} stroke=${3} />` : ''}${o.label}</button>`)}
  </div>`;
}

// ---------------------------------------------------------------- sheet / toast / notification hosts
export function SheetHost() {
  const sheet = useStore((s) => s.sheet);
  const [closing, setClosing] = useState(false);
  useEffect(() => setClosing(false), [sheet]);
  if (!sheet) return null;
  const close = () => { setClosing(true); setTimeout(closeSheet, 180); };
  let title = '', body = null;
  if (sheet.type === 'sources') { title = 'Where this comes from'; body = html`<${SourceList} ids=${sheet.ids} claim=${sheet.claim} />`; }
  else if (sheet.type === 'alert') { title = 'Official alert'; body = html`<${AlertSheet} />`; }
  else if (sheet.type === 'custom') { title = sheet.title; body = sheet.render(close); }
  return html`<div class=${'sheet-scrim' + (closing ? ' closing' : '')} onClick=${close}>
    <div class="sheet" role="dialog" aria-label=${title} onClick=${(e) => e.stopPropagation()}>
      <div class="sheet-grab"></div>
      <div class="sheet-hdr"><h2>${title}</h2><button class="hdr-btn" aria-label="Close" onClick=${close}><${Icon} n="x" /></button></div>
      ${body}
    </div>
  </div>`;
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return html`<div class="toasts">${toasts.map((t) => html`<div key=${t.id} class=${'toast ' + t.tone} role="status">
    <${Icon} n=${t.tone === 'bad' ? 'alert' : 'checkc'} size=${18} />${t.text}</div>`)}</div>`;
}

export function NotifBanner() {
  const n = useStore((s) => s.notif);
  if (!n) return null;
  return html`<div class="notif" role="alert" onClick=${() => { set({ notif: null }); if (n.go) nav(n.go); }}>
    <div class="notif-icon"><img src="icons/icon-192.png" alt="" /></div>
    <div class="grow"><div class="notif-top"><strong>${APP_NAME}</strong><span class="muted">now</span></div>
      <div class="notif-title">${n.title}</div><div class="notif-text">${n.text}</div></div>
  </div>`;
}

export function Modal({ title, children, onClose }) {
  return html`<div class="modal-scrim" onClick=${onClose}><div class="modal" role="dialog" aria-label=${title} onClick=${(e) => e.stopPropagation()}>
    <h3>${title}</h3>${children}</div></div>`;
}

export function SeverityBar({ value }) {
  if (!value) return null;
  const words = ['', 'Low', 'Minor', 'Moderate', 'High', 'Extreme'];
  return html`<div class="sev" aria-label=${'Severity ' + value + ' of 5'}>
    <div class="sev-top"><span>Severity</span><strong>${value}/5 · ${words[value]}</strong></div>
    <div class="sev-bar">${[1, 2, 3, 4, 5].map((i) => html`<span class=${'sev-seg s' + i + (i <= value ? ' on' : '')}></span>`)}</div>
  </div>`;
}
