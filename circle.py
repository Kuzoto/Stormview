"""
Safety circle sync (live mode). No accounts: each phone gets a random user id + secret token the first time
the user picks a display name. People connect through invite links:

  - Inviter taps "+ Add person"  ->  server makes an invite code  ->  inviter texts/shares https://<server>/r/<code>
  - If the recipient HAS the app: the link opens /#/join/<code>, they accept, and both are connected. From then
    on each sees the other's check-in status in the app (the app polls about every 20 s).
  - If they DON'T: /r/<code> is a one-tap reply page (I'm safe / I need help + note). Their reply shows up in the
    inviter's circle. The same link can be re-sent later to ask again.

Privacy: only connected people see your status (and a guest only sees the status of the person who invited
them). A shared location is coarse (~100 m) and expires after 1 hour. Tokens are stored hashed.
Storage: userdata/circle.json (git-ignored).
"""
import hashlib
import json
import os
import secrets
import threading
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(ROOT, "userdata", "circle.json")
os.makedirs(os.path.dirname(PATH), exist_ok=True)
INVITE_TTL = 30 * 86400
STATES = ("safe", "help")
_lock = threading.RLock()  # re-entrant: me() checks the rate limit while holding it
_rate = {}


def _load():
    try:
        with open(PATH) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {"users": {}, "links": [], "invites": {}}


DB = _load()


def _save():
    tmp = PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(DB, f)
    os.replace(tmp, PATH)


def _h(token):
    return hashlib.sha256(str(token).encode()).hexdigest()


def _clean_name(n):
    return " ".join(str(n or "").split())[:30]


def _clean_note(n):
    return " ".join(str(n or "").split())[:140]


def _rate_ok(key, per_min):
    now = time.time()
    with _lock:
        ts = [t for t in _rate.get(key, []) if now - t < 60]
        ok = len(ts) < per_min
        if ok:
            ts.append(now)
        _rate[key] = ts
        return ok


class AuthError(Exception):
    pass


def auth(token):
    if not token:
        raise AuthError("not signed in")
    h = _h(token)
    for uid, u in DB["users"].items():
        if secrets.compare_digest(u["tokenHash"], h):
            return uid
    raise AuthError("unknown user")


# --------------------------------------------------------------------------- profile
def me(token, name=None, ip=""):
    """Create a user (no token) or update the name. Returns the user's public profile (+ token if new)."""
    name = _clean_name(name)
    with _lock:
        if not token:
            if not name:
                raise ValueError("name is required")
            if not _rate_ok("me:" + ip, 5):
                raise PermissionError("Too many new profiles. Try again in a minute.")
            uid = secrets.token_hex(5)
            token = secrets.token_urlsafe(24)
            DB["users"][uid] = {"name": name, "tokenHash": _h(token), "created": time.time(), "status": None, "pings": []}
            _save()
            return {"uid": uid, "name": name, "token": token}
    uid = auth(token)
    with _lock:
        if name:
            DB["users"][uid]["name"] = name
            _save()
        return {"uid": uid, "name": DB["users"][uid]["name"]}


# --------------------------------------------------------------------------- status
def _status_view(st):
    if not st:
        return None
    out = {"state": st["state"], "note": st.get("note", ""), "time": st["time"]}
    loc = st.get("loc")
    if loc and time.time() - st["time"] < 3600:
        out["loc"] = loc
    return out


def set_status(token, state, note="", loc=None):
    uid = auth(token)
    if state not in STATES:
        raise ValueError("state must be safe or help")
    st = {"state": state, "note": _clean_note(note), "time": time.time()}
    if loc:
        try:
            st["loc"] = [round(float(loc[0]), 3), round(float(loc[1]), 3)]
        except (TypeError, ValueError, IndexError):
            pass
    with _lock:
        DB["users"][uid]["status"] = st
        DB["users"][uid]["pings"] = []  # answering clears "are you OK?" requests
        _save()
    return {"ok": True}


def _connected(uid):
    out = set()
    for a, b in DB["links"]:
        if a == uid:
            out.add(b)
        elif b == uid:
            out.add(a)
    return out


