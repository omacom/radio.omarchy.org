/* The tape on the readout.
 *
 * The LCD is the deck's one lit surface and the only part of it that is a
 * display rather than a control, which is what makes it the right place — and
 * the only right place — for a shader. Nothing here has to be clicked at a
 * position the effect has moved.
 *
 * Canvas UI's VHS draws by reading the real element into a canvas, through the
 * experimental HTML-in-canvas API. That is Chrome behind a flag today, and an
 * origin trial in production, so this is enhancement and nothing else: with no
 * support the readout stays exactly where it is, wearing the CSS scanlines it
 * always wore, and not a line of this runs.
 *
 * What it is driven by is the record. The field already answers the analyser —
 * mirrored bands, bass at the outer edges — so the tape reads the same
 * loudness out of src/scripts/field.ts and moves with it: the wave and the
 * head-switch band open up as a track gets loud, and a new track arrives with
 * a tear, the way a tape does when the head finds a splice.
 */

import { createVHS, supportsHtmlInCanvas, type VHSInstance } from '../components/canvasui/VHSVanilla.ts';
import { fieldAmp } from './field.ts';

/* At rest. The LCD is a readout with a 62px marquee on it, so this is a long
   way below the component's defaults: the tape has to be legible before it is
   anything else, and every one of these was set by reading the clock on it.
   Two are held at 0 on purpose — barrel would bend the marquee off its
   baseline, and vignette would darken the corner the visualiser sits in. */
const REST = {
  speed: 0.4,
  wave: 0.35,
  jitter: 0.08,
  crease: 0.06,
  switching: 0.03,
  switchingHeight: 0.02,
  bloom: 0.28,
  aberration: 0.8,
  acBeat: 0.45,
  grain: 0.05,
  /* The CSS overlay this replaces runs 2px on at .42 alpha; the shader's own
     lines are finer, so it takes a little more of them. */
  scanlines: 0.22,
  vignette: 0,
  barrel: 0,
  saturation: 1,
  exposure: 1,
} as const;

/** How far each of them travels between silence and the loudest the deck gets. */
const LOUD = {
  wave: 0.55,
  jitter: 0.22,
  crease: 0.14,
  switching: 0.1,
  bloom: 0.18,
  aberration: 1.6,
  acBeat: 0.35,
  grain: 0.06,
} as const;

/* A new record is a splice: the tape tears for a moment and settles. Seconds. */
const TEAR_MS = 620;

interface Elements {
  /** The section the whole readout sits in, which is what carries the height. */
  lcd: HTMLElement;
  /** The canvas that hosts the readout once the browser says it can. */
  source: HTMLCanvasElement;
  /** The readout itself. */
  content: HTMLElement;
  /** The canvas the shader draws to. */
  output: HTMLCanvasElement;
}

let vhs: VHSInstance | null = null;
let els: Elements | null = null;
let tornAt = 0;
let raf = 0;

/** True once the tape is actually running, so the deck can stop asking. */
export function tapeRunning(): boolean {
  return vhs !== null;
}

/* Both sides of the readout's box have to be written down before it goes into
   the canvas, and neither for the reason you would guess.
 *
 * The height, because the section takes its height from the readout, and once
 * the readout is inside the canvas the section has nothing in flow left to be
 * sized by.
 *
 * The width, because a canvas subtree is not laid out against the canvas's
 * box: left to itself the readout took its max-content width — 1646px inside
 * an 1178px canvas, the 62px marquee being what made it that wide — and the
 * two right-aligned things on it, the source label and the clock, were laid
 * out past the edge of the texture and never drawn.
 *
 * So both are measured where the readout really lives, before the move: out
 * of the canvas, read, back in. A forced layout, but only on a resize, which
 * already forces two.
 */
function pinBox(): void {
  if (!els) return;
  const { lcd, source, content } = els;
  const hosted = content.parentElement === source;
  if (hosted) lcd.insertBefore(content, source);
  lcd.style.height = '';
  content.style.width = '';
  const w = lcd.clientWidth;
  const h = content.offsetHeight;
  if (h) lcd.style.height = `${h}px`;
  if (w) content.style.width = `${w}px`;
  if (hosted) source.appendChild(content);
}

