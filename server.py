#!/usr/bin/env python3
"""
Severe-weather app prototype server (Python 3.8+ standard library only, no pip installs).

  python3 server.py                 # http://0.0.0.0:8000
  python3 server.py --port 9000
  python3 server.py --https         # self-signed HTTPS (see README for caveats)

Serves the PWA in ./static and these JSON endpoints:
  GET  /api/health                 -> LLM availability, model, spend so far
  POST /api/chat                   -> WeatherBoy answer grounded in scenario.json
  GET  /api/summary?phase=<id>     -> AI-written personal summary for a phase (cached)
  GET  /api/nws                    -> live NWS hourly forecast for Ann Arbor (real data)
  POST /api/live                   -> LIVE mode: real NWS alerts/forecast for the user's places (live.py)
  POST /api/live/summary           -> AI summary of the live data (cached per data fingerprint)
  GET  /api/geocode?q=             -> address / city search for My Places
  GET  /api/posts?lat=&lng=        -> shared Neighbor Reports near a point (posts.py)
  POST /api/posts                  -> create a post (optional photo); DELETE /api/posts/<id> (author token)
  POST /api/posts/<id>/report      -> flag a post (hidden after 3 reports)
  GET  /photos/<id>.jpg            -> uploaded post photos
  POST /api/log                    -> append study events to logs/<participant>.jsonl
  GET  /api/logs                   -> list participants with logs
  GET  /api/logs/<pid>.csv|.jsonl  -> download a participant's events
"""
import argparse
import csv
import hashlib
import io
import json
import os
import re
import ssl
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

import live as LIVE
import posts as POSTS

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(ROOT, "static")
LOGS = os.path.join(ROOT, "logs")
SCENARIO_PATH = os.path.join(STATIC, "data", "scenario.json")
USAGE_PATH = os.path.join(LOGS, "_usage.json")
SUMMARY_CACHE_PATH = os.path.join(LOGS, "_summary_cache.json")
os.makedirs(LOGS, exist_ok=True)


# --------------------------------------------------------------------------- config
def load_env(path):
    if not os.path.exists(path):
        return
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


load_env(os.path.join(ROOT, ".env"))
API_KEY = os.environ.get("OPENAI_API_KEY", "").strip()
MODEL = os.environ.get("OPENAI_MODEL", "gpt-4.1-mini").strip()
BASE_URL = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
REASONING_EFFORT = os.environ.get("OPENAI_REASONING_EFFORT", "").strip()  # only for reasoning models
BUDGET_USD = float(os.environ.get("BUDGET_USD", "9.50"))
PRICE_IN = float(os.environ.get("PRICE_IN_PER_M", "0.40"))     # USD per 1M input tokens
PRICE_OUT = float(os.environ.get("PRICE_OUT_PER_M", "1.60"))   # USD per 1M output tokens
RATE_PER_MIN = int(os.environ.get("RATE_PER_MIN", "30"))
NWS_UA = os.environ.get("NWS_USER_AGENT", "cse593-weather-prototype (student project)")
LIVE.UA = NWS_UA


def load_scenario():
    with open(SCENARIO_PATH) as f:
        return json.load(f)


SCENARIO = load_scenario()
SOURCE_IDS = list(SCENARIO["sources"].keys())
LOCK = threading.Lock()


# --------------------------------------------------------------------------- spend guard
def read_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return default


def write_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=1)
    os.replace(tmp, path)


def spent_usd():
    return read_json(USAGE_PATH, {}).get("usd", 0.0)


def record_usage(usage):
    if not usage:
        return
    with LOCK:
        u = read_json(USAGE_PATH, {"usd": 0.0, "in": 0, "out": 0, "calls": 0})
        tin = usage.get("prompt_tokens", 0)
        tout = usage.get("completion_tokens", 0)
        u["in"] += tin
        u["out"] += tout
        u["calls"] += 1
        u["usd"] = round(u["usd"] + tin / 1e6 * PRICE_IN + tout / 1e6 * PRICE_OUT, 5)
        write_json(USAGE_PATH, u)


_calls = []


