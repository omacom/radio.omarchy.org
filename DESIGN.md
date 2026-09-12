# Design

Two things: what the omarchy.org redesign
([omacom/omarchy-site#171](https://github.com/omacom/omarchy-site/pull/171))
does, read out of its code, and what this deck should take from it so the two
read as one family.

They are already tied together at the content level. The redesign's hero plays
**"We Can Fix Everything (The Ultimate Machine)" by Kevin Koontz** — a track that
lives in `public/tracks/playlist.json` in this repository — and `src/lib/music.ts`
carries `radio: 'https://radio.omarchy.org/'`. The main site's front page is
listening to this station. It should not look like a different project.

---

# Part 1 — The redesign

A React/Vite/TanStack app rendered to static files, 29,691 lines added. The
design lives in four places: `src/styles.css` (1,631 lines of tokens and base),
`src/components/HeroPixelField.tsx` (1,413 lines — the background), and the
small primitives `src/lib/pixel-grid.ts`, `src/components/PixelLabel.tsx`,
`src/components/PixelSnap.tsx`.

## The token spine

Every colour is a `--t-*` custom property, redefined per theme, exposed to
Tailwind through an `@theme inline` block that maps `--color-*` onto it. The
families:

| Family | Members |
| --- | --- |
| Ground | `--t-bg-deep`, `--t-bg`, `--t-surface`, `--t-surface-2` |
| Line | `--t-border-subtle`, `--t-border-strong` |
| Ink | `--t-text`, `--t-text-secondary`, `--t-text-muted` |
| Accent | `--t-brand`, `--t-brand-soft` (`1f` alpha suffix), `--t-brand-ink` |
| Depth | `--t-elevation`, `--t-elevation-hover`, `--t-img-outline` |
| Chrome | `--t-scroll-thumb`, `--t-selection` |
| **Field** | `--t-field-bg`, `-dim`, `-mid`, `-lit`, `-hover`, `-crest` |

That last family is the interesting one, and it has no equivalent here. The
background field is not drawn in one colour at varying alpha — it has a
**six-step ink ramp of its own**, from the field's ground through three resting
inks to two lit ones. Cells are hard on or off; depth comes from which ink a
cell takes, never from opacity.

`--t-brand-ink` is the same idea as this deck's `--acFg`: what sits *on* the
accent, so a filled control survives any accent hue. It is hand-picked per theme
(`#0c0e10` on the dark themes, `#ffffff` on Rosé Pine) rather than derived.

## Six themes, verbatim

`tokyo-night` (default), `catppuccin`, `gruvbox`, `matte-black`, `rose-pine`,
`white`. Two are light. Every base value is copied verbatim from
`omacom/omarchy` `themes/<id>/colors.toml`; only the in-between steps — surfaces,
the field's dim/mid, hover states — are mixes.

The theme is stamped onto `<html data-theme>` by a pre-paint script in `<head>`
so there is never a flash of the wrong one, persisted under
`omarchy-site-theme`, and opened with `T`. A `THEME_EVENT` on `window` tells the
canvas to re-read its palette, and `paintFavicon()` redraws the tab icon in the
new accent by rebuilding the `<link>` element.

There is no light/dark switch. There are themes, and two of them happen to be
light. That is the same position this deck takes.

## Type

Two variable faces, both from Fontsource, subset to latin and latin-ext:

- **JetBrains Mono Variable** (100–800, plus italics) — the default for
  `html`, `body`, `#app`. Body copy is monospace.
- **Geist Variable** (100–900) — headings only, via `h1`–`h6` and
  `text-wrap: balance`.

`font-synthesis: none`, so a weight that does not exist is never faked.

## Form

Zero radius, enforced at the source: an `@theme` block sets `--radius-xs`
through `--radius-4xl` to `0px`, so every Tailwind `rounded-*` utility in the
codebase resolves to square. You cannot accidentally round something.

Other standing rules: one focus ring for the whole site
(`2px solid var(--t-brand)`, offset `2px`, flipped to `-2px` inside horizontal
rails so the outline is not clipped); `.img-outlined` puts a 1px inset outline at
10% black or white on every image; a `--measure: 48rem` reading column; a named
z-index scale (`--z-nav` 100 → `--z-tooltip` 400) with the instruction that no
arbitrary z-values appear anywhere else.

## The lattice

This is the load-bearing idea, and it is the thing most worth stealing.

The wordmark is a bitmap — 81 cells wide, 19 tall. The hero measures the slot the
wordmark occupies, and **one wordmark pixel becomes one grid cell for the entire
background field**. The field is not a texture with the logo composited on top;
the logo's cells and the background's cells are the same lattice, sharing an
origin, so no viewport width can knock them out of alignment.

The cell size is then published two ways:

1. **To JavaScript**, as a `GRID_EVENT` carrying `{x, y, cw, ch}`. `PixelSnap`
   listens and translates every `[data-px-snap]` element onto the nearest cell
   line — *translate only*, never resizing, because rounding box sizes fed back
   into the grid and showed up as the navbar settling through several visible
   states on load. And it only snaps before a frame paints, or not at all for
   that load.
2. **To CSS**, with no measurement at all:

```css
.pixel-container > * {
  --pxc: calc(min((100cqw - 48px) * 0.88, 896px) / 81);
  --pxr: calc(var(--pxc) * 50 / 51);   /* the wordmark's units are 51×50 */
}
```

Anything sized in `--pxc` multiples lands on the grid without JavaScript, which
is how the navbar controls stay put — they were snapped once, and jumped on
arrival and again on the way out, so they were moved onto the CSS mirror
instead.

Worth knowing before porting any of this: the cell is not quite square. The
bitmap is 81×19 (`WORDMARK_WIDTH`/`WORDMARK_HEIGHT`), the canvas takes its cell
as `slot.width / 81` by `slot.height / 19`, and the CSS mirror hard-codes the
resulting ratio as `50/51`. Assume square cells and the two lattices drift.

## The field

`HeroPixelField.tsx`. Drifting value noise, thresholded through an **8×8 Bayer
ordered dither** into hard on/off cells.

The threshold each cell is judged against:

```
0.78 * ((BAYER[(row & 7) * 8 + (col & 7)] + 0.5) / 64)
  + 0.22 * jitter[(row & 63) * 64 + (col & 63)]
```

Pure Bayer would light the same low-index cells everywhere and read as a regular
lattice at this density, so a fixed per-cell jitter scatters the resting field
while the ordered structure still emerges where luminance is pushed high.

Luminance per cell is a base texture — two octaves of value noise at
`CELLS_PER_NOISE = 9` cells per unit, drifting on two different vectors, times a
per-cell twinkle with a random phase so cells appear and disappear locally rather
than the whole pattern sliding past — plus, added on top:

| Contribution | Detail |
| --- | --- |
| Cursor glow | `CURSOR_CELLS = 12` reach, squared falloff so the middle lights densely without dragging a solid blob |
| Idle wander | After `IDLE_MS = 2500` without a pointer move, or on a device with no pointer, the glow sets off along a slow arc at `WANDER_STRENGTH = 0.7`, eased in over ~1s and handed back the instant the pointer moves |
| Click stamps | The 15×15 Omarchy logo bitmap, stamped and dissolving through the dither, with per-click jitter in tempo and size |
| Spectrum | The track's bands, **mirrored about the centre** — bass at the outer edges, treble toward the middle — thickening each column from the bottom up to `SPECTRUM_REACH = 0.92` of the height |
| Beats | Push the glow out momentarily; `BEAT_REACH = 0.8`, `BEAT_DECAY = 0.84` |

The ink is then chosen by "heat" — the max of the glow, stamp and spectrum
contributions — as `heat > 0.34 ? lit : heat > 0.1 ? mid : dim`. Three inks, hard
edges, no alpha blending.

The composition is protected. A ramp keeps the field clear of anything readable:
`CLEAR_REACH = 150` CSS px around a text block, `HUSH_REACH = 96` for the
cursor's response, and `CLEAR_CURVE = 3` — cubed rather than smoothstepped,
because a smoothstep is half strength at the halfway mark, which put texture
right up against the links. The footer variant runs at `FIELD_DENSITY = 0.3` of
the hero's, because the footer is text almost edge to edge.

Under `prefers-reduced-motion`, `t` is pinned to `0`. The field still draws — it
simply stops moving. That is a better answer than not drawing it.

## Pixel typography

`PixelLabel` renders section labels in a **3×5 pixel font** — every glyph five
rows of three cells, `TRACKING = 1` blank column between glyphs, `SPACE_WIDTH = 2`
— as an SVG of 1×1 `<rect>`s with `shapeRendering="crispEdges"`. Uppercase,
digits, `.` and `/`. Small labels are not small type; they are pixels, the same
material the wordmark and the field are made of.

## The track

`src/lib/music.ts` is more careful than it needs to be, and worth reading in
full. The problem it solves: browsers will not let a page analyse audio before a
gesture, but the field should already be moving on the first paint.

So `scripts/analyse-track.mjs` listened to the track once, offline, and wrote a
timeline of 16 bands plus beat positions into `src/data/track.json`. A silent
clock runs through that from first paint, looping, fetching no audio at all. Turn
the sound on and it loads the track, starts it *where the clock already is*, and
switches to a live 32-band Web Audio analyser with its own onset detector. Turn
it off and the volume drops after the analyser — the track keeps running, the
field keeps hearing it, and the sound is one press away.

`analyser.smoothingTimeConstant = 0`, so a kick's attack arrives whole; the
picture is smoothed by whoever draws it. Bands are spaced evenly in pitch
(50 Hz → 10 kHz, logarithmic) with a per-band running floor and peak, so a
bass-heavy mix still shows its treble. Live reading runs at `LIVE_GAIN = 0.9`
against the timeline's `MUTED_GAIN = 0.6`, deliberately, so the live picture is
visibly livelier without being a wall.

`audio.crossOrigin = 'anonymous'` is set before the source, with a comment
naming the reason: so a track served from another origin — *the radio* — still
reaches the analyser.

---

# Part 2 — What is here now

For comparison, the deck's own system, which is documented by its code rather
than by a doc:

- **Four seeds, fifteen tokens.** A theme is `bg`, `fg`, `ac`, `bd`; everything
  else is computed in `theme()` in `src/scripts/theme.ts` by `mix()` (linear sRGB) and `lum()`
  (Rec. 709), and written to custom properties by `applyTheme()`. `--acFg` is
  chosen from the accent's own luminance; `--g1`/`--g2` mix the accent toward
  `--lcd` rather than `--bg`, because the LCD is a different ground.
- **24 themes**, in `SKINS`, named after Omarchy's. Nine are light. Stored under
  `omarchy-radio-skin`; `--bg` is written to `<meta name="theme-color">`.
- **Fixed canvas.** 1180×880, scaled by `--fit`, set inline before first paint.
  Below 900px it reflows to one fluid column via `display: contents`.
- **Square and flat.** `style.css` contains **zero** `box-shadow`s, exactly one
  `border-radius` (2px, on the explicit badge), and its gradients are all
  lattices or masks rather than shading: the scanline overlay, the marquee
  mask, the phone knob track, and the two that draw the meter's bricks and the
  three zones they are coloured by.
- **Three faces.** JetBrains Mono by default, Space Grotesk for track titles,
  VT323 for anything that reads as a readout — the 62px marquee, the clock, row
  numbers, knob values, lyric timestamps.
- **The LCD**, the one lit surface, with its own ground, its own inks, and a
  scanline overlay that thins from `rgba(0,0,0,.42)` at 2px to
  `rgba(0,0,0,.055)` at 1px on light themes.
- **The background**, in `drawField()`: a 24px grid of squares, each column mapped
  to one of 56 analyser bands, alpha `0.018 + level*0.10*wave + amp*0.05*wave`
  capped at `0.2`, size `1 + level*wave*2.2` px, all in `--ac`, plus a radial
  glow. Skipped entirely under reduced motion.

## Where the two already agree

More than you would expect. Both are terminal-native, dark-first-but-not-dark-only,
square, single-accent-per-theme, JetBrains Mono, themed from Omarchy's own theme
set, persisted in `localStorage`, applied before first paint, and both drive a
pixel background from an audio analyser. Nobody has to be talked into anything.

## Where they diverge

| | omarchy.org (#171) | radio.omarchy.org |
| --- | --- | --- |
| Themes | 6, every value hand-authored from `colors.toml` | 24 from 4 seeds, plus the desktop's own live |
| Field inks | 6-step ramp, hard cells | 1 colour, varying alpha |
| Field structure | 8×8 Bayer ordered dither + jitter | plain grid, no dither |
| Cell size | one wordmark pixel, published to CSS and JS | 24px, arbitrary |
| Snapping | `[data-px-snap]` + `--pxc` | none |
| Spectrum layout | mirrored, bass at the edges | linear, left to right |
| Field vs. text | `CLEAR_REACH` / `HUSH_REACH` / cubed curve | field sits behind a solid panel |
| Reduced motion | draws, frozen at `t = 0` | does not draw |
| Small labels | 3×5 pixel font | 9px uppercase, `.22em` tracking |
| Readouts | none | VT323 |
| Stack | React, Vite, Tailwind, shadcn | Astro, one stylesheet, one script |

---

# Part 3 — What was taken

Steps 1–5 below are done and in the working tree. Step 6 is still a judgement
call.

**1. The field ink ramp — done.** `theme()` now derives five field inks from the
accent the way omarchy.org hand-picks its `--t-field-*` steps: `fDim`
(`mix(ac, bg, .82)`), `fMid` (`.52`), `fLit` (the accent itself), `fHov` (which
turned out to already exist as `--acHi`) and `fCrest`. `applyTheme()` writes them
out as `--field-dim` … `--field-crest`, so CSS can reach them too, and
`style.css` carries the green-theme values as the pre-script fallback.

**2. The background is dithered — done.** `drawBg()` no longer varies alpha. Cells
are hard on or off, thresholded through the 8×8 Bayer matrix plus a fixed
per-cell jitter, and each lit cell takes `fDim`, `fMid` or `fLit` by heat.
Underneath it is two octaves of drifting value noise plus a per-cell twinkle,
the same shape omarchy.org uses.

One thing did not carry over unchanged: the web field weights its threshold
`0.78` Bayer to `0.22` jitter, which works when the field is hundreds of cells
across. Ours runs at 81 cells across the frame and the ordered tile repeated
often enough to read as a checkerboard, so the resting texture is held at `0.34`
of a cell's luminance. That was tuned by looking at it, not derived.

**3. The spectrum is mirrored — done.** Bass at the outer edges, treble in
towards the deck, columns thickening from the bottom and easing off towards the
top. Symmetrical, and it leaves the middle calm where the deck sits.

**4. The cell is anchored — done.** The lattice is the deck's own: `FIELD_COLS =
81` cells across the measured frame, taking the frame's left edge as the origin,
so the field cannot drift against the deck at any window size. The frame carries
its scale in a transform, so its measured box is what is really on screen.

The field also stays clear of the deck now — `CLEAR_REACH = 240` px, cubed
rather than smoothstepped — so texture builds out in the margins instead of
packing against the 1px border.

**5. Reduced motion draws — done.** `drawBg(true)` pins `t = 0` and paints one
still frame, repainted only on resize or a theme change. It used to skip the
canvas entirely, which handed reduced-motion readers a blank ground.

**Verified** on a dark theme and a light one (Rosé Pine, where the ramp has to
darken against the ground rather than lighten), with no console errors.

**6. The 3×5 pixel labels — not done.** Still a judgement call rather than a fix;
the deck's 9px tracked uppercase is already a strong treatment.

## What not to take

**The six hand-authored themes.** The derivation here is the better engineering:
24 Omarchy themes from four values each, versus 6 from about twenty-five values
each. If anything the influence should run the other way. Borrow the *field ramp*
as a concept; keep computing it.

**React, Tailwind and shadcn.** They are the right call for a site with a
manual, a plugin catalogue, search and six routes. There is one page here,
wearing thirty-eight addresses, and no component on it is reused twice.

This is where the argument used to end: *keep the stack too — three files a
contributor can read in an afternoon*. That part did not survive, and it is
worth saying why rather than quietly deleting it. See below.

**`--t-hdr-*`.** Six tokens per theme, thirty-six in total, that the stylesheet's
own comment says are pre-compensation for a `mix-blend-mode` that does not
happen — a sticky element forms its own stacking context and has no backdrop to
blend against. They are kept "for a future attempt". Do not copy dead tokens.

---

# Part 4 — The build

The three files became Astro. What the earlier draft of this doc got wrong was
which three files there were: the deck, the stylesheet and the script are three,
but sitting beside them were `tools/build-routes.py` — 600 lines of Python
templating `index.html` through five marked comment regions — and thirty-five
generated HTML pages, committed. Contributors sent a song and a diff of the
thirty-odd pages that song moved.

Astro is that half, done by something that does it for a living:

- **One page, one file.** `src/pages/playlist/[slug].astro` is the page behind
  every song. The five marked regions are props.
- **One rule for an address.** `slugify()` and `assignSlugs()` existed twice —
  once in the deck, once in the Python — with a test whose whole job was to run
  both over the same titles and check they still agreed. `src/lib/slug.ts` is
  imported by the build and by the browser. There is nothing left to disagree.
  The same goes for the labels a row carries: the build wrote `dateLabel()` in
  Python and the deck wrote it again in JavaScript, and the two spelled a date
  differently, so a row changed under the reader on load. One `src/lib/format.ts`
  now, in UTC, so a page built in CI reads the same as a browser anywhere.
- **The stamp is the bundler's.** `build-routes.py` hashed `app.js` and the two
  stylesheets and rewrote their `?` suffixes in every page, so a service worker
  could never serve a cached deck against a page it no longer fits. That is what
  a content-hashed bundle is, and `sw.js` needed no change to keep the property.
- **`build.format: 'file'`,** so `/playlist/still-licensed` is still a file at
  `playlist/still-licensed.html` served at the extensionless path, 200, no
  redirect. The directory form would have answered every existing link with a
  301 to a trailing slash the canonical links do not have.
- **Nothing generated is committed.** The contribution path is what it always
  was — an MP3 and three lines of JSON — minus the thirty-five files.

What did not change: the design. Every token, every mix, all 24 themes, the
Bayer threshold, the `REST` level tuned by looking at it, `CLEAR_REACH` and its
cubed curve, the mirrored spectrum — the field's constants were carried over and
checked literal by literal, and the 24 derived themes compared value by value
against the old `theme()`. The stylesheet moved directory and gained one
section. The deck is the same program in TypeScript, in three modules instead of
one file, because the field and the tape wanted to be reachable on their own.

## The seeds, arriving live

The four seeds turned out not to be a design decision at all. They are a
projection of Omarchy's `colors.toml`, and
[omarchy-theme-sync](https://github.com/omacom/omarchy-theme-sync) — a
Chromium extension that writes the running theme's palette onto `<html>` as
`--omarchy-*` properties and rewrites them when the desktop theme changes —
publishes exactly the file they came out of:

| seed | key |
| --- | --- |
| `bg` | `background` |
| `fg` | `bright_foreground`, or `foreground` where a theme has no brighter one |
| `ac` | `accent` |
| `bd` | `selection` |

Checked, not assumed: run over the 22 Omarchy themes installed on a machine,
those four keys reproduce all 22 of the corresponding entries in `SKINS` value
for value. `bright_foreground` is the one that had to be found by looking —
`foreground` alone matches 16 of 22, and the six it misses are the six themes
whose `bright_foreground` differs from it, which is what the list was copied
from.

So the deck gained a twenty-fifth theme, first in the list, called `desktop`,
and it is what a listener gets on a first visit if their browser offers one.
Nothing about the derivation changed. `derive()` takes the same four values
and does the same twenty-odd mixes; the field's ink ramp comes out of the same
accent. The only structural change was that the theme on is now tracked by
**name** rather than by index into `SKINS` — a list that grows a row at the
top when an extension wakes up is a list where an index quietly means the
theme below the one that was picked.

What the extension will not do from here is *set* a theme:
`THEME_WRITE_ORIGINS` is `https://omarchy.org` exactly, so this deck can read
the desktop and never write it. That is the right way round. The twenty-four
stay, and stay the fallback.

## Finding a song

The list grew past the point where reading it is how you find something. **find**
sits between the panel heading and the column heads, filters what is on screen,
and does three things worth writing down:

- **Every word has to appear**, across the title and whoever made it, so
  `koontz fix` is a query and not a mistake.
- **Folded on both sides** — `src/lib/slug.ts` grew a `fold()` beside
  `slugify()`, for the same reason and with the spaces kept. Nobody hunting
  for Aurélien's song is going to reach for the acute.
- **The number is the item's place in the list**, not its place among the
  matches. The whole list is walked and non-matches are skipped, which is the
  same shape `rowsFor()` uses to number one row on a permalink page 02.

And it stays out of the address. Every other thing the deck does to what is on
screen is written into the path, because those are places somebody can be
sent; a half-typed query is not one, and a canonical link to one would be
worse than useless.

## The meter, and being sent to a song

Two smaller things came out of the same idea as the field.

**The meter is bricks.** The bars under the clock were continuous fills with a
percentage height. They are a stack of bricks on a fixed lattice now, and a
column is a whole number of them — `frame()` rounds to `METER_SEGS` and hands
CSS the count as `calc(var(--seg) * n)`, which is the one place the deck lets
the stylesheet do the arithmetic and the reason a narrow layout can change the
pitch on one line without the deck knowing.

The lattice is drawn `to top` so it starts at the bottom of the box, and the
boxes are bottom-aligned: anchored anywhere else the gaps would slide against
each other as a column grew. The gaps are painted in `--lcd` rather than left
transparent, so a brick is hard-edged against the ground the way a field cell
is.

The colour is the theme's, in three zones and one hue: `--g1` for the quiet
body, `--ac` through the middle, `--acHi` at the top. Those are the LCD's own
accent mixes rather than the deck's — this panel has a ground of its own, and
the tokens mixed toward `--bg` are the wrong family for it. Depth comes from
which ink a brick wears, never from opacity, which is the field's rule and the
reason the two look related. On a light theme `--acHi` darkens rather than
lightens, so "hot" stays "more contrast" without anything being special-cased.

**A link lands on its song.** Following a permalink to the twenty-seventh song
opened the list at the top of it. `revealNamedRow()` brings it into view, and
two things about it are worth writing down.

It holds a *key*, not a flag. A permalink paints three times before the list
is the real one — the item baked into the page, then the manifest landing while
the row still marked as playing is whatever index the seeded copy had, then the
real position. A bare flag is spent on the middle paint and scrolls to the
wrong row; the test caught exactly that.

And it is spent only by a paint that could act on it. The first of those three
has one row and nothing to scroll, so a list shorter than the room it has is
read as "not the list this will end up being" and the answer is left to a later
paint.

It is deliberately narrow. A press on a row is a press on something already on
screen, and a track running into the next one must not move the list out from
under whoever is reading further down it — the same rule about whose scroller
it is that the lyric sheet follows with `handScrolled`.

## What light mode was hiding

The meter went in built out of `--g1`, `--ac` and `--acHi`, and on Rosé Pine
half of it disappeared. Measuring it turned up something bigger than the
meter.

`--g1` and `--g2` are the LCD's dim inks — its small labels, the artist line,
the total time — and they are the accent mixed 45% and 62% of the way toward
the LCD's own ground. That works on a dark theme, where the ground is
near-black and the accent is bright, and it does not work on a light one,
where the ground is near-white and an accent has little contrast against white
to begin with. **A fraction of the way to the ground is not the same amount of
dimming in both directions.** On thirteen of the twenty-four themes `--g1` was
under 3:1 against the panel it sits on — every light theme, worst at 1.83, and
several dark ones whose accent is close to their ground.

So the dimming is derived against a floor now. `dim()` asks for as much as it
can have and walks back in twentieths until the result reads: 3:1 for `--g1`
at 9px, 2.2:1 for `--g2`, which is the quietest thing on the panel and meant
to be. A theme already clear of the floor is not touched — `green`,
`hackerman`, `kanagawa`, `lumon` and `retro 82` come out exactly as before —
and `--g1` stays ahead of `--g2` on all twenty-four.

That needed a second luminance function. `lum()` is Rec. 709 over gamma-encoded
values and it decides whether a theme is light; it has decided that the same
way for twenty-four themes and it is not going to start deciding differently.
`relative()` linearises, which is what a contrast ratio actually needs. Two
functions because they answer two questions.

The meter got its own ramp out of the same reasoning, rather than reusing
tokens built for text: it steps *away* from the ground in whichever direction
the theme's `lift` points, so the hot end is brighter on a dark theme and
darker on a light one, and "hot" means "more contrast" without a special case.

### And the fallbacks had drifted

`:root` in the stylesheet carries the first skin's values as the theme the page
wears for the one frame before the deck runs. It is a copy, and twelve of the
twenty-three were wrong — `--g1` in there was the old `--g2`'s value. Invisible,
because it is one frame, and wrong all the same.

They are regenerated from `derive(SKINS[0])`, and `tools/test-routes.mjs` now
compares the two rather than trusting them: it reads the properties out of
`applyTheme()` itself, so the list of what to check is not a third copy to keep
by hand either.

## The icons were never being drawn by us

The transport's glyphs — `▶` `◀◀` `■` `❙❙`, the two carets, the arrow on an
outbound link — are all outside latin and latin-ext, which is the whole of
what this site subsets. So the deck shipped three carefully cut webfaces and
then drew its four most important controls out of whatever the platform fell
back to. `❙❙` (U+2759 MEDIUM VERTICAL BAR) is a particularly poor bet; `▶` and
`◀` are worse, being in Unicode's emoji set, where a phone is entitled to
render the play button in colour.

They are cells on a lattice now, in `src/lib/icons.ts`. That was not a style
decision so much as the only one consistent with everything else here: the
wordmark is a 15×15 bitmap of axis-aligned rects, the field is hard on-or-off
cells, the meter is bricks, and omarchy.org's small labels are a 3×5 pixel
font. A stepped triangle is the same material — and it is the one icon that
cannot go blurry, because there is no curve in it to resolve. One cell to one
CSS pixel with `shape-rendering="crispEdges"`, so the steps land on the grid.

Two of them have two faces, and both are in the page with a class deciding
which shows: rewriting a button's contents forty times a minute to say the
same two things is work for nothing, and it keeps drawing out of the deck. The
one icon the deck does draw is the caret on an episode's row, because the deck
builds that row — and it draws it from the same table, the way the build and
the browser share the slug rule.

Prev and next are two triangles rather than a bar and one. A disc player marks
skip with the bar; a tape deck marks it with the pair, and this deck has a
tape on its readout.

## Why the deck plays through a <video>

"Click anywhere to start" was an admission of defeat, and it turned out to be
a premature one.

No browser grants an audible autoplay to a site nobody has engaged with. The
exemption everybody quotes is that a *muted* autoplay is always allowed, and
the deck's first attempt at this simply muted the `<audio>` element and tried
again. It was refused. So was `volume = 0`. Measured under both of Chromium's
restrictive policies:

| attempt | result |
| --- | --- |
| `new Audio(src)`, `muted = true` | `NotAllowedError` |
| `new Audio(src)`, `volume = 0` | `NotAllowedError` |
| `<video>`, `muted = true` | plays |
| `<video>`, `muted = true`, in the document | plays |

The exemption is for `<video>`. That reads like a loophole and is not really
one: a media element with no picture is an ordinary thing for a `<video>` to
be, and nothing else about it changes — the same `HTMLMediaElement` API, the
same events, the same `createMediaElementSource`, the same media session, and
still never in the document, so there is no frame to lay out. `playsInline`
is there for iOS, which would otherwise take a `play()` for a request to go
fullscreen, and which is also the platform where an `<audio>` element could
never have autoplayed at all.

So a first visit arrives playing. `silence()` is the refusal handler and it
plays rather than asks; the status says which kind of playing it is; and the
first gesture calls `unsilence()`, which turns the sound on **where the track
has got to**. Not from the top: the clock and the marquee have been visibly
running, and restarting would contradict what the listener has been watching.
Joining part-way through is what a radio is.

Every `play()` sets `muted = false` first, so being silenced once is not being
silenced for good — a press earns an audible attempt where an arrival did not,
which is why pressing *next* while silent simply comes up with sound. And
`arm()` is still there, for the case where even the muted attempt is refused.

The one press that does not mean what its button says is play, while the deck
is playing silently: there it means "sound". The status line is what asked for
it, so it is not a guess.

## The readout, played back as tape

One thing was added: the LCD is drawn through [Canvas UI](https://canvasui.dev)'s
VHS shader — tape wave, head-switch band, chroma bleed — with the wave, the
jitter and the switching driven off `fieldAmp()`, the same smoothed loudness the
field lights its cells by, and a tear on the record changing.

It is the only surface that gets one. The field is a ground and the deck is
controls; a readout is the one thing here that is a *picture*, so it is the one
thing a shader can move without moving something you have to hit. Two of the
component's options are held at `0` for the same reason the field keeps
`CLEAR_REACH` away from the frame: `barrel` bends the marquee off its baseline
and `vignette` darkens the corner the visualiser sits in.

Two things had to be worked out, both written down at their definition in
`src/scripts/lcd-vhs.ts`:

- **A canvas subtree is not laid out against the canvas's box.** Left alone the
  readout took its max-content width — 1646px inside an 1178px canvas, the 62px
  marquee being what made it that wide — and the two right-aligned things on it,
  the source label and the clock, were laid out past the edge of the texture and
  never drawn at all. Both sides of the box are measured where the readout really
  lives and written down before it moves in.
- **The component captures the element when its box resizes,** which is right for
  a page that sits still and wrong for a clock. The capture is asked for every
  frame instead.

And it is Chrome-only, behind a flag today and an origin trial in production, so
it is enhancement and nothing more: `supportsHtmlInCanvas()` is false and the
readout stays where it is, wearing the CSS scanlines. Under
`prefers-reduced-motion` it is not started at all — unlike the field, which has
a texture worth painting frozen; a still frame of a moving artefact is not the
effect standing still, it is a smeared readout.

---

## Notes from reading the code

- I did not build or run the redesign — no `npm ci`, so no typecheck, lint or
  `npm run parity`. Everything above is read from source.
- The stylesheet's structure is unusually well-commented for a redesign of this
  size; most of the constants above are explained *and justified* at their
  definition, including several that record what was tried first and why it
  failed. `PixelSnap`'s "before paint, or not at all for this load" rule and the
  `CLEAR_CURVE` note are both worth reading in the original.
- `--t-hdr-*` is the only dead weight I found in the token layer.

---

# The same field, in the terminal

The design travelled to a third surface: `~/Code/cliamp` gained an **Omarchy**
visualizer mode (`ui/vis_omarchy.go`), which is this field rendered into a TUI
panel — the same 8×8 Bayer threshold, the same drifting value noise and per-cell
twinkle, the same mirrored spectrum with the bass at the outer edges.

Three things had to change for a terminal:

- **Two pixels to a character cell**, stacked and drawn as `▀`/`▄`/`█`, so a
  pixel comes out roughly square rather than twice as tall as it is wide. The
  pair wears the warmer of its two tiers.
- **The jitter carries more of the threshold** — `0.55` Bayer to `0.45` jitter,
  against the web's `0.78`/`0.22`. A panel is tens of cells across, not hundreds,
  so the 8×8 tile repeats often enough to read as a checkerboard.
- **The mark is `logo.txt` from `omacom/omarchy`**, which is already half-block
  art and therefore already a bitmap 81 pixels across — the same 81-cell lattice
  omarchy.org cuts its wordmark into, arriving for free. It is decoded, not
  transcribed. A panel too narrow for it falls back to the 15×15 square-spiral
  mark, and one too small for either runs the field alone.

The three inks map onto cliamp's existing low/mid/high spectrum tiers, so the
field themes itself with the rest of the player.
