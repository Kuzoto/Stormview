// My Places (D8 / HF-18): add, rename and remove saved places.
import { html, useState } from '../../vendor/preact-htm.js';
import { SC, useStore, set, toast } from '../store.js';
import { Icon, Header } from '../ui.js';
import { log } from '../log.js';

// A few Ann Arbor-area spots to choose from when adding a place (no geocoding in the prototype).
const PRESETS = [
  { label: 'Ann Arbor – North Campus', lat: 42.2930, lng: -83.7160 },
  { label: 'Ann Arbor – Westgate', lat: 42.2690, lng: -83.7860 },
  { label: 'Saline', lat: 42.1667, lng: -83.7816 },
  { label: 'Dexter', lat: 42.3384, lng: -83.8885 },
  { label: 'Ypsilanti – EMU', lat: 42.2506, lng: -83.6240 },
];

export function Places() {
  const s = useStore();
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [preset, setPreset] = useState(0);

  const save = (id) => {
    set((st) => ({ places: { ...st.places, [id]: { ...st.places[id], name, short: name } } }));
    log('place_rename', id, { name });
    setEditing(null);
  };
  const remove = (id) => {
    set((st) => { const p = { ...st.places }; delete p[id]; return { places: p, placeOrder: st.placeOrder.filter((x) => x !== id) }; });
    log('place_remove', id);
  };
  const add = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    const id = 'pl' + Date.now();
    const pr = PRESETS[preset];
    set((st) => ({ places: { ...st.places, [id]: { name: name.trim(), short: name.trim(), addr: pr.label, lat: pr.lat, lng: pr.lng } }, placeOrder: [...st.placeOrder, id] }));
    log('place_add', name.trim(), pr);
    toast('Added ' + name.trim());
    setAdding(false); setName('');
  };

  return html`<div class="pad">
    <${Header} title="My Places" backTo="/more" />
    <p class="small muted">Alerts, impacts and forecasts are shown for these places.</p>
    <div class="list card">
      ${s.placeOrder.map((id) => { const p = s.places[id]; const builtIn = !!SC.places[id]; return html`<div class="list-item static">
        <span class="li-ic"><${Icon} n="pin" /></span>
        ${editing === id
          ? html`<form class="grow row gap8" onSubmit=${(e) => { e.preventDefault(); save(id); }}><input class="grow" value=${name} onInput=${(e) => setName(e.target.value)} aria-label="Place name" /><button class="btn primary sm">Save</button></form>`
          : html`<span class="grow"><span class="li-title">${p.name}${id === SC.meta.userLocation ? ' · you are here' : ''}</span><span class="li-sub">${p.addr}</span></span>
            <button class="hdr-btn sm" aria-label=${'Rename ' + p.name} onClick=${() => { setEditing(id); setName(p.name); }}><${Icon} n="edit" size=${18} /></button>
            ${!builtIn ? html`<button class="hdr-btn sm" aria-label=${'Remove ' + p.name} onClick=${() => remove(id)}><${Icon} n="trash" size=${18} /></button>` : ''}`}
      </div>`; })}
    </div>
    ${adding ? html`<form class="card mt12" onSubmit=${add}>
      <label class="field"><span>Name</span><input value=${name} onInput=${(e) => setName(e.target.value)} placeholder="e.g. Kid's school" /></label>
      <label class="field"><span>Area</span><select value=${preset} onChange=${(e) => setPreset(+e.target.value)}>${PRESETS.map((p, i) => html`<option value=${i}>${p.label}</option>`)}</select></label>
      <div class="row gap8"><button type="button" class="btn ghost grow" onClick=${() => setAdding(false)}>Cancel</button><button class="btn primary grow" disabled=${!name.trim()}>Add place</button></div>
    </form>` : html`<button class="btn ghost full mt12" onClick=${() => { setAdding(true); setName(''); }}><${Icon} n="plus" size=${18} /> Add a place</button>`}
  </div>`;
}
