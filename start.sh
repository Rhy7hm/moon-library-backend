#!/bin/sh
# Moon Library — start it on this computer:
#
#   sh start.sh            → http://127.0.0.1:5100        sign in (clients and staff), client website
#                            http://127.0.0.1:5100/admin  the admin, where staff land after signing in
#   sh start.sh --build    → rebuild both websites first (it also rebuilds by itself when their code changed)
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

# build each website when asked, when it was never built, or when its code is newer than the build
for site in admin client; do
    if [ "${1:-}" = "--build" ] || [ ! -f "$site/dist/index.html" ] || [ -n "$(find "$site/src" "$site/index.html" "$site/public" -newer "$site/dist/index.html" -print -quit 2>/dev/null)" ]; then
        echo "Building the $site website…"
        (cd "$site" && { [ -d node_modules ] || npm ci --no-audit --no-fund; } && npm run build >/dev/null)
    fi
done

.venv/bin/python scripts/preflight.py

echo ""
echo "  Ready → http://127.0.0.1:$PORT   (sign in — clients stay there, staff go on to /admin)"
echo "          Ctrl+C to stop"
echo ""
exec .venv/bin/python -m flask --app wsgi run --host 127.0.0.1 --port "$PORT"
