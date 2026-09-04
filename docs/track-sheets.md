# Track sheets

A track sheet combines presentation cues, metadata, sections, and word timestamps. It describes one exact audio file.

The schema is [track-sheet.schema.json](../station/track-sheet.schema.json). Runtime validation also enforces interval order, track duration, vocal clearance, and review provenance.

`station/cues.json` maps repository filenames to track sheets. An absent or invalid sheet closes all track mic windows. Junctions remain available.

## Time and identity

`sha256` identifies the original MP3 bytes. All times use seconds from the first decoded audio sample, after MP3 padding removal.

The station converts these values to integer frames at 44,100 Hz. A changed file invalidates the old sheet, even if its filename stays identical.

The decode profile is `pcm-v1`: FFmpeg decode, loudness normalization, stereo, 44,100 Hz. A future profile change requires a new broadcast identity.

## Example shape

This example illustrates the format. Its hash and timings are placeholders, not approved cues for a repository track.

```json
{
  "version": 1,
  "sha256": "0000000000000000000000000000000000000000000000000000000000000000",
  "reviewed": false,
  "metadata": {
    "pronunciation": "Oh-mar-key",
    "facts": [{"text": "Contributor-supplied context", "source": "Repository pull request URL"}]
  },
  "lyrics": {
    "coverage": "partial",
    "words": [
      {"text": "Open", "start": 8.1, "end": 8.45, "line": 0, "confidence": 0.94},
      {"text": "the", "start": 8.46, "end": 8.6, "line": 0, "confidence": 0.91},
      {"text": "terminal", "start": 8.61, "end": 9.3, "line": 0, "confidence": 0.95}
    ]
  },
  "sections": [{"kind": "intro", "start": 0, "end": 8}],
  "vocals": [{"start": 8, "end": 30}],
  "windows": [{"kind": "intro", "start": 0.3, "end": 7, "confidence": "candidate", "evidence": "Candidate from analysis"}],
  "ending": "unknown",
  "analysis": {"tool": "future alignment pipeline", "version": "1"}
}
```

## Backfill workflow

1. Run `npm run analyze:tracks`.
2. Inspect the hash, loudness, and silence report in `station/analysis.json`.
3. Add aligned words and section candidates from your analysis tool.
4. Include sung words, backing vocals, speech, and ad-libs in vocal regions.
5. Listen to each proposed mic window against the exact MP3.
6. Copy the selected sheet into `station/cues.json`, under its filename.
7. Set each approved window's `confidence` to `reviewed`.
8. Set `reviewed`, `reviewedBy`, and `reviewedAt` after review.
9. Start a new broadcast with a new `RADIO_DATA` directory.

The live process retains its committed sheets and programme. A restart with changed sheets refuses to overwrite that broadcast.

## Admission rules

Words veto conflicting windows, including partial or low-confidence transcripts. Gaps between words never create windows. A complete transcript can still miss backing vocals.

Silence analysis supplies evidence, not permission. Intro, instrumental, and outro windows require explicit review. The scheduler adds half-second guards at both ends.

`ending` preserves the record's ending style. The station plays each record to its measured end and does not invent crossfades across unknown vocals.

The presenter receives nearby words, sections, pronunciation notes, and sourced facts. It cannot edit the sheet or authorize its own mic window.

Future alignment tools can populate this primitive without changing the playout API. Lyrics remain off the listener interface until the existing lyrics feature is enabled.
