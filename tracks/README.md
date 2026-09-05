# Tracks

The playlist for Omarchy Radio, and the whole of what the deck plays. Every
track here is served straight from the repo, so adding one is a pull request.

The order in `playlist.json` is the order it plays in, from the top, round
again at the end.

## Add a track

1. Drop your MP3 in this folder, named `Artist - Title.mp3`, or
   `Artist - Title-explicit.mp3` if the lyrics are explicit.
2. Add an entry to `playlist.json`.
3. Open a pull request.

```json
{
  "title": "Play the Machine",
  "artist": "Dan T.",
  "file": "Dan T. - Play the Machine.mp3"
}
```

That is the whole entry. There is no id to invent and no count to bump. The
song's own page — `radio.omarchy.org/playlist/<title>` — is written for you
when the pull request lands, along with its card and its sitemap entry.

## Fields

| field | required | notes |
| --- | --- | --- |
| `title` | yes | shown in the playlist and the marquee |
| `artist` | yes | shown under the title |
| `file` | yes | filename in this folder, exactly as on disk |
| `album` | no | shown in place of the artist while playing |
| `url` | no | full URL for a track hosted elsewhere, used instead of `file` |
| `explicit` | no | `true` shows an EXPLICIT badge beside the title |
| `lyrics` | no | filename of the sheet in `lyrics/`, or `false` for none |

If the lyrics are explicit, set `explicit`, end the filename `-explicit.mp3`, and
put `[EXPLICIT]` in the pull request title.

Spaces, accents and apostrophes in `file` are fine. The player encodes the
name when it builds the URL, so write it exactly as the file is named and do
not escape anything yourself.

## Lyrics

Optional, and only you can send them: they are your words, so nobody else
gets to put them on the site for you.

Drop a file in `lyrics/` named after the MP3 — `Artist - Title.lrc` for
`Artist - Title.mp3` — and the player finds it on its own. No manifest change
is needed unless the sheet is named something else, in which case name it in
the `lyrics` field.

Plain text is fine, one line per line:

```
Woke up to a merge conflict
Coffee going cold on the desk
```

Add timestamps and the player follows along, lighting each line as it comes.
The format is `[mm:ss.cc]`, and a line can carry more than one stamp if it
comes round again:

```
[00:12.40]Woke up to a merge conflict
[00:16.10]Coffee going cold on the desk
[01:04.00][02:18.00]This is the chorus, twice
```

A `lyrics` button appears on the playlist panel whenever a track is playing.
Without a sheet it says so and points here.

## What to send

- MP3, 320 kbps or lower. Keep it under 10 MB.
- Your own creation, and set in the Omarchy universe. The [README](../README.md)
  covers what that means.
- Order in `playlist.json` is the order in the player. New tracks go wherever
  fits, the list is roughly alphabetical by artist.

## Check it before you push

Serve the repo root and open the player:

```bash
python3 -m http.server 8000
```

Your track should appear in the playlist panel and play when clicked. If it
does not, the usual cause is `file` not matching the filename on disk.

To see the page behind its permalink, write the pages first and serve them the
way the host does:

```bash
python3 tools/build-routes.py     # write the page for every song
python3 tools/test-routes.py      # check every address answers with its page
```

Neither is required of a pull request: a workflow runs them when it lands.
