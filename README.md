# StormWise: functional prototype (CSE 593, Group 2)

An installable phone web app (PWA) for the tornado-warning scenario. The server runs on any laptop, and phones open the link and **Add to Home Screen**. After that it launches full-screen from its own icon like a native iOS/Android app, with a tab bar, bottom sheets, notifications, and offline support.

> "StormWise" is a placeholder name (set in `static/js/ui.js` → `APP_NAME`, `index.html`, `manifest.webmanifest`).

## Run it

Requirements: **Python 3.8+**. Nothing else: no pip, no npm, no build step.

```bash
cd prototype
cp .env.example .env          # then paste your OpenAI key into .env
python3 server.py             # http://localhost:8000
```

The server prints a `Phone:` URL (your LAN IP). Open it on a phone connected to the same Wi-Fi or hotspot.

### Getting it onto phones as an "app"

| Option | How | Notes |
|---|---|---|
| **Same network (quickest)** | Open the `Phone:` URL | University Wi-Fi (MWireless/eduroam) usually **blocks device-to-device traffic**. Use a phone hotspot with the laptop joined to it. Works over plain http, but no offline caching on Android. |
| **HTTPS tunnel (recommended for the study)** | `./tunnel.sh 8000` in a second terminal, then open the printed `https://…trycloudflare.com` URL | Works on any network and enables full PWA install + offline mode on iOS and Android. The URL changes each time you restart it. |
| Self-signed HTTPS | `python3 server.py --https` | Phones show a certificate warning. Only use this if the tunnel isn't possible. |

**Install:**
- **iPhone (Safari):** Share → *Add to Home Screen*.
- **Android (Chrome):** ⋮ → *Install app* (or *Add to Home screen*).

It then opens without browser chrome.

## OpenAI / WeatherBoy

- Key: `OPENAI_API_KEY` in `.env`. Model: `OPENAI_MODEL` (default **gpt-4.1-mini**, which is fast and cheap, a good fit for a 60-second task. `gpt-5-mini` also works but is slower.)
- **What the model does:**
  1. Answers chat questions.
  2. Writes the 2-sentence **"WeatherBoy summary for you"** on Home for each phase.

  Both are grounded in `static/data/scenario.json`, and the model returns structured JSON `{answer, sourceIds, severity, followUps}`. `sourceIds` is restricted to the scenario's source list, so the source chips under each answer always point to a real entry on the Sources page.
- **Suggested questions** send a `promptId`. The server adds a question-specific formatting instruction (see `PROMPTS` in `server.py`), but the model still writes the answer.
- **Summaries are cached on the server** (`logs/_summary_cache.json`), so every participant sees the same Home text for a phase. In the researcher panel, use **Pre-generate summaries** before a session.
- **Cost:** ~2.5k input + ~300 output tokens per question ≈ **$0.0015** on gpt-4.1-mini, so $10 is roughly 6,000 questions.
- **Guardrails:**
  - Server-side estimated spend cap `BUDGET_USD` (default 9.50; usage in `logs/_usage.json`)
  - 30 requests/min rate limit
  - Capped output length
  - Only the last 8 turns of history are sent
  - **Also set a hard monthly budget on an OpenAI Project** at platform.openai.com → Settings → Limits
- With no key (or once the budget is reached), WeatherBoy falls back to showing the official alert text, so the app never breaks during a session.
- `.env` is git-ignored. Never commit the key. One teammate's laptop serves everyone through the shared URL.

## Running a study session (Quantitative eval, R1)

1. Open the **researcher panel**: add `?admin=1` to the URL, or **long-press the "StormWise" title** on Home (or "More").
2. Enter the participant ID (e.g. `P01`) and the condition order.
3. Tap **Start on Home**. This resets the app (check-in, chat, posts, phase = 7:40 PM warning), opens Home, and starts the **60 s** timer. The countdown is hidden by default; there's a toggle to show it.
4. When time is up, the participant answers **"How safe do you feel?"** (the completion criterion) and **"How informed do you feel about power, water and shelter?"** on 1–5 scales. Both are logged.
5. NASA-TLX stays in the Google Form.
6. Logs: the researcher panel → Logs → **CSV/JSONL** per participant (`logs/<pid>.jsonl`). Every screen view, tap, source-chip open, chat question/answer (with latency), map layer change, check-in action and Likert answer is timestamped, with `taskElapsedMs` measured from task start.

Other panel controls: phase (7:40 PM warning → 8:05 PM storm overhead → 8:55 PM danger has passed, for R4), **simulate no connection** (offline state), reset, show the lock screen.

