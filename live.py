"""
Live mode: builds the same "phase" shape the app uses for the scripted scenario, but from real data.

  - National Weather Service (api.weather.gov, free, no key): active alerts, warning polygons and the
    hourly forecast for each saved place.
  - OpenStreetMap / Overpass (free, no key): public buildings near each place (libraries, community
    centers, town halls, emergency shelters). These are NOT official storm shelters and their
    power/water status is unknown; the UI says so.
  - US Census geocoder + Open-Meteo geocoding (free, no key): address / city search for My Places.

Power outages, boil-water notices and road closures have no free public API, so live mode gives a
weather-based risk and links to the right official source instead of inventing data.

Python 3.8+ standard library only. Times come from the NWS timestamps' own UTC offsets, so this works
on Windows without the tzdata package.
"""
import hashlib
import json
import math
import re
import sys
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

UA = "cse593-weather-prototype (student project)"
DEFAULT_PLACE = {"id": "here", "name": "Ann Arbor", "lat": 42.2808, "lng": -83.7430}

# Source definitions live in static/data/scenario.json ("liveSources") so the app has them before the first fetch.
import os as _os
with open(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "static", "data", "scenario.json")) as _f:
    LIVE_SOURCES = json.load(_f)["liveSources"]


# --------------------------------------------------------------------------- HTTP + cache
_cache = {}
_cache_lock = threading.Lock()


def _get(url, headers=None, data=None, timeout=12):
    h = {"User-Agent": UA, "Accept": "application/geo+json, application/json"}
    h.update(headers or {})
    req = urllib.request.Request(url, headers=h, data=data)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def cached(key, ttl, fn):
    now = time.time()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    val = fn()
    with _cache_lock:
        _cache[key] = (now, val)
        if len(_cache) > 2000:  # crude bound
            for k in sorted(_cache, key=lambda k: _cache[k][0])[:500]:
                _cache.pop(k, None)
    return val


def stale(key):
    with _cache_lock:
        hit = _cache.get(key)
    return hit[1] if hit else None


# --------------------------------------------------------------------------- time helpers
def parse_t(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def fmt_clock(dt):
    h = dt.hour % 12 or 12
    return "%d:%02d %s" % (h, dt.minute, "AM" if dt.hour < 12 else "PM")


def fmt_hour(dt):
    return "%d %s" % (dt.hour % 12 or 12, "AM" if dt.hour < 12 else "PM")


def fmt_when(dt, now):
    """'8:45 PM' today, 'Tue 8:45 PM' on another day."""
    dt = dt.astimezone(now.tzinfo)
    if dt.date() == now.date():
        return fmt_clock(dt)
    return dt.strftime("%a ") + fmt_clock(dt)


def miles(a_lat, a_lng, b_lat, b_lng):
    r = 3958.8
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp, dl = p2 - p1, math.radians(b_lng - a_lng)
    x = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(x))


# --------------------------------------------------------------------------- NWS
def rnd(v):
    return round(float(v), 4)


def nws_point(lat, lng):
    def f():
        p = _get("https://api.weather.gov/points/%s,%s" % (rnd(lat), rnd(lng)))["properties"]
        rel = (p.get("relativeLocation") or {}).get("properties") or {}
        return {
            "hourly": p.get("forecastHourly"),
            "city": rel.get("city"), "state": rel.get("state"),
            "office": p.get("cwa"), "radar": p.get("radarStation"),
        }
    return cached(("pt", rnd(lat), rnd(lng)), 86400, f)


def nws_alerts(lat, lng):
    def f():
        j = _get("https://api.weather.gov/alerts/active?point=%s,%s" % (rnd(lat), rnd(lng)))
        out = []
        for ft in j.get("features", []):
            p = ft.get("properties") or {}
            if p.get("status") not in (None, "Actual"):
                continue
            poly = None
            g = ft.get("geometry")
            if g and g.get("type") == "Polygon":
                poly = [[c[1], c[0]] for c in g["coordinates"][0]]
            elif g and g.get("type") == "MultiPolygon":
                poly = [[c[1], c[0]] for c in g["coordinates"][0][0]]
            out.append({
                "id": p.get("id") or ft.get("id"), "event": p.get("event") or "Weather alert",
                "headline": p.get("headline") or "", "description": (p.get("description") or "").strip(),
                "instruction": (p.get("instruction") or "").strip(), "severity": p.get("severity"),
                "urgency": p.get("urgency"), "certainty": p.get("certainty"),
                "sent": p.get("sent"), "onset": p.get("onset"), "ends": p.get("ends") or p.get("expires"),
                "area": p.get("areaDesc") or "", "sender": p.get("senderName") or "National Weather Service",
                "polygon": poly, "zones": (p.get("affectedZones") or [])[:15],
                "motion": (p.get("parameters") or {}).get("eventMotionDescription") or [],
            })
        return out
    return cached(("al", rnd(lat), rnd(lng)), 60, f)


WIND_RE = re.compile(r"(\d+)")


