// One backfillable primitive, tied to the source bytes, never to title alone.
// Word timing is useful context, but missing words cannot prove no vocals.
export function trackSheet(input, hash, duration) {
  const empty = {
    version: 1,
    sha256: hash,
    metadata: {},
    lyrics: { coverage: "unknown", words: [] },
    sections: [],
    windows: [],
    vocals: [],
    ending: "unknown",
    reviewed: false,
  };
  if (!input || input.version !== 1 || input.sha256 !== hash) return empty;
  const interval = (r) =>
    r &&
    Number.isFinite(r.start) &&
    Number.isFinite(r.end) &&
    r.start >= 0 &&
    r.start < r.end &&
    r.end <= duration;
  const words = input.lyrics?.words;
  if (
    words !== undefined &&
    (!Array.isArray(words) ||
      words.length > 20000 ||
      !words.every(
        (w) =>
          interval(w) && typeof w.text === "string" && w.text.length <= 200,
      ))
  )
    return empty;
  const sections = input.sections ?? [];
  if (
    !Array.isArray(sections) ||
    !sections.every(
      (s) =>
        interval(s) &&
        [
          "intro",
          "verse",
          "chorus",
          "bridge",
          "instrumental",
          "outro",
        ].includes(s.kind),
    )
  )
    return empty;
  const metadata = input.metadata ?? {};
  return {
    ...empty,
    ...input,
    metadata: {
      pronunciation:
        typeof metadata.pronunciation === "string"
          ? metadata.pronunciation.slice(0, 500)
          : "",
      facts: Array.isArray(metadata.facts)
        ? metadata.facts
            .filter(
              (f) => typeof f.text === "string" && typeof f.source === "string",
            )
            .slice(0, 12)
            .map((f) => ({
              text: f.text.slice(0, 500),
              source: f.source.slice(0, 500),
            }))
        : [],
    },
    lyrics: {
      coverage: ["complete", "partial"].includes(input.lyrics?.coverage)
        ? input.lyrics.coverage
        : "unknown",
      words: words ?? [],
    },
    sections,
  };
}
export function sheetContext(sheet, window, slotStart, rate) {
  const start = (window.start - slotStart) / rate,
    end = (window.end - slotStart) / rate;
  return {
    metadata: sheet.metadata,
    sections: sheet.sections.filter(
      (s) => s.end > start - 15 && s.start < end + 15,
    ),
    lyrics: {
      coverage: sheet.lyrics.coverage,
      words: sheet.lyrics.words
        .filter((w) => w.end > start - 5 && w.start < end + 10)
        .slice(0, 80),
    },
    ending: sheet.ending,
  };
}
