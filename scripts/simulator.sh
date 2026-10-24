#!/bin/sh
# Runs the Even Hub simulator without a desktop: a virtual X display (Xvfb)
# plus the automation API on port 9898 for screenshots and input.
#
#   sh scripts/simulator.sh [url]        default url: http://localhost:5180
#
# Then, from another shell:
#   curl -s http://127.0.0.1:9898/api/screenshot/glasses -o glasses.png
#   curl -s -X POST -H 'content-type: application/json' -d '{"action":"click"}' http://127.0.0.1:9898/api/input
#   curl -s http://127.0.0.1:9898/api/console
# Actions: up, down, click, double_click, long_press, long_press_release, context_menu.
#
# One-time setup on Debian (the simulator is a WebKitGTK app):
#   apt-get install -y --no-install-recommends libwebkit2gtk-4.1-0 libsoup-3.0-0 libjavascriptcoregtk-4.1-0 xvfb
#
# Useful URLs: ?test=font&set=1..4 (glyph widths), ?preview=over (game-over screen)
set -e
URL=${1:-http://localhost:5180}
PORT=${AUTOMATION_PORT:-9898}
DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$DIR"
# WebKit's sandbox and GPU paths do not work inside PRoot/containers.
export WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1
export WEBKIT_DISABLE_COMPOSITING_MODE=1
export WEBKIT_DISABLE_DMABUF_RENDERER=1
export LIBGL_ALWAYS_SOFTWARE=1
export GDK_BACKEND=x11
# MIT-SHM is unreliable on a virtual display; turn the extension off.
exec xvfb-run -a -s "-screen 0 1280x900x24 -extension MIT-SHM" \
  node node_modules/@evenrealities/evenhub-simulator/bin/index.js "$URL" --automation-port "$PORT"
