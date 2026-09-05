#!/usr/bin/env python3

"""Mirrors the Omarchy Stories feed into stories/feed.rss.

The player reads the episode list from this repo rather than from the show's
host, because a browser will not read another site's feed unless that site
sends a header saying it may, and Riverside send it on the preflight but not
on the GET a plain read makes. Mirroring the file sidesteps the question: by
the time the player asks, the feed is served from radio.omarchy.org like
everything else. The episode audio still comes from the show's host, so their
download figures still count what they always counted.

Run by .github/workflows/stories.yml every hour, and safe to run by hand:

    python3 tools/fetch-stories.py

It leaves the file alone unless the show actually published something, so an
hourly job does not write 24 commits a day. Standard library only.
"""

import argparse
import os
import re
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

FEED = 'https://api.riverside.com/hosting/1i59HjrN.rss'
DEST = 'stories/feed.rss'
UA = 'omarchy-radio (+https://radio.omarchy.org)'

TRIES = 3
TIMEOUT = 30

# Stamped by the host at the moment of the request, so it is different on every
# fetch and says nothing about the show. Comparing without it is the difference
# between committing when an episode lands and committing every hour forever.
VOLATILE = re.compile(rb'<lastBuildDate>[^<]*</lastBuildDate>')


def fetch(url):
    last = None
    for attempt in range(1, TRIES + 1):
        try:
            req = urllib.request.Request(url)
            req.add_header('User-Agent', UA)
            # Riverside sit behind a cache that varies on User-Agent; ask past it
            # so an hourly job is not reading an hour-old copy of an hourly file.
            req.add_header('Cache-Control', 'no-cache')
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return r.read()
        except (urllib.error.URLError, OSError) as e:
            last = e
            if attempt < TRIES:
                wait = attempt * 5
                print('  attempt %d failed (%s), retrying in %ds' % (attempt, e, wait),
                      file=sys.stderr)
                time.sleep(wait)
    raise SystemExit('the feed would not load after %d tries: %s' % (TRIES, last))


def episodes(raw):
    """The titles in a feed, or a reason it is not one.

    A host having a bad day answers with an error page, a login wall or an
    empty body, and any of those would replace a working episode list with
    nothing. Nothing is written until this agrees the bytes are a feed.
    """
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as e:
        raise SystemExit('that is not XML: %s' % e)

    channel = root.find('channel')
    if root.tag != 'rss' or channel is None:
        raise SystemExit('that is XML, but it is not an RSS feed')
    if not (channel.findtext('title') or '').strip():
        raise SystemExit('the feed has no title; treating it as broken')

    return [(i.findtext('title') or '').strip() for i in channel.findall('item')]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--url', default=FEED, help='feed to mirror (default: the show)')
    ap.add_argument('--dest', default=DEST, help='where it lands (default: %s)' % DEST)
    ap.add_argument('-n', '--dry-run', action='store_true',
                    help='say what would change, write nothing')
    ap.add_argument('--allow-empty', action='store_true',
                    help='accept a feed with no episodes over one that had some')
    args = ap.parse_args()

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    dest = args.dest if os.path.isabs(args.dest) else os.path.join(root, args.dest)

    print('reading %s' % args.url)
    raw = fetch(args.url)
    fresh = episodes(raw)
    print('  %d episode%s' % (len(fresh), '' if len(fresh) == 1 else 's'))

    have = None
    if os.path.exists(dest):
        with open(dest, 'rb') as f:
            have = f.read()

    if have is not None:
        # A feed that has lost every episode is a host having a bad day far
        # more often than it is a show deleting its back catalogue.
        if not fresh and episodes(have) and not args.allow_empty:
            raise SystemExit('the feed came back empty and the copy here is not; '
                             'refusing to wipe it (--allow-empty overrides)')
        if VOLATILE.sub(b'', have) == VOLATILE.sub(b'', raw):
            print('unchanged — nothing published since the last run')
            return 0

    was = len(episodes(have)) if have is not None else 0
    print('changed — %d episode%s, was %d' %
          (len(fresh), '' if len(fresh) == 1 else 's', was))
    for title in fresh[:5]:
        print('  %s' % title)

    if args.dry_run:
        print('dry run; %s not written' % args.dest)
        return 0

    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, 'wb') as f:
        f.write(raw)
    print('wrote %s' % args.dest)
    return 0


if __name__ == '__main__':
    sys.exit(main())
