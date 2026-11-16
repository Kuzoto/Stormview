// Bluesky (AT Protocol) for Neighbor Reports. Everything runs on the phone: the app password is sent
// straight to Bluesky and never stored; only the session tokens Bluesky returns are kept (until Disconnect).
// Bluesky's search refuses requests without a signed-in account, so sign-in is required.
import { get, set } from './store.js';
import { log } from './log.js';

export const DEFAULT_SERVICE = 'https://bsky.social';
const WEATHER = /\b(storm|tornado|funnel|severe|warning|thunder|lightning|hail|flood(ing|ed)?|flash flood|power(\s+is)?\s+(out|outage)|outage|no power|blackout|tree[s]?\s+(down|fell|fallen)|downed|wind(s)?|gust|snow|ice|icy|sleet|blizzard|freezing rain|road[s]?\s+closed|closure|shelter|evacuat|siren)\b/i;

const sess = () => get().bsky;

async function call(base, method, { params, body, auth, httpMethod } = {}) {
  const url = new URL(`${base.replace(/\/$/, '')}/xrpc/${method}`);
  Object.entries(params || {}).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
  const r = await fetch(url, {
    method: httpMethod || (body ? 'POST' : 'GET'),
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(auth ? { Authorization: 'Bearer ' + auth } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.message || j.error || 'Bluesky error ' + r.status); e.code = j.error; e.status = r.status; throw e; }
  return j;
}

const pdsOf = (j, fallback) => {
  const svc = j.didDoc && (j.didDoc.service || []).find((x) => x.id === '#atproto_pds' || x.type === 'AtprotoPersonalDataServer');
  return (svc && svc.serviceEndpoint) || fallback;
};

export async function connect(identifier, appPassword, service = DEFAULT_SERVICE) {
  const id = identifier.trim().replace(/^@/, '');
  const j = await call(service, 'com.atproto.server.createSession', { body: { identifier: id, password: appPassword.trim() } });
  set({ bsky: { service, pds: pdsOf(j, service), did: j.did, handle: j.handle, accessJwt: j.accessJwt, refreshJwt: j.refreshJwt } });
  log('bsky_connect', '');
  return j.handle;
}

export function disconnect() {
  const s = sess();
  if (s && s.refreshJwt) call(s.pds, 'com.atproto.server.deleteSession', { auth: s.refreshJwt, httpMethod: 'POST' }).catch(() => {});
  set({ bsky: null });
  log('bsky_disconnect', '');
}

async function refresh() {
  const s = sess();
  const j = await call(s.pds, 'com.atproto.server.refreshSession', { auth: s.refreshJwt, httpMethod: 'POST' });
  set({ bsky: { ...s, accessJwt: j.accessJwt, refreshJwt: j.refreshJwt, handle: j.handle || s.handle } });
}

async function authed(method, params) {
  const s = sess();
  if (!s) throw new Error('Not connected to Bluesky');
  try {
    return await call(s.pds, method, { params, auth: s.accessJwt });
  } catch (e) {
    if (e.code === 'ExpiredToken' || e.status === 401) {
      try { await refresh(); } catch (e2) { set({ bsky: null }); throw new Error('Your Bluesky sign-in expired. Please connect again.'); }
      return call(sess().pds, method, { params, auth: sess().accessJwt });
    }
    throw e;
  }
}

function images(embed) {
  if (!embed) return [];
  const imgs = embed.images || (embed.media && embed.media.images) || [];
  return imgs.map((i) => ({ thumb: i.thumb, full: i.fullsize, alt: i.alt || '' }));
}

export function normalize(p) {
  const rkey = (p.uri || '').split('/').pop();
  return {
    uri: p.uri, url: `https://bsky.app/profile/${p.author.handle}/post/${rkey}`,
    handle: p.author.handle, name: p.author.displayName || p.author.handle, avatar: p.author.avatar,
    text: (p.record && p.record.text) || '', createdAt: (p.record && p.record.createdAt) || p.indexedAt,
    images: images(p.embed), likes: p.likeCount || 0,
  };
}

/** Weather posts from people the user follows (their home timeline, filtered by weather keywords). */
export async function followingWeather() {
  const out = [];
  let cursor;
  for (let page = 0; page < 2; page++) {
    const j = await authed('app.bsky.feed.getTimeline', { limit: 100, cursor });
    (j.feed || []).forEach((f) => { if (f.post && WEATHER.test((f.post.record && f.post.record.text) || '')) out.push(normalize(f.post)); });
    cursor = j.cursor;
    if (!cursor) break;
  }
  const seen = new Set();
  return out.filter((p) => !seen.has(p.uri) && seen.add(p.uri));
}

/** Public posts matching each query from the last 3 days, merged newest first. */
export async function search(queries) {
  const since = new Date(Date.now() - 3 * 86400000).toISOString();
  const results = await Promise.all(queries.slice(0, 4).map((q) => authed('app.bsky.feed.searchPosts', { q, sort: 'latest', limit: 25, since }).catch(() => ({ posts: [] }))));
  const seen = new Set();
  return results.flatMap((r) => r.posts || []).map(normalize)
    .filter((p) => !seen.has(p.uri) && seen.add(p.uri))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export const defaultQueries = (city) => {
  const c = (city || 'Ann Arbor').split(',')[0].trim();
  return [`"${c}" storm`, `"${c}" power out`, `"${c}" flooding`, `"${c}" weather`];
};
