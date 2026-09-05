#!/usr/bin/env python3

"""Writes the page that sits behind every permalink.

The deck is one page of JavaScript, and every song and every episode has an
address of its own:

    /                      the live stream
    /playlist              the songs
    /playlist/<song>       that song
    /podcast               the episodes
    /podcast/<episode>     that episode

A single-page deck could serve all of those out of one file and route them in
the browser, and on GitHub Pages that means every address but / answering 404
and every link pasted anywhere showing the same card. So each one is written
out as a real file instead:

    playlist/still-licensed.html   ->  /playlist/still-licensed

which GitHub Pages serves at the extensionless path, 200, no redirect. Each
carries its own title, description, canonical link, card and structured data,
and the item itself is baked into the page as window.__ITEM__ so the deck can
start playing on the first tick — before the manifest, before the feed, while
the press that opened the link still counts as engagement.

index.html is the template, and the source of everything a page shares. The
five marked regions in it are what a page differs by:

    page:head   title, description, canonical, robots, card
    page:data   structured data, and the item behind a permalink
    page:panel  the heading over the list
    page:tabs   which of the two tabs is the current one
    page:list   the rows, as links
    page:note   the line under the list

Run it after adding a song, and it is run by the workflows when the playlist
or the mirrored feed changes:

    python3 tools/build-routes.py            write the pages and the sitemap
    python3 tools/build-routes.py --check    say what is stale, write nothing

--check exits 1 if a page on disk is not what the sources say it should be,
which is how the workflow knows whether there is anything to commit, and how
a song added without a page gets caught.

The slugs must agree with assignSlugs() in assets/js/app.js, or a link would
open a page for a song the deck cannot find. tools/test-routes.py runs both
implementations over the same titles and compares them.

Standard library only.
"""

import argparse
import html
import json
import os
import re
import sys
import unicodedata
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CANON = 'https://radio.omarchy.org'

TEMPLATE = 'index.html'
MANIFEST = 'tracks/playlist.json'
FEED = 'stories/feed.rss'
TRACKS_DIR = 'tracks/'
SITEMAP = 'sitemap.xml'

SHOW = 'Omarchy Stories'
SHOW_HOME = 'https://omarchystories.org'
ITUNES = '{http://www.itunes.com/dtds/podcast-1.0.dtd}'

SITE_DESC = ('A live stream and an on-demand playlist for the Omarchy desktop. '
             'Every song in it arrived as a pull request.')

MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun',
          'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

MARKERS = ('head', 'data', 'panel', 'tabs', 'list', 'note')

# The two lists, and the paths they own.
KINDS = ('playlist', 'podcast')


# ── slugs ───────────────────────────────────────────────────────────────
# A port of slugify() and assignSlugs() from assets/js/app.js. Kept line for
# line with it on purpose: the two have to produce the same slug for the same
# title, or a generated page is a page for a song the deck cannot find.

COMBINING = re.compile('[%s-%s]' % (chr(0x300), chr(0x36f)))
APOSTROPHE = re.compile("['%s]" % chr(0x2019))


def slugify(value):
    s = unicodedata.normalize('NFD', str(value or ''))
    s = COMBINING.sub('', s)          # strip accents, or Aurelien is all dashes
    s = s.lower()
    s = APOSTROPHE.sub('', s)
    s = re.sub(r'[^a-z0-9]+', '-', s)
    return s.strip('-')


def assign_slugs(items, kind):
    seen = {}
    for t in items:
        base = slugify(t.get('title')) or 'track'
        slug = base
        if seen.get(slug):
            slug = base + '-' + slugify(t.get('artist'))
        n = 2
        while seen.get(slug):
            slug = base + '-' + str(n)
            n += 1
        seen[slug] = True
        t['slug'] = slug
        t['kind'] = kind
        t['key'] = kind + '/' + slug
    return items


# ── the two lists ───────────────────────────────────────────────────────

def read_tracks():
    with open(os.path.join(ROOT, MANIFEST), encoding='utf-8') as f:
        data = json.load(f)
    tracks = []
    for t in data.get('tracks') or []:
        if not t.get('title'):
            continue
        t = dict(t)
        # Contributors name the file and nothing else, the way the deck's own
        # resolveTrack() takes it.
        if not t.get('url'):
            t['url'] = TRACKS_DIR + quote_file(t.get('file') or '')
        tracks.append(t)
    return assign_slugs(tracks, 'playlist')


