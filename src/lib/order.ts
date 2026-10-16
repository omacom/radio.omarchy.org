/* The order a seed names.
 *
 * Not a shuffle of the list as it happens to sit. Each song is ranked by
 * the seed and its own key, and the order is those ranks. A song added
 * later slots in where its rank puts it and does not move the others — a
 * link to a shuffle should still be that shuffle after the playlist grows.
 *
 * The list on screen does not move. This is only which song comes next,
 * and it is only the playlist's: an episode still follows the one before it.
 * Next and previous both walk this order, so two people on the same seed
 * hear the same song come next, whichever way they step.
 */

import { hashText, spellSeed } from './seed.ts';

/** Indices into `keys`, the order `seed` names. Empty seed, empty order. */
export function permutationOf(keys: string[], seed: string): number[] {
  const spell = spellSeed(seed);
  if (!spell || keys.length < 2) return [];
  const ranked = keys.map((key, i) => ({
    i,
    rank: hashText(spell + '\0' + key),
  }));
  ranked.sort((a, b) => a.rank - b.rank || a.i - b.i);
  return ranked.map((r) => r.i);
}

/** One step along an order. A song the order does not know is treated as
    standing just before the start, so next opens on the first. */
export function stepPerm(order: number[], current: number, dir: 1 | -1): number {
  const n = order.length;
  if (n === 0) return -1;
  if (n === 1) return order[0]!;
  const at = order.indexOf(current);
  const from = at < 0 ? (dir > 0 ? -1 : 0) : at;
  return order[(from + dir + n) % n]!;
}
