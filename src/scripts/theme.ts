/* The themes, and what a theme is derived into.
 *
 * Four seeds — ground, ink, accent, line — and every other token is computed
 * from them. Twenty-four Omarchy themes at four values each, rather than six
 * at twenty-five: the derivation is the design, and it is why adding a theme
 * is one line.
 *
 * A leaf module on purpose. Nothing here touches the DOM, so the field, the
 * tape on the LCD and applyTheme() can all read the same colours without any
 * of them having to know about the others.
 */

/** A theme, as it is written down: a ground, an ink, an accent and a line. */
export interface Skin {
  name: string;
  bg: string;
  fg: string;
  ac: string;
  bd: string;
}

/** A theme, as the deck uses it. */
export interface Theme extends Skin {
  bdF: string;
  c2: string;
  c3: string;
  rowOn: string;
  rowHov: string;
  trk: string;
  lcd: string;
  acFg: string;
  acHi: string;
  g1: string;
  g2: string;
  /** The meter's three zones, bottom to top. */
  mLow: string;
  mMid: string;
  mHigh: string;
  /** The field's five-step ink ramp. */
  fDim: string;
  fMid: string;
  fLit: string;
  fHov: string;
  fCrest: string;
  light: boolean;
}

/** Named after Omarchy's own. Nine of them are light. */
export const SKINS: Skin[] = [
  { name: 'green',            bg: '#0a0b0a', fg: '#e7e6e0', ac: '#5ef2a0', bd: '#23261f' },
  { name: 'daylight',         bg: '#f7f6f2', fg: '#23231f', ac: '#2f9e63', bd: '#dedbd2' },
  { name: 'catppuccin',       bg: '#1e1e2e', fg: '#cdd6f4', ac: '#89b4fa', bd: '#45475a' },
  { name: 'catppuccin latte', bg: '#eff1f5', fg: '#4c4f69', ac: '#1e66f5', bd: '#ccd0da' },
  { name: 'ethereal',         bg: '#060b1e', fg: '#ffcead', ac: '#7d82d9', bd: '#252e56' },
  { name: 'everforest',       bg: '#2d353b', fg: '#d3c6aa', ac: '#7fbbb3', bd: '#3d484d' },
  { name: 'flexoki light',    bg: '#fffcf0', fg: '#100f0f', ac: '#205ea6', bd: '#cecdc3' },
  { name: 'gruvbox',          bg: '#282828', fg: '#d4be98', ac: '#7daea3', bd: '#504945' },
  { name: 'hackerman',        bg: '#0b0c16', fg: '#ddf7ff', ac: '#82fb9c', bd: '#1f253a' },
  { name: 'kanagawa',         bg: '#1f1f28', fg: '#dcd7ba', ac: '#dcd7ba', bd: '#363646' },
  { name: 'last horizon',     bg: '#0c0b0c', fg: '#e2dddc', ac: '#b59790', bd: '#584e51' },
  { name: 'lumon',            bg: '#16242d', fg: '#f2fcff', ac: '#8bc9eb', bd: '#243d56' },
  { name: 'lupine',           bg: '#fafafa', fg: '#000000', ac: '#3264eb', bd: '#d0d0d0' },
  { name: 'matte black',      bg: '#121212', fg: '#bebebe', ac: '#e68e0d', bd: '#2a2a2a' },
  { name: 'miasma',           bg: '#222222', fg: '#c2c2b0', ac: '#78824b', bd: '#383838' },
  { name: 'nord',             bg: '#2e3440', fg: '#d8dee9', ac: '#81a1c1', bd: '#434c5e' },
  { name: 'osaka jade',       bg: '#111c18', fg: '#f7e8b2', ac: '#509475', bd: '#32473b' },
  { name: 'retro 82',         bg: '#05182e', fg: '#f6dcac', ac: '#faa968', bd: '#134e5a' },
  { name: 'ristretto',        bg: '#2c2525', fg: '#e6d9db', ac: '#f38d70', bd: '#403e41' },
  { name: 'rose pine',        bg: '#faf4ed', fg: '#575279', ac: '#56949f', bd: '#dfdad9' },
  { name: 'solitude',         bg: '#101315', fg: '#a5aeb4', ac: '#798186', bd: '#343d41' },
  { name: 'tokyo night',      bg: '#1a1b26', fg: '#c0caf5', ac: '#7aa2f7', bd: '#292e42' },
  { name: 'vantablack',       bg: '#000000', fg: '#ffffff', ac: '#8d8d8d', bd: '#1a1a1a' },
  { name: 'white',            bg: '#ffffff', fg: '#000000', ac: '#6e6e6e', bd: '#c0c0c0' },
];

