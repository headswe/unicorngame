/**
 * How many eggs one magic flower carries.
 *
 * Out of the picture book: a unicorn family that wants a foal grows a magic
 * flower, and when it opens there is an egg inside — but "på vissa magiska
 * blommor står flera blommor ut, då får den familjen tvillingar eller
 * trillingar". So a flower is usually one egg, sometimes two, and now and then
 * three.
 *
 * This is plain JavaScript in `server/` for the same reason the herd is: the
 * relay imports it under Node and the game imports it in the browser, and both
 * have to agree. Agreeing matters here — the relay has to know how many eggs a
 * flower is still holding before it can forget about it, and the browser has to
 * put down exactly that many. Deriving it from the spell's seed means nothing
 * about the clutch ever has to cross the wire.
 */

import { hashSeed } from './herd.js';

/** How often a flower carries more than one egg. */
export const CLUTCH_ODDS = { twins: 0.2, triplets: 0.06 };

/** The seconds a bud takes to open, which both sides count from the cast. */
export const BLOOM_TIME = 3;

/**
 * One, two or three, decided by the spell's seed alone.
 *
 * Drawn off a different corner of the seed than anything else uses, so the
 * clutch size and the foal inside are independent — a triplet flower is not
 * quietly always the same colour.
 */
export function clutchSize(seed) {
  const roll = ((hashSeed(`${seed}-kull`) >>> 8) % 10000) / 10000;
  if (roll < CLUTCH_ODDS.triplets) return 3;
  if (roll < CLUTCH_ODDS.triplets + CLUTCH_ODDS.twins) return 2;
  return 1;
}

/** Names the nth egg of a clutch, so a hatch can be reported for just that one. */
export function eggId(seed, index) {
  return `${seed}:${index}`;
}

/** The clutch an egg id belongs to, or null if it is not one of ours. */
export function clutchOf(id) {
  const cut = id.lastIndexOf(':');
  return cut < 0 ? null : id.slice(0, cut);
}
