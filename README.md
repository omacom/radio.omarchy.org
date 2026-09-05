# Omarchy Radio

The site behind [radio.omarchy.org](https://radio.omarchy.org). A live stream, and an on-demand playlist that lives in this repo. Every song in the playlist arrived as a pull request.

## Submissions

Make it with AI. That is not a concession, it is the point. You do not need a band, a studio, a singer, or any of the things that used to stand between having an idea for a song about dotfiles and hearing one.

Any tool is fair game. If you have never done this, Suno is an easy place to start: write the lyrics yourself (or have your agent do that too), give it a style, keep pulling the lever until a take lands. Udio, a local model, something you rigged up yourself, all fine. Nobody is checking which one you used.

**It still has to be yours.** Your prompt, your lyrics, your generations, your call on which take ships. Prompting is writing. What you cannot do is submit someone else's song, generated or not.

**It has to live in the Omarchy universe.** Arch, Hyprland, omakase, dotfiles, the terminal, Quattro, the license, the oligarchy, fork o'clock, the two days you lost to a display config. That is the world, and it is wide open. Take any corner of it and make it yours.

For a sense of how far that can go, listen to [Still Licensed](https://radio.omarchy.org/playlist/still-licensed) by Michel Krapf. It is unmistakably about this world, and it gets there by an angle all its own. Go and beat it.

**Label explicit lyrics.** Swearing is welcome, labelling it keeps it that way. Name the file `Artist - Title-explicit.mp3` and put `[EXPLICIT]` in the pull request title, so it gets the badge in the player and nobody is caught out at work.

## How to send one

Drop the MP3 in `tracks/`, add three lines to `tracks/playlist.json`, open a pull request. The details are in [tracks/README.md](tracks/README.md).

## Links

Every song has an address of its own, `radio.omarchy.org/playlist/<song>`, and every episode has `radio.omarchy.org/podcast/<episode>`. Those are real pages, one per item, written by [tools/build-routes.py](tools/build-routes.py) and committed like anything else: open one and it arrives with the song's name in the tab, its own card wherever it is pasted, and the song itself baked into the page so it starts playing before anything is fetched.

From there it is one deck. Pressing a row swaps the audio and rewrites the address without reloading, so following a link never costs you what you were already hearing, and back goes back. The `#` beside a row copies that row's address.

You do not have to write any of it. Add a song and the workflow writes its page; the show publishes an episode and the hourly mirror writes that one. The links from before this — `radio.omarchy.org/#still-licensed` — still open the same song, and rewrite themselves to the path on the way in.

## The podcast

The playlist panel has a second list: **podcast**, which is [Omarchy Stories](https://omarchystories.org), the show the community makes about running this desktop. Nothing about it lives in this repo. The player reads the show's RSS feed when it loads, so an episode appears here because it was published, not because anybody remembered to add it. Pressing one plays it, the row opens to show its chapters and what it is about, and pressing a chapter jumps there. Every episode has its own link, `radio.omarchy.org/podcast/<episode>`, the same way a song does.

The feed itself is mirrored into this repo, at [stories/feed.rss](stories/feed.rss), by a workflow that runs every hour and commits only when the show has published something. That is not for want of trying to read it live: a browser will only read a feed from another site if that site says it may, with an `Access-Control-Allow-Origin` header on the response, and the show's host sends it on the preflight but not on the `GET` a plain read makes. Mirroring the file makes the feed same-origin and the question moot. The episode audio is still the host's, so their download figures are unaffected. Details in [stories/README.md](stories/README.md).
