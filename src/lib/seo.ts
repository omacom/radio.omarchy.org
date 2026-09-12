/* What a page says about itself.
 *
 * Every song and every episode arrives as a document of its own, so each one
 * carries its own title, description, canonical link and card. This is the
 * shape of that, in one place, so a new kind of page cannot quietly ship
 * without one.
 */

import { CANON } from './site.ts';

export interface Meta {
  name?: string;
  property?: string;
  content: string;
}

export interface Head {
  title: string;
  description: string;
  /** The path this page is the canonical spelling of. */
  path: string;
  ogType?: string;
  /** noindex, for the page the host serves when it has no file. */
  index?: boolean;
  /** og:audio and the like, for a page that is about one recording. */
  extra?: Meta[];
}

export function headMeta(head: Head): Meta[] {
  const { title, description, path, ogType = 'website', index = true, extra = [] } = head;
  return [
    { name: 'description', content: description },
    {
      name: 'robots',
      content: index
        ? 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'
        : 'noindex, follow',
    },
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
    { property: 'og:url', content: CANON + path },
    { property: 'og:type', content: ogType },
    ...extra,
    { name: 'twitter:title', content: title },
    { name: 'twitter:description', content: description },
  ];
}

export function audioMeta(url: string): Meta[] {
  return [
    { property: 'og:audio', content: url },
    { property: 'og:audio:type', content: 'audio/mpeg' },
  ];
}
