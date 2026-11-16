// Live mode: keeps the user's location and the real NWS data fresh.
//  - "My location" comes from the phone (needs https or localhost; otherwise we fall back to Ann Arbor).
//  - /api/live is re-fetched every 2 minutes while the app is open, when it comes back to the foreground,
//    and whenever places change. The last payload is kept in the store for offline use.
import { SC, get, set, isLive, DEFAULT_HERE } from './store.js';
import { log } from './log.js';

let timer = null;
let inflight = null;
let lastKey = '';
let lastAt = 0;

const tz = () => -new Date().getTimezoneOffset();

export function livePlacesPayload(s = get()) {
  return s.liveOrder.filter((id) => s.livePlaces[id]).map((id) => {
    const p = s.livePlaces[id];
    return { id, name: p.name, lat: p.lat, lng: p.lng };
  }).filter((p) => p.lat != null);
}

function locate() {
  return new Promise((resolve) => {
    if (!navigator.geolocation || !window.isSecureContext) return resolve({ error: window.isSecureContext ? 'unsupported' : 'insecure' });
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy }),
      (err) => resolve({ error: err.code === 1 ? 'denied' : 'unavailable' }),
      { enableHighAccuracy: false, maximumAge: 5 * 60 * 1000, timeout: 10000 },
    );
  });
}

const kmBetween = (a, b) => {
  const R = 6371, dLat = ((b.lat - a.lat) * Math.PI) / 180, dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

/** Update "My location" from the phone. Rounded to ~100 m: enough for alerts, kinder to privacy. */
export async function updateLocation() {
  const s = get();
  const here = s.livePlaces.here;
  if (!here || !here.auto) return;
  const r = await locate();
  if (r.error) {
    set((st) => ({ livePlaces: { ...st.livePlaces, here: { ...st.livePlaces.here, locError: r.error, approx: st.livePlaces.here.approx !== false && !st.livePlaces.here.located } } }));
    return;
  }
  const next = { lat: Math.round(r.lat * 1000) / 1000, lng: Math.round(r.lng * 1000) / 1000 };
  if (here.located && kmBetween(here, next) < 0.3) return;
  set((st) => ({ livePlaces: { ...st.livePlaces, here: { ...st.livePlaces.here, ...next, located: true, approx: false, locError: null } } }));
  log('location_update', '', { acc: Math.round(r.acc || 0) });
}

export async function refreshLive(force = false) {
  const s = get();
  if (!isLive(s) || s.offline) return;
  const places = livePlacesPayload(s);
  const key = JSON.stringify(places);
  if (!force && key === lastKey && Date.now() - lastAt < 60000 && s.live) return;
  if (inflight) return inflight;
  set({ liveLoading: true });
  inflight = (async () => {
    try {
      const r = await fetch('api/live', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ places, here: 'here', tz: tz() }) });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || 'HTTP ' + r.status);
      if (j.sources) Object.assign(SC.sources, j.sources);
      lastKey = key; lastAt = Date.now();
      set((st) => {
        const here = st.livePlaces.here;
        const patch = { live: j, liveLoading: false, liveError: null };
        if (here && here.auto) {
          const city = j.hereCity || '';
          const addr = here.located ? (city ? 'Near ' + city : 'Current location') : here.locError === 'denied'
            ? 'Location is off · using ' + (city || 'Ann Arbor, MI') : !window.isSecureContext
            ? 'Location needs https · using ' + (city || 'Ann Arbor, MI') : city ? 'Near ' + city : 'Current location';
          if (addr !== here.addr) patch.livePlaces = { ...st.livePlaces, here: { ...here, addr } };
        }
        return patch;
      });
      // Public buildings are looked up in the background on the server; pick them up shortly.
      if (j.publicPending) setTimeout(() => refreshLive(true), 6000);
    } catch (e) {
      set({ liveLoading: false, liveError: String(e.message || e) });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function startLive() {
  if (timer) return;
  const tick = async () => {
    if (!isLive() || document.hidden) return;
    await updateLocation();
    refreshLive();
  };
  (async () => { await updateLocation(); refreshLive(true); })();
  timer = setInterval(tick, 120000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
}

/** Use the phone's location again for "My location" (after it was set by hand). */
export function resetHere() {
  set((st) => ({ livePlaces: { ...st.livePlaces, here: { ...DEFAULT_HERE, name: st.livePlaces.here?.name || DEFAULT_HERE.name } } }));
  updateLocation().then(() => refreshLive(true));
}
