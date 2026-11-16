#!/usr/bin/env bash
# Gives the running prototype a public HTTPS URL (Cloudflare quick tunnel, free, no account).
# HTTPS is what lets phones install it as an app with offline support.
# Usage: start `python3 server.py` in one terminal, then `./tunnel.sh` in another.
set -euo pipefail
PORT="${1:-8000}"
DIR="$(cd "$(dirname "$0")" && pwd)"
BIN="$DIR/bin/cloudflared"

if command -v cloudflared >/dev/null 2>&1; then
  BIN="$(command -v cloudflared)"
elif [ ! -x "$BIN" ]; then
  mkdir -p "$DIR/bin"
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64)  URL=https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 ;;
    Linux-aarch64) URL=https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 ;;
    Darwin-*)      echo "On macOS run: brew install cloudflared   (then re-run this script)"; exit 1 ;;
    *)             echo "Download cloudflared for your OS: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"; exit 1 ;;
  esac
  echo "Downloading cloudflared…"
  curl -fsSL -o "$BIN" "$URL"
  chmod +x "$BIN"
fi

echo "Opening tunnel to http://localhost:$PORT. Look for the https://….trycloudflare.com URL below."
echo "Anyone with that URL can open the app while this runs. Press Ctrl+C to stop."
exec "$BIN" tunnel --url "http://localhost:$PORT"
