// @ts-check
import { copyFile } from 'node:fs/promises';
import { defineConfig } from 'astro/config';

/* The list pages, twice.
 *
 * GitHub Pages serves an extensionless path from <path>.html and a directory
 * from its index.html, and playlist/ and podcast/ both exist here because the
 * songs and the episodes live in them. Rather than depend on which of the two
 * it prefers, both are there — /playlist from playlist.html, /playlist/ from
 * playlist/index.html — and the canonical link names the one worth sharing.
 *
 * The copy is the whole of it: the two files are the same page, so writing the
 * second from the first is the only way they cannot drift.
 */
function listDirectoryIndexes() {
  return {
    name: 'list-directory-indexes',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        for (const kind of ['playlist', 'podcast']) {
          await copyFile(new URL(`${kind}.html`, dir), new URL(`${kind}/index.html`, dir));
          logger.info(`wrote ${kind}/index.html from ${kind}.html`);
        }
      },
    },
  };
}

/* Astro writes the pages that sit behind the permalinks.
   Every song and every episode has an address of its own, and on a static
   host that means a file of its own:

       /playlist/still-licensed   ->  dist/playlist/still-licensed.html

   build.format 'file' is what makes that a file rather than a directory with
   an index in it. GitHub Pages serves the extensionless path from <path>.html
   with a 200 and no redirect; the directory form would answer /playlist/song
   with a 301 to /playlist/song/, and the canonical links, the sitemap and the
   address the deck writes as it plays all name the slash-free spelling. */
export default defineConfig({
  site: 'https://radio.omarchy.org',
  integrations: [listDirectoryIndexes()],
  trailingSlash: 'never',
  build: {
    format: 'file',
    // The deck and its stylesheets are named by a stamp of their contents, so
    // a page cached before a deploy can never be served a deck it does not
    // fit. build-routes.py used to hash them by hand; this is the same idea,
    // done by the bundler.
    assets: '_astro',
  },
  vite: {
    build: {
      // The field, the router and the audio graph are one program. Splitting
      // them costs a round trip before the first sound.
      cssCodeSplit: false,
    },
  },
});