/* ── colour maths (mirrors the design's mix/lum) ─────── */

/** Linear sRGB, so a mix lands where the eye expects it to. */
export function mix(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return '#' + pa.map((v, i) =>
    Math.round(v + (pb[i]! - v) * t).toString(16).padStart(2, '0')).join('');
}

/** Rec. 709 luminance, which is what decides light from dark. */
export function lum(hex: string): number {
  const p = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * p[0]! + 0.7152 * p[1]! + 0.0722 * p[2]!;
}

/* Relative luminance, linearised — which lum() above is not, and should not
   become: it decides whether a theme is light, and it has decided that the
   same way for twenty-four themes. This one is for contrast, where the
   gamma actually matters. */
function relative(hex: string): number {
  const p = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * p[0]! + 0.7152 * p[1]! + 0.0722 * p[2]!;
}

function contrast(a: string, b: string): number {
  const la = relative(a);
  const lb = relative(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/* Dims `ink` toward `ground`, but no further than `floor` contrast against it.
 *
 * A fraction of the way to the ground is not the same amount of dimming in
 * both directions. On a dark theme the accent is bright and the ground is
 * near-black, so 45% of the way still leaves a colour that reads. On a light
 * theme the ground is near-white and an accent has little contrast against
 * white to begin with, so the same 45% is most of what there was — which is
 * why the LCD's small labels came out as a pale wash on every light theme,
 * and on several dark ones whose accent is close to their ground.
 *
 * So the mix asks for as much dimming as it can have and then walks back until
 * the result reads. A theme already clear of the floor is not touched at all. */
function dim(ink: string, ground: string, t: number, floor: number): string {
  let at = t;
  let out = mix(ink, ground, at);
  // Twentieths: finer than the eye follows, and a handful of steps at worst.
  while (at > 0 && contrast(out, ground) < floor) {
    at = Math.max(0, at - 0.05);
    out = mix(ink, ground, at);
  }
  return out;
}

/** A theme's four seeds, worked up into everything the deck paints with. */
export function derive(t: Skin): Theme {
  const { bg, fg, ac, bd } = t;
  const light = lum(bg) > 0.5;
  const deep = light ? '#ffffff' : '#000000';
  // Away from the ground: white on a dark theme, black on a light one.
  const lift = light ? '#000000' : '#ffffff';
  const lcd = mix(bg, deep, light ? 0.55 : 0.5);
  const acHi = mix(ac, lift, 0.3);
  return {
    name: t.name, bg, fg, ac, bd,
    bdF: mix(bd, bg, 0.55),
    c2: mix(fg, bg, 0.48),
    c3: mix(fg, bg, 0.7),
    rowOn: mix(ac, bg, 0.88),
    rowHov: mix(fg, bg, 0.93),
    trk: mix(fg, bg, 0.85),
    lcd,
    acFg: lum(ac) > 0.55 ? mix(bg, '#000000', 0.35) : '#ffffff',
    acHi,
    /* The LCD's own dim inks: g1 for its small labels and the artist line,
       g2 for the total time, which is the quietest thing on the panel. The
       floors are what they need to stay readable at 9px and 17px; the
       hierarchy between them is unchanged. */
    g1: dim(ac, lcd, 0.45, 3),
    g2: dim(ac, lcd, 0.62, 2.2),

    /* The meter's three zones, and its own ramp rather than g1/ac/acHi.
       Those step *toward* the LCD's ground, which works on a dark theme
       where the ground is near-black and the accent is bright — but on a
       light theme the ground is near-white and the quiet end of the ramp
       washes out to almost nothing. A ramp is made of contrast against the
       panel, so this steps away from the ground in both polarities: the
       quiet end is close to it, and the hot end is as far from it as the
       theme goes. Which direction "far" is in is what light decides. */
    mLow: mix(ac, lcd, light ? 0.30 : 0.52),
    mMid: light ? mix(ac, lift, 0.10) : ac,
    mHigh: mix(ac, lift, light ? 0.42 : 0.34),

    /* The field's own ink ramp, derived the way omarchy.org derives its
       --t-field-* steps. The background there is not one colour at varying
       alpha: it is hard cells that each take one of five inks, and the depth
       comes from which ink a cell wears. Same five steps here, mixed from
       this theme's accent rather than hand-picked. */
    fDim: mix(ac, bg, 0.82),
    fMid: mix(ac, bg, 0.52),
    fLit: ac,
    fHov: acHi,
    fCrest: mix(ac, lift, 0.6),
    light,
  };
}
