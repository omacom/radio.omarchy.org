/* What a song and an episode are.
 *
 * One shape for both, because a row, a page and the marquee do not care which
 * of the two they are showing. Types only — no imports that would follow this
 * into the browser bundle, so the build and the deck can both name it.
 */

import type { Addressed } from './slug.ts';

/** A stamped line: a chapter of an episode, or a line of a timed lyric. */
export interface Stamped {
  /** Seconds in. -1 on a lyric sheet with no timings. */
  t: number;
  txt: string;
}

export interface Item extends Addressed {
  title: string;
  artist: string;
  /** Where the audio is. A song's is this origin; an episode's is the host's. */
  url: string;

  // ── a song ──
  /** The MP3's name in tracks/. The deck rebuilds url from it. */
  file?: string;
  album?: string;
  /** false, or the name of a sheet that does not match the MP3's. */
  lyrics?: boolean | string;

  // ── either ──
  explicit?: boolean;

  // ── an episode ──
  /** Published, in ms. */
  ms?: number;
  /** Published, as a date. Written by the build; the deck works off ms. */
  date?: string;
  /** Length in seconds, off itunes:duration. */
  secs?: number;
  /** What the show wrote, flattened to one sentence. The build's; it goes in
      the card. */
  summary?: string;
  /** What the show wrote, as lines. The deck's, out of the live feed. */
  notes?: string[];
  /** Where its parts start. The deck's, out of the live feed. */
  chapters?: Stamped[];
  /** The notes and the chapters are the feed's to give, and the deck reads it
      a moment after the page opens. Until then the panel says so. */
  provisional?: boolean;
}

/** The show, as its feed describes it. */
export interface Show {
  name: string;
  home: string;
  episodes: Item[];
}
