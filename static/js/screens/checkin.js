// Screen 6 – Safety Check-In (D5): own status always labeled, unpressed buttons look unpressed,
// confirmation persists on the page, request/add people, circle updates arrive as notifications.
import { html, useState, useEffect } from '../../vendor/preact-htm.js';
import { useStore, set, get, phase, toast, notify, later, openSheet, isLive, myCircle, myPlaces, hereId, closeSheet } from '../store.js';
import { profileName, ensureProfile, setLocalName, refreshCircle, sendStatus, createInvite, inviteUrl, pingPerson, removePerson, sendText } from '../circle.js';
import { Icon, Header, Modal } from '../ui.js';
import { log } from '../log.js';

function AddPersonForm({ close }) {
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const add = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (isLive()) {
      const p = { id: 'p' + Date.now(), name: name.trim(), initials: name.trim()[0].toUpperCase(), where: contact.trim() || 'No phone saved', phone: contact.trim(), status: 'none', time: null, requested: null };
      set((s) => ({ liveCircle: [...s.liveCircle, p] }));
      log('circle_add', name.trim(), { live: true });
      toast('Added ' + name.trim());
      close();
      return;
    }
    const p = { id: 'p' + Date.now(), name: name.trim(), initials: name.trim()[0].toUpperCase(), where: 'Invite sent', status: 'invited', time: null, requested: null };
    set((s) => ({ circle: [...s.circle, p] }));
    log('circle_add', name.trim());
    toast('Invite sent to ' + name.trim());
    close();
  };
  return html`<form class="sheet-body" onSubmit=${add}>
    ${isLive() ? html`<p class="small">Saved on this phone only. When you check in, the app opens a text message to everyone here. <strong>They don't need the app.</strong></p>`
      : html`<p class="small">We'll text or email them a link. <strong>They don't need the app</strong>: they can see your status in a web page and reply with one tap.</p>`}
    <label class="field"><span>Name</span><input value=${name} onInput=${(e) => setName(e.target.value)} placeholder="e.g. Jamie" /></label>
    <label class="field"><span>Phone or email</span><input value=${contact} onInput=${(e) => setContact(e.target.value)} placeholder="(734) 555-0123" inputmode="email" /></label>
    <button class="btn primary full" disabled=${!name.trim()}>Send invite</button>
  </form>`;
}

function ScenarioCheckIn() {
  const s = useStore();
  const ph = phase(s);
  const [confirm, setConfirm] = useState(null); // 'safe' | 'help'
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  useEffect(() => { if (q.get('quick') === 'safe' && s.checkin.status === 'none') setConfirm('safe'); }, []);

  const live = isLive(s);
  const circle = myCircle(s);
  const recipients = circle.filter((c) => c.status !== 'invited');
  const here = myPlaces(s)[hereId(s)];
  const phones = recipients.map((c) => c.phone).filter(Boolean);
  // Live mode: really send it, through the phone's share sheet or a prefilled text message.
  const sendLive = async (status) => {
    const loc = s.checkin.shareLocation && here && here.lat != null && !here.approx ? ` My location: https://maps.google.com/?q=${here.lat},${here.lng}` : '';
    const text = (status === 'safe' ? "I'm safe." : 'I need help.') + ` (${ph.clock}${ph.level !== 'clear' ? ', ' + ph.banner.title : ''})` + loc;
    let how = 'sms';
    try {
      if (!phones.length && navigator.share) { await navigator.share({ text }); how = 'share'; }
      else location.href = `sms:${phones.join(',')}${/iPhone|iPad|Mac/.test(navigator.userAgent) ? '&' : '?'}body=${encodeURIComponent(text)}`;
    } catch (e) { if (e && e.name === 'AbortError') { log('checkin_cancel', status); return; } }
    set((st) => ({ checkin: { ...st.checkin, status, time: ph.clock, sentTo: recipients.map((c) => c.name) } }));
    log('checkin_send', status, { to: recipients.length, how, shareLocation: s.checkin.shareLocation, live: true });
    setConfirm(null);
    toast(how === 'share' ? 'Shared your status' : 'Opened a text message with your status');
  };
  const send = (status) => {
    if (live) return sendLive(status);
    const time = ph.clock;
    set((st) => ({ checkin: { ...st.checkin, status, time, sentTo: recipients.map((c) => c.name) } }));
    log('checkin_send', status, { to: recipients.length, shareLocation: s.checkin.shareLocation });
    setConfirm(null);
    toast(`Sent "${status === 'safe' ? "I'm safe" : 'I need help'}" to ${recipients.length} people`);
    // Scripted replies from the circle (e.g. Mom), shown as a lock-screen-style notification.
    get().circle.forEach((c) => {
      if (c.autoReply && c.status === 'none') {
        later(() => {
          set((st) => ({ circle: st.circle.map((x) => (x.id === c.id ? { ...x, status: c.autoReply.status, time: phase().clock, note: c.autoReply.note } : x)) }));
          notify({ title: `${c.name} checked in: ✓ Safe`, text: c.autoReply.note, go: '/checkin' });
          log('circle_update', c.id, c.autoReply);
        }, c.autoReply.afterMs);
      }
    });
  };
  const request = (c) => {
    if (live) {
      if (c.phone) location.href = `sms:${c.phone}${/iPhone|iPad|Mac/.test(navigator.userAgent) ? '&' : '?'}body=${encodeURIComponent('Are you OK? Reply when you can.')}`;
      set((st) => ({ liveCircle: st.liveCircle.map((x) => (x.id === c.id ? { ...x, requested: ph.clock } : x)) }));
      log('checkin_request', c.id, { live: true });
      if (!c.phone) toast('No phone saved for ' + c.name, 'bad');
      return;
    }
    set((st) => ({ circle: st.circle.map((x) => (x.id === c.id ? { ...x, requested: ph.clock } : x)) }));
    log('checkin_request', c.id);
    toast('Check-in request sent to ' + c.name);
  };

  const st = s.checkin.status;
  const statusCard = st === 'none'
    ? html`<div class="my-status none"><div class="ms-lbl">Your status</div><div class="ms-val"><${Icon} n="clock" size=${20} /> Not sent yet</div>
        <div class="small">${live ? 'Let your people know how you are.' : 'Your circle hasn\'t heard from you since the warning started.'}</div></div>`
    : html`<div class=${'my-status ' + st}><div class="ms-lbl">Your status</div>
        <div class="ms-val"><${Icon} n=${st === 'safe' ? 'checkc' : 'alert'} size=${22} /> ${st === 'safe' ? "I'm safe" : 'I need help'}</div>
        <div class="small"><strong>${s.checkin.sentTo.length ? `Sent to ${s.checkin.sentTo.length} people at ${s.checkin.time}` : 'Sent at ' + s.checkin.time}</strong>${s.checkin.sentTo.length ? ': ' + s.checkin.sentTo.join(', ') : ''}</div>
        ${s.checkin.shareLocation ? html`<div class="small">📍 Sharing your location for 1 hour</div>` : ''}</div>`;

  return html`<div class="pad">
    <${Header} title="Safety Check-In" />
    ${statusCard}
    <div class="small muted mt12">${st === 'none' ? 'Tap one to tell your circle:' : 'Change or resend your status:'}</div>
    <div class="ci-btns">
      <button class=${'ci-btn safe' + (st === 'safe' ? ' sent' : '')} onClick=${() => setConfirm('safe')}><${Icon} n="checkc" size=${26} /><span>I'm safe</span>${st === 'safe' ? html`<em>Sent ✓</em>` : ''}</button>
      <button class=${'ci-btn help' + (st === 'help' ? ' sent' : '')} onClick=${() => setConfirm('help')}><${Icon} n="alert" size=${26} /><span>I need help</span>${st === 'help' ? html`<em>Sent ✓</em>` : ''}</button>
    </div>
    <label class="toggle-row card">
      <div class="grow"><strong>Share my location for 1 hour</strong><div class="small muted">Only with people in your circle</div></div>
      <input type="checkbox" class="switch" checked=${s.checkin.shareLocation}
        onChange=${(e) => { set((x) => ({ checkin: { ...x.checkin, shareLocation: e.target.checked } })); log('share_location', String(e.target.checked)); }} />
    </label>

    <div class="sec-hdr mt16"><h2>My circle</h2><button class="btn ghost sm" onClick=${() => openSheet({ type: 'custom', title: 'Add someone to your circle', render: (close) => html`<${AddPersonForm} close=${close} />` })}><${Icon} n="plus" size=${16} /> Add person</button></div>
    <div class="circle">
      ${live && !circle.length ? html`<p class="small muted">No one yet. Add the people you'd text in an emergency. They're saved on this phone only.</p>` : ''}
      ${circle.map((c) => html`<div class="person">
        <span class=${'avatar ' + c.status}>${c.initials}</span>
        <div class="grow"><div><strong>${c.name}</strong></div>
          <div class="small muted">${c.where}${c.note ? ' · “' + c.note + '”' : ''}</div></div>
        ${c.status === 'safe' ? html`<div class="p-status safe">✓ Safe<div class="tiny">${c.time}</div></div>`
          : c.status === 'help' ? html`<div class="p-status help">Needs help<div class="tiny">${c.time}</div></div>`
          : c.status === 'invited' ? html`<div class="p-status none">Invited</div>`
          : c.requested ? html`<div class="p-status none">No update<div class="tiny">Asked ${c.requested}</div></div>`
          : html`<button class="btn ghost sm" onClick=${() => request(c)}>${live ? 'Text: are you OK?' : 'Request check-in'}</button>`}
        ${live ? html`<button class="hdr-btn sm" aria-label=${'Remove ' + c.name} onClick=${() => set((st) => ({ liveCircle: st.liveCircle.filter((x) => x.id !== c.id) }))}><${Icon} n="trash" size=${16} /></button>` : ''}
      </div>`)}
    </div>
    <p class="tiny muted mt8">${live ? 'Replies come back as normal text messages.' : 'When someone in your circle updates, you\'ll get a notification, even on your lock screen.'}</p>

    ${confirm ? html`<${Modal} title=${confirm === 'safe' ? 'Send "I\'m safe"?' : 'Send "I need help"?'} onClose=${() => setConfirm(null)}>
      <p class="small">${live ? (phones.length ? html`Opens a text message to <strong>${recipients.filter((c) => c.phone).map((c) => c.name).join(', ')}</strong>. You tap send.` : 'Opens your phone\'s share sheet so you can pick who to send it to.')
        : html`This goes to <strong>${recipients.map((c) => c.name).join(', ')}</strong> by text and notification.`}</p>
      ${confirm === 'help' ? html`<div class="callout bad small">If you're in immediate danger, call 911. <a class="link" href="tel:911">Call 911</a></div>` : ''}
      <label class="row gap8 small mt8"><input type="checkbox" checked=${s.checkin.shareLocation} onChange=${(e) => set((x) => ({ checkin: { ...x.checkin, shareLocation: e.target.checked } }))} /> Also share my location for 1 hour</label>
      <div class="row gap8 mt12"><button class="btn ghost grow" onClick=${() => setConfirm(null)}>Cancel</button>
        <button class=${'btn grow ' + (confirm === 'safe' ? 'safe' : 'danger')} onClick=${() => send(confirm)}>Send</button></div>
    </${Modal}>` : ''}
  </div>`;
}