def rate_ok():
    now = time.time()
    with LOCK:
        while _calls and now - _calls[0] > 60:
            _calls.pop(0)
        if len(_calls) >= RATE_PER_MIN:
            return False
        _calls.append(now)
        return True


# --------------------------------------------------------------------------- prompts
SYSTEM_BASE = """You are WeatherBoy, the assistant inside a severe-weather phone app for people in Ann Arbor, MI.

Your job:
1. Explain the official alert and local impact data below in plain, calm language (8th-grade reading level).
2. Help the user use the app (see APP GUIDE).

Hard rules:
- Use ONLY facts in SCENARIO DATA. Never invent times, places, numbers, forecasts or sources. You explain official information; you are not a forecaster.
- If the data does not answer the question, say so plainly and point to the most relevant official source (or 911 for an emergency).
- When the user's safety is at stake, lead with the action they should take.
- The user is currently at {user_location}. Saved places: Home, Work, Mom's house. Current time in the scenario: {clock}.
- Put the id of every source you relied on in "sourceIds" (ids from SOURCES only). Don't write URLs in the answer.
- "answer" formatting: short paragraphs; lines starting with "- " for bullets; **double asterisks** for the key action. No headings with #. Keep it under {max_words} words unless the instructions below say otherwise.
- "severity": an integer 1-5 ONLY when the question is about danger or severity (5 = life-threatening now, 1 = no threat); otherwise null.
- "followUps": 2-3 short questions the user might ask next (max 8 words each).

USER STATE: {user_state}

SOURCES (id: name, kind):
{sources}

APP GUIDE:
{guide}

SCENARIO DATA (current phase "{phase_label}"):
{phase_json}

SHELTER PLACES:
{shelters}

HOURLY FORECAST ({hours}):
{forecast}
"""

# Suggested-question chips -> extra formatting instructions (the model still writes the answer).
PROMPTS = {
    "meaning": {
        "q": "What does this warning mean for me?",
        "fmt": "Format: first line in **bold**: what this alert is in one sentence. Then a bullet 'Watch vs. warning:' with a one-line explanation. Then 'For you:' with one bullet each for Work (where the user is), Home and Mom's house. End with the single most important action in **bold**.",
    },
    "severity": {
        "q": "How severe is this, and how do we know?",
        "fmt": "You MUST set severity (1-5). Format: one sentence explaining why that level. Then 'How we know:' and one bullet per source, starting with ✓ for official sources and ? for community reports, saying what each source shows.",
    },
    "sources": {
        "q": "Where does this information come from?",
        "fmt": "Format: one bullet per source used in the current phase: '✓ <name>: <what it reports>' for official sources or '? <name>: <what it reports> (unverified)' for community. Then one sentence on how much to trust the combination and which claims are only community reports.",
    },
    "power_water": {
        "q": "Do I have power and water?",
        "fmt": "Format: a line '**Power**' followed by bullets for Home, Work, Mom's house; then a line '**Water**' followed by bullets for Home, Work, Mom's house. Then one bullet naming the nearest public place that has power and water and its hours. Up to 120 words.",
    },
    "shelter": {
        "q": "Where should I shelter?",
        "fmt": "Format: first line in **bold**: where to shelter right now given where the user is and whether the warning is active. Then 2-4 bullets of specific steps for that building. Then 'If you need power or water later:' with up to 2 bullets of the nearest public places (name, distance, hours). If the warning is active, remind them not to travel during the warning.",
    },
    "drive": {
        "q": "Is it safe to drive home?",
        "fmt": "Format: start with **Yes**, **No** or **Not yet** in bold followed by a one-sentence reason. Then bullets: roads to avoid and the recommended route if given. If not yet, say when it is expected to be safer based on the data.",
    },
    "changed": {
        "q": "What changed recently?",
        "fmt": "Format: bullets of the most recent 3 timeline updates (time first), newest first, each saying what it means for the user.",
    },
    "help_checkin": {
        "q": "How do I tell my family I'm safe?",
        "fmt": "This is an app-help question. Format: numbered steps (1., 2., 3.) using exact tab and button names from APP GUIDE. Mention their current check-in status from USER STATE.",
    },
    "help_map": {
        "q": "How do I read the map?",
        "fmt": "This is an app-help question. Format: numbered steps or bullets describing the layers and legend, using exact names from APP GUIDE. Don't describe weather details beyond one bullet.",
    },
    "help_sources": {
        "q": "How can I check where info comes from?",
        "fmt": "This is an app-help question. Format: numbered steps using exact names from APP GUIDE (source chips, ✓ vs ?, More → Sources).",
    },
}

