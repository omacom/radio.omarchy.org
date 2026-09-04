import { createHash } from "node:crypto";
import { buildCycle, slotsBetween } from "./clock.mjs";
import { frames } from "./audio.mjs";
export function programme(tracks, from = 0) {
  const signature = createHash("sha256")
    .update(JSON.stringify(tracks.map(({ path, ...track }) => track)))
    .digest("hex");
  return { signature, from, tracks, cycle: buildCycle(tracks) };
}
export function scheduleUpdate(programmes, tracks, now) {
  const next = programme(tracks),
    last = programmes.at(-1);
  if (last.signature === next.signature) return false;
  // Finish a rotation after the public programme horizon. Previously advertised
  // and forward-sold records, including the first next record, remain unchanged.
  const duration = last.cycle.at(-1).end;
  next.from =
    last.from +
    Math.ceil(
      (Math.max(now + frames(1800), last.from + duration) - last.from) /
        duration,
    ) *
      duration;
  programmes.push(next);
  return true;
}
export function programmeSlots(programmes, start, end) {
  return programmes.flatMap((p, i) => {
    const until = programmes[i + 1]?.from ?? Infinity;
    if (end <= p.from || start >= until) return [];
    return slotsBetween(
      p.cycle,
      Math.max(0, start - p.from),
      Math.min(end, until) - p.from,
    ).map((s) => ({
      ...s,
      id: `${p.from}-${s.id}`,
      start: s.start + p.from,
      end: s.end + p.from,
    }));
  });
}
export function programmeContext(programmes, slot, window) {
  const neighbours = programmeSlots(
    programmes,
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
    window: { kind: window.kind, seconds: (window.end - window.start) / 44100 },
  };
}