// ====================================================================== live mode: synced circle (circle.js)
/** Display name used for check-ins and Neighbor Reports. Saved on this phone; synced when committed. */
export function NameField({ label = 'Your name', hint, onCommitted }) {
  const s = useStore();
  const [busy, setBusy] = useState(false);
  const commit = async () => {
    const nm = profileName(get()).trim();
    if (!nm || (s.profile && s.profile.token && s.profile.syncedName === nm)) return;
    setBusy(true);
    try { await ensureProfile(nm); set((st) => ({ profile: { ...st.profile, syncedName: nm } })); onCommitted && onCommitted(); }
    catch (e) { toast(String(e.message || e), 'bad'); }
    setBusy(false);
  };
  return html`<label class="field"><span>${label}${busy ? ' · saving…' : ''}</span>
    <input value=${profileName(s)} maxlength="30" placeholder="e.g. Jamie" autocomplete="nickname"
      onInput=${(e) => setLocalName(e.target.value)} onBlur=${commit} onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }} />
    ${hint ? html`<span class="tiny muted">${hint}</span>` : ''}</label>`;
}

function inviteText(me, contact, url) {
  return `Hi ${contact}, it's ${me}. If there's a storm or emergency, tap this to tell me you're OK (or connect with me in the StormWise app): ${url}`;
}

