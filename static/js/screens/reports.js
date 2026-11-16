// Screen 8 – "Neighbor Reports" (was "Local Posts", D7/D8): timestamps, author context,
// verification status, posting with an optional photo.
//  - Live mode: posts are shared through the server with everyone near you (posts.py), within ~15 miles.
//  - Practice scenario: scripted posts + your own posts, kept on this phone (the study stays identical).
import { html, useState, useEffect } from '../../vendor/preact-htm.js';
import { SC, useStore, set, get, phase, phaseIndex, toast, isLive, myPlaces, hereId, openSheet } from '../store.js';
import { Icon, Header } from '../ui.js';
import { log } from '../log.js';
import { NameField } from './checkin.js';
import { BlueskyPanel } from './bluesky.js';
import { Segmented } from '../ui.js';
import { profileName, ensureProfile } from '../circle.js';

const CATS = ['Road', 'Power', 'Flooding', 'Damage', 'Other'];
const TreeImg = () => html`<svg class="post-img" viewBox="0 0 320 140" role="img" aria-label="Photo: fallen tree across a road">
  <rect width="320" height="140" fill="#5b6b78"/><rect y="88" width="320" height="52" fill="#3c4650"/>
  <rect x="0" y="110" width="320" height="4" fill="#d9c35c" opacity=".7"/>
  <g transform="rotate(-8 160 95)"><rect x="40" y="86" width="230" height="16" rx="6" fill="#6d4c33"/>
  <circle cx="250" cy="80" r="26" fill="#2e5d34"/><circle cx="225" cy="72" r="20" fill="#3b7441"/><circle cx="270" cy="96" r="18" fill="#2e5d34"/></g>
  <text x="10" y="20" fill="#fff" font-size="12" font-family="system-ui">S Main St · 7:36 PM</text></svg>`;

/** Shrink and re-encode a photo on the phone: smaller upload, and it drops EXIF data (incl. GPS). */
async function resizePhoto(file, maxSide, quality) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Not an image')); i.src = url; });
    const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality);
  } finally { URL.revokeObjectURL(url); }
}

const deviceId = () => {
  let id = get().deviceId;
  if (!id) { id = Math.random().toString(36).slice(2) + Date.now().toString(36); set({ deviceId: id }); }
  return id;
};

const ago = (t) => {
  const m = Math.round((Date.now() / 1000 - t) / 60);
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60);
  return h < 24 ? h + ' h ago' : Math.round(h / 24) + ' d ago';
};

const showPhoto = (src, alt) => openSheet({ type: 'custom', title: 'Photo', render: () => html`<div class="sheet-body"><img class="photo-full" src=${src} alt=${alt} /></div>` });

