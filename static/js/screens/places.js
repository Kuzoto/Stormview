// My Places (D8 / HF-18): add, rename and remove saved places.
// Live mode: real address / city search (US Census + Open-Meteo geocoders via the server) and
// "My location" from the phone. Scenario mode: a few preset Ann Arbor-area spots.
import { html, useState } from '../../vendor/preact-htm.js';
import { SC, useStore, set, toast, isLive, myPlaces, myOrder, hereId, setPlaces } from '../store.js';
import { Icon, Header } from '../ui.js';
import { log } from '../log.js';
import { refreshLive, resetHere } from '../live.js';

const PRESETS = [
  { label: 'Ann Arbor – North Campus', lat: 42.2930, lng: -83.7160 },
  { label: 'Ann Arbor – Westgate', lat: 42.2690, lng: -83.7860 },
  { label: 'Saline', lat: 42.1667, lng: -83.7816 },
  { label: 'Dexter', lat: 42.3384, lng: -83.8885 },
  { label: 'Ypsilanti – EMU', lat: 42.2506, lng: -83.6240 },
];

function LiveSearch({ onPick }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const search = async (e) => {
    e && e.preventDefault();
    if (q.trim().length < 3) return;
    setBusy(true);
    try {
      const j = await (await fetch('api/geocode?q=' + encodeURIComponent(q.trim()))).json();
      setRes(j.results || []);
    } catch (err) { setRes([]); }
    setBusy(false);
  };
  return html`<div>
    <label class="field"><span>Address or city (US)</span>
      <div class="row gap8"><input class="grow" value=${q} onInput=${(e) => setQ(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') search(e); }}
        placeholder="e.g. 1100 N University Ave, Ann Arbor" enterkeyhint="search" />
      <button type="button" class="btn ghost sm" disabled=${busy || q.trim().length < 3} onClick=${search}>${busy ? '…' : 'Search'}</button></div></label>
    ${res && !res.length ? html`<p class="small muted">No matches. Try "street, city, state" or just a city name.</p>` : ''}
    ${res && res.length ? html`<div class="list card">${res.map((r) => html`<button type="button" class="list-item" onClick=${() => { onPick(r); setRes(null); setQ(r.label); }}>
      <span class="li-ic"><${Icon} n="pin" /></span><span class="grow li-title">${r.label}</span></button>`)}</div>` : ''}
  </div>`;
}

export function Places() {
  const s = useStore();
  const live = isLive(s);
  const places = myPlaces(s);
  const order = myOrder(s);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [preset, setPreset] = useState(0);
  const [found, setFound] = useState(null);

  const save = (id) => {
    setPlaces(({ places: p, order: o }) => ({ places: { ...p, [id]: { ...p[id], name, short: name } }, order: o }));
    log('place_rename', id, { name });
    setEditing(null);
    if (live) refreshLive(true);
  };
  const remove = (id) => {
    setPlaces(({ places: p, order: o }) => { const n = { ...p }; delete n[id]; return { places: n, order: o.filter((x) => x !== id) }; });
    log('place_remove', id);
    if (live) refreshLive(true);
  };
  const add = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    const pr = live ? found : PRESETS[preset];
    if (!pr) return;
    const id = 'pl' + Date.now();
    setPlaces(({ places: p, order: o }) => ({ places: { ...p, [id]: { name: name.trim(), short: name.trim(), addr: pr.label, lat: pr.lat, lng: pr.lng } }, order: [...o, id] }));
    log('place_add', name.trim(), live ? { live: true } : pr);
    toast('Added ' + name.trim());
    setAdding(false); setName(''); setFound(null);
    if (live) setTimeout(() => refreshLive(true), 50);
  };
  const setHereManually = (r) => {
    set((st) => ({ livePlaces: { ...st.livePlaces, here: { ...st.livePlaces.here, lat: r.lat, lng: r.lng, addr: r.label, auto: false, approx: false, located: true, locError: null } } }));
    log('here_set_manual', '');
    setTimeout(() => refreshLive(true), 50);
  };
  const here = live && places.here;
  const [settingHere, setSettingHere] = useState(false);

  return html`<div class="pad">
    <${Header} title="My Places" backTo="/more" />
    <p class="small muted">${live ? 'Live alerts, impacts and forecasts are shown for these places (up to 6). They are saved on this phone.' : 'Alerts, impacts and forecasts are shown for these places.'}</p>
    <div class="list card">
      ${order.map((id) => { const p = places[id]; const builtIn = live ? id === 'here' : !!SC.places[id]; return html`<div class="list-item static">
        <span class="li-ic"><${Icon} n="pin" /></span>
        ${editing === id
          ? html`<form class="grow row gap8" onSubmit=${(e) => { e.preventDefault(); save(id); }}><input class="grow" value=${name} onInput=${(e) => setName(e.target.value)} aria-label="Place name" /><button class="btn primary sm">Save</button></form>`
          : html`<span class="grow"><span class="li-title">${p.name}${id === hereId(s) ? (live ? '' : ' · you are here') : ''}</span><span class="li-sub">${p.addr}</span></span>
            <button class="hdr-btn sm" aria-label=${'Rename ' + p.name} onClick=${() => { setEditing(id); setName(p.name); }}><${Icon} n="edit" size=${18} /></button>
            ${!builtIn ? html`<button class="hdr-btn sm" aria-label=${'Remove ' + p.name} onClick=${() => remove(id)}><${Icon} n="trash" size=${18} /></button>` : ''}`}
      </div>`; })}
    </div>
    ${here ? html`<div class="card mt12 small">
      <strong>My location</strong>
      <p class="muted">${here.auto
        ? here.locError === 'denied' ? 'Location permission is off, so the app is using Ann Arbor. Turn on location for this site in your browser settings, or set it by hand.'
          : !window.isSecureContext ? 'Phones only share location with https pages (use the tunnel link) or localhost. Using Ann Arbor until then, or set it by hand.'
          : here.located ? 'Using your phone\'s location (rounded to about 100 m).' : 'Finding your location…'
        : 'Set by hand. The app is not using your phone\'s location.'}</p>
      ${settingHere ? html`<${LiveSearch} onPick=${(r) => { setHereManually(r); setSettingHere(false); }} />`
        : html`<div class="row gap8">${!here.auto || here.locError ? html`<button class="btn ghost sm grow" onClick=${resetHere}>Use my phone's location</button>` : ''}
          <button class="btn ghost sm grow" onClick=${() => setSettingHere(true)}>Set it by hand</button></div>`}
    </div>` : ''}
    ${adding ? html`<form class="card mt12" onSubmit=${add}>
      <label class="field"><span>Name</span><input value=${name} onInput=${(e) => setName(e.target.value)} placeholder="e.g. Home, Work, Mom's house" /></label>
      ${live ? html`<${LiveSearch} onPick=${setFound} />${found ? html`<p class="small">✓ ${found.label}</p>` : ''}`
        : html`<label class="field"><span>Area</span><select value=${preset} onChange=${(e) => setPreset(+e.target.value)}>${PRESETS.map((p, i) => html`<option value=${i}>${p.label}</option>`)}</select></label>`}
      <div class="row gap8"><button type="button" class="btn ghost grow" onClick=${() => { setAdding(false); setFound(null); }}>Cancel</button><button class="btn primary grow" disabled=${!name.trim() || (live && !found)}>Add place</button></div>
    </form>` : html`<button class="btn ghost full mt12" disabled=${live && order.length >= 6} onClick=${() => { setAdding(true); setName(''); }}><${Icon} n="plus" size=${18} /> Add a place</button>`}
  </div>`;
}