def circle(token):
    uid = auth(token)
    now = time.time()
    with _lock:
        u = DB["users"][uid]
        people = []
        for other in _connected(uid):
            o = DB["users"].get(other)
            if o:
                people.append({"id": other, "kind": "app", "name": o["name"], "status": _status_view(o.get("status"))})
        for code, inv in DB["invites"].items():
            if inv["from"] != uid or inv.get("usedBy") or now - inv["created"] > INVITE_TTL:
                continue
            people.append({"id": code, "kind": "guest", "name": inv["contactName"], "code": code,
                           "status": _status_view(inv.get("reply")), "invitedAt": inv["created"]})
        pings = [{"from": DB["users"].get(p["from"], {}).get("name", "Someone"), "time": p["time"]}
                 for p in u.get("pings", []) if now - p["time"] < 86400]
        return {"me": {"uid": uid, "name": u["name"], "status": _status_view(u.get("status"))}, "people": people, "pings": pings}


# --------------------------------------------------------------------------- invites
def invite(token, contact_name):
    uid = auth(token)
    name = _clean_name(contact_name)
    if not name:
        raise ValueError("name is required")
    if not _rate_ok("inv:" + uid, 10):
        raise PermissionError("Too many invites. Try again in a minute.")
    code = secrets.token_urlsafe(6).replace("-", "x").replace("_", "y")
    with _lock:
        DB["invites"][code] = {"from": uid, "contactName": name, "created": time.time(), "reply": None, "usedBy": None}
        _save()
    return {"code": code}


def invite_info(code):
    with _lock:
        inv = DB["invites"].get(code)
        if not inv or time.time() - inv["created"] > INVITE_TTL:
            return None
        u = DB["users"].get(inv["from"])
        if not u:
            return None
        return {"from": u["name"], "contactName": inv["contactName"], "used": bool(inv.get("usedBy")),
                "fromStatus": _status_view(u.get("status")), "reply": _status_view(inv.get("reply"))}


def accept(token, code):
    uid = auth(token)
    with _lock:
        inv = DB["invites"].get(code)
        if not inv or time.time() - inv["created"] > INVITE_TTL:
            raise ValueError("This invite link has expired. Ask for a new one.")
        if inv["from"] == uid:
            raise ValueError("That's your own invite link.")
        if inv.get("usedBy") and inv["usedBy"] != uid:
            raise ValueError("This invite was already used by someone else. Ask for a new one.")
        inv["usedBy"] = uid
        pair = sorted([uid, inv["from"]])
        if pair not in DB["links"]:
            DB["links"].append(pair)
        _save()
        return {"ok": True, "name": DB["users"][inv["from"]]["name"]}


def guest_reply(code, state, note="", ip=""):
    if state not in STATES:
        raise ValueError("state must be safe or help")
    if not _rate_ok("reply:" + ip, 10):
        raise PermissionError("Too many replies. Try again in a minute.")
    with _lock:
        inv = DB["invites"].get(code)
        if not inv or time.time() - inv["created"] > INVITE_TTL:
            raise ValueError("This link has expired.")
        inv["reply"] = {"state": state, "note": _clean_note(note), "time": time.time()}
        _save()
    return {"ok": True}


def remove(token, other):
    uid = auth(token)
    with _lock:
        before = len(DB["links"])
        DB["links"] = [l for l in DB["links"] if sorted([uid, other]) != l]
        inv = DB["invites"].get(other)
        removed = len(DB["links"]) != before
        if inv and inv["from"] == uid:
            DB["invites"].pop(other)
            removed = True
        _save()
    return {"ok": removed}


def ping(token, other):
    uid = auth(token)
    with _lock:
        if other not in _connected(uid) or other not in DB["users"]:
            raise ValueError("not in your circle")
        pings = [p for p in DB["users"][other].get("pings", []) if p["from"] != uid]
        pings.append({"from": uid, "time": time.time()})
        DB["users"][other]["pings"] = pings[-10:]
        _save()
    return {"ok": True}