def quote_file(name):
    # encodeURIComponent, so a space or an accent in a filename survives being
    # written into an attribute and asked for over HTTP.
    from urllib.parse import quote
    return quote(name, safe="!'()*-._~")


def hms(raw):
    """itunes:duration, which arrives as seconds, mm:ss or hh:mm:ss."""
    if not raw:
        return 0
    out = 0
    for part in str(raw).split(':'):
        try:
            out = out * 60 + int(part)
        except ValueError:
            return 0
    return out


def text_of(node, tag):
    kid = node.find(tag)
    return (kid.text or '').strip() if kid is not None and kid.text else ''


def read_episodes():
    """The show's episodes, out of the copy of its feed mirrored into here.

    Nothing but what a page needs: the deck reads the same feed a moment after
    it loads and fills in the chapters and the notes itself.
    """
    path = os.path.join(ROOT, FEED)
    if not os.path.exists(path):
        return SHOW, SHOW_HOME, []

    channel = ET.parse(path).getroot().find('channel')
    if channel is None:
        return SHOW, SHOW_HOME, []

    show = text_of(channel, 'title') or SHOW
    home = text_of(channel, 'link') or SHOW_HOME

    eps = []
    for item in channel.findall('item'):
        enc = item.find('enclosure')
        url = enc.get('url') if enc is not None else ''
        title = text_of(item, 'title') or text_of(item, ITUNES + 'title')
        if not title or not url:
            continue
        eps.append({
            'title': title,
            # The show stands where the artist does, in the deck and here.
            'artist': show,
            'url': url,
            'ms': pubdate_ms(text_of(item, 'pubDate')),
            'date': pubdate_iso(text_of(item, 'pubDate')),
            'secs': hms(text_of(item, ITUNES + 'duration')),
            'explicit': bool(re.match(r'^(yes|true)$', text_of(item, ITUNES + 'explicit'), re.I)),
            'summary': plain_text(text_of(item, 'description')
                                  or text_of(item, ITUNES + 'summary')),
            # The notes and the chapters are the feed's to give, and it is read
            # a moment after this page opens. Until then the panel says so.
            'provisional': True,
        })

    # Newest first, the way a show is read.
    eps.sort(key=lambda e: e['ms'], reverse=True)
    return show, home, assign_slugs(eps, 'podcast')


def pubdate_ms(raw):
    from email.utils import parsedate_to_datetime
    if not raw:
        return 0
    try:
        return int(parsedate_to_datetime(raw).timestamp() * 1000)
    except (TypeError, ValueError):
        return 0


def pubdate_iso(raw):
    from email.utils import parsedate_to_datetime
    if not raw:
        return ''
    try:
        return parsedate_to_datetime(raw).date().isoformat()
    except (TypeError, ValueError):
        return ''


def plain_text(markup):
    """The show writes its notes as markup. This is the sentence out of them."""
    if not markup:
        return ''
    s = re.sub(r'(?is)<(script|style).*?</\1>', ' ', markup)
    s = re.sub(r'(?i)<(br|/p|/div|/li|/h[1-6])[^>]*>', ' \n', s)
    s = re.sub(r'(?s)<[^>]+>', ' ', s)
    s = html.unescape(s)
    lines = []
    for line in s.split('\n'):
        line = re.sub(r'\s+', ' ', line).strip()
        # A timestamp is a chapter, not a description of the episode.
        if not line or re.match(r'^(?:\d+:)?\d{1,2}:\d{2}\s', line):
            continue
        if re.match(r'^(chapters|timestamps|chapter markers)[:.]?$', line, re.I):
            continue
        lines.append(line)
    s = ' '.join(lines).strip()
    # Lifting the markup out leaves a gap where a tag sat mid-sentence, and
    # "Omarchy Stories , I'm joined by" is not a sentence anybody wrote.
    return re.sub(r'\s+([,.;:!?])', r'\1', s)


def clip(text, limit=190):
    text = re.sub(r'\s+', ' ', text or '').strip()
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(' ', 1)[0].rstrip(' ,;:.—-')
    return cut + '…'


# ── the labels the rows carry, as the deck writes them ──────────────────

def date_label(ms):
    if not ms:
        return ''
    import datetime
    # UTC, so the file a build writes does not depend on where it was run.
    d = datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc)
    return '%d %s %d' % (d.day, MONTHS[d.month - 1], d.year)


