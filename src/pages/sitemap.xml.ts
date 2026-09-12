/* Every address, for the crawlers.
 *
 * Hand-written rather than left to @astrojs/sitemap, because the priorities,
 * the change frequencies and the front page's image are the point of it.
 *
 * lastmod only where there is a date worth trusting. An episode has the one
 * the show published it on; a song has nothing but the commit that added it,
 * and a checkout does not carry that, so a build in CI would stamp today on
 * all of them and rewrite this file every time it ran.
 */

import type { APIRoute } from 'astro';
import { readEpisodes, readTracks } from '../lib/sources.ts';
import { CANON } from '../lib/site.ts';

interface Entry {
  loc: string;
  priority: string;
  freq: string;
  lastmod?: string;
  image?: boolean;
}

function url({ loc, priority, freq, lastmod = '', image = false }: Entry): string {
  const out = ['  <url>', `    <loc>${esc(CANON + loc)}</loc>`];
  if (lastmod) out.push(`    <lastmod>${lastmod}</lastmod>`);
  out.push(`    <changefreq>${freq}</changefreq>`);
  out.push(`    <priority>${priority}</priority>`);
  if (image) {
    out.push(
      '    <image:image>',
      `      <image:loc>${CANON}/assets/images/opengraph.png</image:loc>`,
      '      <image:title>Omarchy Radio</image:title>',
      '      <image:caption>Omarchy Radio</image:caption>',
      '    </image:image>',
    );
  }
  out.push('  </url>');
  return out.join('\n');
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export const GET: APIRoute = () => {
  const tracks = readTracks();
  const { episodes } = readEpisodes();
  const newest = episodes.map((e) => e.date ?? '').filter(Boolean).sort().pop() ?? '';

  const body = [
    url({ loc: '/', priority: '1.0', freq: 'weekly', lastmod: newest, image: true }),
    url({ loc: '/playlist', priority: '0.9', freq: 'weekly' }),
    url({ loc: '/podcast', priority: '0.9', freq: 'weekly', lastmod: newest }),
    ...tracks.map((t) => url({ loc: `/${t.key}`, priority: '0.8', freq: 'monthly' })),
    ...episodes.map((e) =>
      url({ loc: `/${e.key}`, priority: '0.7', freq: 'monthly', lastmod: e.date })),
  ];

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n' +
    '        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n' +
    body.join('\n') + '\n</urlset>\n';

  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