def nws_hourly(lat, lng):
    pt = nws_point(lat, lng)

    def f():
        j = _get(pt["hourly"])["properties"]
        periods = []
        for p in j.get("periods", [])[:24]:
            winds = [int(x) for x in WIND_RE.findall(p.get("windSpeed") or "")] or [0]
            periods.append({
                "start": p["startTime"], "temp": p.get("temperature"), "unit": p.get("temperatureUnit", "F"),
                "pop": (p.get("probabilityOfPrecipitation") or {}).get("value") or 0,
                "wind": max(winds), "dir": p.get("windDirection") or "", "short": p.get("shortForecast") or "",
            })
        return {"updated": j.get("updateTime") or j.get("generateTime") or j.get("generatedAt"), "periods": periods}
    return cached(("hr", pt["hourly"]), 600, f)


# --------------------------------------------------------------------------- OpenStreetMap public buildings
# Nominatim (OpenStreetMap's search service). Its usage policy allows <= 1 request/second with an
# identifying User-Agent and requires caching, so lookups run in one background thread, spaced 1.1 s
# apart, and results are kept for a week. The app never waits on them: build_live() uses whatever is
# cached and the client refreshes a few seconds later ("publicPending").
OSM_QUERIES = [("library", "Library"), ("community_centre", "Community center"), ("townhall", "Town hall")]
_osm_lock = threading.Lock()
_osm_pending = set()
_osm_last = [0.0]


def _nominatim(amenity, lat, lng, d=0.05):
    with _osm_lock:  # global 1 request / second
        wait = 1.1 - (time.time() - _osm_last[0])
        if wait > 0:
            time.sleep(wait)
        _osm_last[0] = time.time()
    u = ("https://nominatim.openstreetmap.org/search?format=jsonv2&bounded=1&limit=8&extratags=1&amenity=%s&viewbox=%f,%f,%f,%f"
         % (amenity, lng - d * 1.35, lat + d, lng + d * 1.35, lat - d))
    return _get(u, timeout=12)


def _overpass(lat, lng, radius_m=4000):
    q = """[out:json][timeout:10];(
nwr["amenity"~"^(library|community_centre|townhall)$"](around:%d,%f,%f);
);out center tags 40;""" % (radius_m, lat, lng)
    kinds = dict(OSM_QUERIES)
    out = []
    for e in _get("https://overpass-api.de/api/interpreter", data=urllib.parse.urlencode({"data": q}).encode(), timeout=12).get("elements", []):
        t = e.get("tags") or {}
        c = e.get("center") or e
        if t.get("name") and "lat" in c:
            out.append({"osm": "%s/%s" % (e.get("type"), e.get("id")), "name": t["name"], "kind": kinds.get(t.get("amenity"), "Public building"),
                        "lat": c["lat"], "lng": c["lon"], "hours": t.get("opening_hours"), "phone": t.get("phone") or t.get("contact:phone"),
                        "addr": " ".join(x for x in (t.get("addr:housenumber"), t.get("addr:street")) if x)})
    return out


def _osm_fetch(key, lat, lng):
    out, failures = [], 0
    try:
        for amenity, kind in OSM_QUERIES:
            rows = None
            for attempt in range(2):  # Nominatim occasionally times out; one retry per query
                try:
                    rows = _nominatim(amenity, lat, lng)
                    break
                except Exception as e:
                    sys.stderr.write("[osm nominatim %s] %r\n" % (amenity, e))
            if rows is None:
                failures += 1
                continue
            for x in rows:
                name = x.get("name")
                if not name:
                    continue
                et = x.get("extratags") or {}
                addr = (x.get("display_name") or "").split(",")
                out.append({"osm": "%s/%s" % (x.get("osm_type"), x.get("osm_id")), "name": name, "kind": kind,
                            "lat": float(x["lat"]), "lng": float(x["lon"]), "hours": et.get("opening_hours"),
                            "phone": et.get("phone") or et.get("contact:phone"),
                            "addr": ", ".join(a.strip() for a in addr[1:3]) if len(addr) > 2 else ""})
        if failures == len(OSM_QUERIES):
            try:
                out = _overpass(lat, lng)
                failures = 0
            except Exception as e:
                sys.stderr.write("[osm overpass] %r\n" % e)
        with _cache_lock:
            if out or not failures:
                _cache[key] = (time.time(), out)
            elif key not in _cache:  # total failure: retry in ~2 minutes
                _cache[key] = (time.time() - 7 * 86400 + 120, [])
    finally:
        with _cache_lock:
            _osm_pending.discard(key)


def osm_public(lat, lng):
    """Returns (places, pending). Never blocks on the network."""
    key = ("osm", round(lat / 0.02) * 0.02, round(lng / 0.02) * 0.02)
    with _cache_lock:
        hit = _cache.get(key)
        fresh = hit and time.time() - hit[0] < 7 * 86400
        if fresh:
            return hit[1], False
        if key not in _osm_pending:
            _osm_pending.add(key)
            threading.Thread(target=_osm_fetch, args=(key, lat, lng), daemon=True).start()
    return (hit[1] if hit else []), True


