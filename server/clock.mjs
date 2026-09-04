import { frames, RATE } from "./audio.mjs";
export const GUARD = frames(0.5);
export function validateCues(sheet, sha256, length) {
  const closed = {
    reviewed: false,
    windows: [],
    vocals: [],
    ending: "unknown",
  };
  if (
    !sheet ||
    sheet.sha256 !== sha256 ||
    sheet.reviewed !== true ||
    !sheet.reviewedBy ||
    !Number.isFinite(Date.parse(sheet.reviewedAt))
  )
    return closed;
  const range = (r) =>
    r &&
    Number.isFinite(r.start) &&
    Number.isFinite(r.end) &&
    r.start >= 0 &&
    r.end > r.start &&
    frames(r.end) <= length;
  if (
    !Array.isArray(sheet.windows) ||
    !Array.isArray(sheet.vocals) ||
    !sheet.windows.every(range) ||
    !sheet.vocals.every(range)
  )
    return closed;
  if (!["unknown", "cold", "fade", "sustain"].includes(sheet.ending))
    return closed;
  const vocals = [...sheet.vocals, ...(sheet.lyrics?.words ?? [])].map((r) => ({
    start: frames(r.start),
    end: frames(r.end),
  }));
  const windows = sheet.windows
    .filter(
      (w) =>
        ["intro", "instrumental", "outro"].includes(w.kind) &&
        w.confidence === "reviewed",
    )
    .map((w) => ({ start: frames(w.start), end: frames(w.end), kind: w.kind }))
    .filter(
      (w) =>
        !vocals.some((v) => w.start < v.end + GUARD && w.end > v.start - GUARD),
    )
    .sort((a, b) => a.start - b.start);
  if (windows.some((w, i) => i && w.start < windows[i - 1].end)) return closed;
  return { reviewed: true, windows, vocals, ending: sheet.ending };
}
export function buildCycle(tracks) {
  let time = 0;
  const cycle = [];
  for (const [i, t] of tracks.entries()) {
    cycle.push({
      id: `track-${i}`,
      type: "track",
      start: time,
      end: time + t.frames,
      trackId: t.id,
      title: t.title,
      artist: t.artist,
      explicit: t.explicit,
      ending: t.cues.ending,
    });
    time += t.frames;
    if ((i + 1) % 3 === 0 || i === tracks.length - 1) {
      cycle.push({
        id: `junction-${i}`,
        type: "junction",
        start: time,
        end: time + (t.furniture?.frames ?? frames(18)),
        ...(t.furniture
          ? {
              furnitureId: t.furniture.id,
              micStart: t.furniture.micStart,
              micEnd: t.furniture.micEnd,
            }
          : {}),
        title: "Omarchy Radio",
        artist: "The community frequency",
      });
      time += t.furniture?.frames ?? frames(18);
    }
  }
  return cycle;
}
export function slotsBetween(cycle, start, end) {
  const duration = cycle.at(-1).end,
    result = [];
  for (
    let lap = Math.max(0, Math.floor(start / duration));
    lap <= Math.floor(end / duration);
    lap++
  ) {
    for (const s of cycle) {
      const slot = {
        ...s,
        id: `${lap}-${s.id}`,
        rotation: lap,
        start: s.start + lap * duration,
        end: s.end + lap * duration,
      };
      if (slot.end > start && slot.start < end) result.push(slot);
    }
  }
  return result;
}
export function micWindows(slot, track) {
  const ranges =
    slot.type === "junction"
      ? [
          {
            start: slot.micStart ?? 0,
            end: slot.micEnd ?? slot.end - slot.start,
            kind: "junction",
          },
        ]
      : (track?.cues.windows ?? []);
  return ranges
    .map((w, i) => ({
      id: `${slot.id}-mic-${i}`,
      kind: w.kind,
      start: slot.start + w.start + GUARD,
      end: slot.start + w.end - GUARD,
    }))
    .filter((w) => w.end - w.start >= frames(4));
}
export function admit(window, length, now, sealedThrough, links = []) {
  return (
    Number.isSafeInteger(length) &&
    length > 0 &&
    window.start + length <= window.end &&
    window.start > Math.max(now + frames(24), sealedThrough) &&
    !links.some((l) => Math.abs(l.start - window.start) < frames(180))
  );
}
export function contextFor(cycle, slot, window) {
  const neighbours = slotsBetween(
    cycle,
    Math.max(0, slot.start - frames(1800)),
    slot.end + frames(1800),
  );
  return {
    previous:
      neighbours
        .filter((s) => s.type === "track" && s.end <= window.start)
        .at(-1) ?? null,
    current:
      neighbours.find(
        (s) =>
          s.type === "track" && s.start <= window.start && s.end > window.start,
      ) ?? null,
    next:
      neighbours.find((s) => s.type === "track" && s.start > window.start) ??
      null,
    window: { kind: window.kind, seconds: (window.end - window.start) / RATE },
  };
}
