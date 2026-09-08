/* The two lists, out of the two files behind them.
 *
 * A song is three lines of public/tracks/playlist.json and a file beside it.
 * An episode is an item in the show's feed, mirrored into
 * public/stories/feed.rss. Both come out of here as an Item, which is the
 * shape the deck holds them in too.
 *
 * Text in, items out, and nothing here reads a file: src/lib/sources.ts is
 * the half that does. That is what lets tools/test-routes.mjs run this same
 * parsing under plain node, where the bundler's imports mean nothing.
 */

import { XMLParser } from 'fast-xml-parser';
import { assignSlugs, type Kind } from './slug.ts';
import type { Item, Show } from './item.ts';
import { hms } from './format.ts';
import { SHOW, SHOW_HOME, TRACKS_DIR } from './site.ts';

/** public/tracks/playlist.json, as a contributor writes it. */
export interface Manifest {
  station?: string;
  name?: string;
  tracks?: Partial<Item>[];
}

export function parseTracks(data: Manifest): Item[] {
  const tracks = (data.tracks ?? [])
    .filter((t): t is Partial<Item> & { title: string } => Boolean(t.title))
    .map((t) => ({
      ...t,
      artist: t.artist ?? '',
      /* Contributors name the file and nothing else, the way the deck's own
         resolveTrack() takes it. Encoded here so nobody has to hand-escape a
         space or an accent in the manifest, and so the same address survives
         being written into an attribute and asked for over HTTP. */
      url: t.url || TRACKS_DIR + encodeURIComponent(t.file ?? ''),
    }));
  return assignSlugs(tracks, 'playlist');
}

/* Nothing but what a page needs: the deck reads the same feed a moment after
   it loads and fills in the chapters and the notes itself. */
export function parseEpisodes(xml: string): Show {
  if (!xml) return { name: SHOW, home: SHOW_HOME, episodes: [] };

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    // A title of "2024" is a title, not a number, and a slug built from a
    // number that lost its zeroes is a different address.
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
  });

  /* The shape of a parsed feed is the feed's business, not ours: it is
     whatever the show's host chose to write, and a tag can arrive as a
     string, a number, an object or not at all. Every read below goes through
     text(), which is where that is coped with — so this is deliberately
     untyped rather than a type that would be a guess. */
  let channel: Loose | undefined;
  try {
    channel = (parser.parse(xml) as Loose | undefined)?.rss?.channel;
  } catch {
    return { name: SHOW, home: SHOW_HOME, episodes: [] };
  }
  if (!channel) return { name: SHOW, home: SHOW_HOME, episodes: [] };

  const name = text(channel.title) || SHOW;
  const home = text(channel.link) || SHOW_HOME;

  /* One <item> parses to an object rather than a list of one. */
  const items: Loose[] = Array.isArray(channel.item)
    ? channel.item
    : channel.item
      ? [channel.item]
      : [];

  const episodes = items
    .map((item) => {
      const url = item.enclosure?.['@url'] ?? '';
      const title = text(item.title) || text(item['itunes:title']);
      if (!title || !url) return null;
      const ms = Date.parse(text(item.pubDate)) || 0;
      return {
        title,
        // The show stands where the artist does, in the deck and here.
        artist: name,
        url,
        ms,
        date: ms ? new Date(ms).toISOString().slice(0, 10) : '',
        secs: hms(text(item['itunes:duration'])),
        explicit: /^(yes|true)$/i.test(text(item['itunes:explicit'])),
        summary: plainText(text(item.description) || text(item['itunes:summary'])),
        provisional: true,
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)
    // Newest first, the way a show is read.
    .sort((a, b) => b.ms - a.ms);

  return { name, home, episodes: assignSlugs(episodes, 'podcast') };
}

type Loose = Record<string, any>;

/** fast-xml-parser hands back a string, a number, or {} for an empty tag. */
function text(node: unknown): string {
  if (typeof node === 'string') return node.trim();
  if (typeof node === 'number') return String(node);
  if (node && typeof node === 'object' && '#text' in node) {
    return String((node as Record<string, unknown>)['#text'] ?? '').trim();
  }
  return '';
}

/** The show writes its notes as markup. This is the sentence out of them. */
export function plainText(markup: string): string {
  if (!markup) return '';
  let s = markup
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6])[^>]*>/gi, ' \n')
    .replace(/<[^>]+>/g, ' ');
  s = unescapeEntities(s);
  const lines: string[] = [];
  for (const raw of s.split('\n')) {
    const line = raw.replace(/\s+/g, ' ').trim();
    // A timestamp is a chapter, not a description of the episode.
    if (!line || /^(?:\d+:)?\d{1,2}:\d{2}\s/.test(line)) continue;
    if (/^(chapters|timestamps|chapter markers)[:.]?$/i.test(line)) continue;
    lines.push(line);
  }
  // Lifting the markup out leaves a gap where a tag sat mid-sentence, and
  // "Omarchy Stories , I'm joined by" is not a sentence anybody wrote.
  return lines.join(' ').trim().replace(/\s+([,.;:!?])/g, '$1');
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
};

function unescapeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return isFinite(code) && code > 0 ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[body.toLowerCase()] ?? all;
  });
}

/** Trimmed to fit a card, on a word. */
export function clip(text: string, limit = 190): string {
  const s = (text ?? '').replace(/\s+/g, ' ').trim();
  if (s.length <= limit) return s;
  return s.slice(0, limit).replace(/\s+\S*$/, '').replace(/[ ,;:.—-]+$/, '') + '…';
}

/** The item, as the deck wants it: enough to play and to draw a row.
 *
 * Baked into the page ahead of the deck, so a link that names a song can
 * start it on the first tick — before the manifest, before the feed, while
 * the press that opened the link still counts as engagement. */
export function seedOf(item: Item): Record<string, unknown> {
  const keep = ['title', 'artist', 'file', 'url', 'explicit', 'lyrics',
                'ms', 'secs', 'provisional'] as const;
  const seed: Record<string, unknown> = {};
  for (const k of keep) {
    if (item[k] !== undefined && item[k] !== null) seed[k] = item[k];
  }
  seed.kind = item.kind;
  seed.slug = item.slug;
  // The deck's resolveTrack() builds the url from the file, the way it does
  // for every other track, so the two cannot drift apart.
  if (item.kind === 'playlist') delete seed.url;
  return seed;
}

/* /playlist/index and /podcast/index are the addresses of the lists
   themselves — written twice, as <kind>.html and <kind>/index.html — so a
   song that slugged to "index" would have its page quietly overwrite one of
   them. The pages that generate the items check this and fail the build. */
export function isReservedSlug(key: string): boolean {
  return KINDS.some((k) => key === `${k}/index`);
}

const KINDS: Kind[] = ['playlist', 'podcast'];
