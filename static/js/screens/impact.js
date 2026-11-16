// Impact detail (Power / Water / Roads / Shelter): per-place status with sources (D1),
// specific shelter guidance + public places with power & water + routes (D4).
import { html, useState } from '../../vendor/preact-htm.js';
import { SC, useStore, phase } from '../store.js';
import { Icon, Header, SourceChip, Dot, PlaceTag, Segmented, nav, navTab } from '../ui.js';
import { log } from '../log.js';

const TITLES = { power: 'Power', water: 'Water', roads: 'Roads & commute', shelter: 'Shelter' };
const ASK = { power: 'power_water', water: 'power_water', roads: 'drive', shelter: 'shelter' };

function Rows({ rows }) {
  return html`<div class="rows">${rows.map((r) => html`<div class=${'prow ' + r.tone}>
    <${Dot} tone=${r.tone} />
    <div class="grow"><${PlaceTag} id=${r.place} /><div class="prow-text">${r.text}</div></div>
    <${SourceChip} ids=${r.sourceIds} claim=${r.text} />
  </div>`)}</div>`;
}

export function PublicPlaces({ near, filter }) {
  const s = useStore();
  const warningActive = phase(s).level !== 'clear';
  const list = SC.shelterPlaces.filter((p) => (!near || p.near === near) && (!filter || p[filter]));
  return html`<div class="places-list">${list.map((p) => html`<div class="pp">
    <div class="pp-top"><strong>${p.name}</strong><${SourceChip} ids=${p.sourceIds} claim=${p.name + ': ' + p.hours} /></div>
    <div class="pp-tags">
      <span class=${'tag ' + (p.power ? 'ok' : 'bad')}><${Icon} n="bolt" size=${13} /> ${p.power ? 'Has power' : 'No power'}</span>
      <span class=${'tag ' + (p.water ? 'ok' : 'bad')}><${Icon} n="drop" size=${13} /> ${p.water ? 'Drinking water' : 'No water'}</span>
      <span class="tag"><${Icon} n="clock" size=${13} /> ${p.hours}</span>
    </div>
    <div class="small muted">${p.distance} · ${p.walk} · ${p.notes}</div>
    <button class="btn ghost sm mt8" onClick=${() => { log('route_open', p.id); nav('/map?layer=shelters&route=' + p.id); }}>
      <${Icon} n="route" size=${16} /> Route${warningActive ? ' (for after the warning)' : ''}</button>
  </div>`)}</div>`;
}

function ShelterBody() {
  const s = useStore();
  const ph = phase(s);
  const [where, setWhere] = useState(SC.meta.userLocation);
  const active = ph.level !== 'clear';
  return html`<div>
    <${Segmented} value=${where} onChange=${(v) => { log('shelter_where', v); setWhere(v); }}
      options=${[{ value: 'work', label: "I'm at Work" }, { value: 'home', label: "I'm at Home" }]} />
    ${active ? html`<section class="card danger-card mt12">
      <div class="row gap8"><${Icon} n="shelter" size=${22} /><h3>Right now: shelter where you are</h3></div>
      <p class="small">During a Tornado Warning, going outside to reach another shelter is more dangerous than staying in a sturdy building.</p>
      <ol class="steps">${SC.inBuilding[where].map((t) => html`<li>${t}</li>`)}</ol>
      <div class="row gap8"><span class="small muted">Guidance from</span><${SourceChip} ids=${['ready', 'nws_warn']} claim="Tornado shelter guidance" /></div>
    </section>` : html`<section class="card ok-card mt12"><h3>No need to shelter</h3><p class="small">${ph.action}</p></section>`}
    <h2 class="mt16">Status at your places</h2>
    <${Rows} rows=${ph.impacts.shelter.rows} />
    <h2 class="mt16">Public places with power & water near ${where === 'work' ? 'Work' : 'Home'}</h2>
    <p class="small muted">${active ? 'Use these if your building loses power or water once the warning ends, or if it isn\'t safe to stay.' : 'Open now if you need power, water or a place to charge your phone.'}</p>
    <${PublicPlaces} near=${where} />
  </div>`;
}

export function Impact({ id }) {
  const s = useStore();
  const ph = phase(s);
  const imp = ph.impacts[id];
  if (!imp) return html`<div class="pad"><${Header} title="Not found" backTo="/home" /></div>`;
  let extra = null;
  if (id === 'power') extra = html`<h2 class="mt16">Places with power near you</h2><${PublicPlaces} filter="power" />`;
  if (id === 'water') extra = html`
    ${imp.tone !== 'ok' ? html`<section class="card warn-card mt12"><h3>Boil-water advisory: what to do</h3>
      <ol class="steps"><li>Bring tap water to a rolling boil for 1 minute, then let it cool.</li><li>Or use bottled water for drinking, cooking, brushing teeth and baby formula.</li><li>Showering is OK. Don't swallow the water.</li></ol>
      <${SourceChip} ids=${['a2water']} claim="Boil-water instructions" /></section>` : ''}
    <h2 class="mt16">Places with drinking water</h2><${PublicPlaces} filter="water" />`;
  if (id === 'roads') extra = html`
    <h2 class="mt16">Closures & hazards</h2>
    <div class="rows">${ph.roadMarks.map((r) => html`<div class="prow bad"><span class=${'road-sym ' + r.kind}>${r.kind === 'closed' ? '' : '≈'}</span>
      <div class="grow"><div class="prow-text"><strong>${r.label}</strong></div><div class="small muted">Reported ${r.time}</div></div><${SourceChip} ids=${r.sourceIds} claim=${r.label} /></div>`)}</div>
    <button class="btn ghost full mt12" onClick=${() => nav('/map?layer=roads')}><${Icon} n="map" size=${18} /> View roads on the map</button>`;
  return html`<div class="pad">
    <${Header} title=${TITLES[id]} backTo="/home" />
    <div class=${'impact-hero ' + imp.tone}><div class="ih-head">${imp.headline}</div><div class="ih-sub">${imp.sub}</div></div>
    ${id === 'shelter' ? html`<${ShelterBody} />` : html`<${Rows} rows=${imp.rows} />${extra}`}
    <button class="btn primary full mt16" onClick=${() => navTab('/ask?p=' + ASK[id])}><${Icon} n="chat" size=${18} /> Ask WeatherBoy about ${TITLES[id].toLowerCase()}</button>
  </div>`;
}
