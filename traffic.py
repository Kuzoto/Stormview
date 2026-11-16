"""
Live traffic from TomTom (optional: set TOMTOM_API_KEY in .env; everything else works without it).

  - Incident Details v5 (closures, crashes, roadworks, flooding, jams) for the area around the user's places.
    Free tier: 2,500 requests / MONTH, so results are cached ~25 min per area and shared by every phone,
    with a monthly cap (TOMTOM_INCIDENT_MONTHLY, default 2300) after which the last result is reused.
  - Raster Flow Tiles v4 (roads colored by speed). Free tier: 200,000 tiles / month. Tiles are proxied by
    our server (/api/tiles/flow/z/x/y.png) so the key never reaches phones, cached for a few minutes, and
    capped at TOMTOM_TILE_MONTHLY (default 190000).

Docs: https://docs.tomtom.com/traffic-api/documentation/tomtom-maps/traffic-incidents/incident-details
      https://docs.tomtom.com/traffic-api/documentation/tomtom-maps/traffic-flow/raster-flow-tiles
"""
import json
import math
import os
import sys
import threading
import time
import urllib.parse
import urllib.error
import urllib.request
from collections import OrderedDict

import mapdata as MD

ROOT = os.path.dirname(os.path.abspath(__file__))
USAGE_PATH = os.path.join(ROOT, "logs", "_tomtom_usage.json")
KEY = os.environ.get("TOMTOM_API_KEY", "").strip()
BASE = os.environ.get("TOMTOM_BASE_URL", "https://api.tomtom.com").rstrip("/")
INCIDENT_MONTHLY = int(os.environ.get("TOMTOM_INCIDENT_MONTHLY", "2300"))
TILE_MONTHLY = int(os.environ.get("TOMTOM_TILE_MONTHLY", "190000"))
INCIDENT_TTL = int(os.environ.get("TOMTOM_INCIDENT_CACHE_S", "1500"))  # 25 min
FLOW_STYLE = "relative0"

ICON = {  # iconCategory -> (kind, label)
    0: ("other", "Traffic incident"), 1: ("accident", "Crash"), 2: ("fog", "Fog"), 3: ("danger", "Dangerous conditions"),
    4: ("rain", "Rain"), 5: ("ice", "Ice"), 6: ("jam", "Traffic jam"), 7: ("lane", "Lane closed"), 8: ("closed", "Road closed"),
    9: ("works", "Road works"), 10: ("wind", "Wind"), 11: ("flood", "Flooding"), 14: ("breakdown", "Broken-down vehicle"),
}
MAGNITUDE = {0: "", 1: "minor", 2: "moderate", 3: "major", 4: ""}
FIELDS = ("{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code,iconCategory},"
          "startTime,endTime,from,to,length,delay,roadNumbers,timeValidity,probabilityOfOccurrence,lastReportTime}}}")

_lock = threading.Lock()
LAST_ERROR = [None]  # shown in the researcher panel (e.g. "HTTP 403" for a bad key)


def enabled():
    return bool(KEY)


# --------------------------------------------------------------------------- monthly usage guard
def _usage():
    try:
        with open(USAGE_PATH) as f:
            u = json.load(f)
    except (OSError, ValueError):
        u = {}
    month = time.strftime("%Y-%m")
    if u.get("month") != month:
        u = {"month": month, "incidents": 0, "tiles": 0}
    return u


def _count(kind, limit):
    """Reserve one request of `kind`; False if this month's cap is reached."""
    with _lock:
        u = _usage()
        if u[kind] >= limit:
            return False
        u[kind] += 1
        os.makedirs(os.path.dirname(USAGE_PATH), exist_ok=True)
        tmp = USAGE_PATH + ".tmp"
        with open(tmp, "w") as f:
            json.dump(u, f)
        os.replace(tmp, USAGE_PATH)
        return True


def usage():
    with _lock:
        u = _usage()
    return {"enabled": enabled(), "month": u["month"], "incidents": u["incidents"], "incidentCap": INCIDENT_MONTHLY,
            "tiles": u["tiles"], "tileCap": TILE_MONTHLY, "lastError": LAST_ERROR[0]}


# --------------------------------------------------------------------------- incidents
def _bbox(places, pad_km=12):
    lats = [p["lat"] for p in places]
    lngs = [p["lng"] for p in places]
    dlat = pad_km / 111.0
    dlng = pad_km / (111.0 * max(0.2, math.cos(math.radians(sum(lats) / len(lats)))))
    # Snap outward to a 0.05° grid so nearby users share one cached request.
    snap = lambda v, up: (math.ceil if up else math.floor)(v / 0.05) * 0.05
    return (round(snap(min(lngs) - dlng, False), 2), round(snap(min(lats) - dlat, False), 2),
            round(snap(max(lngs) + dlng, True), 2), round(snap(max(lats) + dlat, True), 2))


def _area_km2(b):
    w = (b[2] - b[0]) * 111.0 * math.cos(math.radians((b[1] + b[3]) / 2))
    h = (b[3] - b[1]) * 111.0
    return abs(w * h)


