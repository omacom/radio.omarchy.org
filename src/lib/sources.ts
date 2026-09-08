/* The two files the site is built from.
 *
 * Imported rather than read off disk, so the build has no opinion about where
 * it was run from, and `astro dev` rewrites the pages the moment a song is
 * added or the feed is mirrored in — both are dependencies of the build, not
 * something it happens to look at.
 *
 * The parsing is in src/lib/lists.ts, which reads no files at all.
 */

import manifest from '../../public/tracks/playlist.json' with { type: 'json' };
import feedXml from '../../public/stories/feed.rss?raw';
import { parseEpisodes, parseTracks, type Manifest } from './lists.ts';
import type { Item, Show } from './item.ts';

/** Every song, in the order the playlist plays them. */
export function readTracks(): Item[] {
  return parseTracks(manifest as Manifest);
}

/** The show, and every episode it has published, newest first. */
export function readEpisodes(): Show {
  return parseEpisodes(feedXml);
}
