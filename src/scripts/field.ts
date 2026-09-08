/* The field — the ground the deck sits on.
 *
 * Made of the same material as the field behind omarchy.org's wordmark: hard
 * cells on one lattice, thresholded through an ordered dither, each wearing
 * one of the theme's field inks rather than one ink at varying alpha. Nothing
 * is drawn as a haze. What lights a cell here is the record that is playing.
 *
 * Its own module because it is the one part of the deck with no opinion about
 * playback: hand it a canvas, the frame the lattice is anchored to, the
 * analyser's bands and the theme's inks, and it paints. The loudness it
 * settles on is worth reading back — src/scripts/lcd-vhs.ts drives the tape
 * off the same number, so the ground and the readout answer the same music.
 */

/** The three inks a lit cell can wear, out of the theme's five-step ramp. */
export interface FieldInks {
  fDim: string;
  fMid: string;
  fLit: string;
}

/** Classic 8x8 ordered dither matrix, 0..63. */
const BAYER = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
];

function rand(n: number): Float32Array {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = Math.random();
  return a;
}

/* Bayer on its own lights the same low-index cells everywhere, which at this
   density reads as a regular lattice rather than as texture. A fixed per-cell
   offset scatters the resting field, while the ordered structure still shows
   through wherever a loud band pushes a column bright. */
const JITTER = rand(4096);
/* The drifting texture, sampled as value noise rather than evaluated as a
   wave: blobs that wander and dissolve, not a pattern sliding past. */
const NOISE_SIZE = 128;
const NOISE = rand(NOISE_SIZE * NOISE_SIZE);