# --------------------------------------------------------------------------- geocoding (My Places search)
def geocode(q):
    q = (q or "").strip()[:120]
    if len(q) < 3:
        return []

    def f():
        res = []
        if re.search(r"\d", q):  # looks like a street address -> US Census geocoder
            try:
                u = ("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address="
                     + urllib.parse.quote(q))
                for m in _get(u)["result"]["addressMatches"][:5]:
                    res.append({"label": m["matchedAddress"].title().replace(", Mi,", ", MI,"),
                                "lat": m["coordinates"]["y"], "lng": m["coordinates"]["x"]})
            except Exception as e:
                sys.stderr.write("[geocode census] %r\n" % e)
        if not res:  # city / town names -> Open-Meteo
            try:
                u = "https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&format=json&name=" + urllib.parse.quote(q.split(",")[0])
                for r in _get(u).get("results", []) or []:
                    if r.get("country_code") != "US":
                        continue
                    res.append({"label": ", ".join(x for x in (r.get("name"), r.get("admin1")) if x),
                                "lat": r["latitude"], "lng": r["longitude"]})
            except Exception as e:
                sys.stderr.write("[geocode open-meteo] %r\n" % e)
        return res[:5]
    return cached(("geo", q.lower()), 86400, f)


# --------------------------------------------------------------------------- alert interpretation
RANK = [  # (keyword in event, rank, level, action, dontDrive, shelter)
    ("Tornado Warning", 100, "warning", "Shelter now: lowest floor, interior room, away from windows. Don't drive.", True, "now"),
    ("Tornado Emergency", 101, "warning", "Take cover now: lowest floor, interior room. Don't drive.", True, "now"),
    ("Extreme Wind Warning", 99, "warning", "Take cover now in an interior room away from windows. Don't drive.", True, "now"),
    ("Flash Flood Emergency", 98, "warning", "Get to higher ground now. Never drive into flood water.", True, "high"),
    ("Flash Flood Warning", 90, "warning", "Avoid low areas and flooded roads. Turn around, don't drown.", True, "high"),
    ("Severe Thunderstorm Warning", 85, "warning", "Go indoors now and stay away from windows until the storm passes.", False, "indoors"),
    ("Blizzard Warning", 84, "warning", "Avoid travel. Stay indoors and keep phones charged.", True, "indoors"),
    ("Ice Storm Warning", 83, "warning", "Avoid travel. Expect power outages; keep phones charged.", True, "indoors"),
    ("Hurricane Warning", 95, "warning", "Follow local evacuation orders. Stay away from windows.", True, "indoors"),
    ("Excessive Heat Warning", 70, "warning", "Stay somewhere cool, drink water, and check on others.", False, "cool"),
    ("Extreme Heat Warning", 70, "warning", "Stay somewhere cool, drink water, and check on others.", False, "cool"),
    ("High Wind Warning", 72, "warning", "Stay indoors if you can. Expect fallen branches and possible outages.", False, "indoors"),
    ("Winter Storm Warning", 75, "warning", "Avoid travel if you can. If you must drive, slow down and carry supplies.", False, "indoors"),
    ("Flood Warning", 65, "warning", "Avoid flooded roads and low areas.", False, None),
    ("Tornado Watch", 60, "watch", "Be ready to shelter. Know where you'd go and keep your phone charged.", False, "ready"),
    ("Severe Thunderstorm Watch", 55, "watch", "Be ready to go indoors quickly if a warning is issued.", False, "ready"),
    ("Flash Flood Watch", 50, "watch", "Be ready to avoid low areas and flooded roads.", False, None),
    ("Winter Storm Watch", 45, "watch", "Plan for possible travel problems and outages.", False, None),
    ("Watch", 40, "watch", "Be ready: conditions could become dangerous.", False, None),
    ("Warning", 62, "warning", "Follow the official instructions in the alert.", False, None),
    ("Advisory", 30, "advisory", "Take extra care. Read the advisory for details.", False, None),
    ("Statement", 20, "advisory", "Stay aware of changing conditions.", False, None),
    ("", 10, "advisory", "Read the official alert for details.", False, None),
]
SEVERITY = {"Extreme": 5, "Severe": 4, "Moderate": 3, "Minor": 2}
POWER_RISK = ("Tornado", "Thunderstorm", "Wind", "Ice", "Blizzard", "Hurricane", "Tropical", "Winter Storm")
ROAD_RISK = ("Flood", "Winter", "Ice", "Blizzard", "Snow", "Freezing", "Fog", "Dense")
WATER_RISK = ("Flood",)


def classify(a):
    for kw, rank, level, action, dd, shelter in RANK:
        if kw in a["event"]:
            return {"rank": rank, "level": level, "action": action, "dontDrive": dd, "shelter": shelter,
                    "generic": kw in ("Watch", "Warning", "Advisory", "Statement", "")}


def join_names(names):
    names = list(dict.fromkeys(names))
    if len(names) <= 2:
        return " & ".join(names)
    return ", ".join(names[:-1]) + " & " + names[-1]


def short_text(s, n):
    s = re.sub(r"\s+", " ", s or "").strip()
    return s if len(s) <= n else s[: n - 1].rsplit(" ", 1)[0] + "…"


# --------------------------------------------------------------------------- build the live "phase"
def clean_places(raw):
    out = []
    for p in (raw or [])[:6]:
        try:
            lat, lng = float(p["lat"]), float(p["lng"])
        except (KeyError, TypeError, ValueError):
            continue
        if not (-90 <= lat <= 90 and -180 <= lng <= 180):
            continue
        out.append({"id": re.sub(r"[^A-Za-z0-9_-]", "", str(p.get("id") or "p"))[:24] or "p",
                    "name": str(p.get("name") or "Place")[:40], "lat": round(lat, 4), "lng": round(lng, 4)})
    return out or [dict(DEFAULT_PLACE)]


