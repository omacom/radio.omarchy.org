"""Transcribes audio into .lrc sheets timed for line-by-line follow.

Driven by tools/make-lyrics.sh, which owns the virtualenv. Run that rather
than this, unless faster-whisper is already importable.

Whisper's own segments run 10-15s on sung audio, which merges several sung
lines into one and gives a highlight that sits still while three lines go
past. So this asks for word timestamps and rebuilds the lines itself:
break on a real pause between words, or once a line is long enough to
read. Each line's stamp is its first word's start, which is what the
player highlights on.

What comes out is a first pass, not a transcript to trust. Singing is hard
for speech recognition: rhymes land wrong, buried vocals come out thin,
and the timing drifts by a beat here and there. It is plain text so a
wrong line takes seconds to fix by hand, which is the point.
"""
import argparse
import pathlib
import re
import statistics
import sys

AUDIO = {'.mp3', '.flac', '.wav', '.m4a', '.ogg', '.opus', '.aac', '.wma', '.aiff'}

# Whisper spells what it expects to hear, so naming the vocabulary is the
# difference between "Hyprland" and "hyper land". Override for other worlds.
PROMPT = ("Omarchy, Omakase, Hyprland, Arch Linux, dotfiles, Quattro, DHH, "
          "oligarchy, fork o'clock, tiling window manager, terminal, distro, "
          "Neovim, Waybar, Alacritty, systemd, sudo, kernel, repo, commit.")


def stamp(t):
    m, s = divmod(max(0.0, t), 60)
    return '[%02d:%05.2f]' % (int(m), s)


def collect(paths):
    """Files, directories, or a mix. Directories are one level deep, which is
    how a tracks/ folder is laid out."""
    out = []
    for p in paths:
        path = pathlib.Path(p)
        if path.is_dir():
            out += sorted(f for f in path.iterdir() if f.suffix.lower() in AUDIO)
        elif path.is_file():
            out.append(path)
        else:
            print('  no such path: %s' % p, file=sys.stderr)
    return out


def lines_from_words(words, gap, max_words, max_chars):
    groups, cur = [], []
    for w in words:
        txt = (w.word or '').strip()
        if not txt:
            continue
        if cur:
            quiet = w.start - cur[-1].end >= gap
            wide = len(cur) >= max_words
            long = sum(len((x.word or '').strip()) + 1 for x in cur) >= max_chars
            # A comma or full stop is a line break the singer already wrote,
            # but only once there is enough on the line to be worth breaking.
            closed = txt[-1] in '.!?,' and len(cur) >= 4
            if quiet or wide or long or closed:
                groups.append(cur)
                cur = []
        cur.append(w)
    if cur:
        groups.append(cur)
    return groups


def sheet_stats(text):
    ts, wc = [], []
    for line in text.splitlines():
        m = re.match(r'\[(\d+):([\d.]+)\](.*)', line)
        if m:
            ts.append(int(m.group(1)) * 60 + float(m.group(2)))
            wc.append(len(m.group(3).split()))
    gaps = [b - a for a, b in zip(ts, ts[1:])]
    return {
        'lines': len(ts),
        'gap': statistics.median(gaps) if gaps else 0.0,
        'words': statistics.median(wc) if wc else 0.0,
    }


