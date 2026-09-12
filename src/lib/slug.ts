/* Where an address comes from.
 *
 * Slugs come from the title so a link reads as the song. Two tracks can share
 * a title, so the artist breaks the tie, and a number after that. The key is
 * the path: the songs have one namespace, the episodes another, and neither
 * can shadow the other.
 *
 * This used to exist twice — once in the deck, once in tools/build-routes.py —
 * with a test whose whole job was to run both over the same titles and check
 * they still agreed. They have to: a page written under a slug the deck does
 * not compute is a link that opens a page for a song the deck cannot find.
 * The build and the browser now import this file, so there is nothing left to
 * disagree.
 */

export type Kind = 'playlist' | 'podcast';

/** Anything with a title and an artist can be given an address. */
export interface Nameable {
  title: string;
  artist?: string;
}

/** What assignSlugs() adds to one. */
export interface Addressed {
  kind: Kind;
  slug: string;
  /** kind + '/' + slug — the path, without its leading slash. */
  key: string;
}

export function slugify(value: unknown): string {
  return String(value ?? '')
    // Strip accents first, or "Aurélien" would come out full of dashes.
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/* A bare {} would inherit "constructor" and the rest from Object, so a song by
   that name would read as a clash with something that is not there. */
export function assignSlugs<T extends Nameable>(items: T[], kind: Kind): (T & Addressed)[] {
  const seen: Record<string, true> = Object.create(null);
  return items.map((item) => {
    const base = slugify(item.title) || 'track';
    let slug = base;
    if (seen[slug]) slug = `${base}-${slugify(item.artist)}`;
    let n = 2;
    while (seen[slug]) slug = `${base}-${n++}`;
    seen[slug] = true;
    return Object.assign(item, { kind, slug, key: `${kind}/${slug}` });
  });
}

/* What somebody typed, and what they typed it at, reduced to the same thing.
 *
 * The same accent-stripping an address gets, for the same reason: nobody
 * hunting for Aurélien's song is going to reach for the acute, and nobody
 * searching for "cest la vie" should be told there is no such song. Unlike a
 * slug this keeps the spaces, because the words are what is being matched.
 */
export function fold(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
