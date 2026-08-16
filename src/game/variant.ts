/**
 * A unicorn is a recipe, not a picture: which body, horn, mane and tail to
 * stack, and what colour to make each one. Because it is plain data, a variant
 * can be rolled from a seed, saved to disk, or edited piece by piece in a
 * character creator later on.
 */

import type { AssetLibrary } from '../engine/assets.ts';
import { makeRng, type Rng } from '../engine/rng.ts';
import { COATS, HAIR, HORNS, NAMES, PATTERN_COLOURS, RAINBOW } from './palette.ts';

export interface UnicornVariant {
  seed: string;
  name: string;

  bodyId: string;
  hornId: string;
  maneId: string;
  tailId: string;
  /** null means a plain coat. */
  patternId: string | null;

  coat: number;
  maneColour: number;
  tailColour: number;
  hornColour: number;
  patternColour: number;

  /** How strongly the coat pattern shows, 0..1. */
  patternAmount: number;
  /** How many times the pattern tiles across the body. */
  patternScale: number;

  /** Overall size multiplier — foals are smaller. */
  scale: number;
}

/** Ids the generator may choose from, filtered to what actually loaded. */
function idsOfKind(assets: AssetLibrary, kind: Parameters<AssetLibrary['ofKind']>[0]): string[] {
  return assets.ofKind(kind).map((p) => p.id);
}

function pickId(rng: Rng, ids: string[], kind: string): string {
  if (!ids.length) throw new Error(`no "${kind}" sprites available — run npm run gen:assets`);
  return rng.pick(ids);
}

export function randomVariant(assets: AssetLibrary, seed: string): UnicornVariant {
  const rng = makeRng(seed);

  const bodyId = pickId(rng, idsOfKind(assets, 'body'), 'body');
  const patterns = idsOfKind(assets, 'pattern');

  /**
   * Rainbow lives in the palettes so the wardrobe offers it, but a random roll
   * should only turn one up now and then — it stops being a treat otherwise.
   */
  const pickColour = (from: typeof HAIR, rainbowChance: number): number => {
    const choice = rng.pick(from).hex;
    if (choice !== RAINBOW || rng.chance(rainbowChance)) return choice;
    return rng.pick(from.filter((c) => c.hex !== RAINBOW)).hex;
  };

  // Manes and tails usually match, the way a real pony's would, but every so
  // often one turns up with a contrasting tail.
  const maneColour = pickColour(HAIR, 0.35);
  const tailColour = rng.chance(0.8) ? maneColour : pickColour(HAIR, 0.35);

  return {
    seed,
    name: rng.pick(NAMES),
    bodyId,
    hornId: pickId(rng, idsOfKind(assets, 'horn'), 'horn'),
    maneId: pickId(rng, idsOfKind(assets, 'mane'), 'mane'),
    tailId: pickId(rng, idsOfKind(assets, 'tail'), 'tail'),
    patternId: patterns.length && rng.chance(0.55) ? rng.pick(patterns) : null,
    coat: pickColour(COATS, 0.25),
    maneColour,
    tailColour,
    hornColour: pickColour(HORNS, 0.4),
    patternColour: rng.pick(PATTERN_COLOURS).hex,
    patternAmount: rng.range(0.45, 0.85),
    patternScale: rng.range(2.5, 4.5),
    scale: bodyId === 'kropp_liten' ? rng.range(0.72, 0.85) : rng.range(0.92, 1.1),
  };
}

/** How many seeds to try before settling for the closest family resemblance. */
const SIBLING_TRIES = 150;

/** The little body, which is what makes a hatchling read as a foal. */
const FOAL_BODY = 'kropp_liten';

/**
 * Rolls a newborn: a unicorn on the little body, so it is visibly a foal.
 *
 * Searched for rather than shrunk afterwards. The herd is sent as a list of
 * seeds and rebuilt by rolling them, so a variant edited after rolling would
 * come out of its egg one size and join the herd another — and any such edit
 * is quietly thrown away. Finding a seed that rolls the way we want is the only
 * kind of choice that survives the trip.
 */
export function foalVariant(assets: AssetLibrary, seed: string): UnicornVariant {
  for (let attempt = 0; attempt < SIBLING_TRIES; attempt++) {
    const candidate = randomVariant(assets, `${seed}-${attempt}`);
    if (candidate.bodyId === FOAL_BODY) return candidate;
  }
  // No little body in the asset folder. A big foal beats no foal.
  return randomVariant(assets, seed);
}

/**
 * A brother or sister for a foal that is already rolled.
 *
 * Twins out of one magic flower have to look like family or the whole thing
 * falls flat: their eggs are painted in their coats, so two matching eggs are
 * the clue that twins are coming. But a sibling cannot simply be the firstborn
 * with a new mane — the herd is sent as a list of seeds and every machine
 * rebuilds each pony by rolling that seed, so a variant that has been edited
 * after rolling would hatch one colour and then join the herd as another.
 *
 * So this searches instead of edits: it rolls candidate seeds until one comes
 * up wearing the family coat, and returns that roll untouched. Whatever it
 * returns is therefore exactly what `randomVariant` gives for the same seed,
 * anywhere, which is the only property the herd needs.
 *
 * Deriving it from the firstborn's seed rather than sending it also keeps the
 * whole clutch off the wire.
 */
export function siblingVariant(
  assets: AssetLibrary,
  firstborn: UnicornVariant,
  index: number,
): UnicornVariant {
  let best: UnicornVariant | null = null;
  let bestScore = -1;

  for (let attempt = 0; attempt < SIBLING_TRIES; attempt++) {
    const candidate = randomVariant(assets, `${firstborn.seed}-syskon-${index}-${attempt}`);
    // The coat is what the egg is painted in, so it matters most; being a foal
    // at all comes next, and matching the family's coat pattern is the
    // finishing touch.
    const score =
      (candidate.coat === firstborn.coat ? 4 : 0) +
      (candidate.bodyId === FOAL_BODY ? 2 : 0) +
      (candidate.patternId === firstborn.patternId ? 1 : 0);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
      if (score === 7) break;
    }
  }

  // Unreachable in practice — one attempt is enough to have a candidate — but
  // a sibling that is merely unrelated beats no sibling at all.
  return best ?? randomVariant(assets, `${firstborn.seed}-syskon-${index}`);
}

/** A fresh seed, e.g. for the "roll again" button in the stable. */
export function randomSeed(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Round-trips a variant through the save slot in localStorage. */
const SAVE_KEY = 'enhorningsangen.player';

export function saveVariant(variant: UnicornVariant): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(variant));
  } catch {
    // Private browsing and full quotas are not worth interrupting play for.
  }
}

export function loadVariant(): UnicornVariant | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<UnicornVariant>;
    // Only trust it if the fields the renderer needs are actually there.
    if (typeof parsed.bodyId === 'string' && typeof parsed.coat === 'number') {
      return parsed as UnicornVariant;
    }
  } catch {
    // Corrupt save: fall back to rolling a new unicorn.
  }
  return null;
}