SUMMARY_FMT = (
    "Write the personal summary shown at the top of the Home screen. Exactly 2 sentences, at most 45 words total: "
    "sentence 1 = what is happening and what to do right now; sentence 2 = the most important power/water/road fact "
    "for Home, Work or Mom's house. No bullets, no bold. severity = null. followUps = []."
)

def response_schema(source_ids):
    return {
    "type": "json_schema",
    "json_schema": {
        "name": "weatherboy_reply",
        "strict": True,
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "answer": {"type": "string"},
                "sourceIds": {"type": "array", "items": {"type": "string", "enum": list(source_ids)}},
                "severity": {"type": ["integer", "null"]},
                "followUps": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["answer", "sourceIds", "severity", "followUps"],
        },
    },
    }


RESPONSE_SCHEMA = response_schema(SOURCE_IDS)
LIVE_SCHEMA = response_schema(LIVE.LIVE_SOURCES.keys())
LIVE_GUIDE = [
    "Bottom tabs on every screen: Home, Map, Check-In, Ask/Help (this chat), More.",
    "The colored banner at the top of every screen shows the most important active alert and when it ends. Tap it for the full official alert text.",
    "Every claim has a small source chip (check mark for official, ? for community data). Tap it to see the source. More > Sources lists every source.",
    "Home > 'What this means for you' cards (Power, Water, Roads, Shelter) open details for each saved place.",
    "Home > Updates lists the alerts issued and the latest forecast outlook, newest last.",
    "Shelter card > what to do now, plus public buildings nearby (from OpenStreetMap, not official shelters) with a Directions button.",
    "Map tab > choose one layer at the top (Radar, Roads, Power, Shelters). Radar is live; the dashed red outline is an active NWS warning area. The legend explains every symbol.",
    "Check-In tab > tap 'I'm safe' or 'I need help', then confirm; it opens your phone's share sheet or text messages to send it to your people. '+ Add person' saves a contact.",
    "More > Forecast at My Places shows the live hourly temperature, chance of rain/snow and wind. More > My Places lets you add places by address or city; 'My location' uses the phone's location.",
]


def phase_by_id(pid):
    for p in SCENARIO["phases"]:
        if p["id"] == pid:
            return p
    return SCENARIO["phases"][0]


def build_system(phase, user_state, max_words=90):
    phase_view = {k: v for k, v in phase.items() if k not in ("warnPolygon", "storm", "outages", "routeHome", "summaryFallback")}
    fc = SCENARIO["forecast"]
    srcs = "\n".join("- %s: %s (%s)" % (k, v["name"], v["kind"]) for k, v in SCENARIO["sources"].items())
    shelters = json.dumps([{k: v for k, v in s.items() if k not in ("lat", "lng")} for s in SCENARIO["shelterPlaces"]])
    place = SCENARIO["places"][SCENARIO["meta"]["userLocation"]]
    return SYSTEM_BASE.format(
        user_location="%s (%s)" % (place["name"], place["addr"]),
        clock=phase["clock"],
        max_words=max_words,
        user_state=json.dumps(user_state or {}),
        sources=srcs,
        guide="\n".join("- " + g for g in SCENARIO["appGuide"]),
        phase_label=phase["label"],
        phase_json=json.dumps(phase_view),
        shelters=shelters,
        hours=", ".join(fc["hours"]),
        forecast=json.dumps(fc["places"]),
    ) + "\nIn-building shelter steps: " + json.dumps(SCENARIO["inBuilding"])


