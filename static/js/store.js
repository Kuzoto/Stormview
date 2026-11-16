// Tiny global store with localStorage persistence (per device).
import { useState, useEffect } from '../vendor/preact-htm.js';

const KEY = 'stormwise-state-v1';
export let SC = null; // scenario.json, loaded once

const listeners = new Set();
let state = null;

function initialState() {
  return {
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

const TRANSIENT = ['toasts', 'notif', 'sheet', 'summaries', 'llm', 'likertOpen'];

export async function loadScenario() {
  const r = await fetch('data/scenario.json', { cache: 'no-cache' });
  SC = await r.json();
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { saved = null; }
  state = { ...initialState(), ...(saved || {}), toasts: [], notif: null, sheet: null, summaries: {}, llm: null, likertOpen: false };
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

/** Reset everything a participant could have changed (keeps study settings). */
export function resetApp(keepStudy = true) {
  const study = state.study;
  state = { ...initialState(), toasts: [], notif: null, sheet: null, summaries: state.summaries, llm: state.llm, likertOpen: false };
  if (keepStudy) state.study = study;
  pendingTimers.forEach(clearTimeout);
  pendingTimers.length = 0;
  persist();
  listeners.forEach((l) => l(state));
}

// ---- helpers
export const phase = (s = state) => SC.phases.find((p) => p.id === s.phase) || SC.phases[0];
export const phaseIndex = (s = state) => Math.max(0, SC.phases.findIndex((p) => p.id === s.phase));
export const clock = (s = state) => phase(s).clock;
export const placeName = (id, s = state) => (s.places[id] && s.places[id].name) || id;

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
