// Screen 2 – Home / summary. Answers "what does this mean for me" in one place:
// AI summary, Power / Water / Roads / Shelter cards (each with sources, each opens details),
// check-in prompt, color-coded updates timeline, and a map preview.
import { html, useEffect, useRef } from '../../vendor/preact-htm.js';
import { SC, useStore, phase, placeName } from '../store.js';
import { loadSummary } from '../api.js';
import { Icon, SourceChip, Header, nav, navTab, APP_NAME, Dot } from '../ui.js';
import { MiniMap } from './map.js';

const CARDS = [
  { id: 'power', label: 'Power', icon: 'bolt' },
  { id: 'water', label: 'Water', icon: 'drop' },
  { id: 'roads', label: 'Roads & commute', icon: 'car' },
  { id: 'shelter', label: 'Shelter', icon: 'shelter' },
];

function Summary() {
  const s = useStore();
  const ph = phase(s);
  const sum = s.summaries[ph.id];
  useEffect(() => { loadSummary(ph.id); }, [ph.id, s.offline]);
  return html`<section class="card summary">
    <div class="sum-hdr"><span class="wb-avatar sm">W</span><span>WeatherBoy summary for you</span></div>
    ${sum ? html`<p class="sum-text">${sum.answer}</p>` : html`<p class="sum-text skeleton">Reading the latest alert…</p>`}
    <div class="row between">
      ${sum ? html`<${SourceChip} ids=${sum.sourceIds || []} claim=${sum.answer} />` : html`<span></span>`}
      <span class="tiny muted">${sum && sum.fallback ? 'Written from official alert text' : 'AI summary of official sources'}</span>
    </div>
  </section>`;
}

function ImpactCard({ c }) {
  const s = useStore();
  const imp = phase(s).impacts[c.id];
  const ids = [...new Set(imp.rows.flatMap((r) => r.sourceIds))];
  return html`<button class=${'impact ' + imp.tone} onClick=${() => nav('/impact/' + c.id)} data-log=${'impact card ' + c.id}>
    <div class="imp-top"><span class="imp-ic"><${Icon} n=${c.icon} size=${20} /></span><span class="imp-lbl">${c.label}</span><${Icon} n="chev" size=${16} cls="imp-chev" /></div>
    <div class="imp-head">${imp.headline}</div>
    <div class="imp-sub">${imp.sub}</div>
    <div class="imp-src"><${SourceChip} ids=${ids} claim=${c.label + ': ' + imp.headline} /></div>
  </button>`;
}

function CheckinPrompt() {
  const s = useStore();
  if (s.checkin.status !== 'none') {
    return html`<button class="card checkin-done" onClick=${() => navTab('/checkin')}>
      <${Icon} n="checkc" size=${20} /><span class="grow">You checked in as <strong>${s.checkin.status === 'safe' ? 'Safe' : 'Need help'}</strong> · sent to ${s.checkin.sentTo.length} people at ${s.checkin.time}</span><${Icon} n="chev" size=${16} />
    </button>`;
  }
  const waiting = s.circle.filter((c) => c.status === 'none').length;
  return html`<section class="card checkin-prompt">
    <div class="row gap8"><${Icon} n="shield" size=${22} /><div class="grow"><strong>Let your circle know you're OK</strong>
      <div class="small muted">You haven't checked in yet · ${waiting} of ${s.circle.length} people have no update</div></div></div>
    <div class="row gap8 mt8">
      <button class="btn safe grow" onClick=${() => nav('/checkin?quick=safe')}>I'm safe</button>
      <button class="btn ghost grow" onClick=${() => navTab('/checkin')}>Open Check-In</button>
    </div>
  </section>`;
}

function Timeline() {
  const s = useStore();
  const ph = phase(s);
  return html`<section class="card">
    <div class="sec-hdr"><h2>Updates</h2><span class="muted small">as of ${ph.clock}</span></div>
    <ol class="timeline">
      ${ph.timeline.map((t, i) => html`<li class=${'tl ' + t.level + (i === ph.timeline.length - 1 ? ' latest' : '')}>
        <span class="tl-dot"></span>
        <div class="tl-body"><div class="tl-time">${t.time}${i === ph.timeline.length - 1 ? html` <span class="pill tiny-pill">Latest</span>` : ''}</div>
          <div class="tl-text">${t.text}</div><${SourceChip} ids=${t.sourceIds} claim=${t.text} /></div>
      </li>`)}
    </ol>
    <div class="tl-legend"><span><i class="tl-k high"></i>Danger</span><span><i class="tl-k med"></i>Impact</span><span><i class="tl-k info"></i>Info</span><span><i class="tl-k ok"></i>Resolved</span></div>
  </section>`;
}

export function Home() {
  const s = useStore();
  const ph = phase(s);
  const openAdmin = () => nav('/admin');
  return html`<div class="pad">
    <${Header} title=${APP_NAME} onTitleHold=${openAdmin} right=${html`<span class="hdr-clock">${ph.clock}</span>`} />
    ${ph.dontDrive ? html`<div class="dont-drive" role="alert"><${Icon} n="car" size=${22} /><div><strong>${ph.action}</strong></div></div>`
      : html`<div class="all-clear-note"><${Icon} n="checkc" size=${22} /><div><strong>${ph.action}</strong></div></div>`}
    <${Summary} />
    <div class="sec-hdr mt16"><h2>What this means for you</h2><span class="muted small">Home · Work · Mom's</span></div>
    <div class="impact-grid">${CARDS.map((c) => html`<${ImpactCard} c=${c} />`)}</div>
    <${CheckinPrompt} />
    <${Timeline} />
    <section class="card map-card" onClick=${() => navTab('/map')} data-log="map preview">
      <div class="sec-hdr"><h2>Map</h2><span class="link small">Open full map <${Icon} n="chev" size=${14} /></span></div>
      <${MiniMap} />
    </section>
    <button class="ask-fab" onClick=${() => navTab('/ask')} aria-label="Ask WeatherBoy"><${Icon} n="chat" size=${20} /> Ask WeatherBoy</button>
  </div>`;
}
