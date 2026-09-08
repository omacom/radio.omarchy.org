/* Structured data: what this page is, for the engines that read that.
 *
 * The graph is anchored on @id rather than repeated: a song points at the
 * playlist it is in, the playlist and the show point at the site, and the
 * site points at the organisation over on omarchy.org. */

import { CANON, SHOW, SHOW_FEED, SITE_DESC } from './site.ts';
import { clip } from './lists.ts';
import type { Item } from './item.ts';

const ORG = 'https://omarchy.org/#organization';

/** The site, the organisation behind it, the front page, and the show.
 *
 * Every page carries this, and a page about one thing — a song, an episode,
 * the playlist — carries a second block of its own beside it. */
export function siteGraph(showHome: string) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${CANON}/#website`,
        url: `${CANON}/`,
        name: 'Omarchy Radio',
        description: SITE_DESC,
        inLanguage: 'en',
        publisher: { '@id': ORG },
      },
      {
        '@type': 'Organization',
        '@id': ORG,
        name: 'Omarchy',
        url: 'https://omarchy.org',
        description: 'Beautiful, Fun & Agentic Linux by DHH',
        logo: {
          '@type': 'ImageObject',
          url: `${CANON}/assets/images/icon-512.png`,
          width: 512,
          height: 512,
        },
      },
      {
        '@type': 'WebPage',
        '@id': `${CANON}/#webpage`,
        url: `${CANON}/`,
        name: 'Omarchy Radio',
        isPartOf: { '@id': `${CANON}/#website` },
        about: { '@id': `${CANON}/playlist#playlist` },
        mentions: { '@id': `${CANON}/#stories` },
        image: [
          `${CANON}/assets/images/opengraph.png`,
          `${CANON}/assets/images/opengraph-16x9.png`,
          `${CANON}/assets/images/opengraph-4x3.png`,
          `${CANON}/assets/images/opengraph-square.png`,
        ],
        primaryImageOfPage: {
          '@type': 'ImageObject',
          url: `${CANON}/assets/images/opengraph.png`,
          width: 1200,
          height: 630,
          caption: 'Omarchy Radio',
        },
        inLanguage: 'en',
      },
      /* The show. seriesNode() below describes this same @id on the /podcast
         page, so the two have to agree about every field they both carry. */
      {
        '@type': 'PodcastSeries',
        '@id': `${CANON}/#stories`,
        name: SHOW,
        url: showHome,
        webFeed: SHOW_FEED,
        description:
          'A signal from nowhere — a transmission by the community, for the community.',
        inLanguage: 'en',
        publisher: { '@id': ORG },
      },
    ],
  };
}

export function playlistNode(tracks: Item[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'MusicPlaylist',
    '@id': `${CANON}/playlist#playlist`,
    name: 'Omarchy Radio playlist',
    url: `${CANON}/playlist`,
    numTracks: tracks.length,
    description:
      'Songs about the Omarchy desktop, every one of them made by somebody who runs it.',
    track: tracks.map((t, i) => ({
      '@type': 'MusicRecording',
      position: i + 1,
      name: t.title,
      url: `${CANON}/${t.key}`,
      byArtist: { '@type': 'Person', name: t.artist || 'unknown' },
    })),
  };
}

export function songNode(track: Item, path: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'MusicRecording',
    '@id': `${CANON}${path}#recording`,
    name: track.title,
    url: CANON + path,
    byArtist: { '@type': 'Person', name: track.artist || 'unknown' },
    inPlaylist: { '@id': `${CANON}/playlist#playlist` },
    publisher: { '@id': ORG },
    isFamilyFriendly: !track.explicit,
    audio: {
      '@type': 'AudioObject',
      contentUrl: `${CANON}/${track.url.replace(/^\/+/, '')}`,
      encodingFormat: 'audio/mpeg',
    },
  };
}

export function seriesNode(episodes: Item[], home: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'PodcastSeries',
    '@id': `${CANON}/#stories`,
    name: SHOW,
    url: home,
    webFeed: SHOW_FEED,
    numberOfEpisodes: episodes.length,
    episode: episodes.map((e) => ({
      '@type': 'PodcastEpisode',
      name: e.title,
      url: `${CANON}/${e.key}`,
      datePublished: e.date,
    })),
  };
}

export function episodeNode(ep: Item, path: string, home: string) {
  const node: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'PodcastEpisode',
    '@id': `${CANON}${path}#episode`,
    name: ep.title,
    url: CANON + path,
    partOfSeries: { '@type': 'PodcastSeries', name: SHOW, url: home },
    associatedMedia: {
      '@type': 'AudioObject',
      contentUrl: ep.url,
      encodingFormat: 'audio/mpeg',
    },
  };
  if (ep.date) node.datePublished = ep.date;
  if (ep.secs) node.timeRequired = `PT${Math.max(1, Math.round(ep.secs / 60))}M`;
  if (ep.summary) node.description = clip(ep.summary, 500);
  return node;
}
