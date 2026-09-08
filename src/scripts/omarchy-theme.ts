/* The desktop's own theme, if the browser is offering it.
 *
 * omacom/omarchy-theme-sync is a Chromium extension that reads the Omarchy
 * theme the machine is actually running and writes its palette onto <html> as
 * --omarchy-* custom properties, re-writing them when the desktop theme
 * changes. Any page may read it; only omarchy.org may write, so this is a
 * one-way follow.
 *
 * The deck derives everything from four seeds, and those four are exactly a
 * projection of Omarchy's own colors.toml:
 *
 *     bg  <- background
 *     fg  <- bright_foreground, or foreground where a theme has no brighter one
 *     ac  <- accent
 *     bd  <- selection
 *
 * That is not a guess. Run over the 22 Omarchy themes installed on a machine,
 * those four keys reproduce all 22 of the hand-copied entries in SKINS
 * value for value — the list in src/scripts/theme.ts *is* this projection,
 * written down. So following the desktop is not a new palette or an
 * approximation of one: it is the same derivation the deck already does, with
 * the seeds arriving live instead of from a list.
 *
 * The list stays, and stays the fallback: without the extension — which is
 * every browser that is not Chromium on Omarchy — the deck is the twenty-four
 * themes it always was.
 */

import type { Skin } from './theme.ts';

const PREFIX = '--omarchy-';
const CHANGE = 'omarchythemechange';

/** What the deck calls the skin that follows the desktop. */
export const DESKTOP = 'desktop';

/** The main-world API the extension defines. Absent unless it is installed. */
interface OmarchyApi {
  readonly theme: string | null;
  readonly mode: string | null;
  colors(): Record<string, string>;
  color(name: string): string | null;
  onChange(handler: (colors: Record<string, string>) => void): () => void;
}

function api(): OmarchyApi | null {
  const w = window as unknown as { omarchy?: OmarchyApi };
  return w.omarchy ?? null;
}

/* The palette lands as inline custom properties on <html>, which the
   extension's own notes call the contract: the isolated world writes them and
   both page CSS and page JavaScript can read them. So this reads the DOM
   rather than the API — the same values, and it works even in a frame where
   the main-world script did not run. */
function read(key: string): string {
  const style = document.documentElement.style;
  const v = style.getPropertyValue(PREFIX + key.replace(/_/g, '-')).trim();
  return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : '';
}

/** The theme the desktop is wearing, as four seeds, or null if nothing is. */
export function desktopSkin(): Skin | null {
  const bg = read('background');
  const ac = read('accent');
  const bd = read('selection');
  const fg = read('bright_foreground') || read('foreground');
  // All four or none. A partial palette would derive a theme nobody chose.
  if (!bg || !fg || !ac || !bd) return null;
  return { name: DESKTOP, bg, fg, ac, bd };
}

/** What the desktop calls it — "ethereal", "tokyo night" — for the picker. */
export function desktopName(): string {
  const named = document.documentElement.dataset.omarchyTheme
    || api()?.theme
    || '';
  return named.trim().toLowerCase().replace(/[-_]+/g, ' ');
}

/**
 * Calls back whenever the desktop's palette changes, and once at once if
 * there is already one.
 *
 * The extension writes at document_start but the palette comes from a native
 * host over a port, so on a cold service worker it can land after the deck has
 * booted. That is why this is a subscription and not a question: the skin
 * appears in the picker when the palette does, however late that is.
 *
 * @returns a function that stops listening.
 */
export function watchDesktop(onPalette: (skin: Skin | null) => void): () => void {
  const fire = () => onPalette(desktopSkin());
  document.addEventListener(CHANGE, fire);
  fire();
  return () => document.removeEventListener(CHANGE, fire);
}
