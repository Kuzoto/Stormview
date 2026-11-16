// Researcher panel (hidden): participant/condition, 60 s task timer, reset, phase, offline, log export.
// Open with ?admin=1, or long-press the app title on Home / More.
import { html, useEffect, useState } from '../../vendor/preact-htm.js';
import { SC, useStore, set, get, resetApp, toast } from '../store.js';
import { Header, Segmented, nav, navTab } from '../ui.js';
import { log, flush } from '../log.js';
import { health, loadSummary } from '../api.js';

export function Admin() {
  const s = useStore();
  const [logs, setLogs] = useState([]);
  const [dur, setDur] = useState(60);
  const refreshLogs = () => fetch('api/logs').then((r) => r.json()).then((j) => setLogs(j.participants || [])).catch(() => {});
  useEffect(() => { refreshLogs(); health(); }, []);

  const study = (patch) => set((st) => ({ study: { ...st.study, ...patch } }));
  const start = (startAt) => {
    if (!s.study.pid) { toast('Enter a participant ID first', 'bad'); return; }
    resetApp(true);
    const session = new Date().toISOString().slice(0, 19);
    set((st) => ({ study: { ...st.study, session }, timer: { startedAt: Date.now(), durationMs: dur * 1000 } }));
    log('task_start', startAt, { durationMs: dur * 1000, condition: get().study.condition });
    flush();
    navTab(startAt);
  };
  const stop = () => { log('task_stop', 'manual'); set({ timer: null }); flush(); };
  const prefetch = async () => {
    for (const p of SC.phases) await loadSummary(p.id, true);
    toast('Summaries generated & cached');
  };

  return html`<div class="pad admin">
    <${Header} title="Researcher panel" backTo="/home" />
    <section class="card">
      <h2>Participant</h2>
      <label class="field"><span>Participant ID</span><input value=${s.study.pid} onInput=${(e) => study({ pid: e.target.value.replace(/[^A-Za-z0-9_-]/g, '') })} placeholder="e.g. P01" /></label>
      <div class="small muted">Condition order</div>
      <${Segmented} value=${s.study.condition} onChange=${(v) => study({ condition: v })}
        options=${[{ value: 'app-first', label: 'App first' }, { value: 'google-first', label: 'Google first' }]} />
    </section>

    <section class="card mt12">
      <h2>Task timer</h2>
      <div class="row gap8"><label class="field grow"><span>Seconds</span><input type="number" value=${dur} onInput=${(e) => setDur(Math.max(5, +e.target.value || 60))} /></label>
        <label class="row gap8 small"><input type="checkbox" checked=${s.study.showTimer} onChange=${(e) => study({ showTimer: e.target.checked })} /> Show countdown to participant</label></div>
      <p class="tiny muted">Start resets the app (check-in, chat, posts, phase = Warning), opens it, and starts the timer. When time is up the participant answers the safety (and informed) Likert questions, which are logged.</p>
      <div class="row gap8">
        <button class="btn primary grow" onClick=${() => start('/home')}>Start on Home</button>
        <button class="btn ghost grow" onClick=${() => start('/lock')}>Start on lock screen</button>
      </div>
      ${s.timer ? html`<button class="btn danger full mt8" onClick=${stop}>Stop timer (no Likert)</button>` : ''}
      ${s.likertDone ? html`<p class="small mt8">Last answer: safety <strong>${s.likertDone.safety}</strong>, informed <strong>${s.likertDone.informed}</strong></p>` : ''}
    </section>

    <section class="card mt12">
      <h2>Scenario</h2>
      <div class="small muted">Phase (simulated time)</div>
      <${Segmented} value=${s.phase} onChange=${(v) => { set({ phase: v }); log('phase_set', v); }}
        options=${SC.phases.map((p) => ({ value: p.id, label: p.clock }))} />
      <div class="tiny muted mt8">${SC.phases.map((p) => p.clock + ' = ' + p.label).join(' · ')}</div>
      <label class="row gap8 mt12"><input type="checkbox" checked=${!!s.offline} onChange=${(e) => { set({ offline: e.target.checked }); log('offline_set', String(e.target.checked)); }} /> Simulate no connection (offline state)</label>
      <div class="row gap8 mt12">
        <button class="btn ghost grow" onClick=${() => { resetApp(true); toast('App reset'); }}>Reset app state</button>
        <button class="btn ghost grow" onClick=${() => nav('/lock')}>Lock screen</button>
      </div>
    </section>

    <section class="card mt12">
      <h2>WeatherBoy (OpenAI)</h2>
      <p class="small">${s.llm ? (s.llm.llm ? html`Connected · <strong>${s.llm.model}</strong> · spent $${(s.llm.spentUsd || 0).toFixed(4)} of $${(s.llm.budgetUsd || 0).toFixed(2)} cap` : 'Not connected: add OPENAI_API_KEY to prototype/.env and restart the server.') : 'Checking…'}</p>
      <div class="row gap8"><button class="btn ghost grow" onClick=${health}>Refresh</button><button class="btn ghost grow" onClick=${prefetch}>Pre-generate summaries</button></div>
      <p class="tiny muted">Summaries are cached on the server, so every participant sees the same Home summary for a phase.</p>
    </section>

    <section class="card mt12">
      <h2>Logs</h2>
      <button class="btn ghost sm" onClick=${() => { flush(); setTimeout(refreshLogs, 400); }}>Refresh list</button>
      <div class="log-list">${logs.length ? logs.map((p) => html`<div class="row between"><span>${p}</span><span><a class="link" href=${'api/logs/' + p + '.csv'}>CSV</a> · <a class="link" href=${'api/logs/' + p + '.jsonl'}>JSONL</a></span></div>`) : html`<p class="small muted">No logs yet.</p>`}</div>
    </section>
  </div>`;
}
