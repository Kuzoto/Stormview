# Planned implementations

Status: **Planned** = agreed, not started · **Proposed** = needs a group decision · **Done** = built and committed

## 1. Circle sync + reply links (Check-In) · Done (Nov 16)

Built as **Option A** (no accounts, invite links), combined with the one-tap reply page:
- **Display name:** chosen once on Check-In (or in Neighbor Reports). The same name is used for check-ins and posts. The first time it's saved, the phone gets a random id + secret token from the server (stored hashed in `userdata/circle.json`).
- **+ Add person** creates an invite link (`/r/<code>`) and opens a text (with a phone number) or the share sheet.
  - **Recipient has the app:** the link's "Open in the app" (`/#/join/<code>`) connects you both. Each sees the other's status (+ note, + location if shared, 1 h) within ~20 s, with an in-app notification. **Ask if OK** sends an in-app request (red dot on the Check-In tab + banner) that clears when they check in.
  - **Recipient doesn't:** the reply page lets them tap I'm safe / I need help + a note, and shows your latest status. The reply appears in your circle. **Text link** re-sends it.
- Remove disconnects both sides. Invites expire after 30 days and work for one app user only.
- **Not yet:** lock-screen notifications (Web Push, see 4). Still has the tunnel caveat: links break when the quick-tunnel URL changes.

## 2. Bluesky in Neighbor Reports · Done (Nov 16)

- Neighbor Reports has two tabs: **Near you** (app posts) and **Bluesky**.
- Connect with handle + **app password**, directly from the phone to Bluesky (our server never sees it). Only the session tokens are kept, refreshed automatically, and cleared by **Disconnect**. Supports self-hosted servers (Advanced).
- **People I follow:** your timeline filtered to weather posts. **Search <city>:** recent public posts (3 days) for "<city>" storm / power out / flooding / weather, or your own query. All marked **? Unverified · Bluesky**, with images and "Open in Bluesky".
- Tested against a mock server (sign-in, wrong password, token refresh, timeline, search, disconnect). **Not yet tested with a real Bluesky account.**
- Later: Reddit (needs a free registered Reddit app).

**Also done:** **Share** button on your own posts (share sheet with photo + link to a public post page `/p/<id>`; copies to the clipboard where sharing isn't supported).

## 4. Lock-screen notifications (Web Push) · Proposed

Circle updates and new severe alerts as real phone notifications even when the app is closed. Works for the installed app on Android and on iOS 16.4+ over https. Needs VAPID keys and a Python push library (not stdlib), plus a fixed https address.

## 3. Map data: roads, traffic, power, accuracy (items 1–5 + ODIN done Nov 16)

| Item | Source | Needs | Status |
|---|---|---|---|
| 1. Storm reports pins (trees/power lines down, flooding, tornado) | NWS Local Storm Reports via IEM (free, no key) | — | Done |
| 2. App users' Road/Power/Flooding posts as map pins | Our `/api/posts` | — | Done |
| 3. Zone-based alerts drawn on the map (watches, winter storms, floods) | NWS zone shapes | — | Done |
| 4. Storm position + projected path and arrival time at your places | NWS warning `eventMotionDescription` | — | Done |
| 5. Radar timestamp + 1-hour loop | IEM NEXRAD tiles | — | Done |
| Traffic flow + incidents (road closed, crashes, roadworks, flooding) | TomTom Traffic API: Incident Details v5 (cached ~25 min per area, capped at 2,300/month) + Raster Flow Tiles v4 (proxied through the server, capped at 190,000/month) | Free API key (`TOMTOM_API_KEY` in `.env`) | Built Nov 16, tested against a mock. **Needs the real key** |
| Power outages (free, official, where available) | DOE/ORNL ODIN public feed (`odin.ornl.gov/odi/status`, `/odi/map`; no key). 159 utilities as of Nov 16, incl. Consumers Energy and several MI co-ops. **DTE does not participate**. Anonymous access is county-level. Utility per place from the EIA/HIFLD service-territory layer. Fallback when not covered: NWS reports + neighbor Power posts + links (utility outage map, PowerOutage.us) | — | Done |
| Power outages (DTE) | (a) unofficial Kubra feed behind DTE's map, (b) paid aggregator: PowerOutage.us ~$1,000–1,500/mo, county/city level, or Outage Pro (quote only); ask both about free student/research access | Group decision (terms of use / cost) | Proposed |
| Safe walking/driving routes that avoid closures | OpenRouteService | Free API key | Proposed |
