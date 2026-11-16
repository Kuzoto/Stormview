// Consolidated Sources page (D1): every claim category → the sources behind it.
import { html } from '../../vendor/preact-htm.js';
import { SC, useStore, phase } from '../store.js';
import { Icon, Header, SHORT } from '../ui.js';

export function Sources() {
  const s = useStore();
  const ph = phase(s);
  const groups = [
    ['Alert & storm', ph.banner.sourceIds.concat(ph.timeline.flatMap((t) => t.sourceIds))],
    ['Power', ph.impacts.power.rows.flatMap((r) => r.sourceIds)],
    ['Water', ph.impacts.water.rows.flatMap((r) => r.sourceIds)],
    ['Roads & commute', ph.impacts.roads.rows.flatMap((r) => r.sourceIds).concat(ph.roadMarks.flatMap((r) => r.sourceIds))],
    ['Shelter', ph.impacts.shelter.rows.flatMap((r) => r.sourceIds).concat(['wcem', 'ready'])],
    ['Forecast', ['nws_fcst', 'nws_radar']],
  ].map(([t, ids]) => [t, [...new Set(ids)]]);
  return html`<div class="pad">
    <${Header} title="Sources" backTo="/more" />
    <div class="callout small"><strong>✓ Official</strong> = government agency or utility. <strong>? Community</strong> = posts from people nearby, not verified until an official source confirms them. Information as of <strong>${ph.clock}</strong>.</div>
    ${groups.map(([title, ids]) => html`<section class="card mt12">
      <h2>${title}</h2>
      ${ids.map((id) => { const src = SC.sources[id]; const off = src.kind === 'official'; return html`<div class="src-row">
        <div class=${'src-badge ' + (off ? 'off' : 'com')}>${off ? '✓' : '?'}</div>
        <div class="grow"><div class="src-name">${src.name}</div><div class="small muted">${src.about}</div>
          ${src.url && !s.offline ? html`<a class="link small" href=${src.url} target="_blank" rel="noopener">${src.org} website <${Icon} n="ext" size=${12} /></a>` : ''}</div></div>`; })}
    </section>`)}
    <p class="tiny muted mt12">${SC.meta.note}</p>
  </div>`;
}