def build_live(raw_places, here_id="here", tz_minutes=None):
    places = clean_places(raw_places)
    ids = [p["id"] for p in places]
    here = next((p for p in places if p["id"] == here_id), places[0])
    errors = []

    def per_place(p):
        r = {"place": p, "point": None, "alerts": [], "hourly": None, "public": []}
        try:
            r["point"] = nws_point(p["lat"], p["lng"])
        except Exception as e:
            errors.append("Forecast lookup failed for %s (%s). NWS covers US locations only." % (p["name"], type(e).__name__))
            return r
        try:
            r["alerts"] = nws_alerts(p["lat"], p["lng"])
        except Exception as e:
            errors.append("Alerts unavailable for %s (%s)" % (p["name"], type(e).__name__))
            r["alerts"] = stale(("al", rnd(p["lat"]), rnd(p["lng"]))) or []
        try:
            r["hourly"] = nws_hourly(p["lat"], p["lng"])
        except Exception as e:
            errors.append("Hourly forecast unavailable for %s (%s)" % (p["name"], type(e).__name__))
        return r

    with ThreadPoolExecutor(max_workers=8) as ex:
        results = list(ex.map(per_place, places))
        osm = [osm_public(p["lat"], p["lng"]) for p in places[:3]]
    publics = [o[0] for o in osm]
    public_pending = any(o[1] for o in osm)

    by_id = {r["place"]["id"]: r for r in results}

    # "now" in the phone's time zone (sent by the app); otherwise the offset in the NWS forecast timestamps
    tz = timezone(timedelta(hours=-5))
    if isinstance(tz_minutes, (int, float)) and -840 <= tz_minutes <= 840:
        tz = timezone(timedelta(minutes=tz_minutes))
    else:
        for r in [by_id[here["id"]]] + results:
            if r["hourly"] and r["hourly"]["periods"]:
                tz = parse_t(r["hourly"]["periods"][0]["start"]).tzinfo
                break
    now = datetime.now(tz)

    # ---- merge alerts across places
    alerts = {}
    for r in results:
        for a in r["alerts"]:
            m = alerts.setdefault(a["id"], dict(a, places=[], **classify(a)))
            m["places"].append(r["place"]["id"])
    alerts = sorted(alerts.values(), key=lambda a: (-a["rank"], -(SEVERITY.get(a["severity"]) or 0)))
    name = {p["id"]: p["name"] for p in places}
    primary = alerts[0] if alerts else None

    def until(a):
        t = parse_t(a.get("ends"))
        return ("until " + fmt_when(t, now)) if t else ""

    def at_place(pid):
        return [a for a in alerts if pid in a["places"]]

    # ---- banner + action
    if primary:
        level = primary["level"]
        others = len(alerts) - 1
        banner = {
            "title": primary["event"],
            "levelLabel": {"warning": "Warning · act now", "watch": "Watch · be ready", "advisory": "Advisory"}[level],
            "area": "Covers " + join_names(name[i] for i in ids if i in primary["places"]) + (" · +%d more alert%s" % (others, "s" if others > 1 else "") if others else ""),
            "until": until(primary),
            "sourceIds": ["nws_live"] + (["radar_live"] if any(k in primary["event"] for k in ("Tornado", "Thunderstorm")) else []),
        }
        action = primary["action"]
        if primary["instruction"] and primary["generic"]:
            action = short_text(primary["instruction"], 140)
        alert_text = short_text(primary["headline"], 300) + "\n\n" + short_text(primary["description"], 1400)
        if primary["instruction"]:
            alert_text += "\n\nWhat to do: " + short_text(primary["instruction"], 600)
        if others:
            alert_text += "\n\nAlso active: " + "; ".join("%s (%s)" % (a["event"], until(a) or "no end time") for a in alerts[1:5])
        severity = SEVERITY.get(primary["severity"]) or (4 if level == "warning" else 3 if level == "watch" else 2)
    else:
        level = "clear"
        banner = {"title": "No active alerts", "levelLabel": "All clear", "area": "For " + join_names(name[i] for i in ids),
                  "until": "", "sourceIds": ["nws_live"]}
        action = "No weather alerts for your places right now."
        alert_text = "The National Weather Service has no active watches, warnings or advisories for " + join_names(name[i] for i in ids) + "."
        severity = 1
    dont_drive = any(a["dontDrive"] for a in alerts if here["id"] in a["places"]) or (primary and primary["dontDrive"])

    # ---- forecast per place
    fc = {"hours": [], "places": {}, "updated": None}
    for r in results:
        h = r["hourly"]
        if not h:
            continue
        per = h["periods"][:12]
        if not fc["hours"]:
            fc["hours"] = ["Now" if i == 0 else fmt_hour(parse_t(p["start"]).astimezone(tz)) for i, p in enumerate(per)]
            fc["updated"] = h["updated"]
        fc["places"][r["place"]["id"]] = {
            "temp": [p["temp"] for p in per], "unit": per[0]["unit"] if per else "F",
            "pop": [p["pop"] for p in per], "wind": [p["wind"] for p in per], "short": [p["short"] for p in per],
        }

    def outlook(pid):
        f = fc["places"].get(pid)
        if not f:
            return {}
        wet = next((i for i, v in enumerate(f["pop"]) if v >= 50), None)
        storms = next((i for i, s in enumerate(f["short"]) if "Thunder" in s), None)
        snow = next((i for i, s in enumerate(f["short"]) if any(k in s for k in ("Snow", "Sleet", "Freezing", "Ice"))), None)
        return {"wet": wet, "storms": storms, "snow": snow, "maxWind": max(f["wind"] or [0]),
                "maxPop": max(f["pop"] or [0]), "now": f["short"][0] if f["short"] else ""}

    def hour_label(i):
        return "now" if i == 0 else "around " + fc["hours"][i]

    # ---- timeline: alerts (by issue time) + a forecast outlook line
    timeline = []
    for a in sorted(alerts, key=lambda a: a.get("sent") or ""):
        t = parse_t(a.get("sent"))
        timeline.append({"time": fmt_when(t, now) if t else "", "_t": t.timestamp() if t else 0,
                         "level": "high" if a["level"] == "warning" else "med",
                         "text": "%s issued for %s%s." % (a["event"], join_names(name[i] for i in ids if i in a["places"]), (", " + until(a)) if until(a) else ""),
                         "sourceIds": ["nws_live"]})
    o = outlook(here["id"])
    if o:
        bits = []
        if o["storms"] is not None:
            bits.append("thunderstorms possible " + hour_label(o["storms"]))
        elif o["snow"] is not None:
            bits.append("snow or ice possible " + hour_label(o["snow"]))
        elif o["wet"] is not None:
            bits.append("rain likely " + hour_label(o["wet"]))
        else:
            bits.append("no rain or snow expected in the next 12 hours (max %d%% chance)" % o["maxPop"])
        if o["maxWind"] >= 25:
            bits.append("winds up to %d mph" % o["maxWind"])
        ut = parse_t(fc["updated"])
        timeline.append({"time": fmt_when(ut, now) if ut else fmt_clock(now), "_t": ut.timestamp() if ut else now.timestamp(),
                         "level": "info", "text": "Forecast for %s: %s. Now: %s." % (here["name"], "; ".join(bits), o["now"].lower() or "n/a"),
                         "sourceIds": ["fcst_live"]})
    # ---- extra map data (storm reports, storm track, alert zones, power) -- see mapdata.py
    import mapdata as MD
    import posts as POSTS
    extra_pending = False
    lsr, pend = MD.storm_reports(places)
    extra_pending = extra_pending or pend
    track = None
    for a in alerts:
        track = MD.storm_track(a, places, now)
        if track:
            break
    if track:
        eta = "; ".join(e["text"] for e in track["etas"]) or "not heading toward your places"
        timeline.append({"time": fmt_clock(parse_t(track["observedAt"]).astimezone(tz)), "_t": parse_t(track["observedAt"]).timestamp(),
                         "level": "high", "text": "Radar: %s moving %s at %d mph, %s (estimate)." % (track["what"], track["heading"], track["mph"], eta),
                         "sourceIds": ["nws_live", "radar_live"]})
    for r in [r for r in lsr if r["distanceMi"] <= 10][:4]:
        t = parse_t(r["time"])
        timeline.append({"time": fmt_when(t, now) if t else "", "_t": t.timestamp() if t else 0, "level": "med",
                         "text": "Storm report: %s%s, %s mi from %s (%s)." % (r["label"], (" " + r["magnitude"]) if r["magnitude"] else "",
                                                                               r["distanceMi"], name[r["near"]], r["source"] or "NWS"),
                         "sourceIds": ["lsr_live"]})
    timeline.sort(key=lambda t: t.pop("_t"))

    # ---- impacts per place
    def row(pid, tone, text, src, kind=None):
        r = {"place": pid, "tone": tone, "text": text, "sourceIds": src}
        if kind:
            r["kind"] = kind
        return r

    power_rows, water_rows, road_rows, shelter_rows = [], [], [], []
    for pid in ids:
        al = at_place(pid)
        o = outlook(pid)
        pa = next((a for a in al if any(k in a["event"] for k in POWER_RISK) and a["level"] in ("warning", "watch")), None)
        if pa and pa["level"] == "warning":
            power_rows.append(row(pid, "bad", "Outages likely: %s %s. Charge your phone now." % (pa["event"], until(pa)), ["nws_live", "outages_live"]))
        elif pa or (o and o["maxWind"] >= 35):
            why = pa["event"] if pa else "winds up to %d mph in the forecast" % o["maxWind"]
            power_rows.append(row(pid, "warn", "Outages possible (%s). Check your utility's map for live outages." % why, ["nws_live" if pa else "fcst_live", "outages_live"]))
        else:
            power_rows.append(row(pid, "ok", "No weather threat to power in the next 12 hours. Live outages: your utility's map.", ["fcst_live", "outages_live"]))

        wa = next((a for a in al if any(k in a["event"] for k in WATER_RISK)), None)
        if wa:
            water_rows.append(row(pid, "warn", "%s %s. Flooding can affect water service; follow your utility's notices." % (wa["event"], until(wa)), ["nws_live", "water_live"]))
        else:
            water_rows.append(row(pid, "ok", "No flood alerts. Boil-water notices come from your water utility, not the weather service.", ["nws_live", "water_live"]))

        da = next((a for a in al if a["dontDrive"]), None) or next((a for a in al if any(k in a["event"] for k in ROAD_RISK)), None)
        if da and da["dontDrive"]:
            road_rows.append(row(pid, "bad", "Don't drive: %s %s." % (da["event"], until(da)), ["nws_live", "roads_live"]))
        elif da:
            road_rows.append(row(pid, "warn", "%s %s. Slow down and allow extra time." % (da["event"], until(da)), ["nws_live", "roads_live"]))
        elif o and (o["snow"] is not None or o["storms"] is not None):
            what = "Snow or ice" if o["snow"] is not None else "Thunderstorms"
            i = o["snow"] if o["snow"] is not None else o["storms"]
            road_rows.append(row(pid, "warn", "%s %s may make driving harder." % (what, hour_label(i)), ["fcst_live", "roads_live"]))
        else:
            road_rows.append(row(pid, "ok", "No weather hazards for driving in the next 12 hours. Closures: check 511.", ["fcst_live", "roads_live"]))

        sa = next((a for a in al if a["shelter"]), None)
        if sa and sa["shelter"] == "now":
            shelter_rows.append(row(pid, "bad", "Shelter now: %s %s. Lowest floor, interior room, no windows." % (sa["event"], until(sa)), ["nws_live", "ready_live"], "now"))
        elif sa and sa["shelter"] in ("indoors", "high", "cool"):
            txt = {"indoors": "Stay indoors, away from windows", "high": "Stay out of low areas and flood water", "cool": "Stay somewhere cool"}[sa["shelter"]]
            shelter_rows.append(row(pid, "warn", "%s: %s %s." % (txt, sa["event"], until(sa)), ["nws_live", "ready_live"], sa["shelter"]))
        elif sa:
            shelter_rows.append(row(pid, "warn", "Be ready to shelter: %s %s. Pick your spot (lowest floor, interior room) now." % (sa["event"], until(sa)), ["nws_live", "ready_live"], "ready"))
        else:
            shelter_rows.append(row(pid, "ok", "No need to shelter.", ["nws_live"]))

    point_info = {r["place"]["id"]: {"state": (r["point"] or {}).get("state")} for r in results}
    power_data, pend = MD.power_info(places, point_info)
    extra_pending = extra_pending or pend
    new_rows = []
    for base in power_rows:
        pid = base["place"]
        p = next(x for x in places if x["id"] == pid)
        info = power_data["byPlace"].get(pid) or {}
        utils_all = info.get("utilities", [])
        in_odin = [u["name"] for u in utils_all if u["inOdin"]]
        not_odin = [u["name"] for u in utils_all if not u["inOdin"]][:2]
        unames = join_names(in_odin[:2]) or "your utility"
        near_lsr = [r for r in lsr if r["power"] and MD.miles(p["lat"], p["lng"], r["lat"], r["lng"]) <= 10]
        near_posts = POSTS.nearby(p["lat"], p["lng"], radius_mi=5, categories=("Power",))
        tone, src, parts = base["tone"], list(base["sourceIds"]), []
        co = info.get("countyOut")
        if info.get("covered"):
            src = ["odin_live"] + [s for s in src if s != "outages_live"]
            if co and co["out"]:
                tone = "bad" if co["out"] >= 500 else "warn"
                parts.append("%s customers without power in %s County (%s, reported to the federal ODIN system)." % (format(co["out"], ","), co["county"], unames))
            else:  # ODIN lists only counties with outages, so no entry means none reported
                parts.append("%s reports no outages here (federal ODIN data)." % unames)
            parts.append(base["text"].split(". Live outages")[0].split(". Check your")[0].rstrip(".") + ".")
            if not_odin:
                parts.append("If your power comes from %s, check its outage map instead." % " or ".join(not_odin))
        else:
            parts.append(base["text"].split(" Live outages")[0].split(" Check your")[0])
            if not_odin:
                parts.append("No live outage data: %s %s share outages publicly, so check the outage map." % (
                    " and ".join(not_odin), "doesn't" if len(not_odin) == 1 else "don't"))
        if near_lsr:
            tone = "bad" if tone == "bad" else "warn"
            r = near_lsr[0]
            parts.append("NWS storm report: %s near %s (%s)." % ((r["remark"] or r["label"])[:90].rstrip("."), r["city"], r["source"] or "NWS"))
            src.append("lsr_live")
        if near_posts:
            tone = "bad" if tone == "bad" else "warn"
            parts.append("%d neighbor post%s about power within 5 mi (unverified)." % (len(near_posts), "s" if len(near_posts) > 1 else ""))
            src.append("posts_live")
        new_rows.append(row(pid, tone, " ".join(parts), list(dict.fromkeys(src))))
    power_rows = new_rows

    def worst(rows):
        order = {"bad": 2, "warn": 1, "ok": 0}
        return max(rows, key=lambda r: order[r["tone"]])

    def pnames(rows, tone):
        return join_names(name[r["place"]] for r in rows if r["tone"] == tone)

    w = worst(power_rows)
    any_odin = any(v.get("covered") for v in power_data["byPlace"].values())
    any_out = any((v.get("countyOut") or {}).get("out") for v in power_data["byPlace"].values() if v.get("covered"))
    power = {"tone": w["tone"],
             "headline": "Outages reported" if any_out else {"bad": "Outages likely", "warn": "Outages possible", "ok": "Low outage risk"}[w["tone"]],
             "sub": ((pnames(power_rows, w["tone"]) + " · ") if w["tone"] != "ok" else "") + ("Live data: ODIN" if any_odin else "Live outages: utility map"),
             "rows": power_rows}
    w = worst(water_rows)
    water = {"tone": w["tone"], "headline": "Flood alert" if w["tone"] != "ok" else "No flood alerts",
             "sub": "Boil-water notices: your utility", "rows": water_rows}
    w = worst(road_rows)
    roads = {"tone": w["tone"], "headline": {"bad": "Don't drive now", "warn": "Drive with care", "ok": "No weather hazards"}[w["tone"]],
             "sub": (pnames(road_rows, w["tone"]) if w["tone"] != "ok" else "Next 12 hours") + " · closures: 511", "rows": road_rows}
    hs = next(r for r in shelter_rows if r["place"] == here["id"]) if here["id"] in ids else worst(shelter_rows)
    w = worst(shelter_rows)
    shelter = {"tone": w["tone"], "now": here["id"],
               "headline": "Shelter now" if hs["tone"] == "bad" else ({"indoors": "Stay indoors", "high": "Avoid low areas", "cool": "Stay cool"}.get(hs.get("kind"), "Be ready") if hs["tone"] == "warn" else ("Check your places" if w["tone"] != "ok" else "No need to shelter")),
               "sub": hs["text"].split(":")[0] if hs["tone"] != "ok" else ("Alerts at " + pnames(shelter_rows, w["tone"]) if w["tone"] != "ok" else "No shelter alerts at your places"),
               "rows": shelter_rows}

    # ---- public buildings near the first three places
    public = []
    seen = set()
    for p, lst in zip(places[:3], publics):
        near = sorted(lst, key=lambda x: miles(p["lat"], p["lng"], x["lat"], x["lng"]))
        k = 0
        for x in near:
            if x["osm"] in seen:
                continue
            d = miles(p["lat"], p["lng"], x["lat"], x["lng"])
            seen.add(x["osm"])
            public.append({
                "id": "osm_" + x["osm"].replace("/", "_"), "name": x["name"], "kind": x["kind"], "near": p["id"],
                "distance": "%.1f mi from %s" % (d, p["name"]), "walk": "%d min walk" % max(1, round(d / 3.0 * 60)),
                "hours": x["hours"] or "Hours not listed", "power": None, "water": None,
                "notes": x["kind"] + (" · " + x["addr"] if x["addr"] else "") + " · not an official shelter, call ahead",
                "phone": x["phone"], "lat": x["lat"], "lng": x["lng"], "sourceIds": ["osm_live"],
            })
            k += 1
            if k >= 4:
                break

    # ---- summary fallback (used when the AI is off)
    o = outlook(here["id"])
    if primary:
        fallback = "%s for %s %s. %s" % (primary["event"], join_names(name[i] for i in ids if i in primary["places"]), until(primary), action)
    else:
        fallback = "No weather alerts for your places right now."
        if o:
            fallback += " Forecast for %s: %s." % (here["name"], (o["now"] or "n/a").lower())

    # ---- alert areas: storm-based polygons, else the NWS zones/counties the alert was issued for
    warn_polys = []
    for a in alerts[:6]:
        if a["polygon"]:
            warn_polys.append({"event": a["event"], "level": a["level"], "points": a["polygon"], "zone": False})
            continue
        for z in a["zones"][:12]:
            rings, pend = MD.zone_shape(z)
            extra_pending = extra_pending or pend
            for ring in rings:
                warn_polys.append({"event": a["event"], "level": a["level"], "points": ring, "zone": True})

    pt = by_id[here["id"]]["point"] or {}
    live = {
        "id": "live", "mode": "live", "label": "Live", "level": level, "clock": fmt_clock(now),
        "date": now.strftime("%A, %B ") + str(now.day), "fetchedAt": now.isoformat(),
        "banner": banner, "action": action, "dontDrive": bool(dont_drive), "alertText": alert_text, "severity": severity,
        "timeline": timeline,
        "impacts": {"power": power, "water": water, "roads": roads, "shelter": shelter},
        "storm": None, "warnPolygon": None, "outages": [], "roadMarks": [], "routeHome": None,
        "warnPolygons": warn_polys,
        "alerts": [{k: a[k] for k in ("event", "headline", "severity", "level", "places", "sender", "area")} for a in alerts[:10]],
        "summaryFallback": fallback,
        "forecast": fc,
        "publicPlaces": public,
        "publicPending": public_pending or extra_pending,
        "stormReports": lsr,
        "stormTrack": track,
        "power": power_data,
        "mapPosts": [p for pl in places[:3] for p in POSTS.nearby(pl["lat"], pl["lng"], radius_mi=15, limit=40,
                                                                  categories=("Road", "Power", "Flooding", "Damage"))],
        "radarTime": MD.radar_time(),
        "placeInfo": {r["place"]["id"]: {"city": (r["point"] or {}).get("city"), "state": (r["point"] or {}).get("state")} for r in results},
        "hereCity": ", ".join(x for x in (pt.get("city"), pt.get("state")) if x),
        "sources": LIVE_SOURCES,
        "errors": errors,
    }
    # Stable fingerprint of what the AI summary depends on (not the clock), so summaries are re-used.
    live["digest"] = hashlib.sha1(json.dumps([banner, action, [t["text"] for t in timeline],
                                              {k: v["headline"] for k, v in live["impacts"].items()}],
                                             sort_keys=True).encode()).hexdigest()[:12]
    live["_places"] = places  # used by the server for the AI prompt; stripped before sending
    return live


