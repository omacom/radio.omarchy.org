# Omarchy Radio

The site behind [radio.omarchy.org](https://radio.omarchy.org). A playlist that lives in this repo and plays itself: open the page and it starts at the top, works its way down, and goes round again. Every song in it arrived as a pull request.

There is no live stream any more, and no listener counter. What is here is the songs, the show, and a link to each one.

## Submissions

Make it with AI. That is not a concession, it is the point. You do not need a band, a studio, a singer, or any of the things that used to stand between having an idea for a song about dotfiles and hearing one.

Any tool is fair game. If you have never done this, Suno is an easy place to start: write the lyrics yourself (or have your agent do that too), give it a style, keep pulling the lever until a take lands. Udio, a local model, something you rigged up yourself, all fine. Nobody is checking which one you used.

**It still has to be yours.** Your prompt, your lyrics, your generations, your call on which take ships. Prompting is writing. What you cannot do is submit someone else's song, generated or not.

**It has to live in the Omarchy universe.** Arch, Hyprland, omakase, dotfiles, the terminal, Quattro, the license, the oligarchy, fork o'clock, the two days you lost to a display config. That is the world, and it is wide open. Take any corner of it and make it yours.

For a sense of how far that can go, listen to [Still Licensed](https://radio.omarchy.org/playlist/still-licensed) by Michel Krapf. It is unmistakably about this world, and it gets there by an angle all its own. Go and beat it.

**Label explicit lyrics.** Swearing is welcome, labelling it keeps it that way. Name the file `Artist - Title-explicit.mp3` and put `[EXPLICIT]` in the pull request title, so it gets the badge in the player and nobody is caught out at work.

## How to send one

Drop the MP3 in `public/tracks/` named `artist-title.mp3`, add three lines to `public/tracks/playlist.json`, open a pull request. That is the whole of it — nothing generated lives in this repo, so a song is a song and not also the thirty-odd pages it changes. The details are in [public/tracks/README.md](public/tracks/README.md).

## Links

Every song has an address of its own, `radio.omarchy.org/playlist/<song>`, and every episode has `radio.omarchy.org/podcast/<episode>`. Those are real pages, one per item, written by [Astro](https://astro.build) out of the playlist and the mirrored feed: open one and it arrives with the song's name in the tab, its own card wherever it is pasted, and the song itself baked into the page so it starts playing before anything is fetched.

From there it is one deck. Pressing a row swaps the audio and rewrites the address without reloading, so following a link never costs you what you were already hearing, and back goes back. The `#` beside a row copies that row's address.

You do not have to write any of it. Add a song and the build writes its page; the show publishes an episode and the hourly mirror brings the feed in, which is what makes the next build write that one. The links from before this — `radio.omarchy.org/#still-licensed` — still open the same song, and rewrite themselves to the path on the way in.

An address is spelled by one rule, in [src/lib/slug.ts](src/lib/slug.ts), and both halves import it: the build names the file, the deck works out which song a path means. They cannot disagree, because there is nothing to disagree with.

## Being sent to a song

Following a link to the twenty-seventh song used to open the list at the top
of it, which is not what the link promised. The row the address names is
brought into view now — and only that: pressing a row is a press on something
already on screen, and a track ending into the next one leaves the list where
whoever is reading it left it.

## It starts itself

Open the page and the deck is already playing. That took working out, because
no browser grants an audible autoplay to a site the listener has not engaged
with before, and there is no arguing with it.

The exemption everybody quotes is that a muted autoplay is always allowed —
and it turns out to be an exemption for `<video>`, not for `<audio>`. Measured
under both of Chromium's restrictive policies:

| | |
| --- | --- |
| `new Audio(src)`, `muted = true` | `NotAllowedError` |
| `new Audio(src)`, `volume = 0` | `NotAllowedError` |
| `<video>`, `muted = true` | plays |

So the deck plays through a `<video>` element that has no picture, which is a
perfectly ordinary thing for a media element to be: same API, same events,
same analyser, same media session, never in the document. It also happens to
be the only kind of element iOS would ever have autoplayed.

A first visit therefore arrives with the clock running, the marquee on the
song and the row saying playing — silently, and the footer says so. The first
press anywhere turns the sound on **where the track has got to**, not from the
top, because joining a song part-way through is what tuning in has always
been. A returning listener whose browser already trusts the site gets the
sound immediately.

## Finding a song

Thirty-odd songs is a list you read; a hundred is a list you search. **find**
sits over the list and filters it as you type — `/` puts the cursor there,
escape empties it. Every word has to appear somewhere in the row, title or
artist, so `koontz fix` finds the one Kevin Koontz song about fixing
everything. Accents are folded on both sides: `aurelien` finds Aurélien.

A filtered row keeps the number it has in the playlist, not the number it has
among the matches, the same way the page behind a permalink shows one row
still numbered 02. The address is deliberately left alone — everything else
the deck does to what is on screen goes into the path, because those are
places you can send somebody, and a half-typed query is not one.

## Wearing the desktop's theme

The deck has twenty-four themes named after Omarchy's own, each derived from
four seeds: a ground, an ink, an accent and a line. Install
[omarchy-theme-sync](https://github.com/omacom/omarchy-theme-sync) and it gets
a twenty-fifth, first in the list — **desktop** — which is the theme the
machine is actually running, and which follows it: switch your desktop theme
and the deck repaints without a reload.

That is not an approximation. The extension publishes Omarchy's own
`colors.toml`, and the deck's four seeds are exactly a projection of it:

| seed | `colors.toml` |
| --- | --- |
| ground | `background` |
| ink | `bright_foreground`, or `foreground` where a theme has no brighter one |
| accent | `accent` |
| line | `selection` |

Run over the 22 Omarchy themes installed on a machine, those four keys
reproduce all 22 of the hand-copied entries in the list, value for value — the
list *is* this projection, written down. So following the desktop is the same
derivation the deck already does, with the seeds arriving live instead of from
a file.

Without the extension — every browser that is not Chromium on Omarchy — the
entry is not there and the deck is the twenty-four themes it always was. When
your desktop theme is also one of the twenty-four, both appear: **desktop**
follows, and the named one pins.

The extension only lets `omarchy.org` itself *set* themes, so this is a
one-way follow. Reading is open to any page.

## The meter

The bars under the clock are a stereo's meter rather than a graph: each band
is a stack of bricks on a fixed lattice, a brick is on or off, and a column
is always a whole number of them. Three zones, one hue — the accent mixed
toward the LCD's own ground for the quiet body, the accent itself through the
middle, the accent lifted off the ground at the top — so it comes out of
whatever theme is on and reads as the same material as the field behind the
deck. On a light theme the top of the ramp darkens instead of lightening,
because contrast is what "hot" means.

## The songs are files

Every track is served straight out of the repo, so a filename is also an
address: `radio.omarchy.org/tracks/<file>`. They used to be named
`Artist - Title.mp3`, which works — the player encodes it — and arrives as
`/tracks/Aur%C3%A9lien%20-%20Omarchee%2C%20c'est%20la%20vie.mp3`, which is not
something anybody can read, type, or paste into `mpv` without care.

They are slugs now, through the same rule that turns a title into an address:
`aurelien-omarchee-cest-la-vie.mp3`. The title and the artist in
`playlist.json` keep their punctuation, their accents and their capitals,
because those are what anybody actually reads. The filename is plumbing, and
`npm test` holds it to that shape so it cannot drift back.

## The icons are drawn

The transport was characters — `▶` `◀◀` `■` `❙❙`, plus the carets and the
arrow that says a link leaves the site — and **not one of them is in a subset
this site ships.** JetBrains Mono arrives here as latin and latin-ext;
geometric shapes and arrows are in neither, so the deck's most important
controls were being drawn by whatever font each platform fell back to. Two of
them, `▶` and `◀`, are in Unicode's emoji set, so a phone could render the
play button as a colour emoji.

They are bitmaps now — [`src/lib/icons.ts`](src/lib/icons.ts), cells on a
lattice at one cell to the pixel, the same material as the 15×15 wordmark, the
field's hard cells and the meter's bricks. A stepped triangle is the one kind
of icon that cannot go blurry, because there is no curve in it to resolve.
Both halves read the same table: the page puts them in, and the deck draws the
same caret when it builds a row itself. `npm test` fails if a character ever
comes back.

## The podcast

The playlist panel has a second list: **podcast**, which is [Omarchy Stories](https://omarchystories.org), the show the community makes about running this desktop. Nothing about it lives in this repo. The player reads the show's RSS feed when it loads, so an episode appears here because it was published, not because anybody remembered to add it. Pressing one plays it, the row opens to show its chapters and what it is about, and pressing a chapter jumps there. Every episode has its own link, `radio.omarchy.org/podcast/<episode>`, the same way a song does.

The feed itself is mirrored into this repo, at [public/stories/feed.rss](public/stories/feed.rss), by a workflow that runs every hour and commits only when the show has published something. That is not for want of trying to read it live: a browser will only read a feed from another site if that site says it may, with an `Access-Control-Allow-Origin` header on the response, and the show's host sends it on the preflight but not on the `GET` a plain read makes. Mirroring the file makes the feed same-origin and the question moot. The episode audio is still the host's, so their download figures are unaffected. Details in [public/stories/README.md](public/stories/README.md).

## Working on it

```bash
npm install
npm run dev        # the deck, at localhost:4321, rebuilt as you save
npm run build      # every page, into dist/
npm test           # build, then ask for every address and follow every link
npm run check      # types
npm run test:browser   # drive a real browser over the routes (needs chromium)
```

`npm run build` writes 38 pages: the front, the two lists, one per song, one
per episode, the 404 the host serves for anything else, and the sitemap. CI
runs the same three commands and publishes `dist/`; nothing generated is
committed.

Where things are:

| | |
| --- | --- |
| `src/pages/` | one file per kind of address |
| `src/components/`, `src/layouts/` | the deck's markup, once |
| `src/lib/` | what the build and the browser both read: the slug rule, the two lists, the labels, the cards |
| `src/scripts/deck.ts` | the player: audio, routing, the two lists, painting |
| `src/scripts/field.ts` | the dithered field behind the deck |
| `src/scripts/theme.ts` | the twenty-four themes, and what a theme derives into |
| `src/scripts/omarchy-theme.ts` | reading the desktop's live theme |
| `src/scripts/lcd-vhs.ts` | the tape on the readout |
| `src/styles/style.css` | the design |
| `public/` | served as-is: the songs, the mirrored feed, the fonts, the service worker |

## The readout, played back as tape

The LCD — the lit panel with the marquee and the clock on it — is drawn
through [Canvas UI](https://canvasui.dev)'s VHS shader, with the tape wave,
the head-switch band and the chroma bleed driven by the same analyser that
lights the field: it opens up as a track gets loud, and tears for a moment
when the record changes.

It is the only surface on the deck that gets one, and deliberately. Nothing on
it is a control, so nothing has to be clicked at a position a shader has
moved; and the effect needs Chrome's experimental HTML-in-canvas API, which
means a flag today (`chrome://flags/#canvas-draw-element`) and an origin trial
in production. Everywhere else the readout is ordinary DOM wearing the CSS
scanlines it always wore — which is what almost everyone sees, and is why the
tape is an enhancement and never the design.

The component is vendored, the way that library ships — `npx shadcn@latest add
@canvas-ui/vhs-vanilla` drops it back into `src/components/canvasui/`, and
this deck's own wiring is next door in `src/scripts/lcd-vhs.ts`, so an update
overwrites nothing of ours.
