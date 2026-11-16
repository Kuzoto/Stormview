import { get, set, phase, isLive, myPlaces, myOrder, myCircle } from './store.js';
import { livePlacesPayload } from './live.js';

export async function health() {
  try {
    const r = await fetch('api/health');
    const j = await r.json();
    set({ llm: j });
    return j;
  } catch (e) {
    set({ llm: { llm: false, error: 'offline' } });
    return null;
  }
}

/** AI-written personal summary for the current phase; server caches it so every participant sees the same text. */
export async function loadSummary(phaseId, refresh = false) {
  const s = get();
  if (isLive(s)) return loadLiveSummary(refresh);
  if (!refresh && s.summaries[phaseId]) return s.summaries[phaseId];
  const p = phase();
  let out;
  if (s.offline) {
    out = { answer: p.summaryFallback, sourceIds: p.banner.sourceIds, fallback: true };
  } else {
    try {
      const r = await fetch('api/summary?phase=' + encodeURIComponent(phaseId) + (refresh ? '&refresh=1' : ''));
      out = await r.json();
    } catch (e) {
      out = { answer: p.summaryFallback, sourceIds: p.banner.sourceIds, fallback: true };
    }
  }
  set((st) => ({ summaries: { ...st.summaries, [phaseId]: out } }));
  return out;
}

/** Live mode: summary of the real data. Keyed by the data's fingerprint, so it only changes when the alerts do. */
async function loadLiveSummary(refresh) {
  const s = get();
  const p = phase(s);
  if (!s.live) return null;
  const key = 'live:' + p.digest;
  if (!refresh && s.summaries[key]) return s.summaries[key];
  let out;
  if (s.offline) out = { answer: p.summaryFallback, sourceIds: p.banner.sourceIds, fallback: true };
  else {
    try {
      const r = await fetch('api/live/summary', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ places: livePlacesPayload(s), refresh, tz: -new Date().getTimezoneOffset() }) });
      out = await r.json();
      if (out.error && !out.answer) throw new Error(out.error);
    } catch (e) {
      out = { answer: p.summaryFallback, sourceIds: p.banner.sourceIds, fallback: true };
    }
  }
  set((st) => ({ summaries: { ...st.summaries, [key]: out } }));
  return out;
}

export async function askWeatherBoy(messages, promptId) {
  const s = get();
  const places = myPlaces(s);
  const userState = {
    checkInStatus: s.checkin.status,
    checkInSentAt: s.checkin.time,
    circle: myCircle(s).map((c) => ({ name: c.name, status: c.status, time: c.time })),
    savedPlaces: myOrder(s).map((id) => places[id].name),
  };
  const live = isLive(s);
  const r = await fetch('api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: live ? 'live' : 'scenario', phase: s.phase, promptId, userState,
      places: live ? livePlacesPayload(s) : undefined, tz: -new Date().getTimezoneOffset(),
      messages: messages.map((m) => ({ role: m.role, content: m.content })) }),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
