// Neighbor Reports → Bluesky tab: connect with an app password, then see weather posts from people you
// follow and a search of recent public posts about your city. Everything is marked unverified.
import { html, useEffect, useState } from '../../vendor/preact-htm.js';
import { useStore, phase, toast, openSheet } from '../store.js';
import { Icon, Segmented } from '../ui.js';
import { log } from '../log.js';
import { connect, disconnect, followingWeather, search, defaultQueries, DEFAULT_SERVICE } from '../bluesky.js';

const ago = (iso) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!(m >= 0)) return '';
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60);
  return h < 24 ? h + ' h ago' : Math.round(h / 24) + ' d ago';
};

function Connect() {
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [service, setService] = useState(DEFAULT_SERVICE);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const go = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try { const h = await connect(id, pw, service.trim() || DEFAULT_SERVICE); setPw(''); toast('Connected as @' + h); }
    catch (e2) { setErr(e2.message || String(e2)); log('bsky_connect_fail', ''); }
    setBusy(false);
  };
  return html`<form class="card" onSubmit=${go}>
    <h2>See weather posts from Bluesky</h2>
    <p class="small">Connect your Bluesky account to see storm, outage and flooding posts from people you follow, plus recent public posts about your area. Bluesky only allows searching for signed-in accounts.</p>
    <label class="field"><span>Bluesky handle</span><input value=${id} onInput=${(e) => setId(e.target.value)} placeholder="you.bsky.social" autocapitalize="off" autocomplete="username" /></label>
    <label class="field"><span>App password</span><input type="password" value=${pw} onInput=${(e) => setPw(e.target.value)} placeholder="xxxx-xxxx-xxxx-xxxx" autocomplete="off" /></label>
    <p class="tiny muted">Use an <strong>app password</strong>, not your main password: Bluesky → Settings → Privacy and security → App passwords. <a class="link" href="https://bsky.app/settings/app-passwords" target="_blank" rel="noopener">Create one ↗</a>. It goes straight to Bluesky; StormWise never stores it. A sign-in token stays on this phone until you disconnect, and you can revoke the app password in Bluesky any time.</p>
    <details class="tiny muted"><summary>Advanced: self-hosted server</summary>
      <label class="field mt8"><span>Server</span><input value=${service} onInput=${(e) => setService(e.target.value)} autocapitalize="off" /></label></details>
    ${err ? html`<p class="small warn-text">${err}</p>` : ''}
    <button class="btn primary full mt8" disabled=${busy || !id.trim() || !pw.trim()}>${busy ? 'Connecting…' : 'Connect Bluesky'}</button>
  </form>`;
}

function BskyPost({ p }) {
  const showImg = (img) => openSheet({ type: 'custom', title: 'Photo from Bluesky', render: () => html`<div class="sheet-body"><img class="photo-full" src=${img.full} alt=${img.alt} /></div>` });
  return html`<article class="post card">
    <div class="post-hdr">${p.avatar ? html`<img class="avatar" src=${p.avatar} alt="" loading="lazy" />` : html`<span class="avatar">${(p.name[0] || '?').toUpperCase()}</span>`}
      <div class="grow"><strong>${p.name}</strong><div class="tiny muted">@${p.handle}</div></div>
      <div class="tiny muted post-time"><${Icon} n="clock" size=${12} /> ${ago(p.createdAt)}</div></div>
    <div class="row gap8 mt8"><span class="tag bsky">Bluesky</span><span class="tag warn">? Unverified</span></div>
    <p class="bsky-text">${p.text}</p>
    ${p.images.length ? html`<div class=${'bsky-imgs n' + Math.min(p.images.length, 4)}>${p.images.slice(0, 4).map((img) => html`<button class="post-photo" onClick=${() => showImg(img)}><img src=${img.thumb} alt=${img.alt || 'Image from Bluesky'} loading="lazy" /></button>`)}</div>` : ''}
    <div class="row gap8 post-actions"><a class="link small" href=${p.url} target="_blank" rel="noopener" onClick=${() => log('bsky_open', '')}>Open in Bluesky ↗</a></div>
  </article>`;
}

export function BlueskyPanel() {
  const s = useStore();
  const ph = phase(s);
  const [tab, setTab] = useState('following');
  const [posts, setPosts] = useState(null);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState('');
  const city = (ph.hereCity || 'Ann Arbor, MI').split(',')[0];
  const load = async (which = tab, query = q) => {
    setPosts(null); setErr(null);
    try {
      const list = which === 'following' ? await followingWeather() : await search(query.trim() ? [query.trim()] : defaultQueries(city));
      setPosts(list);
      log('bsky_load', which, { n: list.length, custom: !!query.trim() });
    } catch (e) { setErr(e.message || String(e)); setPosts([]); }
  };
  useEffect(() => { if (s.bsky && !s.offline) load(); }, [!!s.bsky, tab]);
  if (!s.bsky) return html`<${Connect} />`;
  return html`<div>
    <div class="row between small"><span>Connected as <strong>@${s.bsky.handle}</strong></span><button class="link-btn small" onClick=${disconnect}>Disconnect</button></div>
    <div class="mt8"><${Segmented} value=${tab} onChange=${(v) => { setTab(v); }}
      options=${[{ value: 'following', label: 'People I follow' }, { value: 'search', label: 'Search ' + city }]} /></div>
    ${tab === 'search' ? html`<form class="row gap8 mt8" onSubmit=${(e) => { e.preventDefault(); load('search', q); }}>
      <input class="grow bsky-q" value=${q} onInput=${(e) => setQ(e.target.value)} placeholder=${`e.g. ${city} tornado`} />
      <button class="btn ghost sm">Search</button></form>` : ''}
    <p class="tiny muted mt8">${tab === 'following' ? 'Posts from accounts you follow that mention storms, outages, flooding, trees down…' : `Recent public posts (last 3 days) mentioning ${city}. Bluesky posts have no location, so they're matched by place name.`} Not verified: check official alerts before acting.</p>
    ${s.offline ? html`<p class="small muted">No connection.</p>`
      : err ? html`<p class="small warn-text">${err}</p>`
      : posts === null ? html`<p class="small muted">Loading from Bluesky…</p>`
      : !posts.length ? html`<p class="small muted">${tab === 'following' ? 'No weather posts from people you follow right now.' : 'No recent posts found.'}</p>`
      : posts.slice(0, 40).map((p) => html`<${BskyPost} p=${p} />`)}
    ${posts && posts.length ? html`<button class="btn ghost full mt8" onClick=${() => load()}>Refresh</button>` : ''}
  </div>`;
}