function LiveAddPerson({ close }) {
  const s = useStore();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async (e) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const inv = await createInvite(name.trim());
      if (phone.trim()) set((st) => ({ invitePhones: { ...(st.invitePhones || {}), [inv.code]: phone.trim() } }));
      log('circle_invite', '', { phone: !!phone.trim() });
      close();
      const how = await sendText(inviteText(profileName(get()), name.trim(), inv.url), phone.trim());
      toast(how === 'copied' ? 'Invite link copied. Paste it in a text.' : how === 'cancel' ? 'Invite created. Send it any time from your circle.' : 'Invite ready to send');
    } catch (err) { toast(String(err.message || err), 'bad'); }
    setBusy(false);
  };
  return html`<form class="sheet-body" onSubmit=${add}>
    <p class="small">You'll text them a link. <strong>If they have StormWise</strong>, it connects you both, and you'll each see the other's check-ins in the app. <strong>If they don't</strong>, the link opens a one-tap "I'm safe / I need help" page and their answer shows up here.</p>
    <label class="field"><span>Their name</span><input value=${name} onInput=${(e) => setName(e.target.value)} placeholder="e.g. Mom" /></label>
    <label class="field"><span>Phone (optional, opens a text to them)</span><input value=${phone} onInput=${(e) => setPhone(e.target.value)} placeholder="(734) 555-0123" inputmode="tel" /></label>
    <button class="btn primary full" disabled=${!name.trim() || busy}>${busy ? 'Creating link…' : 'Create invite link'}</button>
  </form>`;
}

