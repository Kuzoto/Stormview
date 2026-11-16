// Impact detail (Power / Water / Roads / Shelter): per-place status with sources (D1),
// specific shelter guidance + public places with power & water + routes (D4).
import { html, useState } from '../../vendor/preact-htm.js';
import { SC, useStore, phase, isLive, myPlaces, myOrder, hereId } from '../store.js';
import { Icon, Header, SourceChip, Dot, PlaceTag, Segmented, nav, navTab } from '../ui.js';
import { log } from '../log.js';
import { PowerNote } from './map.js';

const TITLES = { power: 'Power', water: 'Water', roads: 'Roads & commute', shelter: 'Shelter' };
const ASK = { power: 'power_water', water: 'power_water', roads: 'drive', shelter: 'shelter' };

function Rows({ rows }) {
  return html`<div class="rows">${rows.map((r) => html`<div class=${'prow ' + r.tone}>
    <${Dot} tone=${r.tone} />
    <div class="grow"><${PlaceTag} id=${r.place} /><div class="prow-text">${r.text}</div></div>
    <${SourceChip} ids=${r.sourceIds} claim=${r.text} />
  </div>`)}</div>`;
}

export const directionsUrl = (from, to) =>
  `https://www.google.com/maps/dir/?api=1${from && from.lat != null ? `&origin=${from.lat},${from.lng}` : ''}&destination=${to.lat},${to.lng}&travelmode=walking`;

