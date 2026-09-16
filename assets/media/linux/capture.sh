#!/usr/bin/env bash
# Regenerate the Linux store screenshots (issue #40) from the INSTALLED .deb.
#
# Drives the real app on an off-screen X server — Xvfb, no window manager, so
# the window keeps exactly the size asked for — with xdotool, and captures the
# window with ImageMagick. Keyboard where it can: tree clicks land unreliably
# while the tree is still loading, arrow keys never do.
#
# Needs:
#   sudo apt-get install xvfb xdotool imagemagick fonts-noto-color-emoji
#   the demo database (frontend/e2e/support/demo.ts) on 127.0.0.1:13307:
#     docker start quaero-demo-mysql
#   the app launched once, so its localStorage exists to be seeded.
#
# Usage: assets/media/linux/capture.sh [out-dir]   (default: this directory)
# It REPLACES the app's localStorage (connections, settings) with the demo's.
set -eu
OUT="$(cd "${1:-$(dirname "$0")}" && pwd)"
W=1360 H=860
export DISPLAY=:99

win() {  # the main window: the largest one named Squaero (popups share it)
  for w in $(xdotool search --onlyvisible --name '^Squaero$'); do
    eval "$(xdotool getwindowgeometry --shell "$w")"; echo "$((WIDTH * HEIGHT)) $w"
  done | sort -n | tail -1 | cut -d' ' -f2
}
click() { xdotool mousemove --window "$(win)" "$1" "$2" click 1; sleep "${3:-1}"; }
key()   { xdotool windowfocus "$(win)"; xdotool key --delay 60 "$@"; }
shot()  { click 800 845 0.5; import -window "$(win)" "$OUT/$1.png"; echo "wrote $1.png"; }

seed() {  # locale + theme + the demo connection, straight into WebKit's store
  python3 - "$1" <<'EOF'
import glob, json, os, sqlite3, sys
dbs = glob.glob(os.path.expanduser("~/.local/share/squaero/storage/*/*/LocalStorage/localstorage.sqlite3"))
assert dbs, "launch squaero once first"
con = sqlite3.connect(dbs[0])
con.execute("delete from ItemTable")
for k, v in {
    "quaero.locale": "en",
    "quaero.theme": sys.argv[1],
    "quaero.connections": json.dumps([{
        "id": "demo-ventas", "name": "Ventas (demo)", "driver": "mysql",
        "params": {"host": "127.0.0.1", "port": "13307", "user": "root",
                   "password": "demo123", "database": "ventas"}}]),
}.items():
    # WebKit keeps values as UTF-16LE blobs.
    con.execute("insert into ItemTable(key, value) values (?, ?)", (k, v.encode("utf-16-le")))
con.commit()
EOF
}

launch() {
  pkill -x squaero 2>/dev/null && sleep 1 || true
  cd / && GDK_BACKEND=x11 GSK_RENDERER=cairo setsid squaero > /tmp/squaero-capture.log 2>&1 < /dev/null &
  for _ in $(seq 60); do grep -q 'connected to the bridge' /tmp/squaero-capture.log 2>/dev/null && break; sleep 0.5; done
  sleep 3
  xdotool windowsize "$(win)" $W $H windowmove "$(win)" 0 0
  sleep 2
}

pgrep -f 'Xvfb :99' >/dev/null || { setsid Xvfb :99 -screen 0 ${W}x${H}x24 >/dev/null 2>&1 < /dev/null & sleep 2; }

for theme in light dark; do
  pkill -x squaero 2>/dev/null && sleep 1 || true
  seed "$theme"
  launch
  click 90 80                    # Pick a saved connection…
  key Return; sleep 4            # Ventas (demo)
  click 72 339 3                 # expand ventas
  key Down Right; sleep 3        # Tables
  key Down Return; sleep 4       # open clientes
  click 800 700 0.5              # focus off the tree
  shot "linux-$theme-table"
  for tool in "391 er" "425 builder" "289 monitor"; do
    set -- $tool
    click "$1" 51 4
    shot "linux-$theme-$2"
    key Escape; sleep 1
  done
  key ctrl+alt+t; sleep 1.5
  click 700 150 0.5
  xdotool type --delay 15 "SELECT ciudad, COUNT(*) AS clientes FROM clientes GROUP BY ciudad ORDER BY clientes DESC"
  key Escape ctrl+Return; sleep 4
  shot "linux-$theme-query"
  click 1228 397 3               # Chart
  shot "linux-$theme-chart"
done
pkill -x squaero || true
