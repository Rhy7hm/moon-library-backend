#!/bin/sh
# Moon Library — start the admin on this computer:
#
#   sh start.sh            → http://127.0.0.1:5100/admin
#   sh start.sh --build    → rebuild the admin first (after changing its code)
#
# Uses your own MySQL and your Cloudflare R2 bucket (settings in .env). The first run installs what's
# needed; every run checks MySQL and R2 first and asks for anything missing. Ctrl+C stops it.
set -eu
cd "$(dirname "$0")"
PORT="${PORT:-5100}"   # not 5000: macOS uses that for AirPlay Receiver

if [ ! -x .venv/bin/python ]; then
    echo "First run: installing Python packages (about a minute)…"
    python3 -m venv .venv
    .venv/bin/pip install -q --upgrade pip
fi
.venv/bin/pip install -q -r requirements.txt

if [ "${1:-}" = "--build" ] || [ ! -f admin/dist/index.html ] || [ -n "$(find admin/src admin/index.html -newer admin/dist/index.html -print -quit 2>/dev/null)" ]; then
    echo "Building the admin…"
    (cd admin && { [ -d node_modules ] || npm ci --no-audit --no-fund; } && npm run build >/dev/null)
fi

.venv/bin/python scripts/preflight.py

echo ""
echo "  Ready → http://127.0.0.1:$PORT/admin   (Ctrl+C to stop)"
echo ""
exec .venv/bin/python -m flask --app wsgi run --host 127.0.0.1 --port "$PORT"
