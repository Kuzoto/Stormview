// Screen 1 – lock-screen alert (kept: red urgency). Adds a direct "I'm safe" check-in action (D5).
import { html } from '../../vendor/preact-htm.js';
import { SC, useStore, phase, isLive, myPlaces, hereId } from '../store.js';
import { nav, APP_NAME } from '../ui.js';

export function LockScreen() {
  const s = useStore();
  const ph = phase(s);
  const clear = ph.level === 'clear';
  const live = isLive(s);
  const place = myPlaces(s)[hereId(s)] || { name: '', addr: '' };
  const partner = !live && s.circle.find((c) => c.id === 'partner');
  return html`<div class="lock" onClick=${() => nav('/home')}>
    <div class="lock-time">${ph.clock.replace(/ [AP]M$/, '')}</div>
    <div class="lock-date">${live ? ph.date : SC.meta.date}</div>
    ${live ? html`<div class=${'lock-card ' + (clear ? 'clear' : 'warn')} onClick=${(e) => { e.stopPropagation(); nav('/home'); }} data-log="lock alert">
      <div class="lc-top"><img src="icons/icon-192.png" alt="" /><span>${APP_NAME}</span><span class="muted">${ph.clock}</span></div>
      <div class="lc-title">${ph.loading ? 'Checking live alerts…' : clear ? '✓ No active weather alerts' : '⚠ ' + ph.banner.title.toUpperCase()}</div>
      <div class="lc-line"><strong>You:</strong> ${place.addr || place.name}${ph.banner.until ? ' · ' + ph.banner.until : ''}</div>
      ${!clear ? html`<div class="lc-line">${ph.banner.area}</div><div class="lc-action">${ph.action}</div>` : html`<div class="lc-line">${ph.action}</div>`}
      <div class="lc-btns">
        <button class="lc-btn" onClick=${(e) => { e.stopPropagation(); nav('/home'); }}>Open</button>
        ${!clear ? html`<button class="lc-btn" onClick=${(e) => { e.stopPropagation(); nav('/checkin?quick=safe'); }}>I'm safe: check in</button>` : ''}
      </div>
    </div>` : ''}
    ${live ? html`<div class="lock-hint">Tap a notification to open</div>` : ''}

    ${live ? '' : html`<div class=${'lock-card ' + (clear ? 'clear' : 'warn')} onClick=${(e) => { e.stopPropagation(); nav('/home'); }} data-log="lock alert">
      <div class="lc-top"><img src="icons/icon-192.png" alt="" /><span>${APP_NAME}</span><span class="muted">now</span></div>
      <div class="lc-title">${clear ? '✓ Danger has passed' : '⚠ TORNADO WARNING · High'}</div>
      <div class="lc-line"><strong>You:</strong> ${place.name} · ${place.addr.split('·')[0].trim()} ${ph.banner.until ? '· ' + ph.banner.until : ''}</div>
      ${clear
        ? html`<div class="lc-line">${ph.action}</div>`
        : html`<div class="lc-line"><strong>Hazards:</strong> tornado, 70 mph winds, heavy rain</div>
               <div class="lc-line"><strong>Affects you:</strong> commute home (road closed), power out at Home</div>
               <div class="lc-action">Don't drive. Shelter inside now.</div>`}
      <div class="lc-btns">
        <button class="lc-btn" onClick=${(e) => { e.stopPropagation(); nav('/home'); }}>Open</button>
        <button class="lc-btn" onClick=${(e) => { e.stopPropagation(); nav('/checkin?quick=safe'); }}>I'm safe: check in</button>
      </div>
    </div>`}

    ${partner && partner.status === 'safe' ? html`<div class="lock-card small-card" onClick=${(e) => { e.stopPropagation(); nav('/checkin'); }}>
      <div class="lc-top"><img src="icons/icon-192.png" alt="" /><span>${APP_NAME} · Safety circle</span><span class="muted">${partner.time}</span></div>
      <div class="lc-line"><strong>${partner.name}</strong> checked in: ✓ Safe at Home</div>
    </div>` : ''}

    ${live ? '' : html`<div class="lock-hint">Tap a notification to open</div>`}
  </div>`;
}