## What's implemented: design changes from the paper prototype

| Change | Where | Finding / requirement |
|---|---|---|
| **D1 Sources next to claims**: ✓/? source chip on the banner, every impact card, timeline item, per-place row, map layer, shelter, chat answer. Tap → sheet with source, org, kind, link. Consolidated **Sources** page | everywhere; `ui.js` `SourceChip`, `screens/sources.js` | HF-14, P10 failed task; R3 |
| **D2 Visible assistant + help**: labeled **Ask / Help** tab (accent color) and "Ask WeatherBoy" button on Home; suggested questions for the storm *and* for using the app | `screens/ask.js` | HF-22; R3 |
| **D3 Readable map**: one clearly highlighted active layer (Radar / Roads / Power / Shelters), always-visible legend per layer, standard blue location dot, road-closed sign, outage area, storm drawn as non-interactive radar area, NWS warning polygon dashed | `screens/map.js` | HF-01/02/03; R5, R1 |
| **D4 Specific shelter + routes**: "I'm at Work / Home" switch, building-specific steps, public places with power/water/hours/distance, route that avoids closures, "Don't drive" on map | `screens/impact.js` (Shelter), map `?layer=shelters&route=…` | HF-15/16/17; R1 |
| **D5 Persistent check-in**: labeled "Your status: Not sent yet", outlined (unpressed) buttons, confirm dialog, persistent "Sent to 3 people at 7:40 PM", request check-in, **+ Add person** (invite, no app needed), Mom replies → notification banner; check-in from lock screen + Home prompt + tab badge | `screens/checkin.js`, `lock.js`, `home.js` | HF-06–11; R2 |
| **D6 Alert status on every screen**: persistent banner colored by level with label + until-time; color-coded, larger timeline with legend; all times come from one simulated clock (no "until 8:15" when it is later) | `ui.js` `AlertBanner`, `home.js`, `scenario.json` | HF-12/13, P08; R4, R3 |
| **D7 Navigation**: bottom tab bar on every screen (replaces hamburger); renamed pages ("Forecast at My Places", "Neighbor Reports"); every card that looks tappable opens details | `app.js`, `more.js` | HF-04/05/20/23; R1, R3, R5 |
| **D8 Storm conditions & user content**: offline state with last-alert time (and a real service worker cache), timestamps + author context + verification badge + posting on Neighbor Reports, add/rename/remove places | `reports.js`, `places.js`, `sw.js` | HF-18/19/21; R3, R4, R5 |
| **Water** added as a first-class impact (the study task asks for it) | Home card + detail | R1 |
| **Real data**: live NWS hourly forecast and active alerts for Ann Arbor (`/api/nws`) in Forecast at My Places | `server.py`, `forecast.js` | spec: "local forecasts" |

## Files

```
prototype/
  server.py               Python stdlib server: static files, /api/chat, /api/summary, /api/nws, /api/log(s)
  .env.example            OpenAI settings template (copy to .env)
  tunnel.sh               HTTPS tunnel for phones (cloudflared quick tunnel)
  static/
    index.html  manifest.webmanifest  sw.js  icons/
    data/scenario.json    THE scenario: phases, impacts, timeline, sources, places, shelters, circle, posts, forecast
    css/app.css
    vendor/               preact+htm, leaflet, chart.js (vendored, no CDN needed)
    js/app.js             router, tab bar, timer + Likert, boot
    js/store.js           state (localStorage), toasts, notifications
    js/ui.js              banner, source chips/sheet, icons, header, modal, markdown-lite
    js/api.js  js/log.js  server calls; event logging
    js/screens/*.js       lock, home, impact, map, ask, checkin, more, forecast, reports, sources, places, admin
  logs/                   per-participant event logs, LLM spend, summary cache (git-ignored)
```

To change the scenario (times, outages, places, people, posts), edit `static/data/scenario.json` and restart the server. The server reads it for the model's grounding.

## Known limitations (for §8.3)

- All storm, outage, water, road, shelter, people and post data is **scripted**. Agency names show who would supply each fact. DTE and the City have no public APIs, and scraping Facebook/Nextdoor violates their terms.
- WeatherBoy can still word things imperfectly. It is restricted to the scenario data and cites sources, but it is not an official warning channel.
- Lock-screen and circle notifications are simulated inside the app. A web app can't post real lock-screen notifications without push infrastructure.
- Routes are hand-drawn polylines, not turn-by-turn routing.
- App state is stored per device (localStorage). Each phone keeps its own state, which **Start** in the researcher panel resets.
