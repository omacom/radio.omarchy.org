# Local live demo

The demo uses the same station, producer, presenter, TTS, MP3 renderer, and browser player as normal operation.

Only source arrival is controlled. Recorded public excerpts enter the real ingestion path at specified programme times.

`demo/show.json` selects three complete repository tracks and three source arrivals. It does not contain scripts for the presenter.

The show runs in real time. Its reference news date stays fixed so future rehearsals can use the same excerpts without freshness expiry.

## Record a take

1. Copy `.env.example` to `.env` and configure the model and voice.
2. Run `PORT=8788 RADIO_DATA=var-demo npm run demo`.
3. Open [the local station](http://127.0.0.1:8788) and press Play.
4. Let the show run for at least 16 minutes.
5. Stop it with Ctrl-C. Use a new data directory for another take.

The first start prepares the music catalogue. Preparation finishes before the programme clock starts.

The demo saves these private files under `RADIO_DATA/recording`:

- `music.s16le` and `dj.s16le`: separate stereo stems at 44.1 kHz.
- `mix.s16le`: the broadcast mix with the browser's duck envelope.
- `pairs.jsonl`: published timing, metadata, and audio hashes.
- `events.jsonl`: source arrivals, model results, measured speech, and admission decisions.

The renderer records ahead of transmission. Trim the aircheck to the intended programme duration before sharing it.

For example, export the full broadcast mix:

```sh
ffmpeg -f s16le -ar 44100 -ac 2 -i var-demo/recording/mix.s16le \
  -t 960 -c:a libmp3lame -b:a 128k var-demo/full-show.mp3
```

To check the delivered MP3 files independently, use `RADIO_URL=http://127.0.0.1:8788 npm run aircheck` while the station runs.

## Video disclosure

The edited video uses actual browser footage and audio from the same programme clock. Uninterrupted music is cut between presentation windows.

The video must state that source arrivals are replayed fixtures. It must not imply a live news feed or scripted model output.

Keep original footage, separate stems, and the event log locally. Publish the short edit and a factual transcript with the PR.

The soundtrack can be reconstructed from the recorded stems because the browser uses the same frame positions and duck envelope.

## Limits

Provider output varies between takes. A declined, unsupported, late, or overlong link stays off air. It is not replaced with prerecorded successful speech.

Existing tracks have no reviewed talkover windows. This take uses guarded junctions between complete records. Future reviewed track sheets can admit intro and instrumental links.

## Short take with station furniture

`DEMO_SCENARIO=demo/furniture-show.json PORT=8789 RADIO_DATA=var-demo-furniture npm run demo` runs the shorter, 6-minute-50-second show.

It plays two complete repository tracks per rotation, two predetermined source arrivals, alternating prerecorded idents, a jingle, and a 30-second bed.

The supplied MP3 furniture is ready to use. `node --env-file-if-exists=.env scripts/make-furniture.mjs` can regenerate it offline through ElevenLabs.

Generation prompts and provenance are in `station/furniture/production.json`. Music generation is used only for these explicitly produced station assets.

API reference: [ElevenLabs instrumental composition](https://elevenlabs.io/docs/api-reference/music/compose/).

`node scripts/edit-demo.mjs <take-directory> <output.mp4>` assembles recorded browser frames and the corresponding programme audio.

Its input `video/frames.jsonl` records each screenshot filename, wall-clock milliseconds, browser programme position, and running state. Capture through browser developer tools.

The edit retains whole presentation windows, adds explanatory captions, and cuts the intervening music. It does not generate or replace presenter speech.