# --------------------------------------------------------------------------- reply page (no app needed)
REPLY_PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Are you OK? · StormWise</title>
<style>
:root{--red:#c62828;--green:#2e7d32;--ink:#0f1b2d;--muted:#6b7684}
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f2f4f7;color:var(--ink)}
main{max-width:440px;margin:0 auto;padding:24px 16px}
.card{background:#fff;border-radius:16px;padding:18px;box-shadow:0 1px 3px rgba(0,0,0,.08);margin-bottom:14px}
h1{font-size:1.35rem;margin:0 0 6px} p{margin:6px 0;line-height:1.4} .muted{color:var(--muted);font-size:.9rem}
.btns{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:14px 0}
button{font:inherit;font-weight:800;border-radius:14px;padding:16px 10px;border:2px solid;background:#fff;cursor:pointer;font-size:1.05rem}
.safe{border-color:var(--green);color:var(--green)} .help{border-color:var(--red);color:var(--red)}
.safe.on{background:var(--green);color:#fff} .help.on{background:var(--red);color:#fff}
textarea{width:100%;box-sizing:border-box;border:1.5px solid #cfd6de;border-radius:12px;padding:10px;font:inherit;resize:none}
.send{width:100%;background:var(--ink);color:#fff;border-color:var(--ink)} .send:disabled{opacity:.4}
.st{display:inline-block;padding:3px 8px;border-radius:6px;font-weight:800;font-size:.85rem}
.st.safe{background:#e8f5e9;color:var(--green);border:0} .st.help{background:#fdecea;color:var(--red);border:0}
a.app{display:block;text-align:center;font-weight:700;color:#1565c0;margin-top:6px}
.done{display:none} .err{color:var(--red)}
</style></head><body><main>
<div class="card" id="box"><p class="muted">Loading…</p></div>
<div class="card"><p class="muted">Have the StormWise app? <a class="app" id="applink" href="#">Open this in the app to connect</a></p></div>
<p class="muted" style="text-align:center">If you're in immediate danger, call 911.</p>
</main>
<script>
const code = location.pathname.split('/').pop();
document.getElementById('applink').href = '/#/join/' + encodeURIComponent(code);
const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when = (t) => new Date(t * 1000).toLocaleString([], {weekday:'short', hour:'numeric', minute:'2-digit'});
let choice = null;
function render(info) {
  const box = document.getElementById('box');
  if (!info) { box.innerHTML = '<h1>This link has expired</h1><p class="muted">Ask the person who sent it for a new one.</p>'; return; }
  const fs = info.fromStatus;
  box.innerHTML = '<h1>' + esc(info.from) + ' wants to know if you\\'re OK</h1>' +
    (fs ? '<p>' + esc(info.from) + ': <span class="st ' + fs.state + '">' + (fs.state === 'safe' ? '✓ Safe' : 'Needs help') + '</span> <span class="muted">' + when(fs.time) + (fs.note ? ' · “' + esc(fs.note) + '”' : '') + '</span></p>' : '') +
    (info.reply ? '<p class="muted">Your last reply: ' + (info.reply.state === 'safe' ? "I'm safe" : 'I need help') + ' · ' + when(info.reply.time) + '</p>' : '') +
    '<div class="btns"><button class="safe" data-s="safe">I\\'m safe</button><button class="help" data-s="help">I need help</button></div>' +
    '<textarea id="note" rows="2" maxlength="140" placeholder="Add a note (optional), e.g. at home, power is out"></textarea>' +
    '<p><button class="send" id="send" disabled>Send to ' + esc(info.from) + '</button></p><p id="msg" class="muted"></p>';
  box.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => {
    choice = b.dataset.s; box.querySelectorAll('[data-s]').forEach((x) => x.classList.toggle('on', x === b));
    document.getElementById('send').disabled = false;
  });
  document.getElementById('send').onclick = async () => {
    const msg = document.getElementById('msg');
    try {
      const r = await fetch('/api/r/' + encodeURIComponent(code), {method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({state: choice, note: document.getElementById('note').value})});
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Something went wrong');
      msg.className = ''; msg.textContent = '✓ Sent. ' + info.from + ' will see it in their app. You can come back to this link to update it.';
    } catch (e) { msg.className = 'err'; msg.textContent = e.message; }
  };
}
fetch('/api/circle/invite/' + encodeURIComponent(code)).then((r) => r.ok ? r.json() : null).then(render).catch(() => render(null));
</script></body></html>"""
