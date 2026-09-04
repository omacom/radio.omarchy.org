#!/usr/bin/env bash
# Transcribes audio into .lrc sheets the player can follow line by line.
#
#   tools/make-lyrics.sh                      every track, skipping ones done
#   tools/make-lyrics.sh --report             measure the sheets already written
#   tools/make-lyrics.sh -n                   say what it would do
#   tools/make-lyrics.sh "tracks/Some - Song.mp3"
#   tools/make-lyrics.sh --force --no-vad "tracks/Some - Song.mp3"
#   tools/make-lyrics.sh --help               every option
#
# Sheets land in tracks/lyrics/ named after the audio, which is where the
# player looks. What comes out is a first pass: singing is hard for speech
# recognition, so expect a wrong line here and there and fix it by hand.
#
# Everything heavy lives in a virtualenv outside the repo, built on first
# run. That first run also pulls the model (~1.6GB) into ~/.cache/hugging
# face, so it takes a while and wants a network. Later runs are offline.
#
# Needs python3 and ffmpeg. No GPU required; --device cuda if you have one.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
venv="${LYRICS_VENV:-${XDG_CACHE_HOME:-$HOME/.cache}/omarchy-radio-lyrics/venv}"
worker="$root/tools/make-lyrics.py"

[ -f "$worker" ] || { echo "missing $worker" >&2; exit 1; }

# These modes never touch the model, so they must not trigger a multi-gigabyte
# install just to print a usage line or measure files already on disk.
light=""
for a in "$@"; do
  case "$a" in
    -h|--help|--report|-n|--dry-run) light=1 ;;
  esac
done

if [ ! -x "$venv/bin/python" ]; then
  if [ -n "$light" ]; then
    exec python3 "$worker" "$@"
  fi
  command -v python3 >/dev/null || { echo "python3 not found" >&2; exit 1; }
  command -v ffmpeg  >/dev/null || echo "warning: ffmpeg not found; some formats will fail" >&2

  echo "First run: building the transcription environment in"
  echo "  $venv"
  echo "This installs faster-whisper and pulls a model of about 1.6GB."
  python3 -m venv "$venv"
  "$venv/bin/pip" -q install --upgrade pip
  "$venv/bin/pip" -q install faster-whisper
  echo
fi

# Run from the repo root so the "tracks" and "tracks/lyrics" defaults mean the
# same thing wherever the script is called from.
cd "$root"
exec "$venv/bin/python" "$worker" "$@"
