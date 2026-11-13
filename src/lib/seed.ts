/* A name for a shuffle, and for the ground that opens with it.
 *
 * The address carries the spelling — `?seed=omarchy` — and everything that
 * should agree about that name hashes the spelling, not a draw. Two visits
 * with the same name get the same order and the same texture. Punctuation
 * and capitals are not part of the name: a link is typed, and `Omarchy`
 * and `omarchy` are the same shuffle.
 */

/** The spelling a seed is allowed to have. Empty means there is no seed. */
export function spellSeed(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** FNV-1a, 32 bits. The same text is the same number, everywhere. */
export function hashText(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32. One seed, one sequence, in [0, 1). */
export function rngFrom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** What the field hashes, so the deck and the test cannot spell it differently. */
export function textureSeed(spell: string, which: 'jitter' | 'noise'): number {
  return hashText(spellSeed(spell) + '\0' + which);
}

/** A name for a shuffle nobody typed. Short enough to read in an address. */
export function mintSeed(): string {
  return (Math.floor(Math.random() * 0x100000000) >>> 0).toString(36);
}