class BudgetError(Exception):
    pass


def _fetch_incidents(bbox):
    if not _count("incidents", INCIDENT_MONTHLY):
        raise BudgetError("monthly TomTom incident limit reached")
    q = urllib.parse.urlencode({"key": KEY, "bbox": ",".join(str(v) for v in bbox), "fields": FIELDS,
                                "language": "en-US", "timeValidityFilter": "present"})
    req = urllib.request.Request(BASE + "/traffic/services/5/incidentDetails?" + q, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            j = json.load(r)
    except urllib.error.HTTPError as e:
        LAST_ERROR[0] = "HTTP %d%s" % (e.code, " (check TOMTOM_API_KEY)" if e.code in (401, 403) else "")
        raise
    except Exception as e:
        LAST_ERROR[0] = type(e).__name__
        raise
    LAST_ERROR[0] = None
    out = []
    for f in j.get("incidents") or []:
        if not f:
            continue
        p = f.get("properties") or {}
        g = f.get("geometry") or {}
        coords = g.get("coordinates") or []
        if g.get("type") == "Point":
            line = [[coords[1], coords[0]]] if len(coords) >= 2 else []
        else:
            line = [[c[1], c[0]] for c in coords if len(c) >= 2]
        if not line:
            continue
        line = MD.simplify_ring(line, 60)
        kind, label = ICON.get(p.get("iconCategory"), ICON[0])
        events = [e.get("description") for e in (p.get("events") or []) if e.get("description")]
        mid = line[len(line) // 2]
        out.append({
            "id": str(p.get("id") or "")[:80], "kind": kind, "label": label, "closed": kind == "closed",
            "magnitude": MAGNITUDE.get(p.get("magnitudeOfDelay"), ""), "description": "; ".join(dict.fromkeys(events))[:160],
            "from": (p.get("from") or "")[:80], "to": (p.get("to") or "")[:80], "roads": (p.get("roadNumbers") or [])[:3],
            "delayMin": round((p.get("delay") or 0) / 60), "lengthMi": round((p.get("length") or 0) / 1609.34, 1),
            "start": p.get("startTime"), "end": p.get("endTime"), "lat": mid[0], "lng": mid[1], "line": line if len(line) > 1 else None,
        })
    return {"incidents": out, "fetchedAt": time.time()}


def incidents(places):
    """Returns (data or None, pending). data = {"incidents": [...], "fetchedAt": t}."""
    if not enabled() or not places:
        return None, False
    bbox = _bbox(places)
    if _area_km2(bbox) > 9500:  # API limit is 10,000 km2: fall back to the user's own place only
        bbox = _bbox(places[:1])
    return MD.bg_cached(("tomtom_inc",) + bbox, INCIDENT_TTL, lambda: _fetch_incidents(bbox), fail_ttl=300)


def nearby(places, radius_mi=15):
    data, pending = incidents(places)
    if not data:
        return {"enabled": enabled(), "incidents": [], "updated": None, "pending": pending}, pending
    out = []
    for inc in data["incidents"]:
        pts = inc["line"] or [[inc["lat"], inc["lng"]]]
        best = min(((MD.miles(p["lat"], p["lng"], q[0], q[1]), p["id"]) for p in places for q in pts[:: max(1, len(pts) // 8)] + [pts[-1]]))
        if best[0] <= radius_mi:
            out.append(dict(inc, distanceMi=round(best[0], 1), near=best[1]))
    rank = {"closed": 0, "flood": 1, "accident": 2, "danger": 3, "ice": 3}
    out.sort(key=lambda i: (rank.get(i["kind"], 5), i["distanceMi"]))
    return {"enabled": True, "incidents": out[:60], "updated": data["fetchedAt"], "pending": pending}, pending


# --------------------------------------------------------------------------- flow tile proxy
_tiles = OrderedDict()  # (z, x, y) -> (time, bytes)
TILE_TTL = 180


def flow_tile(z, x, y):
    """PNG bytes for a flow tile, or (None, http_status)."""
    if not enabled():
        return None, 404
    if not (3 <= z <= 18 and 0 <= x < 2 ** z and 0 <= y < 2 ** z):
        return None, 400
    key = (z, x, y)
    now = time.time()
    with _lock:
        hit = _tiles.get(key)
        if hit and now - hit[0] < TILE_TTL:
            _tiles.move_to_end(key)
            return hit[1], 200
    if not _count("tiles", TILE_MONTHLY):
        return (hit[1], 200) if hit else (None, 429)
    url = "%s/traffic/map/4/tile/flow/%s/%d/%d/%d.png?%s" % (BASE, FLOW_STYLE, z, x, y, urllib.parse.urlencode({"key": KEY, "tileSize": 256}))
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            body = r.read()
    except Exception as e:
        sys.stderr.write("[tomtom tile] %r\n" % e)
        return (hit[1], 200) if hit else (None, 502)
    with _lock:
        _tiles[key] = (now, body)
        while len(_tiles) > 3000:
            _tiles.popitem(last=False)
    return body, 200
