// Safety circle sync (live mode) + the user's display name (also used on Neighbor Reports).
// No accounts: the first time you set a name, the server gives this phone a random id + secret token.
// The circle is refreshed about every 20 s while the app is open; changes arrive as in-app notifications.
import { get, set, isLive, notify } from './store.js';
import { log } from './log.js';

let timer = null;
let inflight = null;

export const profileName = (s = get()) => (s.profile && s.profile.name) || s.postName || '';

async function api(path, opts = {}) {
  const s = get();
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (s.profile && s.profile.token) headers['X-User-Token'] = s.profile.token;
  const r = await fetch(path, { ...opts, headers });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && s.profile && s.profile.token) {
    // The server no longer knows this phone (e.g. its data was wiped). Keep the name, re-register next time.
    set((st) => ({ profile: { name: st.profile.name } }));
  }
  if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
  return j;
}

/** Make sure this phone has a server identity with the given (or saved) name. */
export async function ensureProfile(name) {
  const s = get();
  const nm = (name ?? profileName(s)).trim().slice(0, 30);
  if (!nm) throw new Error('Choose a name first');
  if (s.profile && s.profile.token) {
    if (nm !== s.profile.name) {
      await api('api/me', { method: 'POST', body: JSON.stringify({ name: nm }) });
      set((st) => ({ profile: { ...st.profile, name: nm } }));
      log('profile_rename', '');
    }
    return get().profile;
  }
  const j = await fetch('api/me', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nm }) }).then(async (r) => {
    const b = await r.json(); if (!r.ok) throw new Error(b.error || 'HTTP ' + r.status); return b;
  });
  set({ profile: { uid: j.uid, token: j.token, name: j.name } });
  log('profile_create', '');
  startCircle();
  return get().profile;
}

/** Save the name locally right away (used while typing); syncs to the server on commit. */
export const setLocalName = (name) => set((st) => ({ profile: { ...(st.profile || {}), name: name.slice(0, 30) } }));

const stateOf = (p) => (p.status ? p.status.state : 'none');

export async function refreshCircle() {
  const s = get();
  if (!isLive(s) || !s.profile || !s.profile.token || s.offline) return null;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const j = await api('api/circle');
      const prev = get().circleLive;
      if (prev) {
        const before = Object.fromEntries((prev.people || []).map((p) => [p.id, p]));
        (j.people || []).forEach((p) => {
          const b = before[p.id];
          const changed = p.status && (!b || !b.status || b.status.time !== p.status.time);
          if (changed) {
            notify({ title: `${p.name}: ${p.status.state === 'safe' ? '✓ Safe' : '⚠ Needs help'}`, text: p.status.note || 'Updated their check-in', go: '/checkin' }, 7000);
            log('circle_update', p.kind, { state: p.status.state });
          } else if (!b && p.kind === 'app') {
            notify({ title: `${p.name} joined your circle`, text: 'You can now see each other\'s check-ins', go: '/checkin' });
          }
        });
        const oldPings = (prev.pings || []).length;
        if ((j.pings || []).length > oldPings) {
          const p = j.pings[j.pings.length - 1];
          notify({ title: `${p.from} asked if you're OK`, text: 'Tap to check in', go: '/checkin' }, 8000);
        }
      }
      set({ circleLive: j, circleError: null });
      return j;
    } catch (e) {
      set({ circleError: String(e.message || e) });
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function startCircle() {
  if (timer) return;
  refreshCircle();
  timer = setInterval(() => { if (!document.hidden) refreshCircle(); }, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshCircle(); });
}

export async function sendStatus(state, note, loc) {
  await ensureProfile();
  await api('api/status', { method: 'POST', body: JSON.stringify({ state, note, loc }) });
  await refreshCircle();
}

export async function createInvite(contactName) {
  await ensureProfile();
  const j = await api('api/circle/invite', { method: 'POST', body: JSON.stringify({ name: contactName }) });
  refreshCircle();
  return { code: j.code, url: location.origin + '/r/' + j.code };
}

export const inviteUrl = (code) => location.origin + '/r/' + code;
export const getInvite = (code) => fetch('api/circle/invite/' + encodeURIComponent(code)).then((r) => (r.ok ? r.json() : null));

export async function acceptInvite(code) {
  await ensureProfile();
  const j = await api('api/circle/accept', { method: 'POST', body: JSON.stringify({ code }) });
  await refreshCircle();
  return j;
}

export const pingPerson = (id) => api('api/circle/ping', { method: 'POST', body: JSON.stringify({ id }) });
export async function removePerson(id) { await api('api/circle/' + encodeURIComponent(id), { method: 'DELETE' }); await refreshCircle(); }

/** Open the phone's text app (with a number) or share sheet, or copy as a last resort. */
export async function sendText(text, phone) {
  const ios = /iPhone|iPad|Mac/.test(navigator.userAgent);
  if (phone) { location.href = `sms:${phone}${ios ? '&' : '?'}body=${encodeURIComponent(text)}`; return 'sms'; }
  if (navigator.share) {
    try { await navigator.share({ text }); return 'share'; } catch (e) { if (e && e.name === 'AbortError') return 'cancel'; }
  }
  try { await navigator.clipboard.writeText(text); return 'copied'; } catch (e) { return 'failed'; }
}