def openai_chat(messages, max_tokens=500, schema=None, valid_ids=None):
    """Call OpenAI Chat Completions with structured output. Returns (dict, error)."""
    if not API_KEY:
        return None, "no_key"
    if spent_usd() >= BUDGET_USD:
        return None, "budget"
    if not rate_ok():
        return None, "rate"
    is_reasoning = MODEL.startswith(("gpt-5", "o1", "o3", "o4"))
    body = {
        "model": MODEL,
        "messages": messages,
        "response_format": schema or RESPONSE_SCHEMA,
        "max_completion_tokens": max_tokens * (4 if is_reasoning else 1),
    }
    if REASONING_EFFORT and is_reasoning:
        body["reasoning_effort"] = REASONING_EFFORT
    if not is_reasoning:
        body["temperature"] = 0.3
    req = urllib.request.Request(
        BASE_URL + "/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Authorization": "Bearer " + API_KEY, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            data = json.load(r)
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:500]
        sys.stderr.write("[openai] HTTP %s: %s\n" % (e.code, detail))
        return None, "http_%s" % e.code
    except Exception as e:  # network, timeout
        sys.stderr.write("[openai] %r\n" % e)
        return None, "network"
    record_usage(data.get("usage"))
    try:
        msg = data["choices"][0]["message"]
        if msg.get("refusal"):
            return None, "refusal"
        out = json.loads(msg["content"])
    except Exception as e:
        sys.stderr.write("[openai] bad content %r\n" % e)
        return None, "parse"
    valid = valid_ids if valid_ids is not None else SCENARIO["sources"]
    out["sourceIds"] = [s for s in out.get("sourceIds", []) if s in valid]
    out["followUps"] = [f for f in out.get("followUps", []) if isinstance(f, str)][:3]
    sev = out.get("severity")
    out["severity"] = sev if isinstance(sev, int) and 1 <= sev <= 5 else None
    return out, None


FALLBACK_TEXT = {
    "no_key": "WeatherBoy isn't connected right now (no API key on the server). The official alert is in the banner at the top. Tap it, or open More → Sources.",
    "budget": "WeatherBoy is paused because the prototype's spending limit was reached. The official alert is in the banner at the top.",
    "rate": "WeatherBoy is getting a lot of questions. Please try again in a few seconds.",
}


def fallback(phase, err):
    text = FALLBACK_TEXT.get(err, "I couldn't reach my server just now. Here is the official alert:")
    if err not in FALLBACK_TEXT or err in ("no_key", "budget"):
        text += "\n\n**" + phase["action"] + "**\n\n" + phase["alertText"]
    return {"answer": text, "sourceIds": list(phase["banner"]["sourceIds"]), "severity": None,
            "followUps": [], "fallback": True, "error": err}


# --------------------------------------------------------------------------- summary cache
_summary_cache = read_json(SUMMARY_CACHE_PATH, {})


def get_summary(phase_id, refresh=False):
    phase = phase_by_id(phase_id)
    digest = hashlib.sha1(json.dumps(phase, sort_keys=True).encode()).hexdigest()[:10]
    key = "%s|%s|%s" % (MODEL, phase_id, digest)
    if not refresh and key in _summary_cache:
        return dict(_summary_cache[key], cached=True)
    msgs = [
        {"role": "system", "content": build_system(phase, {}, max_words=45)},
        {"role": "user", "content": SUMMARY_FMT},
    ]
    out, err = openai_chat(msgs, max_tokens=200)
    if err:
        return {"answer": phase["summaryFallback"], "sourceIds": phase["banner"]["sourceIds"], "fallback": True, "error": err}
    out = {"answer": out["answer"], "sourceIds": out["sourceIds"] or phase["banner"]["sourceIds"]}
    with LOCK:
        _summary_cache[key] = out
        write_json(SUMMARY_CACHE_PATH, _summary_cache)
    return out


# --------------------------------------------------------------------------- live mode
def live_public(live):
    return {k: v for k, v in live.items() if k != "_places"}


_live_summary = {}


