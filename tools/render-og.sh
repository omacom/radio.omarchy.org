#!/usr/bin/env bash
# Renders tools/og.html to the social cards in assets/images/.
# Needs chromium and python3 to serve the fonts, which the card pulls
# through assets/css/fonts.css.
#
#   opengraph.png         1200x630   og:image, twitter:image
#   opengraph-16x9.png    1200x675   schema.org image
#   opengraph-4x3.png     1200x900   schema.org image
#   opengraph-square.png  1200x1200  schema.org image, square crops
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
port="${PORT:-8899}"
imgs="$root/assets/images"

# Deliberately not $BROWSER: that is the desktop's "open a URL for a human"
# launcher (on Omarchy, omarchy-launch-browser), which ignores the headless
# flags and exits 0 without rendering. Override with OG_BROWSER.
browser="${OG_BROWSER:-}"
if [ -z "$browser" ]; then
  for c in chromium chromium-browser google-chrome-stable google-chrome; do
    if command -v "$c" >/dev/null; then browser="$c"; break; fi
  done
fi
[ -n "$browser" ] && command -v "$browser" >/dev/null || {
  echo "no chromium-family browser found (set OG_BROWSER)" >&2; exit 1; }

tmp="$(mktemp -d)"
python3 -m http.server "$port" --bind 127.0.0.1 --directory "$root" >/dev/null 2>&1 &
server=$!
trap 'kill "$server" 2>/dev/null || true; rm -rf "$tmp"' EXIT

base="http://127.0.0.1:$port/tools/og.html"

# Wait for the card to actually serve. Failing here beats screenshotting
# a browser error page over cards that looked fine last time.
ready=""
for _ in $(seq 40); do
  if curl -sf "$base" | grep -q "class=\"name\""; then ready=1; break; fi
  sleep 0.25
done
[ -n "$ready" ] || { echo "server never served $base" >&2; exit 1; }

render() { # <format> <width> <height> <outfile>
  local f="$1" w="$2" h="$3" out="$imgs/$4"

  # A dedicated profile is required, not tidiness: with the user's own browser
  # open, a bare invocation hands the command line to that instance and exits 0
  # without ever rendering.
  "$browser" --headless --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=1 --window-size="$w,$h" \
    --no-first-run --no-default-browser-check \
    --user-data-dir="$tmp/profile-$f" \
    --virtual-time-budget=5000 --screenshot="$tmp/$f.png" \
    "$base?f=$f" >/dev/null 2>&1

  # Move into place only once it is known good, so a failed run cannot leave
  # the previous card sitting there looking like a success.
  [ -s "$tmp/$f.png" ] || { echo "browser wrote no screenshot for $f" >&2; exit 1; }
  local size
  size="$(python3 -c "
import struct, sys
print('%dx%d' % struct.unpack('>II', open(sys.argv[1],'rb').read(24)[16:24]))
" "$tmp/$f.png")"
  [ "$size" = "${w}x${h}" ] || { echo "$f: expected ${w}x${h}, got $size" >&2; exit 1; }

  mv "$tmp/$f.png" "$out"
  echo "  $(basename "$out")  $size"
}

render wide 1200 630  opengraph.png
render 16x9 1200 675  opengraph-16x9.png
render 4x3  1200 900  opengraph-4x3.png
render 1x1  1200 1200 opengraph-square.png
