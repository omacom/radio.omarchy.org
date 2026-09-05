# Stories

`feed.rss` is [Omarchy Stories](https://omarchystories.org), mirrored from the
show's host. **Nothing here is written by hand.** A workflow overwrites the
file, so an edit would live until the next hour and then be gone.

The player reads the episode list out of this file. That is the whole reason
it is here: a browser will not read another site's feed unless that site sends
an `Access-Control-Allow-Origin` header, and the show's host sends it on the
preflight but not on the `GET` a plain read makes. Served from this repo, the
feed is same-origin and the question never comes up.

The episode audio is not mirrored. It is fetched from the show's host, at the
address the feed gives, so their download figures still count what they always
counted.

## How it gets here

[`.github/workflows/stories.yml`](../.github/workflows/stories.yml) runs
[`tools/fetch-stories.py`](../tools/fetch-stories.py) every hour and commits
the result when there is one. Run it yourself any time:

```bash
python3 tools/fetch-stories.py            # mirror it
python3 tools/fetch-stories.py --dry-run  # say what would change
```

It writes nothing unless the show has published something. The feed carries a
`lastBuildDate` stamped at the moment of the request, so comparing the whole
file would mean a commit every hour forever; the comparison ignores that line.

It also refuses to write a feed that will not load, is not a feed, or has lost
every episode when the copy here has some — a host having a bad day should not
be able to empty the panel. Those cases fail the job loudly and leave this file
alone, which is why the deck keeps working while the show's host does not.

## The page behind an episode

Every episode has an address of its own, `radio.omarchy.org/podcast/<episode>`,
and on a static host that means a file of its own. The same workflow writes
them, with [`tools/build-routes.py`](../tools/build-routes.py), straight after
mirroring the feed — so an episode's page arrives in the same commit the
episode does. Nothing under `podcast/` is written by hand either.

An episode published since the last mirror has no page yet. The link still
works: the host serves `404.html`, which is the deck, and the deck reads the
address and looks for the episode in the feed. It appears once the mirror has
run, and until then that link falls back to the playlist.

## If the show moves

The address lives in `FEED` at the top of `tools/fetch-stories.py`, and in
`STORIES_FEED` in [`assets/js/app.js`](../assets/js/app.js) if the player
should ever read the live feed directly instead of this copy.
