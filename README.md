# Omarchy Radio

The site behind [radio.omarchy.org](https://radio.omarchy.org). A live stream, and an on-demand playlist that lives in this repo. Every song in the playlist arrived as a pull request.

## Submissions

Make it with AI. That is not a concession, it is the point. You do not need a band, a studio, a singer, or any of the things that used to stand between having an idea for a song about dotfiles and hearing one.

Any tool is fair game. If you have never done this, Suno is an easy place to start: write the lyrics yourself (or have your agent do that too), give it a style, keep pulling the lever until a take lands. Udio, a local model, something you rigged up yourself, all fine. Nobody is checking which one you used.

**It still has to be yours.** Your prompt, your lyrics, your generations, your call on which take ships. Prompting is writing. What you cannot do is submit someone else's song, generated or not.

**It has to live in the Omarchy universe.** Arch, Hyprland, omakase, dotfiles, the terminal, Quattro, the license, the oligarchy, fork o'clock, the two days you lost to a display config. That is the world, and it is wide open. Take any corner of it and make it yours.

For a sense of how far that can go, listen to [Still Licensed](https://radio.omarchy.org/#still-licensed) by Michel Krapf. It is unmistakably about this world, and it gets there by an angle all its own. Go and beat it.

**Label explicit lyrics.** Swearing is welcome, labelling it keeps it that way. Name the file `Artist - Title-explicit.mp3` and put `[EXPLICIT]` in the pull request title, so it gets the badge in the player and nobody is caught out at work.

## How to send one

Drop the MP3 in `tracks/`, add three lines to `tracks/playlist.json`, open a pull request. The details are in [tracks/README.md](tracks/README.md).

## The podcast

The playlist panel has a second list: **podcast**, which is [Omarchy Stories](https://omarchystories.org), the show the community makes about running this desktop. Nothing about it lives in this repo. The player reads the show's RSS feed when it loads, so an episode appears here because it was published, not because anybody remembered to add it. Pressing one plays it, the row opens to show its chapters and what it is about, and pressing a chapter jumps there. Every episode has its own link, `radio.omarchy.org/#stories/<episode>`, the same way a song does.

One thing to know if the list is ever empty: a browser will only read a feed from another site if that site says it may, with an `Access-Control-Allow-Origin` header on the response. Riverside, who host the show, send that header on the preflight but not on the feed itself, and a plain `GET` never asks for a preflight — so Chrome refuses the read and the panel says the feed would not load. Nothing in this repo can fix that from the outside; it takes either Riverside sending the header or a host we control passing the feed through with one. The single line to repoint is `STORIES_FEED` at the top of [assets/js/app.js](assets/js/app.js). The player keeps the last list it managed to read, so once it works, it keeps working offline too.

## Agentic station backend

This fork adds a shared producer and presenter around the repository's music. The existing player adds a DJ toggle for synchronized live stems.

Run `npm start` with Node 24, FFmpeg, and util-linux installed. Configuration, provider setup, transport details, and verification are in [the station guide](docs/station.md).

The [track-sheet primitive](docs/track-sheets.md) supports reviewed cues, sourced metadata, sections, and word-level lyric timestamps. Existing tracks can receive analysis backfills without changing contributions.

Static-only hosting retains the original live stream. The shared backend requires the Node service and persistent storage.

The [demo guide](docs/demo.md) includes timed source replay and prerecorded station furniture. The short take runs locally with the same live providers and playout.