def length_label(secs):
    if not secs:
        return ''
    m = round(secs / 60)
    if m < 60:
        return '%d min' % m
    return '%d h %d min' % (m // 60, m % 60)


def plural(n, word):
    return '%d %s%s' % (n, word, '' if n == 1 else 's')


# ── the template ────────────────────────────────────────────────────────

def read_template():
    with open(os.path.join(ROOT, TEMPLATE), encoding='utf-8') as f:
        s = f.read()
    for name in MARKERS:
        if s.count('<!-- page:%s -->' % name) != 1 or s.count('<!-- /page:%s -->' % name) != 1:
            sys.exit('%s: the page:%s markers are missing. Every page is written '
                     'from this file, so it needs one pair of each: %s'
                     % (TEMPLATE, name, ', '.join(MARKERS)))
    return s


def fill(template, blocks):
    s = template
    for name, content in blocks.items():
        open_at = '<!-- page:%s -->' % name
        close_at = '<!-- /page:%s -->' % name
        i = s.index(open_at) + len(open_at)
        j = s.index(close_at)
        s = s[:i] + content + s[j:]
    return s


def esc(value):
    # Attributes here are double-quoted, so an apostrophe is left as itself
    # rather than turned into &#x27; in the middle of a song title.
    s = str(value if value is not None else '')
    return html.escape(s, quote=False).replace('"', '&quot;')


def tag(name, content, attr='name'):
    return '<meta %s="%s" content="%s">' % (attr, name, esc(content))


def head_block(title, desc, path, og_type='website', extra=(), index=True):
    out = ['', '<title>%s</title>' % esc(title),
           tag('description', desc),
           '<link rel="canonical" href="%s">' % esc(CANON + path)]
    out.append(tag('robots', 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1')
               if index else tag('robots', 'noindex, follow'))
    out += [tag('og:title', title, 'property'),
            tag('og:description', desc, 'property'),
            tag('og:url', CANON + path, 'property'),
            tag('og:type', og_type, 'property')]
    out += list(extra)
    out += [tag('twitter:title', title), tag('twitter:description', desc)]
    return '\n'.join(out) + '\n'


def data_block(graph, item=None):
    out = ['']
    if item is not None:
        # Inline and ahead of the deferred app.js, so it is there on the first
        # tick. The escape is what keeps a title with a bracket in it from
        # ending the script early.
        payload = json.dumps(item, ensure_ascii=False, sort_keys=True).replace('<', '\\u003c')
        out.append('<script>window.__ITEM__ = %s;</script>' % payload)
    if graph:
        out.append('<script type="application/ld+json">')
        out.append(json.dumps(graph, ensure_ascii=False, indent=2).replace('<', '\\u003c'))
        out.append('</script>')
    return '\n'.join(out) + '\n'


def tabs_block(kind):
    songs = 'playlist' if kind is None else kind
    def one(el_id, label, path, on):
        return ('              <a class="seg-b%s" id="%s" href="%s"%s>%s</a>'
                % (' is-on' if on else '', el_id, path,
                   ' aria-current="page"' if on else '', label))
    return '\n'.join(['',
                      one('tabSongs', 'songs', '/playlist', songs != 'podcast'),
                      one('tabPodcast', 'podcast', '/podcast', songs == 'podcast')]) + '\n'


def panel_block(kind, show):
    if kind == 'podcast':
        return ('<span id="playlistKind">episodes</span> &#8212; '
                '<span id="playlistName">%s</span>' % esc(show.lower()))
    return ('<span id="playlistKind">playlist</span> &#8212; '
            '<span id="playlistName">omarchy</span>')


def row(item, number, artist_line, on):
    """One row, as paintTracks() in the deck builds it.

    Both halves are links to the same address: the row, and the # beside it
    that the deck turns into a press-to-copy once it has loaded.
    """
    path = '/' + item['key']
    ex = '<span class="tr-ex"%s>explicit</span>' % ('' if item.get('explicit') else ' hidden')
    return (
        '<li>'
        '<a class="track%s" href="%s">'
        '<span class="tr-n">%02d</span>'
        '<span class="tr-t">'
        '<span class="tr-line"><span class="tr-title">%s</span>%s</span>'
        '<span class="tr-artist">%s</span>'
        '</span>'
        '<span class="tr-s"><span class="tr-st"></span><span class="tr-c" hidden></span></span>'
        '</a>'
        '<a class="tr-link" href="%s" title="Permalink &#8212; press to copy" '
        'aria-label="Copy link to %s">#</a>'
        '</li>'
    ) % (' is-on' if on else '', esc(path), number, esc(item['title']), ex,
         esc(artist_line), esc(path), esc(item['title']))


def song_rows(tracks, only=None):
    rows = []
    for i, t in enumerate(tracks):
        if only is not None and t is not only:
            continue
        rows.append(row(t, i + 1, t.get('artist') or '', t is only))
    return '\n'.join([''] + rows) + '\n'


def episode_rows(eps, only=None):
    rows = []
    for i, e in enumerate(eps):
        if only is not None and e is not only:
            continue
        # Numbered from the far end: the newest is on top, and episode 01
        # stays episode 01 as the show grows.
        line = ' · '.join(x for x in (date_label(e['ms']), length_label(e['secs'])) if x)
        rows.append(row(e, len(eps) - i, line, e is only))
    return '\n'.join([''] + rows) + '\n'


def song_note(tracks, item=None):
    if not tracks:
        return 'live rotation only &#8212; no track list on this stream'
    count = plural(len(tracks), 'track') + ' on demand'
    if item is None:
        return count
    if len(tracks) == 1:
        return '<a href="/playlist">%s</a>' % count
    return 'one of <a href="/playlist">%s</a>' % count


def episode_note(eps, home, item=None):
    count = plural(len(eps), 'episode') if eps else 'reading the feed…'
    if item is not None and eps:
        many = 'one of ' if len(eps) > 1 else ''
        count = '%s<a href="/podcast">%s</a>' % (many, plural(len(eps), 'episode'))
    return '%s &middot; <a href="%s" target="_blank" rel="noopener">%s</a>' % (
        count, esc(home), esc(re.sub(r'^https?://', '', home).rstrip('/')))


# ── structured data ─────────────────────────────────────────────────────

def playlist_node(tracks):
    return {
        '@context': 'https://schema.org',
        '@type': 'MusicPlaylist',
        '@id': CANON + '/playlist#playlist',
        'name': 'Omarchy Radio playlist',
        'url': CANON + '/playlist',
        'numTracks': len(tracks),
        'description': 'Songs about the Omarchy desktop, every one of them '
                       'made by somebody who runs it.',
        'track': [{
            '@type': 'MusicRecording',
            'position': i + 1,
            'name': t['title'],
            'url': CANON + '/' + t['key'],
            'byArtist': {'@type': 'Person', 'name': t.get('artist') or 'unknown'},
        } for i, t in enumerate(tracks)],
    }


def song_node(track, path):
    node = {
        '@context': 'https://schema.org',
        '@type': 'MusicRecording',
        '@id': CANON + path + '#recording',
        'name': track['title'],
        'url': CANON + path,
        'byArtist': {'@type': 'Person', 'name': track.get('artist') or 'unknown'},
        'inPlaylist': {'@id': CANON + '/playlist#playlist'},
        'publisher': {'@id': 'https://omarchy.org/#organization'},
        'isFamilyFriendly': not track.get('explicit'),
        'audio': {
            '@type': 'AudioObject',
            'contentUrl': CANON + '/' + track['url'].lstrip('/'),
            'encodingFormat': 'audio/mpeg',
        },
    }
    return node


def series_node(eps, home):
    return {
        '@context': 'https://schema.org',
        '@type': 'PodcastSeries',
        '@id': CANON + '/#stories',
        'name': SHOW,
        'url': home,
        'webFeed': CANON + '/' + FEED,
        'numberOfEpisodes': len(eps),
        'episode': [{
            '@type': 'PodcastEpisode',
            'name': e['title'],
            'url': CANON + '/' + e['key'],
            'datePublished': e['date'],
        } for e in eps],
    }


def episode_node(ep, path, home):
    node = {
        '@context': 'https://schema.org',
        '@type': 'PodcastEpisode',
        '@id': CANON + path + '#episode',
        'name': ep['title'],
        'url': CANON + path,
        'partOfSeries': {'@type': 'PodcastSeries', 'name': SHOW, 'url': home},
        'associatedMedia': {
            '@type': 'AudioObject',
            'contentUrl': ep['url'],
            'encodingFormat': 'audio/mpeg',
        },
    }
    if ep['date']:
        node['datePublished'] = ep['date']
    if ep['secs']:
        node['timeRequired'] = 'PT%dM' % max(1, round(ep['secs'] / 60))
    if ep['summary']:
        node['description'] = clip(ep['summary'], 500)
    return node


# ── the pages ───────────────────────────────────────────────────────────

def seed_of(item):
    """The item, as the deck wants it: enough to play and to draw a row."""
    keep = ('title', 'artist', 'file', 'url', 'explicit', 'lyrics',
            'ms', 'secs', 'provisional')
    seed = {k: item[k] for k in keep if item.get(k) is not None}
    seed['kind'] = item['kind']
    seed['slug'] = item['slug']
    if item['kind'] == 'playlist':
        # The deck's resolveTrack() builds the url from the file, the way it
        # does for every other track, so the two cannot drift apart.
        seed.pop('url', None)
    return seed


def pages(template, tracks, eps, show, home):
    """Every file this build owns: path -> contents."""
    out = {}

    songs_list = song_rows(tracks)
    eps_list = episode_rows(eps)

    # ── home, and the two lists ──
    out[TEMPLATE] = fill(template, {
        'head': head_block('Omarchy Radio', SITE_DESC, '/'),
        'data': data_block(None),
        'panel': panel_block('playlist', show),
        'tabs': tabs_block('playlist'),
        'list': songs_list,
        'note': song_note(tracks),
    })

    playlist_page = fill(template, {
        'head': head_block(
            'The playlist · Omarchy Radio',
            'Every song on Omarchy Radio, %s of them, each one made and sent in by '
            'somebody who runs the desktop. Press one to play it.' % len(tracks),
            '/playlist'),
        'data': data_block(playlist_node(tracks)),
        'panel': panel_block('playlist', show),
        'tabs': tabs_block('playlist'),
        'list': songs_list,
        'note': song_note(tracks),
    })
    out['playlist.html'] = playlist_page
    # Written twice on purpose. GitHub Pages serves an extensionless path from
    # <path>.html, and a directory from its index.html, and playlist/ exists
    # here because the songs live in it. Rather than depend on which of the two
    # it prefers, both are there and the canonical link names the one worth
    # sharing.
    out['playlist/index.html'] = playlist_page

    pod_desc = ('%s, the show the community makes about running this desktop. '
                'Every episode, with its chapters, playable here.' % show)
    podcast_page = fill(template, {
        'head': head_block('%s · Omarchy Radio' % show, pod_desc, '/podcast'),
        'data': data_block(series_node(eps, home)),
        'panel': panel_block('podcast', show),
        'tabs': tabs_block('podcast'),
        'list': eps_list,
        'note': episode_note(eps, home),
    })
    out['podcast.html'] = podcast_page
    out['podcast/index.html'] = podcast_page

    reserved = [k + '/index' for k in KINDS]
    for item in tracks + eps:
        if item['key'] in reserved:
            sys.exit('%r slugs to %s, which is the address of the list itself.\n'
                     'Give it a title that does not, or the page for one of them '
                     'would quietly overwrite the other.' % (item['title'], item['key']))

    # ── one page per song ──
    for t in tracks:
        path = '/' + t['key']
        artist = t.get('artist') or 'unknown'
        desc = ('%s by %s, on Omarchy Radio: a song about the Omarchy desktop, '
                'made by somebody who runs it. Press play.' % (t['title'], artist))
        out[t['key'] + '.html'] = fill(template, {
            'head': head_block(
                '%s by %s · Omarchy Radio' % (t['title'], artist),
                desc, path, 'music.song',
                extra=[tag('og:audio', CANON + '/' + t['url'].lstrip('/'), 'property'),
                       tag('og:audio:type', 'audio/mpeg', 'property')]),
            'data': data_block(song_node(t, path), seed_of(t)),
            'panel': panel_block('playlist', show),
            'tabs': tabs_block('playlist'),
            'list': song_rows(tracks, only=t),
            'note': song_note(tracks, item=t),
        })

    # ── one page per episode ──
    for e in eps:
        path = '/' + e['key']
        desc = clip(e['summary']) or (
            '%s, an episode of %s: the show the community makes about running '
            'the Omarchy desktop.' % (e['title'], show))
        extra = [tag('og:audio', e['url'], 'property'),
                 tag('og:audio:type', 'audio/mpeg', 'property')]
        if e['date']:
            extra.append(tag('article:published_time', e['date'], 'property'))
        out[e['key'] + '.html'] = fill(template, {
            'head': head_block('%s · %s' % (e['title'], show), desc, path,
                               'article', extra=extra),
            'data': data_block(episode_node(e, path, home), seed_of(e)),
            'panel': panel_block('podcast', show),
            'tabs': tabs_block('podcast'),
            'list': episode_rows(eps, only=e),
            'note': episode_note(eps, home, item=e),
        })

    # ── everything else ──
    # GitHub Pages serves this for any address it has no file for, which is
    # how a link to an episode published since the last build still opens the
    # deck: it reads the address, finds the episode in the feed, and plays it.
    # Not indexed — it is whatever was asked for, not a page of its own.
    out['404.html'] = fill(template, {
        'head': head_block('Omarchy Radio', SITE_DESC, '/', index=False),
        'data': data_block(None),
        'panel': panel_block('playlist', show),
        'tabs': tabs_block('playlist'),
        'list': songs_list,
        'note': song_note(tracks),
    })

    out[SITEMAP] = sitemap(tracks, eps)
    return out


def sitemap(tracks, eps):
    """Every address, for the crawlers.

    lastmod only where there is a date worth trusting. An episode has the one
    the show published it on; a song has nothing but the commit that added it,
    and a checkout does not carry that, so a build in CI would stamp today on
    all of them and rewrite this file every time it ran.
    """
    newest = max([e['date'] for e in eps if e['date']] or [''])

    def url(loc, priority, freq, lastmod='', image=False):
        out = ['  <url>', '    <loc>%s</loc>' % esc(CANON + loc)]
        if lastmod:
            out.append('    <lastmod>%s</lastmod>' % lastmod)
        out.append('    <changefreq>%s</changefreq>' % freq)
        out.append('    <priority>%s</priority>' % priority)
        if image:
            out += ['    <image:image>',
                    '      <image:loc>%s/assets/images/opengraph.png</image:loc>' % CANON,
                    '      <image:title>Omarchy Radio</image:title>',
                    '      <image:caption>Omarchy Radio</image:caption>',
                    '    </image:image>']
        out.append('  </url>')
        return '\n'.join(out)

    body = [url('/', '1.0', 'weekly', newest, image=True),
            url('/playlist', '0.9', 'weekly'),
            url('/podcast', '0.9', 'weekly', newest)]
    body += [url('/' + t['key'], '0.8', 'monthly') for t in tracks]
    body += [url('/' + e['key'], '0.7', 'monthly', e['date']) for e in eps]

    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n'
            '        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n'
            + '\n'.join(body) + '\n</urlset>\n')


def stale(wanted):
    """Pages under playlist/ and podcast/ with nothing left to be a page for.

    A renamed song leaves its old page behind, and a page for a song the deck
    no longer has is a link that plays the wrong thing, or nothing.
    """
    gone = []
    for kind in KINDS:
        d = os.path.join(ROOT, kind)
        if not os.path.isdir(d):
            continue
        for name in sorted(os.listdir(d)):
            rel = kind + '/' + name
            if name.endswith('.html') and rel not in wanted:
                gone.append(rel)
    return gone


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--check', action='store_true',
                    help='report what is stale and write nothing')
    args = ap.parse_args()

    template = read_template()
    tracks = read_tracks()
    show, home, eps = read_episodes()
    wanted = pages(template, tracks, eps, show, home)
    gone = stale(wanted)

    changed, added = [], []
    for rel, body in sorted(wanted.items()):
        path = os.path.join(ROOT, rel)
        if not os.path.exists(path):
            added.append(rel)
        else:
            with open(path, encoding='utf-8') as f:
                if f.read() != body:
                    changed.append(rel)

    if args.check:
        for rel in added:
            print('missing  %s' % rel)
        for rel in changed:
            print('stale    %s' % rel)
        for rel in gone:
            print('orphan   %s' % rel)
        if added or changed or gone:
            print('\n%d file(s) out of date. Run: python3 tools/build-routes.py'
                  % (len(added) + len(changed) + len(gone)))
            return 1
        print('%d pages, all current' % len(wanted))
        return 0

    for rel, body in sorted(wanted.items()):
        path = os.path.join(ROOT, rel)
        os.makedirs(os.path.dirname(path) or ROOT, exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(body)
    for rel in gone:
        os.remove(os.path.join(ROOT, rel))

    print('%d pages: %d song%s, %d episode%s, %d written fresh, %d updated, %d removed'
          % (len(wanted), len(tracks), '' if len(tracks) == 1 else 's',
             len(eps), '' if len(eps) == 1 else 's',
             len(added), len(changed), len(gone)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
