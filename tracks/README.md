# Tracks

The on-demand playlist for Omarchy Radio. Every track here is served straight
from the repo, so adding one is a pull request.

The live stream is separate and is not affected by anything in this folder.

## Add a track

1. Drop your MP3 in this folder, named `Artist - Title.mp3`.
2. Add an entry to `playlist.json`.
3. Open a pull request.

```json
{
  "title": "Play the Machine",
  "artist": "Dan T.",
  "file": "Dan T. - Play the Machine.mp3"
}
```

That is the whole entry. There is no id to invent and no count to bump.

## Fields

| field | required | notes |
| --- | --- | --- |
| `title` | yes | shown in the playlist and the marquee |
| `artist` | yes | shown under the title |
| `file` | yes | filename in this folder, exactly as on disk |
| `album` | no | shown in place of the artist while playing |
| `url` | no | full URL for a track hosted elsewhere, used instead of `file` |

Spaces, accents and apostrophes in `file` are fine. The player encodes the
name when it builds the URL, so write it exactly as the file is named and do
not escape anything yourself.

## What to send

- MP3, 320 kbps or lower. Keep it under 10 MB.
- Only music you made, or that you hold the rights to distribute.
- Order in `playlist.json` is the order in the player. New tracks go wherever
  fits, the list is roughly alphabetical by artist.

## Check it before you push

Serve the repo root and open the player:

```bash
python3 -m http.server 8000
```

Your track should appear in the playlist panel and play when clicked. If it
does not, the usual cause is `file` not matching the filename on disk.
