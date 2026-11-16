"""
Shared Neighbor Reports for live mode. Posts (and optional photos) are stored on the machine that runs
server.py, so everyone using the same link sees posts from people near them. No accounts: each post
returns a secret token that lets its author delete it from that phone.

Storage (git-ignored):  userdata/posts.jsonl   one JSON object per line (append-only; deletes are tombstones)
                        userdata/photos/<id>.<jpg|png|webp>

Privacy: locations are rounded to ~100 m and only the distance is shown to other people. Photos are
re-encoded on the phone before upload, which strips EXIF metadata (including GPS).
Moderation: posts reported by 3 different phones are hidden; authors can delete their own posts.
"""
import base64
import json
import math
import os
import secrets
import threading
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "userdata")
PHOTOS = os.path.join(DATA, "photos")
POSTS_PATH = os.path.join(DATA, "posts.jsonl")
os.makedirs(PHOTOS, exist_ok=True)

CATEGORIES = ("Road", "Power", "Flooding", "Damage", "Other")
MAX_PHOTO_BYTES = 3_000_000
MAX_AGE_S = 7 * 86400
HIDE_AFTER_REPORTS = 3
_lock = threading.Lock()
_posts = {}       # id -> post (with private fields)
_rate = {}        # client ip -> [timestamps]


def _load():
    if not os.path.exists(POSTS_PATH):
        return
    with open(POSTS_PATH) as f:
        for line in f:
            try:
                ev = json.loads(line)
            except ValueError:
                continue
            if ev.get("op") == "delete":
                _posts.pop(ev.get("id"), None)
            elif ev.get("op") == "report":
                p = _posts.get(ev.get("id"))
                if p and ev.get("by") not in p["reports"]:
                    p["reports"].append(ev.get("by"))
            elif ev.get("op") == "create":
                _posts[ev["post"]["id"]] = ev["post"]


_load()


def _append(ev):
    with open(POSTS_PATH, "a") as f:
        f.write(json.dumps(ev) + "\n")


def miles(a_lat, a_lng, b_lat, b_lng):
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp, dl = p2 - p1, math.radians(b_lng - a_lng)
    x = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 3958.8 * math.asin(math.sqrt(x))


def _rate_ok(ip, per_min=6):
    now = time.time()
    with _lock:
        ts = [t for t in _rate.get(ip, []) if now - t < 60]
        if len(ts) >= per_min:
            _rate[ip] = ts
            return False
        ts.append(now)
        _rate[ip] = ts
        return True


def _decode_photo(data_url):
    """Accept a data: URL of a JPEG/PNG/WebP; verify the bytes really are that image type."""
    if not data_url:
        return None, None
    if not isinstance(data_url, str) or not data_url.startswith("data:image/") or "," not in data_url:
        raise ValueError("photo must be an image")
    raw = base64.b64decode(data_url.split(",", 1)[1], validate=False)
    if len(raw) > MAX_PHOTO_BYTES:
        raise ValueError("photo is too large")
    if raw[:3] == b"\xff\xd8\xff":
        return raw, "jpg"
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        return raw, "png"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return raw, "webp"
    raise ValueError("unsupported image type")


def public(p, lat=None, lng=None):
    out = {k: p[k] for k in ("id", "author", "text", "category", "createdAt", "photo", "area")}
    if lat is not None:
        out["distanceMi"] = round(miles(lat, lng, p["lat"], p["lng"]), 1)
    out["reports"] = len(p["reports"])
    return out


def create(body, ip):
    if not _rate_ok(ip):
        raise PermissionError("Too many posts. Wait a minute and try again.")
    text = " ".join(str(body.get("text") or "").split())[:500]
    if not text:
        raise ValueError("text is required")
    try:
        lat, lng = round(float(body["lat"]), 3), round(float(body["lng"]), 3)
    except (KeyError, TypeError, ValueError):
        raise ValueError("location is required")
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise ValueError("bad location")
    cat = body.get("category") if body.get("category") in CATEGORIES else "Other"
    raw, ext = _decode_photo(body.get("photo"))
    pid = secrets.token_hex(8)
    photo = None
    if raw:
        name = "%s.%s" % (pid, ext)
        with open(os.path.join(PHOTOS, name), "wb") as f:
            f.write(raw)
        photo = "photos/" + name
    post = {
        "id": pid, "author": (" ".join(str(body.get("author") or "").split())[:30] or "Neighbor"),
        "text": text, "category": cat, "createdAt": time.time(), "photo": photo,
        "area": str(body.get("area") or "")[:60], "lat": lat, "lng": lng,
        "token": secrets.token_hex(16), "reports": [],
    }
    with _lock:
        _posts[pid] = post
        _append({"op": "create", "post": post})
    return dict(public(post, lat, lng), token=post["token"])


def nearby(lat, lng, radius_mi=15, limit=60):
    now = time.time()
    with _lock:
        items = [p for p in _posts.values()
                 if now - p["createdAt"] < MAX_AGE_S and len(p["reports"]) < HIDE_AFTER_REPORTS
                 and miles(lat, lng, p["lat"], p["lng"]) <= radius_mi]
    items.sort(key=lambda p: -p["createdAt"])
    return [public(p, lat, lng) for p in items[:limit]]


def delete(pid, token):
    with _lock:
        p = _posts.get(pid)
        if not p or not token or not secrets.compare_digest(p["token"], str(token)):
            return False
        _posts.pop(pid, None)
        _append({"op": "delete", "id": pid})
    if p.get("photo"):
        try:
            os.remove(os.path.join(DATA, p["photo"]))
        except OSError:
            pass
    return True


def report(pid, device):
    device = str(device or "")[:40]
    with _lock:
        p = _posts.get(pid)
        if not p or not device:
            return False
        if device not in p["reports"]:
            p["reports"].append(device)
            _append({"op": "report", "id": pid, "by": device})
    return True


def photo_path(name):
    """Safe path for /photos/<16 hex>.<ext>, or None."""
    import re
    if not re.match(r"^[0-9a-f]{16}\.(jpg|png|webp)$", name or ""):
        return None
    path = os.path.join(PHOTOS, name)
    return path if os.path.exists(path) else None
