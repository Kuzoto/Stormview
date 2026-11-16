// "More" tab (replaces the hidden hamburger menu, D7) with descriptive page names.
import { html } from '../../vendor/preact-htm.js';
import { useStore, isLive, myOrder, myPlaces } from '../store.js';
import { Icon, Header, nav, APP_NAME } from '../ui.js';

const ITEMS = [
  { path: '/forecast', icon: 'chart', title: 'Forecast at My Places', sub: 'Hourly rain & wind at Home, Work, Mom\'s house' },
  { path: '/reports', icon: 'people', title: 'Neighbor Reports', sub: 'What people nearby are seeing; post your own' },
  { path: '/sources', icon: 'doc', title: 'Sources', sub: 'Every source behind the alert and impacts' },
  { path: '/places', icon: 'pin', title: 'My Places', sub: 'Add or edit the places you care about' },
  { path: '/lock', icon: 'alert', title: 'Show lock-screen alert', sub: 'See the alert notification again' },
];

export function More() {
  const s = useStore();
  const live = isLive(s);
  const names = myOrder(s).map((id) => myPlaces(s)[id].short || myPlaces(s)[id].name).join(', ');
  const items = ITEMS.map((i) => (i.path === '/forecast' ? { ...i, sub: (live ? 'Live hourly temperature, rain chance & wind at ' : 'Hourly rain & wind at ') + names } : i));
  return html`<div class="pad">
    <${Header} title="More" onTitleHold=${() => nav('/admin')} />
    <div class="list card">
      ${items.map((i) => html`<button class="list-item" onClick=${() => nav(i.path)}>
        <span class="li-ic"><${Icon} n=${i.icon} /></span>
        <span class="grow"><span class="li-title">${i.title}</span><span class="li-sub">${i.sub}</span></span>
        <${Icon} n="chev" size=${18} />
      </button>`)}
    </div>
    <div class="card small mt16">
      <strong>About this prototype</strong>
      ${live ? html`<p class="muted">${APP_NAME} is a CSE 593 (HCI) research prototype. Alerts, forecasts and radar are <strong>live from the National Weather Service</strong>; public buildings come from OpenStreetMap. Power, water and road status aren't available as live data, so the app shows weather-based risk and links to the official source. WeatherBoy uses an AI model to explain this data. For emergencies, follow official alerts and call 911.</p>`
        : html`<p class="muted"><strong>Practice scenario is on.</strong> The storm, outages, closures, posts and people are scripted; agency names show who would supply each piece of information in a real app. WeatherBoy uses an AI model to explain this scripted data. Don't use it for real emergencies.</p>`}
      <p class="muted">AI: ${s.llm ? (s.llm.llm ? 'connected (' + s.llm.model + ')' : 'not connected, using official text') : 'checking…'}</p>
    </div>
  </div>`;
}