# --------------------------------------------------------------------------- AI grounding for live mode
LIVE_SYSTEM = """You are WeatherBoy, the assistant inside a severe-weather phone app.

Your job:
1. Explain the LIVE official weather data below for the user's own places, in plain, calm language (8th-grade reading level).
2. Help the user use the app (see APP GUIDE).

Hard rules:
- Use ONLY facts in LIVE DATA. Never invent alerts, times, numbers or sources. You explain official information; you are not a forecaster.
- Power: LIVE DATA "power" has county outage counts ONLY where the utility reports to the federal ODIN system ("covered": true). Otherwise there is no live outage data: give the weather-based risk plus any NWS storm reports or neighbor posts, and name the outage map to check. Never claim a specific home has or lacks power.
- There is NO live data for boil-water notices or road closures. Use NWS storm reports (flooding, trees down) and alerts, and point to the water utility or 511. Neighbor posts are unverified.
- Public buildings in LIVE DATA come from OpenStreetMap: they are not official shelters and their hours, power and water are unconfirmed.
- If the data does not answer the question, say so plainly and point to the most relevant official source (or 911 for an emergency).
- When the user's safety is at stake, lead with the action they should take.
- The user is at "{here}"{city}. Saved places: {places}. Local time now: {clock}, {date}.
- Put the id of every source you relied on in "sourceIds" (ids from SOURCES only). Don't write URLs in the answer.
- "answer" formatting: short paragraphs; lines starting with "- " for bullets; **double asterisks** for the key action. No headings with #. Keep it under {max_words} words unless the instructions below say otherwise.
- "severity": an integer 1-5 ONLY when the question is about danger or severity (5 = life-threatening now, 1 = no threat); otherwise null.
- "followUps": 2-3 short questions the user might ask next (max 8 words each).

USER STATE: {user_state}

SOURCES (id: name, kind):
{sources}

APP GUIDE:
{guide}

LIVE DATA (fetched {clock}):
{data}
"""