function Compose({ live, onPosted }) {
  const s = useStore();
  const ph = phase(s);
  const here = myPlaces(s)[hereId(s)];
  const [text, setText] = useState('');
  const [cat, setCat] = useState('Road');
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const noLocation = live && (!here || here.approx);

  const pick = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      // Shared posts get a sharper photo; scenario posts live in this phone's storage, so keep them small.
      setPhoto(await resizePhoto(f, live ? 1280 : 800, live ? 0.8 : 0.7));
      log('post_photo_pick', '', { type: f.type, kb: Math.round(f.size / 1024) });
    } catch (err) { toast("Couldn't read that photo", 'bad'); }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    if (!live) {
      const p = { id: 'u' + Date.now(), author: 'You', context: 'At Work · posted from this phone', time: ph.clock, category: cat, text: text.trim(), verified: null, mine: true, photo };
      set((st) => ({ posts: [...st.posts, p] }));
      log('post_create', cat, { text: text.trim(), photo: !!photo });
      setText(''); setPhoto(null);
      toast('Posted to Neighbor Reports');
      return;
    }
    setBusy(true);
    try {
      const r = await fetch('api/posts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim(), category: cat, photo, author: profileName(s).trim() || 'Neighbor', lat: here.lat, lng: here.lng, area: (ph.hereCity || '') }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
      if (profileName(get()).trim()) ensureProfile().catch(() => {});
      set((st) => ({ myPosts: { ...(st.myPosts || {}), [j.id]: j.token } }));
      log('post_create', cat, { text: text.trim(), photo: !!photo, shared: true });
      setText(''); setPhoto(null);
      toast('Posted. People near you can see it.');
      onPosted && onPosted();
    } catch (err) {
      toast(String(err.message || err), 'bad');
    }
    setBusy(false);
  };

  return html`<form class="card compose" onSubmit=${submit}>
    <strong>Report what you see</strong>
    ${live ? html`<div class="mt8"><${NameField} label="Your name (shown with your posts and check-ins)" /></div>` : ''}
    <div class="cat-row">${CATS.map((c) => html`<button type="button" class=${'chip sm' + (c === cat ? ' on' : '')} onClick=${() => setCat(c)}>${c}</button>`)}</div>
    <textarea rows="2" value=${text} onInput=${(e) => setText(e.target.value)} placeholder="e.g. Tree down on Packard near Stadium" maxlength="500"></textarea>
    ${photo ? html`<div class="photo-prev"><img src=${photo} alt="Photo to attach" /><button type="button" class="photo-x" aria-label="Remove photo" onClick=${() => setPhoto(null)}><${Icon} n="x" size=${16} /></button></div>` : ''}
    ${noLocation ? html`<p class="small warn-text">Turn on location (or set My location in My Places) to post. Posts are shown to people near where you are.</p>` : ''}
    <div class="row between gap8">
      <label class="btn ghost sm photo-btn"><${Icon} n="camera" size=${16} /> ${photo ? 'Change photo' : 'Add photo'}
        <input type="file" accept="image/*" onChange=${pick} hidden /></label>
      <button class="btn primary sm" disabled=${!text.trim() || busy || noLocation}>${busy ? 'Posting…' : 'Post'}</button>
    </div>
    <span class="tiny muted">${live ? 'Shared with people within about 15 miles, with your approximate distance and time. Photo location data is removed.' : 'Shown with your approximate location and time'}</span>
  </form>`;
}

