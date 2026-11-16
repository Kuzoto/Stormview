// Tiny global store with localStorage persistence (per device).
import { useState, useEffect } from '../vendor/preact-htm.js';

const KEY = 'stormwise-state-v1';
export let SC = null; // scenario.json, loaded once

const listeners = new Set();
let state = null;

export const DEFAULT_HERE = { name: 'My location', short: 'You', addr: 'Finding your location…', lat: 42.2808, lng: -83.7430, auto: true, approx: true };

function initialState() {
  return {
    mode: 'live', // 'live' = real NWS data for the user's places (default) · 'scenario' = scripted practice storm (study)
    live: null, // last live payload from /api/live (kept for offline)
    livePlaces: { here: { ...DEFAULT_HERE } },
    liveOrder: ['here'],
    liveCircle: [],
    phase: 'warning',
    offline: false,
    checkin: { status: 'none', time: null, sentTo: [], shareLocation: false },
    circle: SC.circle.map((c) => ({ ...c, requested: null })),
    chat: [],
    posts: [],
    places: JSON.parse(JSON.stringify(SC.places)),
    placeOrder: Object.keys(SC.places),
    study: { pid: '', condition: 'app-first', session: '', showTimer: false },
    timer: null, // {startedAt, durationMs} – persisted so a reload mid-task doesn't lose it
    likertDone: null,
  };
}

const TRANSIENT = ['toasts', 'notif', 'sheet', 'summaries', 'llm', 'likertOpen', 'liveLoading', 'liveError'];
// Persisted live-mode extras: postName, myPosts {id: deleteToken}, hiddenPosts [ids], deviceId.

export async function loadScenario() {
  const r = await fetch('data/scenario.json', { cache: 'no-cache' });
  SC = await r.json();
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { saved = null; }
  state = { ...initialState(), ...(saved || {}), toasts: [], notif: null, sheet: null, summaries: {}, llm: null, likertOpen: false, liveLoading: false, liveError: null };
  Object.assign(SC.sources, SC.liveSources || {}); // live-mode sources (ids end in _live)
}

function persist() {
  const copy = { ...state };
  TRANSIENT.forEach((k) => delete copy[k]);
  try { localStorage.setItem(KEY, JSON.stringify(copy)); } catch (e) { /* private mode */ }
}

export function get() { return state; }

export function set(patch) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  persist();
  listeners.forEach((l) => l(state));
}

export function useStore(sel = (s) => s) {
  const [v, setV] = useState(() => sel(state));
  useEffect(() => {
    const l = (s) => setV(() => sel(s));
    listeners.add(l);
    l(state);
    return () => listeners.delete(l);
  }, []);
  return v;
}

/** Reset everything a participant could have changed in the scenario (keeps study settings and the
 *  user's own live-mode places, contacts and mode). */
export function resetApp(keepStudy = true) {
  const study = state.study;
  const keep = { mode: state.mode, live: state.live, livePlaces: state.livePlaces, liveOrder: state.liveOrder, liveCircle: state.liveCircle };
  state = { ...initialState(), ...keep, toasts: [], notif: null, sheet: null, summaries: state.summaries, llm: state.llm, likertOpen: false, liveLoading: false, liveError: null };
  if (keepStudy) state.study = study;
  pendingTimers.forEach(clearTimeout);
  pendingTimers.length = 0;
  persist();
  listeners.forEach((l) => l(state));
}

// ---- helpers
export const isLive = (s = state) => s.mode === 'live';

const tone = (headline, sub) => ({ tone: 'ok', headline, sub, rows: [] });
function liveLoading(s) {
  const now = new Date();
  return {
    id: 'live', mode: 'live', label: 'Live', level: 'clear', loading: true,
    clock: now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    date: now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }),
    banner: { title: s.liveError ? 'Live alerts unavailable' : 'Checking live alerts…', levelLabel: 'Live', area: 'National Weather Service', until: '', sourceIds: ['nws_live'] },
    action: s.liveError ? 'Couldn\'t reach the weather service. Check weather.gov for official alerts.' : 'Loading the latest official alerts for your places…',
    dontDrive: false, alertText: s.liveError || 'Loading…', severity: null, timeline: [],
    impacts: { power: tone('Loading…', ''), water: tone('Loading…', ''), roads: tone('Loading…', ''), shelter: { ...tone('Loading…', ''), now: 'here' } },
    storm: null, warnPolygon: null, warnPolygons: [], outages: [], roadMarks: [], routeHome: null, publicPlaces: [],
    forecast: { hours: [], places: {} }, summaryFallback: '', digest: 'loading', alerts: [],
  };
}
export const phase = (s = state) => (isLive(s) ? s.live || liveLoading(s) : SC.phases.find((p) => p.id === s.phase) || SC.phases[0]);
export const phaseIndex = (s = state) => (isLive(s) ? 0 : Math.max(0, SC.phases.findIndex((p) => p.id === s.phase)));
export const clock = (s = state) => phase(s).clock;
/** The active set of places: the user's real places in live mode, the scripted ones in the scenario. */
export const myPlaces = (s = state) => (isLive(s) ? s.livePlaces : s.places);
export const myOrder = (s = state) => (isLive(s) ? s.liveOrder : s.placeOrder).filter((id) => myPlaces(s)[id]);
export const hereId = (s = state) => (isLive(s) ? 'here' : SC.meta.userLocation);
export const placeName = (id, s = state) => (myPlaces(s)[id] && myPlaces(s)[id].name) || id;
export const myCircle = (s = state) => (isLive(s) ? s.liveCircle : s.circle);
/** Update the active places (live or scenario) with fn({places, order}) -> {places, order}. */
export function setPlaces(fn) {
  set((st) => {
    const live = isLive(st);
    const r = fn({ places: live ? st.livePlaces : st.places, order: live ? st.liveOrder : st.placeOrder });
    return live ? { livePlaces: r.places, liveOrder: r.order } : { places: r.places, placeOrder: r.order };
  });
}

export function toast(text, tone = 'ok', ms = 3200) {
  const id = Math.random().toString(36).slice(2);
  set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
}

/** iOS/Android-style notification banner that drops in from the top. */
export function notify(n, ms = 5000) {
  const id = Date.now() + Math.random();
  set({ notif: { ...n, id } });
  try { navigator.vibrate && navigator.vibrate(60); } catch (e) {}
  setTimeout(() => set((s) => (s.notif && s.notif.id === id ? { notif: null } : {})), ms);
}

export const openSheet = (sheet) => set({ sheet });
export const closeSheet = () => set({ sheet: null });

export const pendingTimers = [];
export function later(fn, ms) { pendingTimers.push(setTimeout(fn, ms)); }
