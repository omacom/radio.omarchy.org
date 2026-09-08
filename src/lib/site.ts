/* What the site calls itself, in the one place both the build and the deck
   can read it. */

export const CANON = 'https://radio.omarchy.org';

export const SITE_DESC =
  'The community playlist for the Omarchy desktop. Songs about Arch, ' +
  'Hyprland and dotfiles, every one of them sent in as a pull request.';

/** Where the songs live, so they can arrive by pull request. */
export const TRACKS_DIR = '/tracks/';
export const TRACKS_MANIFEST = '/tracks/playlist.json';
export const LYRICS_DIR = '/tracks/lyrics/';

/* Omarchy Stories is the show the community makes about running this desktop.
   Nothing about it lives in this repo; the feed is mirrored in hourly by
   .github/workflows/stories.yml and read from here rather than from the
   show's host, because a browser will not read another site's feed unless
   that site sends a header saying it may, and Riverside send it on the
   preflight but not on the GET a plain read makes. The episode audio is still
   the host's, so their download figures still count what they always counted. */
export const SHOW = 'Omarchy Stories';
export const SHOW_HOME = 'https://omarchystories.org';
/** The copy the deck reads, mirrored into this repo and served same-origin. */
export const STORIES_FEED = '/stories/feed.rss';
/* The show's own feed, on its host. This is the address to subscribe at — a
   podcast app should follow the show, not our mirror of it, and the host's
   download figures should go on counting what they always counted. It is what
   the structured data and the noscript list name; nothing in the browser
   fetches it, for the CORS reason above. */
export const SHOW_FEED = 'https://api.riverside.com/hosting/1i59HjrN.rss';
export const STORIES_TAG = 'from the community';

/* Where the songs come from. Every one of them arrived as a pull request, so
   the line in the header that says so is the way to the place you send one.
   tracks/README.md is the three lines of JSON, not the repository front page:
   somebody reading that line wants to know how, not what the licence is. */
export const REPO = 'https://github.com/omacom/radio.omarchy.org';
export const SUBMIT = REPO + '/blob/main/public/tracks/README.md';

/** What the deck calls itself while a song is playing out of the playlist. */
export const STATION = { name: 'Omarchy', tag: 'community playlist' };

/** Off while there are no sheets in tracks/lyrics/. */
export const SHOW_LYRICS = false;
/** The second list. Off leaves the deck one list and no switch. */
export const SHOW_PODCAST = true;