function LiveReports() {
  const s = useStore();
  const here = myPlaces(s)[hereId(s)];
  const [posts, setPosts] = useState(null);
  const [err, setErr] = useState(null);
  const load = async () => {
    if (!here || here.lat == null || get().offline) return;
    try {
      const r = await fetch(`api/posts?lat=${here.lat}&lng=${here.lng}`);
      const j = await r.json();
      setPosts(j.posts || []); setErr(null);
    } catch (e) { setErr('Couldn\'t load posts'); }
  };
  useEffect(() => { load(); const i = setInterval(load, 30000); return () => clearInterval(i); }, [here && here.lat, here && here.lng, s.offline]);

  const mine = s.myPosts || {};
  const hidden = new Set(s.hiddenPosts || []);
  const remove = async (p) => {
    if (!confirm('Delete your post?')) return;
    const r = await fetch('api/posts/' + p.id, { method: 'DELETE', headers: { 'X-Post-Token': mine[p.id] } });
    if (r.ok) { log('post_delete', p.id); toast('Post deleted'); set((st) => { const m = { ...st.myPosts }; delete m[p.id]; return { myPosts: m }; }); load(); }
    else toast("Couldn't delete the post", 'bad');
  };
  const report = (p) => {
    fetch('api/posts/' + p.id + '/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device: deviceId() }) }).catch(() => {});
    set((st) => ({ hiddenPosts: [...(st.hiddenPosts || []), p.id] }));
    log('post_report', p.id);
    toast('Reported and hidden. Thanks.');
  };
  const list = (posts || []).filter((p) => !hidden.has(p.id));
  const [tab, setTab] = useState('near');

  // Share your own post to other apps (Messages, Bluesky, Facebook…) with its photo and a link to a public page.
  const share = async (p) => {
    const url = location.origin + '/p/' + p.id;
    const text = `${p.category} report${p.area ? ' near ' + p.area : ''}: ${p.text}`;
    let how = 'copied';
    try {
      if (navigator.share) {
        let data = { title: 'StormWise neighbor report', text, url };
        if (p.photo && navigator.canShare) {
          try {
            const blob = await (await fetch(p.photo)).blob();
            const file = new File([blob], 'storm-report.' + (blob.type.split('/')[1] || 'jpg'), { type: blob.type });
            if (navigator.canShare({ files: [file] })) data = { ...data, files: [file] };
          } catch (e) { /* share without the photo */ }
        }
        await navigator.share(data);
        how = data.files ? 'share_photo' : 'share';
      } else {
        await navigator.clipboard.writeText(text + ' ' + url);
        toast('Copied: paste it into any app');
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      try { await navigator.clipboard.writeText(text + ' ' + url); toast('Copied: paste it into any app'); } catch (e2) { toast("Couldn't share", 'bad'); return; }
    }
    log('post_share', p.id, { how });
  };

  return html`<div class="pad">
    <${Header} title="Neighbor Reports" backTo="/more" />
    <${Segmented} value=${tab} onChange=${(v) => { setTab(v); log('reports_tab', v); }}
      options=${[{ value: 'near', label: 'Near you' }, { value: 'bsky', label: 'Bluesky' }]} />
    ${tab === 'bsky' ? html`<div class="mt12"><${BlueskyPanel} /></div>` : html`<div>
    <p class="small muted mt8">Posts from people within about 15 miles of you, from the last 7 days. <strong>Not verified</strong>: check official alerts before acting on them.</p>
    <${Compose} live=${true} onPosted=${load} />
    <div class="sec-hdr mt16"><h2>Near you</h2><button class="link-btn small" onClick=${load}>Refresh</button></div>
    ${s.offline ? html`<p class="small muted">No connection. Posts will load when you're back online.</p>`
      : err ? html`<p class="small muted">${err}</p>`
      : posts === null ? html`<p class="small muted">Loading…</p>`
      : !list.length ? html`<p class="small muted">No reports near you yet. Be the first to post what you see.</p>` : ''}
    ${list.map((p) => html`<article class="post card">
      <div class="post-hdr"><span class="avatar">${(p.author[0] || 'N').toUpperCase()}</span>
        <div class="grow"><strong>${p.author}</strong>${mine[p.id] ? html` <span class="tag">You</span>` : ''}
          <div class="tiny muted">${p.distanceMi < 0.2 ? 'Very close to you' : p.distanceMi + ' mi away'}${p.area ? ' · ' + p.area : ''}</div></div>
        <div class="tiny muted post-time"><${Icon} n="clock" size=${12} /> ${ago(p.createdAt)}</div></div>
      <div class="row gap8 mt8"><span class="tag">${p.category}</span><span class="tag warn">? Unverified</span></div>
      <p>${p.text}</p>
      ${p.photo ? html`<button class="post-photo" onClick=${() => { log('post_photo_open', p.id); showPhoto(p.photo, 'Photo from ' + p.author); }}><img src=${p.photo} alt=${'Photo from ' + p.author + ': ' + p.text} loading="lazy" /></button>` : ''}
      <div class="row gap8 post-actions">
        ${mine[p.id] ? html`<button class="btn ghost sm" onClick=${() => share(p)}><${Icon} n="send" size=${14} /> Share</button><button class="link-btn small" onClick=${() => remove(p)}>Delete</button>`
          : html`<button class="link-btn small muted-link" onClick=${() => report(p)}>Report</button>`}
      </div>
    </article>`)}
    </div>`}
  </div>`;
}

export function Reports() {
  const s = useStore();
  if (isLive(s)) return html`<${LiveReports} />`;
  const pi = phaseIndex(s);
  const scripted = SC.posts.filter((p) => p.phase <= pi).reverse();
  const mine = [...s.posts].reverse();
  const Post = (p) => html`<article class="post card">
    <div class="post-hdr"><span class="avatar">${p.author[0]}</span>
      <div class="grow"><strong>${p.author}</strong><div class="tiny muted">${p.context}</div></div>
      <div class="tiny muted post-time"><${Icon} n="clock" size=${12} /> ${p.time}</div></div>
    <div class="row gap8 mt8"><span class="tag">${p.category}</span>
      ${p.verified && pi >= (p.verifiedPhase ?? 0) ? html`<span class="tag ok">✓ ${p.verified}</span>` : html`<span class="tag warn">? Unverified</span>`}</div>
    <p>${p.text}</p>
    ${p.image === 'tree' ? html`<${TreeImg} />` : ''}
    ${p.photo ? html`<button class="post-photo" onClick=${() => showPhoto(p.photo, 'Your photo')}><img src=${p.photo} alt=${'Your photo: ' + p.text} /></button>` : ''}
  </article>`;
  return html`<div class="pad">
    <${Header} title="Neighbor Reports" backTo="/more" />
    <p class="small muted">Posts from people near your places. Community reports are <strong>not verified</strong> unless an official source confirms them.</p>
    <${Compose} live=${false} />
    ${mine.map(Post)}
    ${scripted.map(Post)}
  </div>`;
}