const fmtT = (t) => new Date(t * 1000).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });

function LiveCheckIn() {
  const s = useStore();
  const ph = phase(s);
  const [confirm, setConfirm] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const named = !!profileName(s).trim();
  const synced = !!(s.profile && s.profile.token);
  useEffect(() => { if (synced) refreshCircle(); }, [synced]);
  useEffect(() => { if (q.get('quick') === 'safe' && named) setConfirm('safe'); }, []);

  const data = s.circleLive || { people: [], pings: [], me: {} };
  const people = data.people || [];
  const mine = (data.me && data.me.status) || null;
  const here = myPlaces(s)[hereId(s)];
  const appCount = people.filter((p) => p.kind === 'app').length;
  const oldLocal = (s.liveCircle || []).filter((c) => !c.invited);

  const send = async () => {
    setBusy(true);
    try {
      const loc = s.checkin.shareLocation && here && here.lat != null && !here.approx ? [here.lat, here.lng] : null;
      await sendStatus(confirm, note.trim(), loc);
      set((st) => ({ checkin: { ...st.checkin, status: confirm, time: ph.clock, sentTo: people.map((p) => p.name) } }));
      log('checkin_send', confirm, { to: people.length, app: appCount, note: !!note.trim(), shareLocation: !!loc, live: true });
      toast(people.length ? `Shared with ${people.length} ${people.length === 1 ? 'person' : 'people'} in your circle` : 'Status saved. Add people to share it.');
      setConfirm(null); setNote('');
    } catch (e) { toast(String(e.message || e), 'bad'); }
    setBusy(false);
  };
  const textToo = async () => {
    const t = (mine && mine.state === 'help' ? 'I need help.' : "I'm safe.") + (mine && mine.note ? ' ' + mine.note : '') + ` (${ph.clock})`;
    await sendText(t, null);
    log('checkin_text', '');
  };
  const ask = async (p) => {
    try {
      if (p.kind === 'app') { await pingPerson(p.id); toast(`Asked ${p.name} to check in`); log('checkin_request', 'app'); }
      else { const how = await sendText(`Are you OK? Tap to let me know: ${inviteUrl(p.code)}`, (s.invitePhones || {})[p.code]); log('checkin_request', 'guest', { how }); if (how === 'copied') toast('Link copied. Paste it in a text.'); }
    } catch (e) { toast(String(e.message || e), 'bad'); }
  };
  const remove = async (p) => {
    if (!confirm_(`Remove ${p.name} from your circle?`)) return;
    try { await removePerson(p.id); log('circle_remove', p.kind); } catch (e) { toast(String(e.message || e), 'bad'); }
  };
  const confirm_ = (m) => window.confirm(m);

  if (!named || !synced) {
    return html`<div class="pad">
      <${Header} title="Safety Check-In" />
      <section class="card mt12">
        <h2>What name should people see?</h2>
        <p class="small muted">Your circle sees this name with your check-ins, and it's shown on your Neighbor Reports posts. No account needed.</p>
        <${NameField} label="Display name" />
        <button class="btn primary full mt8" disabled=${!named} onClick=${async () => { try { await ensureProfile(); toast('Saved'); } catch (e) { toast(String(e.message || e), 'bad'); } }}>Continue</button>
      </section>
    </div>`;
  }

  return html`<div class="pad">
    <${Header} title="Safety Check-In" />
    ${(data.pings || []).length ? html`<div class="callout warn-card small"><strong>${data.pings.map((p) => p.from).join(', ')}</strong> asked if you're OK. Check in below to let them know.</div>` : ''}
    ${mine ? html`<div class=${'my-status ' + mine.state}><div class="ms-lbl">Your status · seen by your circle</div>
        <div class="ms-val"><${Icon} n=${mine.state === 'safe' ? 'checkc' : 'alert'} size=${22} /> ${mine.state === 'safe' ? "I'm safe" : 'I need help'}</div>
        <div class="small"><strong>Shared ${fmtT(mine.time)}</strong>${mine.note ? ' · “' + mine.note + '”' : ''}${mine.loc ? ' · 📍 location shared for 1 hour' : ''}</div></div>`
      : html`<div class="my-status none"><div class="ms-lbl">Your status</div><div class="ms-val"><${Icon} n="clock" size=${20} /> Not shared yet</div>
        <div class="small">Let your people know how you are.</div></div>`}
    <div class="small muted mt12">${mine ? 'Update your status:' : 'Tap one to tell your circle:'}</div>
    <div class="ci-btns">
      <button class=${'ci-btn safe' + (mine && mine.state === 'safe' ? ' sent' : '')} onClick=${() => setConfirm('safe')}><${Icon} n="checkc" size=${26} /><span>I'm safe</span></button>
      <button class=${'ci-btn help' + (mine && mine.state === 'help' ? ' sent' : '')} onClick=${() => setConfirm('help')}><${Icon} n="alert" size=${26} /><span>I need help</span></button>
    </div>
    ${mine ? html`<button class="btn ghost full mt8" onClick=${textToo}>Also send it by text</button>` : ''}
    <label class="toggle-row card">
      <div class="grow"><strong>Share my location for 1 hour</strong><div class="small muted">Only with people in your circle, rounded to ~100 m</div></div>
      <input type="checkbox" class="switch" checked=${s.checkin.shareLocation}
        onChange=${(e) => { set((x) => ({ checkin: { ...x.checkin, shareLocation: e.target.checked } })); log('share_location', String(e.target.checked)); }} />
    </label>

    <div class="sec-hdr mt16"><h2>My circle</h2><button class="btn ghost sm" onClick=${() => openSheet({ type: 'custom', title: 'Add someone to your circle', render: (close) => html`<${LiveAddPerson} close=${close} />` })}><${Icon} n="plus" size=${16} /> Add person</button></div>
    <div class="circle">
      ${!people.length ? html`<p class="small muted">No one yet. Add the people you'd want to hear from in an emergency.</p>` : ''}
      ${people.map((p) => html`<div class="person">
        <span class=${'avatar ' + (p.status ? p.status.state : 'none')}>${(p.name[0] || '?').toUpperCase()}</span>
        <div class="grow"><div><strong>${p.name}</strong> ${p.kind === 'guest' ? html`<span class="tag">No app</span>` : ''}</div>
          <div class="small muted">${p.status ? `${p.status.state === 'safe' ? '✓ Safe' : '⚠ Needs help'} · ${fmtT(p.status.time)}${p.status.note ? ' · “' + p.status.note + '”' : ''}`
            : p.kind === 'guest' ? 'Invite link sent · no reply yet' : 'Connected · no check-in yet'}</div>
          ${p.status && p.status.loc ? html`<a class="link small" href=${`https://maps.google.com/?q=${p.status.loc[0]},${p.status.loc[1]}`} target="_blank" rel="noopener">📍 See shared location</a>` : ''}</div>
        <div class="person-actions">
          <button class="btn ghost sm" onClick=${() => ask(p)}>${p.kind === 'app' ? 'Ask if OK' : 'Text link'}</button>
          <button class="hdr-btn sm" aria-label=${'Remove ' + p.name} onClick=${() => remove(p)}><${Icon} n="trash" size=${16} /></button>
        </div>
      </div>`)}
      ${oldLocal.map((c) => html`<div class="person"><span class="avatar">${c.initials}</span>
        <div class="grow"><strong>${c.name}</strong><div class="small muted">Saved contact · not invited yet</div></div>
        <button class="btn ghost sm" onClick=${async () => { const inv = await createInvite(c.name); if (c.phone) set((st) => ({ invitePhones: { ...(st.invitePhones || {}), [inv.code]: c.phone } }));
          set((st) => ({ liveCircle: st.liveCircle.map((x) => (x.id === c.id ? { ...x, invited: true } : x)) })); sendText(inviteText(profileName(get()), c.name, inv.url), c.phone); }}>Send invite</button></div>`)}
    </div>
    <p class="tiny muted mt8">People with the app see each other's check-ins here within about 20 seconds, with a notification while the app is open. You appear as <strong>${profileName(s)}</strong>. <button class="link-btn tiny" onClick=${() => openSheet({ type: 'custom', title: 'Your name', render: () => html`<div class="sheet-body"><${NameField} label="Display name" hint="Also used on your Neighbor Reports posts." /></div>` })}>Change</button></p>

    ${confirm ? html`<${Modal} title=${confirm === 'safe' ? 'Share "I\'m safe"?' : 'Share "I need help"?'} onClose=${() => setConfirm(null)}>
      <p class="small">${people.length ? html`Your circle (${people.map((p) => p.name).join(', ')}) will see this in the app or on their reply page.` : 'No one is in your circle yet. Your status is saved and people you add will see it.'}</p>
      ${confirm === 'help' ? html`<div class="callout bad small">If you're in immediate danger, call 911. <a class="link" href="tel:911">Call 911</a></div>` : ''}
      <label class="field mt8"><span>Note (optional)</span><input value=${note} maxlength="140" onInput=${(e) => setNote(e.target.value)} placeholder=${confirm === 'safe' ? 'e.g. At work, staying inside' : 'e.g. Tree on the car, need a ride'} /></label>
      <label class="row gap8 small mt8"><input type="checkbox" checked=${s.checkin.shareLocation} onChange=${(e) => set((x) => ({ checkin: { ...x.checkin, shareLocation: e.target.checked } }))} /> Also share my location for 1 hour</label>
      <div class="row gap8 mt12"><button class="btn ghost grow" onClick=${() => setConfirm(null)}>Cancel</button>
        <button class=${'btn grow ' + (confirm === 'safe' ? 'safe' : 'danger')} disabled=${busy} onClick=${send}>${busy ? 'Sharing…' : 'Share'}</button></div>
    </${Modal}>` : ''}
  </div>`;
}

export function CheckIn() {
  const s = useStore();
  return isLive(s) ? html`<${LiveCheckIn} />` : html`<${ScenarioCheckIn} />`;
}