/** Bilinear value noise, smoothstepped, wrapping at the field's edge. */
function noiseAt(u: number, v: number): number {
  const s = NOISE_SIZE;
  const x = u - Math.floor(u / s) * s;
  const y = v - Math.floor(v / s) * s;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = (x0 + 1) % s;
  const y1 = (y0 + 1) % s;
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = NOISE[y0 * s + x0]!;
  const b = NOISE[y0 * s + x1]!;
  const c = NOISE[y1 * s + x0]!;
  const d = NOISE[y1 * s + x1]!;
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

/* The deck's frame is cut into this many cells across, the same count
   omarchy.org cuts its wordmark into. The field runs at the deck's own
   resolution rather than at a round number of pixels, and takes the frame's
   own left edge as the origin, so the two can never fall out of step however
   the window is sized. */
const FIELD_COLS = 81;
/* How much of a cell's luminance the resting texture is worth. The field is a
   ground, not a pattern: at this level roughly one cell in six clears the
   dither at rest, which reads as texture. Much above it and the ordered
   matrix starts to show through as a checkerboard. */
const REST = 0.34;
/** Grid cells per unit of noise: how big the drifting blobs read. */
const CELLS_PER_NOISE = 9;
/** How far, in CSS px, the resting field stays clear of the deck. */
const CLEAR_REACH = 240;
/* How it comes back over that distance. A smoothstep is half strength at the
   halfway mark, which packs texture right up against the frame and fights its
   1px border; cubed, it is an eighth there, so the field keeps its distance
   and builds out in the margins where there is room. */
const CLEAR_CURVE = 3;
/** How much of the field's height the loudest band may climb. */
const SPECTRUM_REACH = 0.92;
/** How dense a column gets, and how much of it wears the brighter inks. */
const SPECTRUM_DENSITY = 0.72;
const SPECTRUM_HEAT = 0.55;
/** Below this a band is resting and its column shows nothing extra. */
const SPECTRUM_FLOOR = 0.08;

let canvas: HTMLCanvasElement | null = null;
let frame: HTMLElement | null = null;
let dpr = 1;
/* The running loudness the field is drawn at, smoothed. Read back by
   fieldAmp() so the tape on the LCD breathes with the same number. */
let amp = 0;
/* A field that cannot move is painted once, not driven. */
let painted = false;

export function initField(bg: HTMLCanvasElement, app: HTMLElement): void {
  canvas = bg;
  frame = app;
}

export function sizeField(): void {
  if (!canvas) return;
  dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  painted = false; // the still field is sized to a window that just changed
}

/** The loudness the field settled on this frame, 0..1-ish. */
export function fieldAmp(): number {
  return amp;
}

/** Whether the one still frame a reduced-motion reader gets has been drawn. */
export function fieldPainted(): boolean {
  return painted;
}

/** A theme change, or anything else that makes the still frame wrong. */
export function markFieldStale(): void {
  painted = false;
}

/* A field that cannot move is still a field. It used to be skipped outright,
   which left reduced-motion readers a blank ground where everyone else got
   the texture; now it is painted once, standing still, and again only when
   the window or the theme changes. */
export function drawField(levels: Float32Array, inks: FieldInks, still = false): void {
  if (!canvas || !canvas.width || !frame) return;
  const g2d = canvas.getContext('2d');
  if (!g2d) return;

  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  const n = levels.length;

  let sum = 0;
  for (let i = 0; i < n; i++) sum += levels[i]!;
  amp = amp * 0.9 + (sum / n) * 0.1;

  // A field that cannot move still gets its texture; it simply stands still.
  const t = still ? 0 : performance.now() / 1000;
  if (still) painted = true;

  g2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  g2d.clearRect(0, 0, w, h);

  // The lattice is the deck's. The frame carries the scale factor in a
  // transform, so its measured box is what is actually on screen.
  const box = frame.getBoundingClientRect();
  const cell = (box.width || w) / FIELD_COLS;
  if (!(cell > 1)) return;

  const cMin = Math.floor(-box.left / cell);
  const rMin = Math.floor(-box.top / cell);
  const cMax = Math.ceil((w - box.left) / cell);
  const rMax = Math.ceil((h - box.top) / cell);
  const rowsTotal = h / cell;
  const midX = box.left + box.width / 2;
  const half = Math.max(1, w / 2);

  for (let col = cMin; col <= cMax; col++) {
    const x = box.left + col * cell;
    const cx = x + cell / 2;

    /* This column's band, mirrored about the deck: the bass at the outer
       edges where the field has the most room, the treble in towards the
       frame. Blended with its neighbour so the bands do not read as bars. */
    const side = Math.min(1, Math.abs(cx - midX) / half);
    const pos = (1 - side) * n - 0.5;
    const b0 = Math.max(0, Math.min(n - 1, Math.floor(pos)));
    const b1 = Math.min(n - 1, b0 + 1);
    const mixB = Math.max(0, Math.min(1, pos - b0));
    const raw = levels[b0]! * (1 - mixB) + levels[b1]! * mixB;
    const level = Math.max(0, (raw - SPECTRUM_FLOOR) / (1 - SPECTRUM_FLOOR));
    const tall = level * rowsTotal * SPECTRUM_REACH;
    const dx = Math.max(box.left - cx, 0, cx - box.right);

    for (let row = rMin; row <= rMax; row++) {
      const y = box.top + row * cell;
      const cy = y + cell / 2;

      // Inside the frame there is nothing to see: the deck is opaque.
      const dy = Math.max(box.top - cy, 0, cy - box.bottom);
      if (dx === 0 && dy === 0) continue;

      // How far the field has come back from the deck at this distance.
      let shade = Math.min(1, Math.sqrt(dx * dx + dy * dy) / CLEAR_REACH);
      shade = Math.pow(shade, CLEAR_CURVE);
      if (shade < 0.004) continue;

      const u = col / CELLS_PER_NOISE;
      const v = row / CELLS_PER_NOISE;
      const base = 0.6 * noiseAt(u + t * 0.14, v - t * 0.055) +
                   0.4 * noiseAt(u * 0.55 - t * 0.08, v * 0.55 + t * 0.06);
      // Each cell also blinks on its own rhythm, so a cell appearing is a
      // local event rather than the whole pattern drifting.
      const tw = 0.5 + 0.5 * Math.sin(t * 1.1 + JITTER[(row * 37 + col * 11) & 4095]! * 6.283);
      let lit = shade * (0.30 + 0.52 * base * base + 0.18 * tw + amp * 0.22) * REST;

      /* The spectrum thickens the column from the bottom up, as high as the
         band is loud, easing off towards the top rather than thinning in a
         straight line so the body of a column stays full. */
      let spec = 0;
      if (level > 0) {
        const up = (h - cy) / cell;
        if (up < tall) {
          spec = level * Math.pow(1 - up / tall, 0.85);
          lit += spec * SPECTRUM_DENSITY * Math.min(1, shade * 3);
        }
      }

      const threshold = 0.78 * ((BAYER[(row & 7) * 8 + (col & 7)]! + 0.5) / 64) +
                        0.22 * JITTER[((row & 63) * 64 + (col & 63)) & 4095]!;
      if (lit <= threshold) continue;

      const heat = spec * SPECTRUM_HEAT + amp * 0.12;
      g2d.fillStyle = heat > 0.34 ? inks.fLit : heat > 0.1 ? inks.fMid : inks.fDim;
      const px = Math.round(x);
      const py = Math.round(y);
      g2d.fillRect(px, py, Math.round(x + cell) - px, Math.round(y + cell) - py);
    }
  }
}