LIVE_FMT = {
    "meaning": "Format: first line in **bold**: what the current alerts mean in one sentence (or that there are none). If there is a watch or warning, add a bullet 'Watch vs. warning:' with a one-line explanation. Then 'For you:' with one bullet per saved place. End with the single most important action in **bold**.",
    "power_water": "Format: a line '**Power**' then one bullet per saved place with the weather-based outage risk; then a line '**Water**' with one bullet per place. Make clear the app can't see live outages or boil-water notices and name where to check. Up to 120 words.",
    "shelter": "Format: first line in **bold**: whether the user needs to shelter right now and where (type of room), based on the alerts at their place. Then 2-4 bullets of specific steps. If a public building is listed nearby, mention at most one and say it is not an official shelter. If a warning is active, remind them not to travel during it.",
    "drive": "Format: start with **Yes**, **No** or **Use caution** in bold followed by a one-sentence reason from the alerts and forecast. Then bullets of weather hazards along the way and when conditions improve if the data says. Remind them to check 511 for closures.",
    "changed": "Format: bullets, newest first: alerts issued recently (time first) and then what the forecast shows for the next few hours, each saying what it means for the user.",
}


def build_system_live(live, user_state, guide, max_words=90):
    places = live.get("_places") or []
    here = places[0]["name"] if places else "Unknown"
    view = {k: v for k, v in live.items() if k not in ("warnPolygons", "sources", "_places", "storm", "warnPolygon",
                                                        "outages", "roadMarks", "routeHome", "digest", "fetchedAt", "placeInfo")}
    view["publicPlaces"] = [{k: p[k] for k in ("name", "kind", "near", "distance", "hours")} for p in live.get("publicPlaces", [])[:8]]
    for k in ("mapPosts", "radarTime", "publicPending", "errors"):
        view.pop(k, None)
    view["stormReports"] = [{k: r[k] for k in ("label", "magnitude", "city", "source", "remark", "time", "distanceMi")} for r in live.get("stormReports", [])[:10]]
    pw = live.get("power") or {}
    view["power"] = {"byPlace": pw.get("byPlace"), "whereToCheck": [l["label"] for l in pw.get("links", [])],
                     "note": "Counts come from ODIN only for utilities that report to it; otherwise there is no live outage data."}
    srcs = "\n".join("- %s: %s (%s)" % (k, v["name"], v["kind"]) for k, v in LIVE_SOURCES.items())
    return LIVE_SYSTEM.format(
        here=here, city=(" (" + live["hereCity"] + ")") if live.get("hereCity") else "",
        places=", ".join(p["name"] for p in places), clock=live["clock"], date=live["date"], max_words=max_words,
        user_state=json.dumps(user_state or {}), sources=srcs, guide="\n".join("- " + g for g in guide),
        data=json.dumps(view),
    )
