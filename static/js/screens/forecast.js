// Screen 9 – "Forecast at My Places" (was "Additional Details", D7). Conditions at saved places (kept),
// hourly rain/wind charts with a "now" marker, plus the real NWS hourly forecast (live data).
import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.js';
import { SC, useStore, phase } from '../store.js';
import { Icon, Header, Segmented, SourceChip, nav } from '../ui.js';
import { log } from '../log.js';

function forecastFor(id, s) {
  if (SC.forecast.places[id]) return { data: SC.forecast.places[id], approx: null };
  // Places added by the user: use the nearest scripted place.
  const p = s.places[id];
  let best = 'work', bd = 1e9;
  Object.entries(SC.places).forEach(([k, q]) => {
    const d = (q.lat - (p.lat ?? q.lat)) ** 2 + (q.lng - (p.lng ?? q.lng)) ** 2;
    if (d < bd) { bd = d; best = k; }
  });
  return { data: SC.forecast.places[best], approx: SC.places[best].name };
}

function ChartBox({ labels, values, nowIdx, label, unit, color, max }) {
  const ref = useRef();
  useEffect(() => {
    const Chart = window.Chart;
    const nowLine = {
      id: 'now',
      afterDatasetsDraw(c) {
        const x = c.scales.x.getPixelForValue(nowIdx);
        const { top, bottom } = c.chartArea;
        const ctx = c.ctx;
        ctx.save(); ctx.strokeStyle = '#0f1b2d'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
        ctx.setLineDash([]); ctx.fillStyle = '#0f1b2d'; ctx.font = '600 11px system-ui'; ctx.fillText('Now', x + 4, top + 10);
        ctx.restore();
      },
    };
    const ch = new Chart(ref.current, {
      type: unit === 'mph' ? 'line' : 'bar',
      data: { labels, datasets: [{ label, data: values, backgroundColor: color + 'aa', borderColor: color, borderWidth: 2, tension: 0.35, pointRadius: 3, fill: unit === 'mph' }] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.parsed.y} ${unit}` } } },
        scales: { y: { beginAtZero: true, suggestedMax: max, title: { display: true, text: unit } }, x: { grid: { display: false } } },
      },
      plugins: [nowLine],
    });
    return () => ch.destroy();
  }, [JSON.stringify(values), nowIdx]);
  return html`<div class="chart-box"><canvas ref=${ref} aria-label=${label + ' chart'}></canvas></div>`;
}

function LiveNWS() {
  const [d, setD] = useState(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || d) return;
    fetch('api/nws').then((r) => r.json()).then(setD).catch(() => setD({ error: 'unavailable' }));
  }, [open]);
  return html`<details class="card mt16" onToggle=${(e) => setOpen(e.target.open)}>
    <summary><strong>Real-world forecast today (live NWS)</strong><div class="small muted">Actual Ann Arbor forecast, not part of the scenario</div></summary>
    ${!d ? html`<p class="small muted">Loading…</p>` : d.error ? html`<p class="small muted">Live forecast unavailable (${d.error}).</p>` : html`
      ${d.alerts && d.alerts.length ? d.alerts.map((a) => html`<div class="callout small">${a.event}: ${a.headline}</div>`) : html`<p class="small">No active NWS alerts for Ann Arbor right now.</p>`}
      <div class="nws-list">${d.periods.map((p) => html`<div class="nws-row"><span>${new Date(p.start).toLocaleTimeString([], { hour: 'numeric' })}</span>
        <strong>${p.temp}°${p.unit}</strong><span class="grow">${p.short}</span><span class="small muted">${p.pop ?? 0}% · ${p.wind}</span></div>`)}</div>
      <div class="row gap8"><span class="tiny muted">Updated ${new Date(d.updated).toLocaleString()}</span><${SourceChip} ids=${['nws_fcst']} claim="Live hourly forecast" /></div>`}
  </details>`;
}

export function Forecast() {
  const s = useStore();
  const ph = phase(s);
  const [place, setPlace] = useState(SC.meta.userLocation);
  const { data, approx } = forecastFor(place, s);
  const fc = SC.forecast;
  const nowIdx = fc.phaseHourIndex[ph.id];
  const opts = s.placeOrder.map((id) => ({ value: id, label: s.places[id].short || s.places[id].name }));
  return html`<div class="pad">
    <${Header} title="Forecast at My Places" backTo="/more" />
    <${Segmented} options=${opts} value=${place} onChange=${(v) => { log('forecast_place', v); setPlace(v); }} />
    <div class="small muted mt8"><${Icon} n="pin" size=${14} /> ${s.places[place].addr || ''}${approx ? ` · estimated from ${approx} (nearest)` : ''}</div>
    <section class="card now-card mt12">
      <div class="row between"><div><div class="small muted">Now · ${ph.clock}</div><div class="now-risk">${data.risk[nowIdx]}</div></div>
        <div class="now-nums"><div><strong>${data.rain[nowIdx]}</strong> in/hr rain</div><div><strong>${data.gust[nowIdx]}</strong> mph gusts</div></div></div>
      <div class="next-hours">${fc.hours.map((h, i) => html`<div class=${'nh' + (i === nowIdx ? ' now' : '') + (i < nowIdx ? ' past' : '')}><div class="tiny">${i === nowIdx ? 'Now' : h}</div><div class="nh-risk">${data.risk[i]}</div></div>`)}</div>
      <div class="row gap8 mt8"><span class="tiny muted">Forecast:</span><${SourceChip} ids=${['nws_fcst', 'nws_radar']} claim=${'Forecast for ' + s.places[place].name} /></div>
    </section>
    <h2 class="mt16">Rain (inches per hour)</h2>
    <${ChartBox} labels=${fc.hours} values=${data.rain} nowIdx=${nowIdx} label="Rain" unit="in/hr" color="#1565c0" max=${2} />
    <h2 class="mt16">Wind gusts (mph)</h2>
    <${ChartBox} labels=${fc.hours} values=${data.gust} nowIdx=${nowIdx} label="Wind gusts" unit="mph" color="#e65100" max=${70} />
    <button class="btn ghost full mt12" onClick=${() => nav('/places')}><${Icon} n="edit" size=${16} /> Add or edit places</button>
    <${LiveNWS} />
  </div>`;
}
