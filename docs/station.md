# Shared station

This backend adds one shared programme to the existing Omarchy Radio player. Repository tracks remain the music catalogue and contribution path.

The original project contributes cue awareness, presentation memory, and deterministic admission. The Omarchy prototype contributes separate editorial calls, source adapters, measured TTS, and paired stems.

The backend replaces the prototype's memory-resident audio and restart clock. It does not reuse the replacement frontend.

## Run locally

Requirements: Node 24, FFmpeg, and `flock` from util-linux. Local development speech also requires `espeak-ng`.

1. Copy `.env.example` to `.env`.
2. Configure the provider credentials and model in `.env`.
3. Run `npm start`.
4. Open [the local station](http://127.0.0.1:8787).

The first start decodes the catalogue to disk. Subsequent starts reuse these files. This catalogue uses about 1.2 GB of decoded storage.

`TTS_PROVIDER=local` supplies a development voice. `TTS_PROVIDER=elevenlabs` uses the configured broadcast voice. Missing providers keep the microphone closed.

Without an LLM, the station can play a short ident at junctions. Music continues during provider errors. Tests do not require provider credentials.

## Programme ownership

The catalogue order supplies the default rotation. `npm run plan:programme` asks the model for a proposed order and saves `station/programme.json`.

Validation requires every catalogue hash exactly once. A new broadcast loads that plan before presentation begins. Listeners cannot change it.

The station commits its epoch, catalogue signature, cycle, and links to `RADIO_DATA`. A kernel file lock permits one writer per volume.

Normal restarts retain the epoch and committed speech. An outage advances the programme according to wall time. Clients rejoin the current programme.

Run `npm run prepare:catalog` after updating repository tracks or cue sheets, then restart the service.

The new rotation starts at a cycle boundary beyond the next 30 minutes. Existing records and announcements keep their committed times.

Keep the persistent volume and cached audio through updates. Experimental version-one data directories require a fresh directory for this MP3 transport.

Every third record ends at a planned junction. The final record also has a junction.

The supplied furniture uses a five-second jingle with a voiced ident, followed by a 30-second instrumental bed. Idents alternate between rotations.

`station/furniture.json` selects these prerecorded assets. Their measured frames set the junction length and reserve an opening before the presenter window.

They are hashed, decoded once, and committed with the programme. The runtime never generates jingles or instrumental music.

Without a furniture configuration, the station uses an 18-second junction with a small synthesized bed and sting.

Records play to their measured ends. Cold endings remain cold, and recorded fades remain intact. Unknown endings do not trigger speculative crossfades.

Track sheets can add reviewed intro, instrumental, and outro windows. See [Track sheets](track-sheets.md).

## Editorial path

The producer chooses from four bounded research tools: official releases, configured maintainers' commits, community issues and curated items, and configured X accounts.

Adapters retain the author, canonical URL, publication time, retrieval time, and content hash. Canonical URLs and identical text prevent duplicate ingestion.

Stories expire after seven days. Source failures have bounded backoff. `station/community.json` accepts curated stories with `title`, `text`, `author`, `url`, and `publishedAt`.

The producer selects a story, an angle, and facts with exact supporting quotes. The presenter receives that brief and the committed neighbouring records.

The presenter also receives the mic window, nearby track-sheet context, and recent links. It can decline. A separate grounding call checks its final wording.

Source IDs and quotes have deterministic checks. Semantic grounding remains probabilistic and requires editorial evaluation with the selected model.

All source text is untrusted data. Models cannot run commands, fetch arbitrary URLs, change the programme, publish segments, or authorize talkover.

Recent links and aired stories persist. A story becomes aired only after its committed link ends. The programme log restores reservations after restart.

## Timing and transport

All internal positions are integer stereo frames at 44,100 Hz. FFmpeg measures rendered speech from decoded PCM, including leading and trailing silence.

Speech must fit the guarded window. Admission also requires a 24-second lead and at least 180 seconds between links. Late speech is discarded.

The renderer prepares four-second music and DJ segments about 20 seconds ahead. Both stems use 128 kbps MP3, matching the existing stream, with silence in unused DJ frames.

Each file has Xing/LAME gapless metadata and two MPEG frames of context at each end. The browser removes this context after decoding.

A decoder must return the declared frame count. Unsupported decoders fail closed rather than play misaligned speech.

The renderer writes both files before publishing their shared marker. Each marker includes broadcast ID, sequence, frame count, hashes, record metadata, and admitted links.

Public requests cannot generate audio or retrieve unpublished segments. The disk ring retains about two minutes of history. The browser verifies hashes and decoded duration.

Both sources start on one AudioContext clock, at the same time and offset. A listener joins about 12 seconds behind the station clock.

The player fetches both stems even when DJ audio is muted. The DJ toggle cancels ducking without stopping, seeking, or replacing the music source.

Ducking starts 120 milliseconds before speech and recovers over 450 milliseconds. DJ transport failure removes ducking for the affected segment.

A clock difference above 1.5 seconds causes both stems to rejoin together. Reconnects and suspended tabs discard stale buffers. Metadata follows scheduled audio.

The service worker excludes live APIs and station configuration. Static-only hosting retains the upstream stream. The Node server enables the shared station explicitly.

On-demand tracks, explicit labels, deep links, podcast code, themes, and contribution workflows retain their existing paths. The listener interface adds only the DJ toggle.

## Operation

The existing frontend is served by GitHub Pages. The live MP3 stream is on `radio.cliamp.stream`, behind nginx.

The public stream uses 128 kbps MP3 at 44.1 kHz. Its endpoints match cliamp-server. The private deployment configuration is unknown.

Keep Pages and the existing stream hostname. Add one companion container behind the current reverse proxy:

1. Configure `.env`, including `ALLOWED_ORIGINS=https://radio.omarchy.org`.
2. Run `docker compose up -d --build` on the stream host.
3. Add the locations from [deploy/nginx.conf](../deploy/nginx.conf) to its existing HTTPS server block.
4. Run `npm run configure:station -- https://radio.cliamp.stream` in the Pages checkout and deploy that static file.
5. Preserve the named `station-data` volume across deployments. Run one writer per volume.
6. Set `OPS_TOKEN` for private inspection and monitor `/api/health` for publication lag.

The container listens on host loopback port 8788. No database, queue, additional public hostname, or frontend build system is required.

`/api/station` and `/api/audio/` serve synchronized stems. `/omarchy/stream` serves a conventional continuous mixed MP3 with optional ICY metadata.

Both transports follow the same programme. Conventional players receive the mixed broadcast; independent DJ control is available in the browser.

`/api/statistics` counts this service's listeners. It does not import the previous stream server's historical statistics or geographic data.

The operations endpoint requires bearer authentication. Listener responses exclude provider state, editorial working memory, credentials, and local paths.

Static assets remain on Pages. `station-config.js` selects the stream origin, and the backend permits only configured browser origins.

For a split-host local rehearsal, run the backend on port 8788 and `npm run dev:web` on port 8790. Include that frontend origin in `ALLOWED_ORIGINS`.

Browser delivery uses two 128 kbps streams plus small manifests. The conventional stream uses one 128 kbps stream per listener.

A deployment needs sustained load measurements and a real-device browser matrix. Web Audio suspension policies can interrupt background playback, especially on mobile browsers.

After suspension, the player rejoins the station rather than resuming stale speech. The play button can resume an audio context that requires a gesture.

The file lock protects one local volume. Multiple hosts need an external single-writer lease and shared immutable storage before horizontal deployment.

## Verification

Run `npm test` for cue guards, deadlines, grounding, provider failures, atomic publication, restart recovery, HTTP boundaries, MP3 frame-count roundtrips, and browser scheduling simulations.

Run `npm run aircheck` to record and verify paired output. `AIRCHECK_SECONDS` controls duration. `AIRCHECK_DIR` selects the output directory.

The aircheck stores separate stems, the local ducked mix, and metadata. It verifies hashes and decoded frame counts for every pair.

Live browser checks cover playback, DJ mute, on-demand switching, and rejoining. Mocked provider tests do not establish real-model editorial quality or voice quality.

API adapter reference: [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

Deployment references: [upstream repository](https://github.com/omacom/radio.omarchy.org), [cliamp-server API](https://github.com/bjarneo/cliamp-server/blob/main/docs/api.md), and [cliamp-server Docker guide](https://github.com/bjarneo/cliamp-server/blob/main/docs/docker.md).

See [the recorded demo guide](demo.md) for timed source arrivals and reproducible local recording.
