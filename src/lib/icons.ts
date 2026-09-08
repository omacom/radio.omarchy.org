/* The deck's icons, drawn as bitmaps.
 *
 * They were characters — ▶ ◀◀ ■ ❙❙ ▼ ▾ ▸ ↗ — and not one of them is in any
 * subset this site ships. JetBrains Mono arrives as latin and latin-ext;
 * geometric shapes and arrows are in neither, so the deck's transport was
 * being drawn by whatever font the browser fell back to, which is a different
 * font on every platform. Two of them, U+25B6 and U+25C0, are also in
 * Unicode's emoji set, so a phone could and did render the play button as a
 * colour emoji.
 *
 * So they are drawn here instead, and drawn the way everything else on this
 * deck is drawn: as cells on a lattice. The wordmark is a 15x15 bitmap of
 * axis-aligned rects, the field is hard on-or-off cells, the meter is bricks
 * — a stepped triangle is the same material, and it is the one kind of icon
 * that cannot go blurry, because there is no curve in it to resolve.
 *
 * The lattice is 1 cell to 1 CSS pixel at the size these render, so the steps
 * land on the pixel grid and shape-rendering: crispEdges keeps them there.
 *
 * Both halves read this: Icon.astro puts them in the page, and the deck's
 * paintTracks() puts the same caret in a row it builds itself.
 */

/** [x, y, width, height], in cells. */
export type Cell = [number, number, number, number];

export interface Icon {
  /** The box, in cells. Also its size in CSS pixels. */
  w: number;
  h: number;
  cells: Cell[];
  /** What it is, for anything that needs to say so out loud. */
  label: string;
}

/* A triangle, stepped. `rows` is how far the shape reaches on each row, and
   `dir` is which edge is the straight one — a right-pointing triangle has its
   flat side on the left and grows rightward, a left-pointing one is the
   mirror of that. */
function triangle(rows: number[], dir: 'right' | 'left', x0: number, span: number): Cell[] {
  return rows.map((w, y): Cell =>
    dir === 'right' ? [x0, y, w, 1] : [x0 + (span - w), y, w, 1]);
}

/* Ten rows reaching two cells further each row: a 45-degree edge that lands
   on whole pixels the whole way down, which is the only reason to pick these
   numbers over any others. */
const BIG = [2, 4, 6, 8, 10, 10, 8, 6, 4, 2];
/* Half the size, so a single step, for the pair of small ones either side. */
const SMALL = [1, 2, 3, 4, 5, 5, 4, 3, 2, 1];

export const ICONS: Record<string, Icon> = {
  /* The transport, all four on one 12x10 box so they are the same weight in
     a row of buttons and need no nudging to look centred. */
  play: { w: 12, h: 10, label: 'Play', cells: triangle(BIG, 'right', 1, 10) },

  pause: { w: 12, h: 10, label: 'Pause', cells: [[2, 0, 3, 10], [7, 0, 3, 10]] },

  stop: { w: 12, h: 10, label: 'Stop', cells: [[2, 1, 8, 8]] },

  /* Two triangles, the way a tape deck marks them, rather than a bar and one
     the way a disc player does: this deck has a tape on its readout. */
  prev: {
    w: 12, h: 10, label: 'Previous track',
    cells: [...triangle(SMALL, 'left', 0, 5), ...triangle(SMALL, 'left', 6, 5)],
  },
  next: {
    w: 12, h: 10, label: 'Next track',
    cells: [...triangle(SMALL, 'right', 0, 5), ...triangle(SMALL, 'right', 6, 5)],
  },

  /* The carets: the theme menu's, and the one on an episode's row. */
  'caret-down': {
    w: 7, h: 4, label: 'Open',
    cells: [[0, 0, 7, 1], [1, 1, 5, 1], [2, 2, 3, 1], [3, 3, 1, 1]],
  },
  'caret-up': {
    w: 7, h: 4, label: 'Close',
    cells: [[3, 0, 1, 1], [2, 1, 3, 1], [1, 2, 5, 1], [0, 3, 7, 1]],
  },
  'caret-right': {
    w: 4, h: 7, label: 'Open',
    cells: [[0, 0, 1, 7], [1, 1, 1, 5], [2, 2, 1, 3], [3, 3, 1, 1]],
  },

  /* The two lists. A note for the songs, a microphone for the show, both
     drawn small enough to sit in a 10px label without shouting over it. */
  note: {
    w: 7, h: 9, label: 'Songs',
    cells: [
      [0, 6, 4, 3],          // the head, filled
      [4, 0, 1, 7],          // the stem, off its right shoulder
      [5, 0, 2, 1], [6, 1, 1, 2],  // and the flag
    ],
  },
  mic: {
    w: 7, h: 9, label: 'Podcast',
    cells: [
      [2, 0, 3, 5],          // the capsule
      [0, 3, 1, 3], [6, 3, 1, 3],  // the cradle, down either side
      [1, 6, 5, 1],          // its base
      [3, 7, 1, 2],          // the stand
    ],
  },

  /* Leaves the site. The one icon that is not a shape but a sign. */
  'arrow-ne': {
    w: 7, h: 7, label: 'Opens in a new tab',
    cells: [
      [3, 0, 4, 1], [6, 0, 1, 4],
      [0, 6, 1, 1], [1, 5, 1, 1], [2, 4, 1, 1], [3, 3, 1, 1], [4, 2, 1, 1], [5, 1, 1, 1],
    ],
  },
};

/**
 * One icon, as an `<svg>`.
 *
 * Decorative by default: these sit inside buttons and links that already say
 * what they are, and a second voice reading "play" after "Play or pause" is
 * one more than anybody needs.
 *
 * @param name which icon
 * @param cls extra classes, for the ones the deck shows and hides in pairs
 */
export function iconSvg(name: keyof typeof ICONS | string, cls = ''): string {
  const icon = ICONS[name];
  if (!icon) throw new Error(`no icon called ${name}`);
  const rects = icon.cells
    .map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`)
    .join('');
  return `<svg class="i i-${name}${cls ? ' ' + cls : ''}" viewBox="0 0 ${icon.w} ${icon.h}" ` +
    `width="${icon.w}" height="${icon.h}" fill="currentColor" ` +
    `shape-rendering="crispEdges" aria-hidden="true" focusable="false">${rects}</svg>`;
}
