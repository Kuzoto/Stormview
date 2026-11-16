// Screen 5 – Map. D3: legend for every symbol, standard road-closed sign, conventional location pin,
// clearly highlighted single active layer, storm drawn as an area (not a button).
// D4: shelters + public places with power, safe routes, "don't drive" shown on the map.
import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.js';
import { SC, useStore, phase, get, isLive, myPlaces, hereId } from '../store.js';
import { directionsUrl } from './impact.js';
import { Icon, Header, Segmented, SourceChip, nav } from '../ui.js';
import { log } from '../log.js';

const L = window.L;
const C = { warn: '#c62828', outage: '#6a1b9a', route: '#1565c0', shelter: '#2e7d32' };

const divIcon = (cls, inner = '', size = [26, 26]) => L.divIcon({ className: 'mk ' + cls, html: inner, iconSize: size, iconAnchor: [size[0] / 2, size[1] / 2] });
const PLACE_GLYPH = { home: 'H', work: 'W', mom: 'M' };

const esc = (t) => String(t || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function drawBase(g, s, { labels = true } = {}) {
  const places = myPlaces(s);
  const hid = hereId(s);
  Object.entries(places).forEach(([id, p]) => {
    if (p.lat == null) return;
    const here = id === hid;
    if (!here) {
      L.marker([p.lat, p.lng], { icon: divIcon('m-place', `<b>${PLACE_GLYPH[id] || esc((p.short || p.name || '★')[0].toUpperCase())}</b>${labels ? `<span>${esc(p.short || p.name)}</span>` : ''}`, [26, 26]), interactive: false }).addTo(g);
    }
  });
  const you = places[hid];
  if (!you || you.lat == null) return;
  L.marker([you.lat, you.lng], { icon: divIcon('m-you', '<i></i>', [22, 22]), zIndexOffset: 1000, interactive: false }).addTo(g);
  if (labels) L.marker([you.lat, you.lng], { icon: L.divIcon({ className: 'mk m-you-lbl', html: isLive(s) ? (you.approx ? 'Ann Arbor (default)' : 'You') : `You · ${esc(you.short || you.name)}`, iconSize: [90, 18], iconAnchor: [-12, 9] }), interactive: false }).addTo(g);
}

const POLY_COLOR = { warning: C.warn, watch: '#d35400', advisory: '#b26a00' };
function drawWarning(g, ph, strong) {
  if (ph.warnPolygon) L.polygon(ph.warnPolygon, { color: C.warn, weight: 2, dashArray: '6 6', fillColor: C.warn, fillOpacity: strong ? 0.08 : 0.04, interactive: false }).addTo(g);
  (ph.warnPolygons || []).forEach((w) => {
    const col = POLY_COLOR[w.level] || C.warn;
    L.polygon(w.points, { color: col, weight: 2, dashArray: '6 6', fillColor: col, fillOpacity: strong ? 0.1 : 0.05, interactive: false }).addTo(g);
  });
}

// Live NEXRAD base-reflectivity mosaic (NWS data, tiles served by Iowa Environmental Mesonet, ~5 min updates).
// Frames for the loop: IEM keeps the last 50 minutes at 5-minute steps (…-m50m … -m05m, then current).
const RADAR_STEPS = [50, 45, 40, 35, 30, 25, 20, 15, 10, 5, 0];
function radarLayer(minsAgo, opacity) {
  const bust = Math.floor(Date.now() / 300000);
  return L.tileLayer(`https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913${minsAgo ? '-m' + String(minsAgo).padStart(2, '0') + 'm' : ''}/{z}/{x}/{y}.png?_=${bust}`,
    { opacity, maxZoom: 18, maxNativeZoom: 12, attribution: 'Radar: NWS NEXRAD via IEM' });
}
function drawRadar(g, loop = false) {
  if (!loop) { radarLayer(0, 0.6).addTo(g); return null; }
  return RADAR_STEPS.map((m, i) => radarLayer(m, i === RADAR_STEPS.length - 1 ? 0.6 : 0).addTo(g));
}
const radarClock = (iso, minsAgo = 0) => (iso ? new Date(new Date(iso).getTime() - minsAgo * 60000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');

// ---- live extras: storm track, NWS storm reports, neighbor posts, ODIN outage areas
const LSR_GLYPH = { tornado: 'T', flood: '≈', damage: '!', hail: '•', snow: '*', wind: 'W', rain: '‖', other: 'i' };
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '');
function drawTrack(g, ph) {
  const t = ph.stormTrack;
  if (!t) return;
  L.polyline(t.path, { color: '#6a1b9a', weight: 3, dashArray: '8 6', interactive: false }).addTo(g);
  t.path.slice(1).forEach((pt, i) => L.marker(pt, { icon: L.divIcon({ className: 'mk m-track-t', html: `+${(i + 1) * 15}m`, iconSize: [36, 16], iconAnchor: [18, -4] }), interactive: false }).addTo(g));
  L.marker([t.lat, t.lng], { icon: divIcon('m-track', `<span style="display:inline-block;transform:rotate(${t.headingDeg - 90}deg)">➤</span>`, [28, 28]), interactive: false }).addTo(g);
  L.marker([t.lat, t.lng], { icon: L.divIcon({ className: 'mk m-storm-lbl', html: `${t.what} · ${t.heading} ${t.mph} mph`, iconSize: [150, 20], iconAnchor: [75, -14] }), interactive: false }).addTo(g);
}
function drawReports(g, ph, onPick, filter) {
  (ph.stormReports || []).filter(filter || (() => true)).forEach((r) => {
    const m = L.marker([r.lat, r.lng], { icon: divIcon('m-lsr ' + r.kind, LSR_GLYPH[r.kind] || 'i', [24, 24]) }).addTo(g);
    if (onPick) m.on('click', () => onPick({ title: `NWS report: ${r.label}${r.magnitude ? ' ' + r.magnitude : ''}`, sub: `${r.city}, ${r.state} · ${fmtTime(r.time)} · ${r.source}${r.remark ? ' · ' + r.remark : ''}`, ids: ['lsr_live'] }));
  });
}
function drawPosts(g, ph, onPick, cats) {
  (ph.mapPosts || []).filter((p) => !cats || cats.includes(p.category)).forEach((p) => {
    const m = L.marker(p.approx, { icon: divIcon('m-post', '?', [24, 24]) }).addTo(g);
    if (onPick) m.on('click', () => onPick({ title: `Neighbor: ${p.category}`, sub: `"${p.text.slice(0, 140)}" · ${p.author} · about ${p.distanceMi} mi away · unverified`, ids: ['posts_live'], post: true }));
  });
}
function drawOdin(g, ph, onPick) {
  const areas = (ph.power && ph.power.areas) || [];
  const max = Math.max(1, ...areas.map((a) => a.out));
  areas.forEach((a) => a.rings.forEach((ring) => {
    const poly = L.polygon(ring, { color: C.outage, weight: 1.5, fillColor: C.outage, fillOpacity: 0.12 + 0.4 * Math.min(1, a.out / max) }).addTo(g);
    if (onPick) poly.on('click', () => onPick({ title: `${a.county} County: ${a.out.toLocaleString()} customers out`, sub: `${a.utilities.join(', ')} · reported to the federal ODIN system`, ids: ['odin_live'] }));
  }));
}

function drawStorm(g, ph) {
  if (!ph.storm) return;
  const { lat, lng, radiusKm: r } = ph.storm;
  [[2.2, '#43a047', 0.22], [1.5, '#fdd835', 0.3], [0.95, '#e53935', 0.38], [0.4, '#ad1457', 0.5]].forEach(([k, col, op]) =>
    L.circle([lat, lng], { radius: r * 1000 * k, stroke: false, fillColor: col, fillOpacity: op, interactive: false }).addTo(g));
  L.marker([lat - r * 0.0215, lng], { icon: L.divIcon({ className: 'mk m-storm-lbl', html: `Storm · moving ${ph.storm.heading} ➚`, iconSize: [150, 20], iconAnchor: [75, -4] }), interactive: false }).addTo(g);
}

function drawOutages(g, ph) {
  ph.outages.forEach((o) => {
    L.circle(o.center, { radius: o.radiusKm * 1000, color: C.outage, weight: 1.5, fillColor: C.outage, fillOpacity: 0.18, interactive: false }).addTo(g);
    L.marker([o.center[0] - 0.006, o.center[1] + 0.012], { icon: divIcon('m-outage', '⚡', [24, 24]), interactive: false }).addTo(g);
  });
}

function drawRoads(g, ph, onPick) {
  ph.roadMarks.forEach((r) => {
    const m = L.marker([r.lat, r.lng], { icon: divIcon(r.kind === 'closed' ? 'm-closed' : 'm-flood', r.kind === 'closed' ? '<i></i>' : '≈', [26, 26]) }).addTo(g);
    if (onPick) m.on('click', () => onPick({ title: r.label, sub: 'Reported ' + r.time, ids: r.sourceIds }));
  });
}

const shelterList = (ph, filter) => (ph.mode === 'live' ? ph.publicPlaces || [] : SC.shelterPlaces.filter((p) => !filter || p[filter]));
function drawShelters(g, onPick, filter, ph) {
  shelterList(ph || {}, filter).forEach((p) => {
    const m = L.marker([p.lat, p.lng], { icon: divIcon('m-shelter', '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11 12 4l9 7M5 10v10h14V10"/></svg>', [26, 26]) }).addTo(g);
    if (onPick) m.on('click', () => onPick(p.power === null
      ? { title: p.name, sub: `${p.kind} · ${p.hours} · ${p.distance} · not an official shelter`, ids: p.sourceIds, route: p.id }
      : { title: p.name, sub: `${p.hours} · ${p.power ? 'Has power' : 'No power'} · ${p.water ? 'Water' : 'No water'} · ${p.distance}`, ids: p.sourceIds, route: p.id }));
  });
}

function fit(map, s, ph, extra = []) {
  const pts = Object.values(myPlaces(s)).filter((p) => p.lat != null).map((p) => [p.lat, p.lng]).concat(extra);
  if (ph.storm) pts.push([ph.storm.lat, ph.storm.lng]);
  if (!pts.length) pts.push([42.2808, -83.743]);
  if (pts.length === 1) map.setView(pts[0], 12, { animate: false });
  else map.fitBounds(L.latLngBounds(pts).pad(0.12), { animate: false, maxZoom: 14 });
}

function newMap(el, interactive) {
  const map = L.map(el, {
    zoomControl: false, attributionControl: true, dragging: interactive, touchZoom: interactive,
    scrollWheelZoom: interactive, doubleClickZoom: interactive, boxZoom: false, keyboard: interactive, tap: false,
    fadeAnimation: false, zoomAnimation: interactive, markerZoomAnimation: interactive,
  });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(map);
  return map;
}

// ------------------------------------------------------------------ preview on Home
export function MiniMap() {
  const ref = useRef();
  const mapRef = useRef();
  const s = useStore();
  const ph = phase(s);
  useEffect(() => {
    mapRef.current = newMap(ref.current, false);
    return () => { mapRef.current._dead = true; mapRef.current.remove(); };
  }, []);
  useEffect(() => {
    const map = mapRef.current;
    if (map._g) map._g.remove();
    const g = (map._g = L.layerGroup().addTo(map));
    if (ph.mode === 'live' && !s.offline) drawRadar(g);
    if (ph.mode === 'live') drawTrack(g, ph);
    drawWarning(g, ph, false); drawStorm(g, ph); drawOutages(g, ph); drawRoads(g, ph); drawBase(g, s, { labels: false });
    fit(map, s, ph);
    setTimeout(() => { if (!map._dead) map.invalidateSize(); }, 350);
  }, [ph.id, ph.digest, JSON.stringify(myPlaces(s)), s.offline]);
  return html`<div class="mini-map-wrap"><div class="mini-map" ref=${ref}></div>
    ${ph.mode === 'live'
      ? html`<div class="mini-legend"><span><i class="lg you"></i>You</span><span><i class="lg radar"></i>Live radar</span><span><i class="lg warnarea"></i>Alert area</span></div>`
      : html`<div class="mini-legend"><span><i class="lg you"></i>You</span><span><i class="lg storm"></i>Storm</span><span><i class="lg warnarea"></i>Warning area</span><span><i class="lg outage"></i>Outage</span><span><i class="lg closed"></i>Road closed</span></div>`}</div>`;
}

// ------------------------------------------------------------------ full map
const LAYERS = [
  { value: 'radar', label: 'Radar' },
  { value: 'roads', label: 'Roads' },
  { value: 'power', label: 'Power' },
  { value: 'shelters', label: 'Shelters' },
];

const LEGEND = {
  radar: [['you', 'You are here'], ['place', 'Saved place (H Home, W Work, M Mom)'], ['warnarea', 'Tornado Warning area (NWS)'], ['radar', 'Radar: heavy rain → rotation (red/purple)']],
  roads: [['you', 'You are here'], ['closed', 'Road closed'], ['flood', 'Water over road'], ['route', 'Recommended route'], ['warnarea', 'Warning area']],
  power: [['you', 'You are here'], ['outage', 'Power outage area (DTE)'], ['shelter', 'Public place with power'], ['place', 'Saved place']],
  shelters: [['you', 'You are here'], ['shelter', 'Public place: power + water'], ['route', 'Route to selected place'], ['closed', 'Road closed (avoided)']],
};
const LAYER_SOURCES = { radar: ['nws_radar', 'nws_warn'], roads: ['a2roads', 'neighbor'], power: ['dte', 'wcem'], shelters: ['wcem'] };
const LIVE_LEGEND = {
  radar: [['you', 'You are here'], ['place', 'Saved place'], ['radar', 'Live radar: green light rain → red/purple severe'], ['warnarea', 'Active NWS alert area (dashed)'], ['track', 'Storm path, next 60 min (estimate)'], ['lsr', 'NWS storm report (tap for details)']],
  roads: [['you', 'You are here'], ['lsr', 'NWS report: flooding, snow/ice, trees down'], ['post', 'Neighbor post (unverified)'], ['warnarea', 'Active NWS alert area']],
  power: [['you', 'You are here'], ['odin', 'Customers without power, by county (ODIN)'], ['lsr', 'NWS report: power lines or wind damage'], ['post', 'Neighbor post about power (unverified)'], ['shelter', 'Public building (power not reported)']],
  shelters: [['you', 'You are here'], ['shelter', 'Public building: library, community center, town hall'], ['place', 'Saved place']],
};
const LIVE_LAYER_SOURCES = { radar: ['radar_live', 'nws_live', 'lsr_live'], roads: ['lsr_live', 'nws_live', 'posts_live', 'roads_live'], power: ['odin_live', 'lsr_live', 'posts_live', 'outages_live'], shelters: ['osm_live', 'ready_live'] };
const ROAD_KINDS = ['flood', 'snow', 'damage', 'tornado'];
const POWER_KINDS = ['damage', 'tornado'];

/** Power layer message: ODIN coverage for the user's utility, or the fallback with local outage links. */
export function PowerNote({ ph, inline = false }) {
  const pw = ph.power;
  if (!pw) return null;
  const here = pw.byPlace && (pw.byPlace.here || Object.values(pw.byPlace)[0]);
  const utils = (here && here.utilities) || [];
  const odinU = utils.filter((u) => u.inOdin).map((u) => u.name);
  const other = utils.filter((u) => !u.inOdin).map((u) => u.name).slice(0, 2);
  const nAreas = (pw.areas || []).length;
  const nPosts = (ph.mapPosts || []).filter((p) => p.category === 'Power').length;
  const nLsr = (ph.stormReports || []).filter((r) => r.power || POWER_KINDS.includes(r.kind)).length;
  const covered = here && here.covered;
  return html`<div class=${(inline ? 'card mt12 power-note' : 'map-note power-note') + (covered ? '' : ' warn')}>
    ${covered
      ? html`<div><strong>Live outages from ${odinU.join(' & ')}</strong> (federal ODIN data, by county). ${nAreas ? `${nAreas} count${nAreas > 1 ? 'ies' : 'y'} with outages nearby.` : 'No outages reported nearby.'}</div>`
      : html`<div><strong>No live outage data for ${other.join(' or ') || 'your utility'}.</strong> ${other.length > 1 ? "They don't" : "It doesn't"} share outages with the federal ODIN system, so this map shows ${nLsr || nPosts ? `${nLsr} NWS report${nLsr === 1 ? '' : 's'} and ${nPosts} neighbor post${nPosts === 1 ? '' : 's'} about power` : 'NWS reports and neighbor posts about power (none right now)'}.</div>`}
    <div class="pn-links">${(pw.links || []).slice(0, 3).map((l) => html`<a href=${l.url} target="_blank" rel="noopener" onClick=${() => log('power_link', l.label)}>${l.label} ↗</a>`)}</div>
  </div>`;
}

export function MapScreen({ query = {} }) {
  const ref = useRef();
  const mapRef = useRef();
  const s = useStore();
  const ph = phase(s);
  const [layer, setLayer] = useState(query.layer || 'radar');
  const [route, setRoute] = useState(query.route || null);
  const [picked, setPicked] = useState(null);
  const [legendOpen, setLegendOpen] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [frame, setFrame] = useState(RADAR_STEPS.length - 1);
  const framesRef = useRef(null);
  useEffect(() => { if (query.layer && query.layer !== layer) { setLayer(query.layer); setPicked(null); setPlaying(false); } }, [query.layer]);

  useEffect(() => {
    const map = newMap(ref.current, true);
    mapRef.current = map;
    setTimeout(() => { if (!map._dead) map.invalidateSize(); }, 350);
    return () => { map._dead = true; map.stop(); map.remove(); };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (map._g) map._g.remove();
    const g = (map._g = L.layerGroup().addTo(map));
    const pick = (p) => { log('map_pick', p.title); setPicked(p); };
    const live = ph.mode === 'live';
    framesRef.current = null;
    if (live && layer === 'radar' && !s.offline) framesRef.current = drawRadar(g, playing);
    drawWarning(g, ph, layer === 'radar');
    const extra = [];
    if (layer === 'radar') { drawStorm(g, ph); if (live) { drawTrack(g, ph); drawReports(g, ph, pick); } }
    // Include nearby reports/posts (within ~15 mi) in the view so they aren't off-screen.
    const near = (lst) => lst.filter((x) => (x.distanceMi ?? 99) <= 15).forEach((x) => extra.push(x.approx || [x.lat, x.lng]));
    if (live && layer === 'radar') near(ph.stormReports || []);
    if (live && layer === 'roads') {
      drawReports(g, ph, pick, (r) => r.road || ROAD_KINDS.includes(r.kind));
      drawPosts(g, ph, pick, ['Road', 'Flooding', 'Damage']);
      near((ph.stormReports || []).filter((r) => r.road || ROAD_KINDS.includes(r.kind)));
      near((ph.mapPosts || []).filter((p) => ['Road', 'Flooding', 'Damage'].includes(p.category)));
    }
    if (live && layer === 'power') {
      drawOdin(g, ph, pick);
      drawReports(g, ph, pick, (r) => r.power || POWER_KINDS.includes(r.kind));
      drawPosts(g, ph, pick, ['Power']);
      near((ph.stormReports || []).filter((r) => r.power || POWER_KINDS.includes(r.kind)));
      near((ph.mapPosts || []).filter((p) => p.category === 'Power'));
    }
    if (layer === 'roads') {
      drawRoads(g, ph, pick);
      if (ph.routeHome) L.polyline(ph.routeHome, { color: C.route, weight: 5, opacity: 0.85 }).addTo(g);
    }
    if (layer === 'power') { drawOutages(g, ph); drawShelters(g, pick, 'power', ph); shelterList(ph, 'power').forEach((p) => extra.push([p.lat, p.lng])); }
    if (layer === 'shelters') {
      drawShelters(g, pick, null, ph); drawRoads(g, ph);
      shelterList(ph).forEach((p) => extra.push([p.lat, p.lng]));
      if (!live && route && SC.routes[route]) L.polyline(SC.routes[route], { color: C.route, weight: 5, dashArray: ph.dontDrive ? '2 8' : null }).addTo(g);
    }
    drawBase(g, s);
    const selLive = live && route && (ph.publicPlaces || []).find((p) => p.id === route);
    if (layer === 'shelters' && !live && route && SC.routes[route]) map.fitBounds(L.latLngBounds(SC.routes[route]).pad(1.2), { animate: false, maxZoom: 15 });
    else if (layer === 'shelters' && selLive) map.setView([selLive.lat, selLive.lng], 15, { animate: false });
    else fit(map, s, ph, extra);
  }, [layer, route, ph.id, ph.digest, ph.fetchedAt, JSON.stringify(myPlaces(s)), s.offline, playing]);

  // Radar loop: step through the 11 frames (50 min ago → now), pause on "now".
  useEffect(() => {
    if (!playing) { setFrame(RADAR_STEPS.length - 1); return; }
    let i = 0, hold = 0;
    const id = setInterval(() => {
      const fr = framesRef.current;
      if (!fr) return;
      if (i === fr.length - 1 && hold++ < 3) return;
      hold = 0;
      fr.forEach((l, k) => l.setOpacity(k === i ? 0.6 : 0));
      setFrame(i);
      i = (i + 1) % fr.length;
    }, 550);
    return () => clearInterval(id);
  }, [playing, layer]);

  const live = ph.mode === 'live';
  const sel = route && (live ? (ph.publicPlaces || []) : SC.shelterPlaces).find((p) => p.id === route);
  const legend = live ? LIVE_LEGEND : LEGEND;
  const layerSources = live ? LIVE_LAYER_SOURCES : LAYER_SOURCES;
  const you = myPlaces(s)[hereId(s)];
  return html`<div class="map-screen">
    <${Header} title="Map" />
    <div class="map-tools">
      <div class="small muted layer-lbl">Showing layer:</div>
      <${Segmented} options=${LAYERS} value=${layer} onChange=${(v) => { log('map_layer', v); setLayer(v); setPicked(null); setPlaying(false); }} cls="map-seg" />
      ${live && layer === 'radar' && !s.offline ? html`<div class="radar-ctl">
        <button class="radar-play" aria-label=${playing ? 'Pause radar loop' : 'Play radar loop'} onClick=${() => { log('radar_loop', playing ? 'pause' : 'play'); setPlaying(!playing); }}>${playing ? '❚❚ Pause' : '▶ Play last 50 min'}</button>
        <span>Radar image: <strong>${radarClock(ph.radarTime, RADAR_STEPS[frame]) || 'loading'}</strong>${playing ? (RADAR_STEPS[frame] ? ` (${RADAR_STEPS[frame]} min ago)` : ' (latest)') : ''}</span></div>` : ''}
    </div>
    <div class="map-holder">
      <div class="map-full" ref=${ref}></div>
      ${ph.dontDrive ? html`<div class="map-dontdrive"><${Icon} n="car" size=${18} /> Don't drive during the warning${ph.banner.until ? ' (' + ph.banner.until + ')' : ''}</div>` : ''}
      ${live && layer === 'radar' && ph.stormTrack && ph.stormTrack.etas.length && !picked ? html`<div class="map-note warn">${ph.stormTrack.etas.map((e) => e.text).join(' · ')} (estimate from the NWS warning)</div>` : ''}
      ${live && layer === 'roads' && !picked ? html`<div class="map-note">Showing NWS storm reports and neighbor posts. Live road closures & traffic: <a href="https://www.fhwa.dot.gov/trafficinfo/" target="_blank" rel="noopener">your state's 511</a>.</div>` : ''}
      ${live && layer === 'power' && !picked ? html`<${PowerNote} ph=${ph} />` : ''}
      ${s.offline ? html`<div class="map-offline">Offline: map tiles may be missing. Markers show the last update (${ph.clock}).</div>` : ''}
      ${picked ? html`<div class="map-pick card">
        <div class="row between"><strong>${picked.title}</strong><button class="hdr-btn sm" aria-label="Close" onClick=${() => setPicked(null)}><${Icon} n="x" size=${18} /></button></div>
        <div class="small muted">${picked.sub}</div>
        <div class="row between mt8"><${SourceChip} ids=${picked.ids} claim=${picked.title} />
          ${picked.route && live ? html`<a class="btn primary sm" target="_blank" rel="noopener" href=${directionsUrl(you, (ph.publicPlaces || []).find((p) => p.id === picked.route))} onClick=${() => log('directions_open', picked.route)}><${Icon} n="route" size=${16} /> Directions</a>`
            : picked.route ? html`<button class="btn primary sm" onClick=${() => { setLayer('shelters'); setRoute(picked.route); setPicked(null); log('route_show', picked.route); }}><${Icon} n="route" size=${16} /> Route</button>` : ''}</div>
      </div>` : ''}
      ${sel && layer === 'shelters' && !picked ? html`<div class="map-pick card">
        <div class="row between"><strong>Route to ${sel.name}</strong><button class="hdr-btn sm" aria-label="Clear route" onClick=${() => setRoute(null)}><${Icon} n="x" size=${18} /></button></div>
        ${live ? html`<div class="small muted">${sel.distance} · ${sel.walk} · ${sel.hours}</div>
          <a class="btn primary sm mt8" target="_blank" rel="noopener" href=${directionsUrl(you, sel)}><${Icon} n="route" size=${16} /> Walking directions</a>`
        : html`<div class="small muted">${sel.distance} · ${sel.walk} · avoids closed roads${ph.dontDrive ? ' · use only after the warning ends or if your building is unsafe' : ''}</div>`}
      </div>` : ''}
      <div class=${'legend card' + (legendOpen ? '' : ' closed')}>
        <button class="legend-hdr" onClick=${() => setLegendOpen(!legendOpen)} aria-expanded=${legendOpen}>
          <${Icon} n="layers" size=${16} /><strong>Legend · ${LAYERS.find((l) => l.value === layer).label}</strong><span class="grow"></span><span class="small">${legendOpen ? 'Hide' : 'Show'}</span></button>
        ${legendOpen ? html`<div class="legend-items">${legend[layer].map(([k, t]) => html`<div class="lg-row"><i class=${'lg ' + k}></i>${t}</div>`)}
          <div class="lg-row"><span class="small muted">Data:</span><${SourceChip} ids=${layerSources[layer]} claim=${'Map layer: ' + layer} /></div></div>` : ''}
      </div>
    </div>
  </div>`;
}
