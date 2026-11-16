import { get, set, phase } from './store.js';

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

export async function askWeatherBoy(messages, promptId) {
  const s = get();
  const userState = {
    checkInStatus: s.checkin.status,
    checkInSentAt: s.checkin.time,
    circle: s.circle.map((c) => ({ name: c.name, status: c.status, time: c.time })),
    savedPlaces: s.placeOrder.map((id) => s.places[id].name),
  };
  const r = await fetch('api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phase: s.phase, promptId, userState, messages: messages.map((m) => ({ role: m.role, content: m.content })) }),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
