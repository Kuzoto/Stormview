// Screen 5 – Map. D3: legend for every symbol, standard road-closed sign, conventional location pin,
// clearly highlighted single active layer, storm drawn as an area (not a button).
// D4: shelters + public places with power, safe routes, "don't drive" shown on the map.
import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.js';
import { SC, useStore, phase, get } from '../store.js';
import { Icon, Header, Segmented, SourceChip, nav } from '../ui.js';
import { log } from '../log.js';

const L = window.L;
const C = { warn: '#c62828', outage: '#6a1b9a', route: '#1565c0', shelter: '#2e7d32' };

const divIcon = (cls, inner = '', size = [26, 26]) => L.divIcon({ className: 'mk ' + cls, html: inner, iconSize: size, iconAnchor: [size[0] / 2, size[1] / 2] });
const PLACE_GLYPH = { home: 'H', work: 'W', mom: 'M' };

function drawBase(g, s, { labels = true } = {}) {
  Object.entries(s.places).forEach(([id, p]) => {
    if (p.lat == null) return;
    const here = id === SC.meta.userLocation;
    if (!here) {
      L.marker([p.lat, p.lng], { icon: divIcon('m-place', `<b>${PLACE_GLYPH[id] || '★'}</b>${labels ? `<span>${p.short || p.name}</span>` : ''}`, [26, 26]), interactive: false }).addTo(g);
    }
  });
  const you = s.places[SC.meta.userLocation];
  L.marker([you.lat, you.lng], { icon: divIcon('m-you', '<i></i>', [22, 22]), zIndexOffset: 1000, interactive: false }).addTo(g);
  if (labels) L.marker([you.lat, you.lng], { icon: L.divIcon({ className: 'mk m-you-lbl', html: `You · ${you.short || you.name}`, iconSize: [90, 18], iconAnchor: [-12, 9] }), interactive: false }).addTo(g);
}

function drawWarning(g, ph, strong) {
  if (ph.warnPolygon) L.polygon(ph.warnPolygon, { color: C.warn, weight: 2, dashArray: '6 6', fillColor: C.warn, fillOpacity: strong ? 0.08 : 0.04, interactive: false }).addTo(g);
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

function drawShelters(g, onPick, filter) {
  SC.shelterPlaces.filter((p) => !filter || p[filter]).forEach((p) => {
    const m = L.marker([p.lat, p.lng], { icon: divIcon('m-shelter', '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11 12 4l9 7M5 10v10h14V10"/></svg>', [26, 26]) }).addTo(g);
    if (onPick) m.on('click', () => onPick({ title: p.name, sub: `${p.hours} · ${p.power ? 'Has power' : 'No power'} · ${p.water ? 'Water' : 'No water'} · ${p.distance}`, ids: p.sourceIds, route: p.id }));
  });
}

function fit(map, s, ph, extra = []) {
  const pts = Object.values(s.places).filter((p) => p.lat != null).map((p) => [p.lat, p.lng]).concat(extra);
  if (ph.storm) pts.push([ph.storm.lat, ph.storm.lng]);
  map.fitBounds(L.latLngBounds(pts).pad(0.12), { animate: false });
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
    drawWarning(g, ph, false); drawStorm(g, ph); drawOutages(g, ph); drawRoads(g, ph); drawBase(g, s, { labels: false });
    fit(map, s, ph);
    setTimeout(() => { if (!map._dead) map.invalidateSize(); }, 350);
  }, [ph.id, JSON.stringify(s.places)]);
  return html`<div class="mini-map-wrap"><div class="mini-map" ref=${ref}></div>
    <div class="mini-legend"><span><i class="lg you"></i>You</span><span><i class="lg storm"></i>Storm</span><span><i class="lg warnarea"></i>Warning area</span><span><i class="lg outage"></i>Outage</span><span><i class="lg closed"></i>Road closed</span></div></div>`;
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