def main():
    ap = argparse.ArgumentParser(
        prog='make-lyrics',
        description='Transcribe audio into .lrc sheets timed for line-by-line follow.')
    ap.add_argument('inputs', nargs='*', default=['tracks'],
                    help='audio files or directories (default: tracks)')
    ap.add_argument('-o', '--out', default='tracks/lyrics',
                    help='where the sheets go (default: tracks/lyrics)')
    ap.add_argument('-m', '--model', default='large-v3-turbo',
                    help='whisper model (default: large-v3-turbo)')
    ap.add_argument('-f', '--force', action='store_true',
                    help='redo sheets that already exist')
    ap.add_argument('--plain', action='store_true',
                    help='write lines without timestamps, so nothing follows along')
    ap.add_argument('--language', default=None,
                    help='force a language instead of detecting per track')
    ap.add_argument('--prompt', default=None, help='vocabulary to prime the model with')
    ap.add_argument('--prompt-file', default=None, help='read that vocabulary from a file')
    ap.add_argument('--no-vad', action='store_true',
                    help='keep every frame. Try this on a track that came out empty: '
                         'voice detection drops vocals buried in a dense mix')
    ap.add_argument('--gap', type=float, default=0.55,
                    help='pause between words that ends a line, seconds (default: 0.55)')
    ap.add_argument('--max-words', type=int, default=8, help='longest line in words')
    ap.add_argument('--max-chars', type=int, default=44, help='longest line in characters')
    ap.add_argument('--beam', type=int, default=1,
                    help='beam size. 5 is more accurate and several times slower')
    ap.add_argument('--threads', type=int, default=0, help='CPU threads (default: all)')
    ap.add_argument('--device', default='cpu', help='cpu or cuda (default: cpu)')
    ap.add_argument('--compute', default='int8',
                    help='ctranslate2 compute type (default: int8; try float16 on cuda)')
    ap.add_argument('--min-lines', type=int, default=6,
                    help='below this a sheet is called out as thin (default: 6)')
    ap.add_argument('-n', '--dry-run', action='store_true', help='say what would be done')
    ap.add_argument('--report', action='store_true',
                    help='just measure the sheets already in --out and stop')
    args = ap.parse_args()

    out = pathlib.Path(args.out)

    if args.report:
        sheets = sorted(out.glob('*.lrc'))
        if not sheets:
            print('no sheets in %s' % out)
            return 0
        return report([(f.stem, sheet_stats(f.read_text(encoding='utf-8'))) for f in sheets],
                      args.min_lines)

    files = collect(args.inputs)
    if not files:
        print('nothing to transcribe', file=sys.stderr)
        return 1

    todo = [f for f in files
            if args.force or not (out / (f.stem + '.lrc')).exists()]
    skipped = len(files) - len(todo)

    print('%d audio file(s), %d to do, %d already have a sheet' %
          (len(files), len(todo), skipped))
    if args.dry_run:
        for f in todo:
            print('  would write %s' % (out / (f.stem + '.lrc')))
        return 0
    if not todo:
        return 0

    prompt = args.prompt
    if args.prompt_file:
        prompt = pathlib.Path(args.prompt_file).read_text(encoding='utf-8').strip()
    if prompt is None:
        prompt = PROMPT

    # Imported here so --help and --report work without the model installed.
    from faster_whisper import WhisperModel

    print('loading %s on %s (%s)…' % (args.model, args.device, args.compute))
    model = WhisperModel(args.model, device=args.device,
                         compute_type=args.compute,
                         cpu_threads=args.threads or 0)

    out.mkdir(parents=True, exist_ok=True)
    done, failed = [], []

    for i, src in enumerate(todo, 1):
        print('[%d/%d] %s' % (i, len(todo), src.name), flush=True)
        try:
            segs, info = model.transcribe(
                str(src),
                language=args.language,
                initial_prompt=prompt,
                condition_on_previous_text=False,  # music loops the decoder otherwise
                vad_filter=not args.no_vad,
                vad_parameters=dict(min_silence_duration_ms=600),
                word_timestamps=not args.plain,
                beam_size=args.beam,
            )

            rows = []
            if args.plain:
                for s in segs:
                    txt = ' '.join((s.text or '').split())
                    if txt:
                        rows.append(txt)
            else:
                words = [w for s in segs for w in (s.words or [])]
                for group in lines_from_words(words, args.gap,
                                              args.max_words, args.max_chars):
                    txt = ' '.join((w.word or '').strip() for w in group)
                    txt = ' '.join(txt.split())
                    if txt:
                        rows.append(stamp(group[0].start) + txt)

            text = '\n'.join(rows) + ('\n' if rows else '')
            dest = out / (src.stem + '.lrc')
            dest.write_text(text, encoding='utf-8')

            st = sheet_stats(text) if not args.plain else {'lines': len(rows),
                                                           'gap': 0.0, 'words': 0.0}
            done.append((src.stem, st))
            note = '  THIN' if st['lines'] < args.min_lines else ''
            print('      %s  lang=%s lines=%d%s' %
                  (dest.name, info.language, st['lines'], note), flush=True)
        except Exception as e:                      # one bad file is not the run
            print('      failed: %s' % e, file=sys.stderr, flush=True)
            failed.append(src.name)

    print()
    report(done, args.min_lines)
    if failed:
        print('\n%d file(s) failed:' % len(failed), file=sys.stderr)
        for f in failed:
            print('  %s' % f, file=sys.stderr)
        return 1
    return 0


def report(rows, min_lines):
    """Counts and timings only, never the words: this is for spotting a sheet
    that needs another pass, not for reading."""
    print('%-40s %6s %9s %8s' % ('sheet', 'lines', 'med gap', 'med wds'))
    thin = []
    for name, st in sorted(rows, key=lambda r: r[1]['lines']):
        flag = ''
        if st['lines'] < min_lines:
            flag = '  THIN'
            thin.append(name)
        print('%-40s %6d %8.1fs %8.1f%s' %
              (name[:40], st['lines'], st['gap'], st['words'], flag))

    good = [st['gap'] for _, st in rows if st['lines'] >= min_lines and st['gap']]
    print('\n%d sheet(s), %d thin.' % (len(rows), len(thin)), end=' ')
    if good:
        print('Median line gap where usable: %.1fs.' % statistics.median(good))
    else:
        print()
    if thin:
        print('\nThin sheets usually mean the vocal is buried and voice detection '
              'dropped it.\nRetry those with --no-vad, and --beam 5 if it is still '
              'thin:')
        print('  tools/make-lyrics.sh --force --no-vad --beam 5 \\')
        print('    %s' % ' \\\n    '.join('"tracks/%s.mp3"' % t for t in thin[:3]))
        if len(thin) > 3:
            print('    …and %d more' % (len(thin) - 3))
    return 0


if __name__ == '__main__':
    sys.exit(main())
