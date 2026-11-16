"""
Extra live map data (all free, no API keys):

  - NWS Local Storm Reports (via Iowa Environmental Mesonet): trees/power lines down, flooding, tornadoes,
    hail, snow... from spotters, emergency managers and the public, with location and time.
  - NWS forecast-zone shapes, so alerts issued by county/zone (watches, winter storms, floods) can be drawn.
  - Storm motion from warnings (eventMotionDescription): current position, projected path, arrival times.
  - Radar frame time (IEM NEXRAD composite).
  - Power outages from DOE/ORNL ODIN (county level, anonymous public feed), with the utility that serves
    each place looked up in the EIA/HIFLD electric retail service territory layer. Utilities that don't
    report to ODIN (e.g. DTE) get a fallback: neighbor posts + NWS reports + links to local outage maps.

Slow or flaky lookups run in the background (bg_cached) so a page load never waits on them.
"""
import json
import math
import re
import sys
import threading
import time
import urllib.parse
from datetime import datetime, timedelta, timezone

import live as LIVE  # shares the HTTP helper, cache and User-Agent

_get = lambda url, **kw: LIVE._get(url, **kw)

# --------------------------------------------------------------------------- background cache
_bg_lock = threading.Lock()
_bg = {}          # key -> (time, value, ok)
_bg_pending = set()


def bg_cached(key, ttl, fn, fail_ttl=120):
    """Return (value, pending). Never blocks: misses start a background fetch and return the stale value."""
    now = time.time()
    with _bg_lock:
        hit = _bg.get(key)
        if hit and now - hit[0] < (ttl if hit[2] else fail_ttl):
            return hit[1], False
        if key not in _bg_pending:
            _bg_pending.add(key)

            def run():
                try:
                    val, ok = fn(), True
                except Exception as e:
                    sys.stderr.write("[mapdata %s] %r\n" % (key[0], e))
                    val, ok = (hit[1] if hit else None), False
                with _bg_lock:
                    _bg[key] = (time.time(), val, ok)
                    _bg_pending.discard(key)
            threading.Thread(target=run, daemon=True).start()
    return (hit[1] if hit else None), True


def wait_for(keys, timeout):
    """Give background fetches a short head start (used on the very first request)."""
    end = time.time() + timeout
    while time.time() < end:
        with _bg_lock:
            if not any(k in _bg_pending for k in keys):
                return
        time.sleep(0.1)


# --------------------------------------------------------------------------- geometry helpers
def simplify_ring(ring, max_pts=120):
    if len(ring) <= max_pts:
        return ring
    step = len(ring) / float(max_pts)
    out = [ring[int(i * step)] for i in range(max_pts)]
    out.append(ring[-1])
    return out


def geojson_rings(geom, max_pts=120):
    """GeoJSON Polygon/MultiPolygon -> list of outer rings as [[lat, lng], ...]."""
    if not geom:
        return []
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"] if geom["type"] == "MultiPolygon" else []
    rings = []
    for poly in polys:
        if poly and poly[0]:
            rings.append([[round(c[1], 4), round(c[0], 4)] for c in simplify_ring(poly[0], max_pts)])
    return rings


def miles(a_lat, a_lng, b_lat, b_lng):
    return LIVE.miles(a_lat, a_lng, b_lat, b_lng)


def destination(lat, lng, bearing_deg, dist_mi):
    r = 3958.8
    br, d = math.radians(bearing_deg), dist_mi / r
    p1, l1 = math.radians(lat), math.radians(lng)
    p2 = math.asin(math.sin(p1) * math.cos(d) + math.cos(p1) * math.sin(d) * math.cos(br))
    l2 = l1 + math.atan2(math.sin(br) * math.sin(d) * math.cos(p1), math.cos(d) - math.sin(p1) * math.sin(p2))
    return round(math.degrees(p2), 4), round(math.degrees(l2), 4)


def bearing(a_lat, a_lng, b_lat, b_lng):
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dl = math.radians(b_lng - a_lng)
    x = math.sin(dl) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]


