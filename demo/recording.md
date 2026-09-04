# Recorded demonstration

[Play the edited video](live-demo.mp4): 2 minutes 6 seconds, cut from the 6-minute-50-second take.

The [edit map](edit-cuts.json) records the original programme position and duration of each excerpt.

This take ran in real time on 4 September 2026, with a committed rotation of two complete repository tracks:

1. “David Picked It” — Patrick Johnson.
2. “prOdiMARCHY” — Corey.

The scenario is [furniture-show.json](furniture-show.json). Public source excerpts arrive at programme seconds 0 and 45. They are fixtures, not a live news feed.

OpenAI produced the briefs and links during the take. ElevenLabs rendered the presenter's speech using the configured voice. The model was `gpt-5.6-luna`.

Two idents, a five-second jingle, and a 30-second instrumental bed were made beforehand through ElevenLabs. Their prompts are in [production.json](../station/furniture/production.json).

The browser footage is real. Its soundtrack uses the same recorded stereo stems, programme frame positions, and duck envelope as browser playback.

The edit removes uninterrupted music between windows. It retains the complete jingle, ident, presenter window, recovery, and following record in each featured junction.

## Actual presenter output

At 02:45, the first link used 15.9 seconds of the guarded 29-second bed window. Speech was ready at 00:14:

> That was “prOdiMARCHY” by Corey. In a brief by dhh, Omarchy proposes setting foot’s touchpad scroll factor to 2.0, so precise scrolling no longer crawls at the group’s 1.5 default. Up next: “David Picked It” by Patrick Johnson.

Source: [dhh's recorded maintainer update](https://github.com/omacom/omarchy/commit/493067741e081c3b09082da6bfd51e99ec24ef00).

At 06:00, the second link was a short continuity announcement:

> That was “prOdiMARCHY” by Corey. Next up, “David Picked It” from Patrick Johnson.

The release brief did not pass the exact-quote check. The station kept its music schedule and admitted a grounded continuity link instead.

This is an example of actual provider output, including its limitations. The wording was not rewritten or replaced for the video.

## Verification

The take retains its original separate stems, continuous mix, source events, model responses, measured speech lengths, and published pair metadata locally.

The repository includes 40 tests. They cover cue guards, deadlines, provider failures, grounding, reconnects, suspension, DJ mute, MP3 timing, HTTP delivery, ICY output, and reserved furniture windows.

Docker execution, physical mobile/Safari testing, and sustained production load remain deployment checks. The local browser and split-host setup were exercised successfully.