def get_live_summary(places, refresh=False, tz=None):
    live = LIVE.build_live(places, "here", tz)
    key = "%s|%s|%s" % (MODEL, live["digest"], ",".join(p["name"] for p in live["_places"]))
    if not refresh and key in _live_summary:
        return dict(_live_summary[key], cached=True, digest=live["digest"])
    msgs = [{"role": "system", "content": LIVE.build_system_live(live, {}, LIVE_GUIDE, max_words=45)},
            {"role": "user", "content": SUMMARY_FMT.replace("for Home, Work or Mom's house", "for the user's saved places")}]
    out, err = openai_chat(msgs, max_tokens=200, schema=LIVE_SCHEMA, valid_ids=LIVE.LIVE_SOURCES)
    if err:
        return {"answer": live["summaryFallback"], "sourceIds": live["banner"]["sourceIds"], "fallback": True, "error": err, "digest": live["digest"]}
    out = {"answer": out["answer"], "sourceIds": out["sourceIds"] or live["banner"]["sourceIds"]}
    with LOCK:
        if len(_live_summary) > 500:
            _live_summary.clear()
        _live_summary[key] = out
    return dict(out, digest=live["digest"])


# --------------------------------------------------------------------------- live NWS (Forecast screen, scenario mode)
_nws = {"t": 0, "data": None}


def get_nws():
    if _nws["data"] and time.time() - _nws["t"] < 900:
        return _nws["data"]

    def fetch(url):
        req = urllib.request.Request(url, headers={"User-Agent": NWS_UA, "Accept": "application/geo+json"})
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.load(r)

    pts = fetch("https://api.weather.gov/points/42.2808,-83.7430")
    hourly = fetch(pts["properties"]["forecastHourly"])
    periods = hourly["properties"]["periods"][:12]
    alerts = []
    try:
        a = fetch("https://api.weather.gov/alerts/active?point=42.2808,-83.7430")
        alerts = [{"event": f["properties"]["event"], "headline": f["properties"].get("headline")} for f in a.get("features", [])]
    except Exception:
        pass
    data = {
        "updated": hourly["properties"].get("updateTime") or hourly["properties"].get("generatedAt"),
        "alerts": alerts,
        "periods": [{
            "start": p["startTime"], "temp": p["temperature"], "unit": p["temperatureUnit"],
            "wind": p["windSpeed"], "dir": p["windDirection"], "short": p["shortForecast"],
            "pop": (p.get("probabilityOfPrecipitation") or {}).get("value"),
        } for p in periods],
    }
    _nws.update(t=time.time(), data=data)
    return data


# --------------------------------------------------------------------------- logs
SAFE_PID = re.compile(r"[^A-Za-z0-9_-]")


def pid_clean(pid):
    return SAFE_PID.sub("", str(pid or "anon"))[:32] or "anon"


def append_events(events):
    by_pid = {}
    for e in events:
        if isinstance(e, dict):
            by_pid.setdefault(pid_clean(e.get("pid")), []).append(e)
    with LOCK:
        for pid, evs in by_pid.items():
            with open(os.path.join(LOGS, pid + ".jsonl"), "a") as f:
                for e in evs:
                    e["server_ts"] = time.time()
                    f.write(json.dumps(e) + "\n")
    return sum(len(v) for v in by_pid.values())


def events_csv(pid):
    path = os.path.join(LOGS, pid + ".jsonl")
    rows = []
    if os.path.exists(path):
        with open(path) as f:
            rows = [json.loads(l) for l in f if l.strip()]
    cols = ["pid", "condition", "session", "ts", "iso", "type", "screen", "target", "detail", "phase", "taskElapsedMs"]
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
    w.writeheader()
    for r in rows:
        if isinstance(r.get("detail"), (dict, list)):
            r["detail"] = json.dumps(r["detail"])
        w.writerow(r)
    return buf.getvalue()