def compass(deg):
    return COMPASS[int((deg + 22.5) // 45) % 8]


# --------------------------------------------------------------------------- NWS zones (alert areas)
def zone_shape(url):
    """Shape of an NWS zone/county (cached a week). Returns (rings, pending)."""
    if not re.match(r"^https://api\.weather\.gov/zones/[a-z]+/[A-Z]{2}[CZ]\d{3}$", url or ""):
        return [], False

    def f():
        return geojson_rings(_get(url).get("geometry"), 100)
    val, pending = bg_cached(("zone", url), 7 * 86400, f, fail_ttl=600)
    return val or [], pending


# --------------------------------------------------------------------------- storm motion
MOTION_RE = re.compile(r"^(?P<t>[0-9T:\-+Z.]+)\.\.\.(?P<what>[^.]*)\.\.\.(?P<deg>\d+)DEG\.\.\.(?P<kt>\d+)KT\.\.\.(?P<pts>[\d ]+)$")


def storm_track(alert, places, now):
    """Parse eventMotionDescription, e.g. '2026-05-12T23:32:00-00:00...storm...240DEG...30KT...4221 8387'.
    DEG is the direction the storm is moving FROM. Returns position now, a 60-min path and ETAs."""
    for desc in alert.get("motion") or []:
        m = MOTION_RE.match(desc.strip())
        if not m:
            continue
        try:
            t0 = datetime.fromisoformat(m.group("t").replace("Z", "+00:00"))
        except ValueError:
            continue
        nums = [int(x) for x in m.group("pts").split()]
        pts = [(nums[i] / 100.0, -nums[i + 1] / 100.0) for i in range(0, len(nums) - 1, 2)]
        if not pts:
            continue
        lat0 = sum(p[0] for p in pts) / len(pts)
        lng0 = sum(p[1] for p in pts) / len(pts)
        heading = (int(m.group("deg")) + 180) % 360
        mph = int(m.group("kt")) * 1.15078
        mins_since = max(0.0, (now - t0).total_seconds() / 60.0)
        lat, lng = destination(lat0, lng0, heading, mph * mins_since / 60.0) if mph else (lat0, lng0)
        path = [[lat, lng]] + [list(destination(lat, lng, heading, mph * k / 60.0)) for k in (15, 30, 45, 60)]
        etas = []
        for p in places:
            d = miles(lat, lng, p["lat"], p["lng"])
            if d < 1:
                etas.append({"place": p["id"], "name": p["name"], "minutes": 0, "text": "over %s now" % p["name"]})
                continue
            off = (bearing(lat, lng, p["lat"], p["lng"]) - heading + 540) % 360 - 180  # angle off the track
            along = d * math.cos(math.radians(off))
            cross = abs(d * math.sin(math.radians(off)))
            if mph and along > 0 and cross <= 6 and along / mph <= 2:
                mins = int(round(along / mph * 60))
                etas.append({"place": p["id"], "name": p["name"], "minutes": mins, "crossMi": round(cross, 1),
                             "text": "may reach %s in about %d min" % (p["name"], mins)})
        return {"event": alert["event"], "what": m.group("what") or "storm", "lat": lat, "lng": lng,
                "heading": compass(heading), "headingDeg": heading, "mph": int(round(mph)),
                "observedAt": t0.isoformat(), "path": path, "etas": etas}
    return None


# --------------------------------------------------------------------------- NWS Local Storm Reports
LSR_KIND = [  # (match in typetext/remark, kind, label)
    ("TORNADO", "tornado", "Tornado"), ("FUNNEL", "tornado", "Funnel cloud"),
    ("FLASH FLOOD", "flood", "Flash flooding"), ("FLOOD", "flood", "Flooding"),
    ("TSTM WND DMG", "damage", "Storm wind damage"), ("NON-TSTM WND DMG", "damage", "Wind damage"),
    ("HAIL", "hail", "Hail"), ("SNOW", "snow", "Snow"), ("ICE", "snow", "Ice"), ("SLEET", "snow", "Sleet"),
    ("FREEZING", "snow", "Freezing rain"), ("BLIZZARD", "snow", "Blizzard"),
    ("WND GST", "wind", "Wind gust"), ("HIGH SUST", "wind", "High wind"), ("RAIN", "rain", "Heavy rain"),
]


def _lsr_all():
    end = datetime.now(timezone.utc)
    sts = (end - timedelta(hours=48)).strftime("%Y-%m-%dT%H:%MZ")
    ets = end.strftime("%Y-%m-%dT%H:%MZ")
    j = _get("https://mesonet.agron.iastate.edu/geojson/lsr.php?sts=%s&ets=%s" % (sts, ets), timeout=20)
    out = []
    for f in j.get("features", []):
        p = f.get("properties") or {}
        tt = (p.get("typetext") or "").upper()
        remark = (p.get("remark") or "").strip()
        kind, label = "other", tt.title()
        for k, kd, lb in LSR_KIND:
            if k in tt:
                kind, label = kd, lb
                break
        up = remark.upper()
        power = any(w in up for w in ("POWER LINE", "POWERLINE", "POWER POLE", "LINES DOWN", "WIRES DOWN", "OUTAGE", "TRANSFORMER"))
        trees = bool(re.search(r"\bTREES?\b|\bLIMBS?\b|\bBRANCH", up))
        road = trees or any(w in up for w in ("ROAD", "CLOSED", "HWY", "HIGHWAY", "STREET", "IMPASSABLE")) or kind in ("flood", "snow")
        mag = p.get("magnitude")
        out.append({
            "id": (p.get("product_id") or "") + ":" + str(p.get("lat")) + str(p.get("lon")) + tt,
            "kind": kind, "label": label, "power": power, "road": road, "trees": trees,
            "magnitude": ("%s %s" % (mag, (p.get("unit") or "").lower())).strip() if mag not in (None, "", "0", "0.00") else "",
            "city": p.get("city") or "", "county": p.get("county") or "", "state": p.get("st") or p.get("state") or "",
            "source": p.get("source") or "", "remark": remark[:240], "time": p.get("valid"),
            "lat": p.get("lat"), "lng": p.get("lon"),
        })
    return out


def storm_reports(places, radius_mi=30):
    all_, pending = bg_cached(("lsr",), 300, _lsr_all)
    out = []
    for r in all_ or []:
        if r["lat"] is None:
            continue
        d = min(miles(p["lat"], p["lng"], r["lat"], r["lng"]) for p in places)
        if d <= radius_mi:
            near = min(places, key=lambda p: miles(p["lat"], p["lng"], r["lat"], r["lng"]))
            out.append(dict(r, distanceMi=round(d, 1), near=near["id"]))
    out.sort(key=lambda r: r["time"] or "", reverse=True)
    return out[:80], pending


# --------------------------------------------------------------------------- radar time
def radar_time():
    val, _ = bg_cached(("radar",), 120, lambda: _get("https://mesonet.agron.iastate.edu/data/gis/images/4326/USCOMP/n0q_0.json")["meta"]["valid"])
    return val


# --------------------------------------------------------------------------- power: utilities + ODIN
TERRITORY_URL = "https://services3.arcgis.com/OYP7N6mAJJCyH6hd/arcgis/rest/services/Electric_Retail_Service_Territories_HIFLD/FeatureServer/0/query"
OUTAGE_MAPS = {  # EIA utility id -> (short name, outage map URL)
    "5109": ("DTE Energy", "https://outage.dteenergy.com/map"),
    "4254": ("Consumers Energy", "https://www.consumersenergy.com/outagemap"),
    "733": ("Appalachian Power", "https://www.appalachianpower.com/outages/"),
}
STATES = {"AL": "alabama", "AK": "alaska", "AZ": "arizona", "AR": "arkansas", "CA": "california", "CO": "colorado",
          "CT": "connecticut", "DE": "delaware", "DC": "district-of-columbia", "FL": "florida", "GA": "georgia", "HI": "hawaii",
          "ID": "idaho", "IL": "illinois", "IN": "indiana", "IA": "iowa", "KS": "kansas", "KY": "kentucky", "LA": "louisiana",
          "ME": "maine", "MD": "maryland", "MA": "massachusetts", "MI": "michigan", "MN": "minnesota", "MS": "mississippi",
          "MO": "missouri", "MT": "montana", "NE": "nebraska", "NV": "nevada", "NH": "new-hampshire", "NJ": "new-jersey",
          "NM": "new-mexico", "NY": "new-york", "NC": "north-carolina", "ND": "north-dakota", "OH": "ohio", "OK": "oklahoma",
          "OR": "oregon", "PA": "pennsylvania", "RI": "rhode-island", "SC": "south-carolina", "SD": "south-dakota",
          "TN": "tennessee", "TX": "texas", "UT": "utah", "VT": "vermont", "VA": "virginia", "WA": "washington",
          "WV": "west-virginia", "WI": "wisconsin", "WY": "wyoming"}


def clean_name(n):
    n = re.sub(r"\s*-\s*\([A-Z]{2}\)$", "", n or "").title()
    n = re.sub(r"\b(Of|And|The)\b", lambda m: m.group(1).lower(), n)
    return re.sub(r"\b(Co|Inc|Corp)\b\.?", lambda m: m.group(1) + ".", n).replace("..", ".")


def utilities_at(lat, lng):
    """Electric utilities whose (approximate, often county-based) territory covers the point."""
    key = ("util", round(lat, 2), round(lng, 2))

    def f():
        q = urllib.parse.urlencode({"geometry": "%f,%f" % (lng, lat), "geometryType": "esriGeometryPoint", "inSR": 4326,
                                    "spatialRel": "esriSpatialRelIntersects", "outFields": "NAME,ID,STATE,TYPE",
                                    "returnGeometry": "false", "f": "json"})
        feats = _get(TERRITORY_URL + "?" + q, timeout=15).get("features", [])
        return [{"name": a["NAME"], "eiaId": str(a["ID"]), "state": a.get("STATE")} for a in (x["attributes"] for x in feats)]
    return bg_cached(key, 30 * 86400, f, fail_ttl=300)


def odin_status():
    return bg_cached(("odin_status",), 300, lambda: _get("https://odin.ornl.gov/odi/status", timeout=20))


def odin_counties(min_lat, min_lng, max_lat, max_lng):
    b = [math.floor(min_lat) - 1, math.floor(min_lng) - 1, math.ceil(max_lat) + 1, math.ceil(max_lng) + 1]

    def f():
        q = urllib.parse.urlencode({"scale": "COUNTY", "minx": b[1], "maxx": b[3], "miny": b[0], "maxy": b[2]})
        out = []
        for x in _get("https://odin.ornl.gov/odi/map?" + q, timeout=30):
            utils = [{"name": o.get("utilityName"), "eiaId": str(o.get("utilityId")), "out": o.get("metersOut") or 0,
                      "served": o.get("metersServed")} for o in x.get("outages") or []]
            out.append({"county": x.get("countyName"), "state": x.get("stateName"), "out": x.get("metersOut") or 0,
                        "utilities": utils, "rings": geojson_rings(x.get("feature"), 80)})
        return out
    return bg_cached(("odin_map",) + tuple(b), 300, f)


def _in_ring(lat, lng, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        yi, xi = ring[i]
        yj, xj = ring[j]
        if (yi > lat) != (yj > lat) and lng < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def power_info(places, point_info):
    """Per place: which utility, whether it reports to ODIN, and ODIN county outages. Plus fallback links."""
    status, p1 = odin_status()
    reporting = {str(u.get("eiaId")): u for u in (status or [])}
    lats = [p["lat"] for p in places]
    lngs = [p["lng"] for p in places]
    counties, p2 = odin_counties(min(lats), min(lngs), max(lats), max(lngs))
    pending = p1 or p2
    by_place, links, seen_links = {}, [], set()

    def add_link(label, url):
        if url not in seen_links:
            seen_links.add(url)
            links.append({"label": label, "url": url})

    for p in places:
        utils, pu = utilities_at(p["lat"], p["lng"])
        pending = pending or pu
        utils = utils or []
        for u in utils:
            u["inOdin"] = u["eiaId"] in reporting
        reporting_utils = [u for u in utils if u["inOdin"]]
        county = next((c for c in counties or [] if any(_in_ring(p["lat"], p["lng"], r) for r in c["rings"])), None)
        county_out = None
        if county:
            mine = [u for u in county["utilities"] if u["eiaId"] in {x["eiaId"] for x in reporting_utils}] or county["utilities"]
            county_out = {"county": county["county"], "out": sum(u["out"] for u in mine), "utilities": mine}
        st = (point_info.get(p["id"]) or {}).get("state")
        # Territories are often drawn by county, so a point can match several utilities. Known/ODIN ones first.
        utils.sort(key=lambda u: (u["eiaId"] not in OUTAGE_MAPS and not u["inOdin"]))
        by_place[p["id"]] = {
            "utilities": [{"name": OUTAGE_MAPS.get(u["eiaId"], (clean_name(u["name"]),))[0], "eiaId": u["eiaId"], "inOdin": u["inOdin"]} for u in utils],
            "covered": bool(reporting_utils), "countyOut": county_out, "state": st,
        }
        for u in utils:
            if u["eiaId"] in OUTAGE_MAPS:
                add_link("%s outage map" % OUTAGE_MAPS[u["eiaId"]][0], OUTAGE_MAPS[u["eiaId"]][1])
        if st in STATES:
            add_link("PowerOutage.us · %s" % STATES[st].replace("-", " ").title(), "https://poweroutage.us/area/state/" + STATES[st])
    add_link("PowerOutage.us · all utilities", "https://poweroutage.us/")
    areas = [{"county": c["county"], "state": c["state"], "out": c["out"], "rings": c["rings"],
              "utilities": [u["name"].title() for u in c["utilities"] if u["out"]]} for c in (counties or []) if c["out"]]
    return {"byPlace": by_place, "areas": areas, "links": links, "odinOk": status is not None}, pending
