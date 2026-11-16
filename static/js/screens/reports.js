// Screen 8 – "Neighbor Reports" (was "Local Posts", D7/D8): timestamps, author context,
// verification status, and a way to post.
import { html, useState } from '../../vendor/preact-htm.js';
import { SC, useStore, set, phase, phaseIndex, toast } from '../store.js';
import { Icon, Header, SourceChip } from '../ui.js';
import { log } from '../log.js';

const CATS = ['Road', 'Power', 'Flooding', 'Other'];
const TreeImg = () => html`<svg class="post-img" viewBox="0 0 320 140" role="img" aria-label="Photo: fallen tree across a road">
  <rect width="320" height="140" fill="#5b6b78"/><rect y="88" width="320" height="52" fill="#3c4650"/>
  <rect x="0" y="110" width="320" height="4" fill="#d9c35c" opacity=".7"/>
  <g transform="rotate(-8 160 95)"><rect x="40" y="86" width="230" height="16" rx="6" fill="#6d4c33"/>
  <circle cx="250" cy="80" r="26" fill="#2e5d34"/><circle cx="225" cy="72" r="20" fill="#3b7441"/><circle cx="270" cy="96" r="18" fill="#2e5d34"/></g>
  <text x="10" y="20" fill="#fff" font-size="12" font-family="system-ui">S Main St · 7:36 PM</text></svg>`;

export function Reports() {
  const s = useStore();
  const ph = phase(s);
  const pi = phaseIndex(s);
  const [text, setText] = useState('');
  const [cat, setCat] = useState('Road');
  const scripted = SC.posts.filter((p) => p.phase <= pi).reverse();
  const mine = [...s.posts].reverse();
  const submit = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    const p = { id: 'u' + Date.now(), author: 'You', context: 'At Work · posted from this phone', time: ph.clock, category: cat, text: text.trim(), verified: null, mine: true };
    set((st) => ({ posts: [...st.posts, p] }));
    log('post_create', cat, { text: text.trim() });
    setText('');
    toast('Posted to Neighbor Reports');
  };
  const Post = (p) => html`<article class="post card">
    <div class="post-hdr"><span class="avatar">${p.author[0]}</span>
      <div class="grow"><strong>${p.author}</strong><div class="tiny muted">${p.context}</div></div>
      <div class="tiny muted post-time"><${Icon} n="clock" size=${12} /> ${p.time}</div></div>
    <div class="row gap8 mt8"><span class="tag">${p.category}</span>
      ${p.verified && pi >= (p.verifiedPhase ?? 0) ? html`<span class="tag ok">✓ ${p.verified}</span>` : html`<span class="tag warn">? Unverified</span>`}</div>
    <p>${p.text}</p>
    ${p.image === 'tree' ? html`<${TreeImg} />` : ''}
  </article>`;
  return html`<div class="pad">
    <${Header} title="Neighbor Reports" backTo="/more" />
    <p class="small muted">Posts from people near your places. Community reports are <strong>not verified</strong> unless an official source confirms them.</p>
    <form class="card compose" onSubmit=${submit}>
      <strong>Report what you see</strong>
      <div class="cat-row">${CATS.map((c) => html`<button type="button" class=${'chip sm' + (c === cat ? ' on' : '')} onClick=${() => setCat(c)}>${c}</button>`)}</div>
      <textarea rows="2" value=${text} onInput=${(e) => setText(e.target.value)} placeholder="e.g. Tree down on Packard near Stadium"></textarea>
      <div class="row between"><span class="tiny muted">Shown with your approximate location and time</span><button class="btn primary sm" disabled=${!text.trim()}>Post</button></div>
    </form>
    ${mine.map(Post)}
    ${scripted.map(Post)}
  </div>`;
}