/**
 * Starts the tape, if this browser can draw an element into a canvas.
 *
 * @param reduceMotion Under a reduced-motion preference the tape is not
 *   started at all. A still frame of a moving artefact is not the effect
 *   standing still, it is a smeared readout — unlike the field, which has a
 *   texture worth painting frozen.
 * @returns whether it started.
 */
export function initLcdTape(elements: Elements, reduceMotion: boolean): boolean {
  if (reduceMotion || !supportsHtmlInCanvas()) return false;

  els = elements;
  const { lcd, source, content, output } = elements;

  pinBox();
  // The class is what swaps the CSS scanlines for the shader's own and brings
  // the two canvases into the box. Set before the move, so the source canvas
  // has a size to host into.
  lcd.classList.add('is-taped');
  source.appendChild(content);

  vhs = createVHS({ source, content, output }, REST);
  if (!vhs) {
    // WebGL2 refused. Put the readout back and leave no trace.
    lcd.insertBefore(content, source);
    lcd.classList.remove('is-taped');
    lcd.style.height = '';
    content.style.width = '';
    els = null;
    return false;
  }

  let width = lcd.clientWidth;
  const onResize = () => {
    if (!vhs || !els) return;
    // Height is a function of width here. A window that only got shorter has
    // not changed the readout, and re-measuring would flicker it.
    if (lcd.clientWidth !== width) {
      width = lcd.clientWidth;
      pinBox();
    }
    vhs.resize();
  };
  window.addEventListener('resize', onResize);
  if (window.ResizeObserver) new ResizeObserver(onResize).observe(lcd);

  drive();
  return true;
}

/** A new record. The tape tears, then settles. */
export function tearTape(): void {
  if (vhs) tornAt = performance.now();
}

/* One loop, reading the loudness the field settled on. It runs at the frame
   rate the deck already draws at rather than one of its own: the numbers only
   change when the field's do. */
function drive(): void {
  raf = requestAnimationFrame(drive);
  if (!vhs || !els) return;

  /* The readout is a readout: the clock counts, the marquee scrolls, and the
     title changes when the record does. The component captures the element on
     its own only when the box resizes — which is right for a page that sits
     still and wrong for this — so the capture is asked for every frame. The
     component's own onpaint marks the texture dirty and uploads it. */
  (els.source as HTMLCanvasElement & { requestPaint?: () => void }).requestPaint?.();

  // The field's amp is a smoothed mean of every band, which sits low. This
  // opens it out so a track at ordinary loudness reaches most of the range.
  const loud = Math.min(1, fieldAmp() * 3.2);

  // A tear decays over its own time, on top of whatever the music is doing.
  const since = performance.now() - tornAt;
  const tear = since < TEAR_MS ? Math.pow(1 - since / TEAR_MS, 2) : 0;

  const at = (rest: number, span: number, tearSpan = span * 4) =>
    rest + span * loud + tearSpan * tear;

  vhs.setOptions({
    wave: at(REST.wave, LOUD.wave),
    jitter: at(REST.jitter, LOUD.jitter),
    crease: at(REST.crease, LOUD.crease),
    switching: at(REST.switching, LOUD.switching),
    // The head-switch band grows with the tear rather than only getting
    // noisier, which is what reads as the head finding a splice.
    switchingHeight: REST.switchingHeight + 0.06 * tear,
    bloom: at(REST.bloom, LOUD.bloom, 0),
    aberration: at(REST.aberration, LOUD.aberration),
    acBeat: at(REST.acBeat, LOUD.acBeat, 0),
    grain: at(REST.grain, LOUD.grain),
    // A tear drops the colour out for a moment, the way a bad splice does.
    saturation: 1 - 0.55 * tear,
    exposure: 1 + 0.12 * tear,
  });
}

/** Stops the tape and puts the readout back. Not used by the deck; here so a
    console can turn it off, and so destroy() is not dead in the component. */
export function stopLcdTape(): void {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  vhs?.destroy();
  vhs = null;
  if (!els) return;
  const { lcd, source, content } = els;
  if (content.parentElement === source) lcd.insertBefore(content, source);
  lcd.classList.remove('is-taped');
  lcd.style.height = '';
  content.style.width = '';
  els = null;
}
