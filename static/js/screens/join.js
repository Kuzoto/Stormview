// Accept a safety-circle invite: /#/join/<code> (opened from a text, or from the reply page's "open in app").
import { html, useEffect, useState } from '../../vendor/preact-htm.js';
import { useStore, set, toast, isLive } from '../store.js';
import { Header, navTab } from '../ui.js';
import { log } from '../log.js';
import { getInvite, acceptInvite, profileName } from '../circle.js';
import { NameField } from './checkin.js';
import { startLive } from '../live.js';

export function Join({ code }) {
  const s = useStore();
  const [info, setInfo] = useState(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!isLive(s)) { set({ mode: 'live' }); startLive(); } // invites are a live-mode feature
    getInvite(code).then(setInfo).catch(() => setInfo(null));
  }, [code]);
  const accept = async () => {
    setBusy(true);
    try {
      const j = await acceptInvite(code);
      log('circle_join', '');
      toast(`You and ${j.name} are connected`);
      navTab('/checkin');
    } catch (e) { toast(String(e.message || e), 'bad'); }
    setBusy(false);
  };
  return html`<div class="pad">
    <${Header} title="Join a safety circle" backTo="/home" />
    ${info === undefined ? html`<p class="small muted">Loading…</p>`
      : !info ? html`<section class="card"><h2>This invite has expired</h2><p class="small">Ask the person who sent it for a new link.</p></section>`
      : html`<section class="card">
        <h2>${info.from} invited you to their safety circle</h2>
        <p class="small">You'll each see the other's "I'm safe / I need help" check-ins in the app, and can ask each other to check in. You can remove each other any time.</p>
        <${NameField} label="Your name (what ${info.from} will see)" />
        <button class="btn primary full mt8" disabled=${busy || !profileName(s).trim()} onClick=${accept}>${busy ? 'Connecting…' : 'Connect with ' + info.from}</button>
        <p class="tiny muted mt8">Not you, or don't want the app? You can also just reply on the web page in the text you got.</p>
      </section>`}
  </div>`;
}
