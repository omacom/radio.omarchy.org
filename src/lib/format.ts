/* The labels a row carries, so the page and the deck spell them the same way.
 *
 * The build writes the rows into the page and the deck rebuilds them a moment
 * later out of the manifest and the feed. Anything the two spell differently
 * shows up as a row that changes under the reader on load, so the spelling
 * lives here and both sides read it.
 */

/** mm:ss. The clock is monospace and the deck is one size, so it is padded. */
export function fmt(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/* Spelled out here rather than by locale: the deck is one typeface at one
   size, and an engine that renders September as "Sept" makes the list ragged
   on some machines and not others. */
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun',
                'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/* UTC, so a page built in CI reads the same as the deck does in a browser
   somewhere else. A published date is a day, not a moment. */
export function dateLabel(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  if (isNaN(d.getTime())) return '';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/* An episode is an hour, not three minutes: minutes are the useful unit, and
   the clock in the deck still counts the seconds. */
export function lengthLabel(secs: number): string {
  if (!secs) return '';
  const m = Math.round(secs / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** itunes:duration, which arrives as seconds, mm:ss or hh:mm:ss. */
export function hms(raw: unknown): number {
  if (!raw) return 0;
  let out = 0;
  for (const part of String(raw).split(':')) {
    const n = parseInt(part, 10);
    if (isNaN(n)) return 0;
    out = out * 60 + n;
  }
  return out;
}
