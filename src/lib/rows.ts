/* The rows a page arrives with, and the line under them.
 *
 * A list page carries every row; the page behind a permalink carries the one
 * it is for, keeping the number it has in the full list. The deck rebuilds
 * both a moment later out of the manifest and the feed, so what is written
 * here has to be what paintTracks() would have written.
 */

import { dateLabel, lengthLabel, plural } from './format.ts';
import { STATION } from './site.ts';
import type { Item, Show } from './item.ts';
import type { Kind } from './slug.ts';

export interface Row {
  item: Item;
  number: number;
  sub: string;
  on: boolean;
}

/* Songs are numbered down the list. Episodes are numbered from the far end,
   because the newest is at the top and episode 01 is episode 01.

   A permalink page passes the whole list and is handed back one row: the
   number a row wears is its place in the list, not in what the page shows,
   so the numbering has to happen before the narrowing. */
export function rowsFor(list: Item[], kind: Kind, only: Item | null = null): Row[] {
  return list
    .map((item, i) => ({
      item,
      number: kind === 'podcast' ? list.length - i : i + 1,
      /* An episode has no artist to name under the title: it has a date and a
         length, which are the two things worth knowing before pressing it. */
      sub: kind === 'podcast'
        ? [dateLabel(item.ms ?? 0), lengthLabel(item.secs ?? 0)].filter(Boolean).join(' · ')
        : item.artist || '',
      on: item === only,
    }))
    .filter((row) => !only || row.on);
}

/** The heading over the list: what kind of list, and whose. */
export function panelTitle(kind: Kind, show: Show): { kind: string; name: string } {
  return kind === 'podcast'
    ? { kind: 'episodes', name: show.name.toLowerCase() }
    : { kind: 'playlist', name: STATION.name.toLowerCase() };
}

/** The line under the list, as HTML: it carries a link on a permalink page. */
export function noteFor(kind: Kind, list: Item[], only: Item | null, show: Show): string {
  if (kind === 'podcast') return episodeNote(list, show, only);
  return songNote(list, only);
}

function songNote(tracks: Item[], only: Item | null): string {
  if (!tracks.length) return 'nothing in the playlist yet';
  const count = `${plural(tracks.length, 'track')}, on repeat`;
  if (!only) return count;
  if (tracks.length === 1) return `<a href="/playlist">${count}</a>`;
  return `one of <a href="/playlist">${count}</a>`;
}

/* The show is not ours, so the note says whose it is and where it lives — the
   one place on the deck that leads to the podcast itself. */
function episodeNote(eps: Item[], show: Show, only: Item | null): string {
  let count = eps.length ? plural(eps.length, 'episode') : 'reading the feed…';
  if (only && eps.length) {
    const many = eps.length > 1 ? 'one of ' : '';
    count = `${many}<a href="/podcast">${plural(eps.length, 'episode')}</a>`;
  }
  const label = show.home.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return `${count} &middot; <a href="${escapeAttr(show.home)}" target="_blank" rel="noopener">${escapeText(label)}</a>`;
}

/* This is the one place the build writes markup by hand rather than handing it
   to Astro, because the note is one sentence with a link in the middle of it.
   The show's own title and address go through here, so they are escaped. */
function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;');
}