# --------------------------------------------------------------------------- HTTP
class Handler(SimpleHTTPRequestHandler):
    extensions_map = dict(SimpleHTTPRequestHandler.extensions_map, **{
        ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
        ".json": "application/json", ".webmanifest": "application/manifest+json",
        ".svg": "image/svg+xml", ".png": "image/png",
    })

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=STATIC, **kw)

    def log_message(self, fmt, *args):
        if "/api/" in (self.path or ""):
            sys.stderr.write("%s %s\n" % (self.command, self.path))

    def end_headers(self):
        p = urlparse(self.path).path
        if p in ("/", "/index.html", "/sw.js", "/manifest.webmanifest") or p.startswith(("/js/", "/css/", "/data/")):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > (5_000_000 if urlparse(self.path).path == "/api/posts" else 2_000_000):
            raise ValueError("too large")
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path == "/api/health":
            return self.send_json({"llm": bool(API_KEY), "model": MODEL, "spentUsd": spent_usd(), "budgetUsd": BUDGET_USD})
        if u.path == "/api/summary":
            return self.send_json(get_summary(q.get("phase", ["warning"])[0], refresh=q.get("refresh") == ["1"]))
        if u.path == "/api/nws":
            try:
                return self.send_json(get_nws())
            except Exception as e:
                return self.send_json({"error": str(e)}, 502)
        if u.path == "/api/geocode":
            try:
                return self.send_json({"results": LIVE.geocode(q.get("q", [""])[0])})
            except Exception as e:
                return self.send_json({"results": [], "error": str(e)}, 502)
        if u.path == "/api/logs":
            files = sorted(f[:-6] for f in os.listdir(LOGS) if f.endswith(".jsonl"))
            return self.send_json({"participants": files})
        m = re.match(r"^/api/logs/([A-Za-z0-9_-]+)\.(csv|jsonl)$", u.path)
        if m:
            pid, ext = m.groups()
            if ext == "csv":
                body = events_csv(pid).encode()
                ctype = "text/csv"
            else:
                path = os.path.join(LOGS, pid + ".jsonl")
                body = open(path, "rb").read() if os.path.exists(path) else b""
                ctype = "application/x-ndjson"
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Disposition", 'attachment; filename="%s.%s"' % (pid, ext))
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if u.path == "/api/posts":
            try:
                lat, lng = float(q["lat"][0]), float(q["lng"][0])
            except (KeyError, ValueError):
                return self.send_json({"error": "lat and lng required"}, 400)
            return self.send_json({"posts": POSTS.nearby(lat, lng)})
        if u.path.startswith("/photos/"):
            path = POSTS.photo_path(u.path[len("/photos/"):])
            if not path:
                return self.send_json({"error": "not found"}, 404)
            body = open(path, "rb").read()
            self.send_response(200)
            self.send_header("Content-Type", {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}[path.rsplit(".", 1)[1]])
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "public, max-age=604800, immutable")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)
            return
        if u.path.startswith("/api/"):
            return self.send_json({"error": "not found"}, 404)
        return super().do_GET()

    def do_DELETE(self):
        u = urlparse(self.path)
        m = re.match(r"^/api/posts/([0-9a-f]{16})$", u.path)
        if not m:
            return self.send_json({"error": "not found"}, 404)
        ok = POSTS.delete(m.group(1), self.headers.get("X-Post-Token"))
        return self.send_json({"ok": ok}, 200 if ok else 403)

    def do_POST(self):
        u = urlparse(self.path)
        try:
            body = self.read_body()
        except Exception:
            return self.send_json({"error": "bad json"}, 400)

        if u.path == "/api/posts":
            try:
                return self.send_json(POSTS.create(body, self.client_address[0]))
            except PermissionError as e:
                return self.send_json({"error": str(e)}, 429)
            except ValueError as e:
                return self.send_json({"error": str(e)}, 400)
        m = re.match(r"^/api/posts/([0-9a-f]{16})/report$", u.path)
        if m:
            return self.send_json({"ok": POSTS.report(m.group(1), body.get("device"))})

        if u.path == "/api/log":
            n = append_events(body.get("events", []))
            return self.send_json({"ok": True, "n": n})

        if u.path == "/api/live":
            try:
                return self.send_json(live_public(LIVE.build_live(body.get("places"), body.get("here", "here"), body.get("tz"))))
            except Exception as e:
                sys.stderr.write("[live] %r\n" % e)
                return self.send_json({"error": "live data unavailable: %s" % type(e).__name__}, 502)

        if u.path == "/api/live/summary":
            try:
                return self.send_json(get_live_summary(body.get("places"), refresh=bool(body.get("refresh")), tz=body.get("tz")))
            except Exception as e:
                sys.stderr.write("[live summary] %r\n" % e)
                return self.send_json({"error": str(e)}, 502)

        if u.path == "/api/chat" and body.get("mode") == "live":
            prompt_id = body.get("promptId")
            history = [m for m in body.get("messages", []) if m.get("role") in ("user", "assistant")][-8:]
            history = [{"role": m["role"], "content": str(m.get("content", ""))[:1500]} for m in history]
            if not history:
                return self.send_json({"error": "no messages"}, 400)
            try:
                live = LIVE.build_live(body.get("places"), "here", body.get("tz"))
            except Exception as e:
                return self.send_json({"answer": "I couldn't load the live weather data just now (%s). Check weather.gov for official alerts." % type(e).__name__,
                                       "sourceIds": ["nws_live"], "severity": None, "followUps": [], "fallback": True})
            system = LIVE.build_system_live(live, body.get("userState"), LIVE_GUIDE)
            fmt = LIVE.LIVE_FMT.get(prompt_id) or (PROMPTS[prompt_id]["fmt"] if prompt_id in PROMPTS else None)
            if fmt:
                system += "\n\nFORMAT FOR THIS QUESTION:\n" + fmt
            out, err = openai_chat([{"role": "system", "content": system}] + history,
                                   max_tokens=450 if prompt_id in ("power_water",) else 380,
                                   schema=LIVE_SCHEMA, valid_ids=LIVE.LIVE_SOURCES)
            if err:
                return self.send_json(fallback(live, err))
            return self.send_json(out)

        if u.path == "/api/chat":
            phase = phase_by_id(body.get("phase", "warning"))
            prompt_id = body.get("promptId")
            history = [m for m in body.get("messages", []) if m.get("role") in ("user", "assistant")][-8:]
            history = [{"role": m["role"], "content": str(m.get("content", ""))[:1500]} for m in history]
            if not history:
                return self.send_json({"error": "no messages"}, 400)
            system = build_system(phase, body.get("userState"))
            if prompt_id in PROMPTS:
                system += "\n\nFORMAT FOR THIS QUESTION:\n" + PROMPTS[prompt_id]["fmt"]
            out, err = openai_chat([{"role": "system", "content": system}] + history,
                                   max_tokens=450 if prompt_id in ("power_water",) else 380)
            if err:
                return self.send_json(fallback(phase, err))
            return self.send_json(out)

        return self.send_json({"error": "not found"}, 404)


def make_cert():
    cert = os.path.join(ROOT, "certs", "cert.pem")
    key = os.path.join(ROOT, "certs", "key.pem")
    if not os.path.exists(cert):
        os.makedirs(os.path.dirname(cert), exist_ok=True)
        subprocess.check_call(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "30",
                               "-subj", "/CN=weather-prototype", "-keyout", key, "-out", cert])
    return cert, key


def lan_ips():
    import socket
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ips.add(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    return sorted(ips)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8000)))
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--https", action="store_true", help="serve HTTPS with a self-signed cert")
    args = ap.parse_args()
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    scheme = "http"
    if args.https:
        cert, key = make_cert()
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(cert, key)
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
        scheme = "https"
    print("\n  Weather prototype running")
    print("  Local:   %s://localhost:%d" % (scheme, args.port))
    for ip in lan_ips():
        print("  Phone:   %s://%s:%d   (same Wi-Fi / hotspot)" % (scheme, ip, args.port))
    print("  Admin:   add ?admin=1 to the URL, or long-press the app title")
    print("  LLM:     %s" % ("%s (spent $%.4f of $%.2f)" % (MODEL, spent_usd(), BUDGET_USD) if API_KEY else "OFF: set OPENAI_API_KEY in .env"))
    print()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
