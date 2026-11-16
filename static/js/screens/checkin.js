// Screen 6 – Safety Check-In (D5): own status always labeled, unpressed buttons look unpressed,
// confirmation persists on the page, request/add people, circle updates arrive as notifications.
import { html, useState, useEffect } from '../../vendor/preact-htm.js';
import { useStore, set, get, phase, toast, notify, later, openSheet, isLive, myCircle, myPlaces, hereId } from '../store.js';
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

export function CheckIn() {
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