export function MapScreen({ query = {} }) {
  const ref = useRef();
  const mapRef = useRef();
  const s = useStore();
  const ph = phase(s);
  const [layer, setLayer] = useState(query.layer || 'radar');
  const [route, setRoute] = useState(query.route || null);
  const [picked, setPicked] = useState(null);
  const [legendOpen, setLegendOpen] = useState(true);

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
    drawWarning(g, ph, layer === 'radar');
    const extra = [];
    if (layer === 'radar') drawStorm(g, ph);
    if (layer === 'roads') {
      drawRoads(g, ph, pick);
      if (ph.routeHome) L.polyline(ph.routeHome, { color: C.route, weight: 5, opacity: 0.85 }).addTo(g);
    }
    if (layer === 'power') { drawOutages(g, ph); drawShelters(g, pick, 'power'); SC.shelterPlaces.forEach((p) => extra.push([p.lat, p.lng])); }
    if (layer === 'shelters') {
      drawShelters(g, pick); drawRoads(g, ph);
      SC.shelterPlaces.forEach((p) => extra.push([p.lat, p.lng]));
      if (route && SC.routes[route]) L.polyline(SC.routes[route], { color: C.route, weight: 5, dashArray: ph.dontDrive ? '2 8' : null }).addTo(g);
    }
    drawBase(g, s);
    if (layer === 'shelters' && route && SC.routes[route]) map.fitBounds(L.latLngBounds(SC.routes[route]).pad(1.2), { animate: false, maxZoom: 15 });
    else fit(map, s, ph, extra);
  }, [layer, route, ph.id, JSON.stringify(s.places)]);

  const sel = route && SC.shelterPlaces.find((p) => p.id === route);
  return html`<div class="map-screen">
    <${Header} title="Map" />
    <div class="map-tools">
      <div class="small muted layer-lbl">Showing layer:</div>
      <${Segmented} options=${LAYERS} value=${layer} onChange=${(v) => { log('map_layer', v); setLayer(v); setPicked(null); }} cls="map-seg" />
    </div>
    <div class="map-holder">
      <div class="map-full" ref=${ref}></div>
      ${ph.dontDrive ? html`<div class="map-dontdrive"><${Icon} n="car" size=${18} /> Don't drive during the warning (until 8:45 PM)</div>` : ''}
      ${s.offline ? html`<div class="map-offline">Offline: map tiles may be missing. Markers show the last update (${ph.clock}).</div>` : ''}
      ${picked ? html`<div class="map-pick card">
        <div class="row between"><strong>${picked.title}</strong><button class="hdr-btn sm" aria-label="Close" onClick=${() => setPicked(null)}><${Icon} n="x" size=${18} /></button></div>
        <div class="small muted">${picked.sub}</div>
        <div class="row between mt8"><${SourceChip} ids=${picked.ids} claim=${picked.title} />
          ${picked.route ? html`<button class="btn primary sm" onClick=${() => { setLayer('shelters'); setRoute(picked.route); setPicked(null); log('route_show', picked.route); }}><${Icon} n="route" size=${16} /> Route</button>` : ''}</div>
      </div>` : ''}
      ${sel && layer === 'shelters' && !picked ? html`<div class="map-pick card">
        <div class="row between"><strong>Route to ${sel.name}</strong><button class="hdr-btn sm" aria-label="Clear route" onClick=${() => setRoute(null)}><${Icon} n="x" size=${18} /></button></div>
        <div class="small muted">${sel.distance} · ${sel.walk} · avoids closed roads${ph.dontDrive ? ' · use only after the warning ends or if your building is unsafe' : ''}</div>
      </div>` : ''}
      <div class=${'legend card' + (legendOpen ? '' : ' closed')}>
        <button class="legend-hdr" onClick=${() => setLegendOpen(!legendOpen)} aria-expanded=${legendOpen}>
          <${Icon} n="layers" size=${16} /><strong>Legend · ${LAYERS.find((l) => l.value === layer).label}</strong><span class="grow"></span><span class="small">${legendOpen ? 'Hide' : 'Show'}</span></button>
        ${legendOpen ? html`<div class="legend-items">${LEGEND[layer].map(([k, t]) => html`<div class="lg-row"><i class=${'lg ' + k}></i>${t}</div>`)}
          <div class="lg-row"><span class="small muted">Data:</span><${SourceChip} ids=${LAYER_SOURCES[layer]} claim=${'Map layer: ' + layer} /></div></div>` : ''}
      </div>
    </div>
  </div>`;
}