export function PublicPlaces({ near, filter }) {
  const s = useStore();
  const ph = phase(s);
  const live = isLive(s);
  const warningActive = ph.level !== 'clear';
  if (live) {
    const all = ph.publicPlaces || [];
    const list = all.filter((p) => !near || p.near === near).slice(0, near ? 4 : 6);
    const from = myPlaces(s)[near || hereId(s)];
    if (!list.length) return html`<p class="small muted">${ph.publicPending || ph.loading ? 'Looking up public buildings nearby…' : 'No public buildings found nearby in OpenStreetMap.'}</p>`;
    return html`<div class="places-list">${list.map((p) => html`<div class="pp">
      <div class="pp-top"><strong>${p.name}</strong><${SourceChip} ids=${p.sourceIds} claim=${p.name + ': ' + p.hours} /></div>
      <div class="pp-tags">
        <span class="tag">${p.kind}</span>
        <span class="tag"><${Icon} n="clock" size=${13} /> ${p.hours}</span>
        <span class="tag unk"><${Icon} n="bolt" size=${13} /> Power not reported</span>
      </div>
      <div class="small muted">${p.distance} · ${p.walk} · not an official shelter, call ahead</div>
      <div class="row gap8 mt8">
        <a class="btn ghost sm" href=${directionsUrl(from, p)} target="_blank" rel="noopener" onClick=${() => log('directions_open', p.id)}><${Icon} n="route" size=${16} /> Directions${warningActive && ph.dontDrive ? ' (after the warning)' : ''}</a>
        <button class="btn ghost sm" onClick=${() => { log('route_open', p.id); nav('/map?layer=shelters&route=' + p.id); }}><${Icon} n="map" size=${16} /> Map</button>
        ${p.phone ? html`<a class="btn ghost sm" href=${'tel:' + p.phone}>Call</a>` : ''}
      </div>
    </div>`)}</div>`;
  }
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

// Generic, official (Ready.gov / NWS) guidance used in live mode, by hazard type (we don't know the building).
const LIVE_GUIDE = {
  now: ['Right now: shelter where you are', ['Go to the lowest floor now: basement, storm cellar or ground floor.', 'Get into a small interior room, hallway or stairwell with no windows.', 'Put as many walls as possible between you and the outside.', 'Crouch down and cover your head and neck. A helmet, mattress or heavy blankets help.']],
  ready: ['Be ready to shelter', ['Pick your spot now: the lowest floor, a small interior room with no windows.', 'Keep shoes, a flashlight and your phone (charged) nearby.', 'If a warning is issued, go there right away. Don\'t wait to see it.']],
  indoors: ['Stay indoors', ['Stay inside and away from windows and doors.', 'Charge your phone and a battery pack in case the power goes out.', 'Avoid travel. If you must go out, tell someone your route.', 'Keep flashlights, water and warm layers handy.']],
  high: ['Avoid low areas and flood water', ['Move to higher ground if water is rising where you are.', 'Never walk or drive through flood water: 6 inches can knock you down, 12 inches can carry a car.', 'Stay out of basements if water is coming in.']],
  cool: ['Stay cool', ['Stay in air conditioning if you can (libraries and community centers are often cooling spots).', 'Drink water often, even if you aren\'t thirsty.', 'Check on older neighbors, kids and pets.']],
};

function LiveShelterBody() {
  const s = useStore();
  const ph = phase(s);
  const places = myPlaces(s);
  const order = myOrder(s);
  const [where, setWhere] = useState(hereId(s));
  const rows = ph.impacts.shelter.rows || [];
  const row = rows.find((r) => r.place === where) || { tone: 'ok', text: 'No need to shelter.' };
  const guide = LIVE_GUIDE[row.kind] || LIVE_GUIDE[row.tone === 'bad' ? 'now' : 'ready'];
  const nearOk = order.slice(0, 3).includes(where);
  return html`<div>
    ${order.length > 1 ? html`<${Segmented} value=${where} onChange=${(v) => { log('shelter_where', v); setWhere(v); }}
      options=${order.slice(0, 3).map((id) => ({ value: id, label: id === 'here' ? "Where I am" : "At " + (places[id].short || places[id].name) }))} />` : ''}
    ${row.tone !== 'ok' ? html`<section class=${'card mt12 ' + (row.tone === 'bad' ? 'danger-card' : 'warn-card')}>
      <div class="row gap8"><${Icon} n="shelter" size=${22} /><h3>${guide[0]}</h3></div>
      <p class="small">${row.text}</p>
      ${row.tone === 'bad' ? html`<p class="small">Going outside to reach another shelter during a warning is more dangerous than staying in a sturdy building.</p>` : ''}
      <ol class="steps">${guide[1].map((t) => html`<li>${t}</li>`)}</ol>
      <div class="row gap8"><span class="small muted">Guidance from</span><${SourceChip} ids=${['ready_live', 'nws_live']} claim="Shelter guidance" /></div>
    </section>` : html`<section class="card ok-card mt12"><h3>No need to shelter</h3><p class="small">No alerts for ${places[where] ? places[where].name : 'this place'} that call for sheltering.</p></section>`}
    <h2 class="mt16">Status at your places</h2>
    <${Rows} rows=${rows} />
    <h2 class="mt16">Public buildings near ${places[where] ? places[where].name : 'you'}</h2>
    <p class="small muted">From OpenStreetMap. These are <strong>not official shelters</strong>; hours, power and water aren't confirmed. Useful for charging a phone or getting water once it's safe to travel.</p>
    <${PublicPlaces} near=${nearOk ? where : null} />
  </div>`;
}

function ShelterBody() {
  const s = useStore();
  if (isLive(s)) return html`<${LiveShelterBody} />`;
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
  const live = isLive(s);
  const Ext = ({ href, children }) => html`<a class="link small" href=${href} target="_blank" rel="noopener">${children} <${Icon} n="ext" size=${12} /></a>`;
  const nearReports = (pred, cats) => html`${(ph.stormReports || []).filter(pred).slice(0, 5).map((r) => html`<div class="prow warn"><span class="rep-ic">!</span>
      <div class="grow"><div class="prow-text"><strong>${r.label}${r.magnitude ? ' ' + r.magnitude : ''}</strong> · ${r.city}, ${r.distanceMi} mi away</div>
        <div class="small muted">${new Date(r.time).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })} · ${r.source}${r.remark ? ' · ' + r.remark : ''}</div></div>
      <${SourceChip} ids=${['lsr_live']} claim=${r.label + ' ' + r.city} /></div>`)}
    ${(ph.mapPosts || []).filter((p) => cats.includes(p.category)).slice(0, 5).map((p) => html`<div class="prow warn"><span class="rep-ic com">?</span>
      <div class="grow"><div class="prow-text">“${p.text}”</div><div class="small muted">${p.author} · ${p.distanceMi} mi away · unverified</div></div>
      <${SourceChip} ids=${['posts_live']} claim=${p.text} /></div>`)}`;
  const noneNear = (pred, cats) => !(ph.stormReports || []).some(pred) && !(ph.mapPosts || []).some((p) => cats.includes(p.category));
  const powerPred = (r) => r.power || r.kind === 'damage' || r.kind === 'tornado';
  const roadPred = (r) => r.road || ['flood', 'snow', 'damage', 'tornado'].includes(r.kind);
  if (live && id === 'power') extra = html`
    <${PowerNote} ph=${ph} inline=${true} />
    <h2 class="mt16">Power reports nearby</h2>
    ${noneNear(powerPred, ['Power']) ? html`<p class="small muted">No NWS storm reports or neighbor posts about power nearby.</p>` : html`<div class="rows">${nearReports(powerPred, ['Power'])}</div>`}
    <button class="btn ghost full mt12" onClick=${() => nav('/map?layer=power')}><${Icon} n="map" size=${18} /> View power on the map</button>
    <h2 class="mt16">Public buildings nearby</h2><${PublicPlaces} />`;
  else if (live && id === 'water') extra = html`
    <section class="card mt12"><h3>Boil-water notices</h3><p class="small">These come from your city or water utility (by text alert, website or local news), not the weather service. If you're told to boil water: bring tap water to a rolling boil for 1 minute, or use bottled water.</p>
      <${Ext} href="https://www.epa.gov/ground-water-and-drinking-water/emergency-disinfection-drinking-water">EPA: what to do during a boil-water notice</${Ext}></section>
    <h2 class="mt16">Public buildings nearby</h2><${PublicPlaces} />`;
  else if (live && id === 'roads') extra = html`
    ${ph.traffic && ph.traffic.enabled ? html`<h2 class="mt16">Closures & incidents nearby</h2>
      ${!ph.traffic.updated ? html`<p class="small muted">Loading live traffic…</p>`
        : !ph.traffic.incidents.filter((i) => i.distanceMi <= 10).length ? html`<p class="small muted">No closures or incidents within 10 mi right now (TomTom).</p>`
        : html`<div class="rows">${ph.traffic.incidents.filter((i) => i.distanceMi <= 10).slice(0, 8).map((i) => html`<div class=${'prow ' + (i.closed ? 'bad' : 'warn')}>
          <span class=${'rep-ic tt ' + (i.closed ? 'closed' : '')}>${i.closed ? '⛔' : '!'}</span>
          <div class="grow"><div class="prow-text"><strong>${i.label}${i.roads.length ? ' · ' + i.roads.join(', ') : ''}</strong>${i.from ? ' · ' + i.from + (i.to && i.to !== i.from ? ' → ' + i.to : '') : ''}</div>
            <div class="small muted">${i.distanceMi} mi away${i.delayMin ? ' · ' + i.delayMin + ' min delay' : ''}${i.description ? ' · ' + i.description : ''}</div></div>
          <${SourceChip} ids=${['traffic_live']} claim=${i.label + ' ' + (i.from || '')} /></div>`)}</div>`}` : ''}
    <h2 class="mt16">Road hazards reported nearby</h2>
    ${noneNear(roadPred, ['Road', 'Flooding', 'Damage']) ? html`<p class="small muted">No NWS storm reports or neighbor posts about flooding, trees down or roads nearby.</p>` : html`<div class="rows">${nearReports(roadPred, ['Road', 'Flooding', 'Damage'])}</div>`}
    <section class="card mt12"><h3>Official closures</h3><p class="small">${ph.traffic && ph.traffic.updated ? 'TomTom combines road-authority feeds and driver data. For official closures and detours, check your state\'s 511 service.' : 'Official closures and crashes come from your state\'s 511 service. This app shows NWS storm reports, neighbor posts and weather-based driving risk.'}</p>
      <${Ext} href="https://www.fhwa.dot.gov/trafficinfo/">Find your state's 511 traffic site</${Ext}></section>
    <button class="btn ghost full mt12" onClick=${() => nav('/map?layer=roads')}><${Icon} n="map" size=${18} /> View road reports on the map</button>`;
  else if (id === 'power') extra = html`<h2 class="mt16">Places with power near you</h2><${PublicPlaces} filter="power" />`;
  if (!live && id === 'water') extra = html`
    ${imp.tone !== 'ok' ? html`<section class="card warn-card mt12"><h3>Boil-water advisory: what to do</h3>
      <ol class="steps"><li>Bring tap water to a rolling boil for 1 minute, then let it cool.</li><li>Or use bottled water for drinking, cooking, brushing teeth and baby formula.</li><li>Showering is OK. Don't swallow the water.</li></ol>
      <${SourceChip} ids=${['a2water']} claim="Boil-water instructions" /></section>` : ''}
    <h2 class="mt16">Places with drinking water</h2><${PublicPlaces} filter="water" />`;
  if (!live && id === 'roads') extra = html`
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
