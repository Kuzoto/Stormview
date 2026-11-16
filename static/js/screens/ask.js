// Screen 3 – Ask WeatherBoy / Help (D2). Suggested questions send a prompt id so the server adds a
// question-specific formatting instruction; the model writes every answer from the scenario data.
import { html, useState, useEffect, useRef } from '../../vendor/preact-htm.js';
import { useStore, set, get, phase, isLive } from '../store.js';
import { askWeatherBoy } from '../api.js';
import { Icon, Header, Md, SourceChip, SeverityBar } from '../ui.js';
import { log } from '../log.js';

const WEATHER = [
  ['meaning', 'What does this warning mean for me?'],
  ['severity', 'How severe is this, and how do we know?'],
  ['sources', 'Where does this information come from?'],
  ['power_water', 'Do I have power and water?'],
  ['shelter', 'Where should I shelter?'],
  ['drive', 'Is it safe to drive home?'],
  ['changed', 'What changed recently?'],
];
const APP = [
  ['help_checkin', 'How do I tell my family I\'m safe?'],
  ['help_map', 'How do I read the map?'],
  ['help_sources', 'How can I check where info comes from?'],
];
const LIVE_WEATHER = [
  ['meaning', 'What do the current alerts mean for me?'],
  ['severity', 'How severe is the weather right now?'],
  ['sources', 'Where does this information come from?'],
  ['power_water', 'Could my power or water be affected?'],
  ['shelter', 'Do I need to shelter?'],
  ['drive', 'Is it safe to drive right now?'],
  ['changed', 'What\'s coming in the next few hours?'],
];
const Q = Object.fromEntries([...WEATHER, ...APP]);
const LQ = Object.fromEntries([...LIVE_WEATHER, ...APP]);

export function Ask({ query = {} }) {
  const s = useStore();
  const ph = phase(s);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef();
  const autoSent = useRef(false);

  async function send(content, promptId) {
    if (!content.trim() || busy) return;
    const userMsg = { role: 'user', content: content.trim(), promptId: promptId || null, phase: ph.id };
    const history = [...get().chat, userMsg];
    set({ chat: history });
    setText('');
    setBusy(true);
    log('chat_send', promptId || 'free', { text: content.trim() });
    const t0 = Date.now();
    let reply;
    try {
      reply = await askWeatherBoy(history, promptId);
    } catch (e) {
      reply = { answer: 'I couldn\'t reach the server. The official alert is in the banner at the top. Tap it for details.', sourceIds: ph.banner.sourceIds, severity: null, followUps: [], fallback: true };
    }
    log('chat_reply', promptId || 'free', { ms: Date.now() - t0, fallback: !!reply.fallback, sourceIds: reply.sourceIds });
    set((st) => ({ chat: [...st.chat, { role: 'assistant', content: reply.answer, sourceIds: reply.sourceIds || [], severity: reply.severity, followUps: reply.followUps || [], fallback: !!reply.fallback }] }));
    setBusy(false);
  }

  useEffect(() => {
    const qs = isLive(get()) ? LQ : Q;
    if (query.p && qs[query.p] && !autoSent.current) {
      autoSent.current = true;
      history.replaceState(null, '', location.pathname + location.search + '#/ask'); // reload won't re-send
      send(qs[query.p], query.p);
    }
  }, [query.p]);
  useEffect(() => { if (s.chat.length && endRef.current) endRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [s.chat.length, busy]);

  const offline = !!s.offline;
  const chip = ([id, q]) => html`<button class="chip" disabled=${busy || offline} onClick=${() => send(q, id)} data-log=${'suggested ' + id}>${q}</button>`;
  const right = s.chat.length ? html`<button class="hdr-btn txt" onClick=${() => set({ chat: [] })}>Clear</button>` : null;

  return html`<div class="ask">
    <${Header} title="Ask WeatherBoy" right=${right} />
    <div class="chat-scroll">
      <div class="msg bot intro">
        <span class="wb-avatar">W</span>
        <div class="bubble"><p><strong>Hi, I'm WeatherBoy.</strong> I explain the official alert in plain language and help you use the app. I don't make my own forecasts, and I'll show you where every answer comes from.</p></div>
      </div>
      ${s.chat.length === 0 ? html`<div class="chip-group"><div class="chip-hdr">${isLive(s) ? 'About the weather now' : 'About this storm'}</div>${(isLive(s) ? LIVE_WEATHER : WEATHER).map(chip)}</div>
        <div class="chip-group"><div class="chip-hdr">Help using the app</div>${APP.map(chip)}</div>` : ''}
      ${s.chat.map((m, i) => m.role === 'user'
        ? html`<div class="msg me"><div class="bubble">${m.content}</div></div>`
        : html`<div class="msg bot"><span class="wb-avatar">W</span><div class="bubble">
            <${SeverityBar} value=${m.severity} />
            <${Md} text=${m.content} />
            ${m.sourceIds && m.sourceIds.length ? html`<div class="msg-src"><span class="tiny muted">Sources:</span>${m.sourceIds.map((id) => html`<${SourceChip} ids=${[id]} claim=${'WeatherBoy: ' + m.content.slice(0, 80) + '…'} />`)}</div>` : ''}
            ${i === s.chat.length - 1 && m.followUps && m.followUps.length ? html`<div class="followups">${m.followUps.map((f) => html`<button class="chip sm" disabled=${busy || offline} onClick=${() => send(f)}>${f}</button>`)}</div>` : ''}
          </div></div>`)}
      ${busy ? html`<div class="msg bot"><span class="wb-avatar">W</span><div class="bubble typing"><span></span><span></span><span></span><em>${isLive(s) ? 'Reading the live alerts…' : 'Reading the official alert…'}</em></div></div>` : ''}
      ${s.chat.length > 0 && !busy ? html`<details class="more-q"><summary>More suggested questions</summary>${[...(isLive(s) ? LIVE_WEATHER : WEATHER), ...APP].map(chip)}</details>` : ''}
      <div ref=${endRef}></div>
    </div>
    <form class="composer" onSubmit=${(e) => { e.preventDefault(); send(text); }}>
      <input value=${text} onInput=${(e) => setText(e.target.value)} disabled=${offline}
        placeholder=${offline ? 'WeatherBoy needs a connection' : isLive(s) ? 'Ask about the weather or the app…' : 'Ask about this storm or the app…'} aria-label="Message WeatherBoy" enterkeyhint="send" />
      <button class="send" type="submit" disabled=${!text.trim() || busy || offline} aria-label="Send"><${Icon} n="send" size=${20} /></button>
    </form>
  </div>`;
}
