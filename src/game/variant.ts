/**
 * A unicorn is a recipe, not a picture: which body, horn, mane and tail to
 * stack, and what colour to make each one. Because it is plain data, a variant
 * can be rolled from a seed, saved to disk, or edited piece by piece in a
 * character creator later on.
 */

import type { AssetLibrary } from '../engine/assets.ts';
import { makeRng, type Rng } from '../engine/rng.ts';
import { COATS, HAIR, HORNS, NAMES, PATTERN_COLOURS } from './palette.ts';

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

  // Manes and tails usually match, the way a real pony's would, but every so
  // often one turns up with a contrasting tail.
  const maneColour = rng.pick(HAIR).hex;
  const tailColour = rng.chance(0.8) ? maneColour : rng.pick(HAIR).hex;

  return {
    seed,
    name: rng.pick(NAMES),
    bodyId,
    hornId: pickId(rng, idsOfKind(assets, 'horn'), 'horn'),
    maneId: pickId(rng, idsOfKind(assets, 'mane'), 'mane'),
    tailId: pickId(rng, idsOfKind(assets, 'tail'), 'tail'),
    patternId: patterns.length && rng.chance(0.55) ? rng.pick(patterns) : null,
    coat: rng.pick(COATS).hex,
    maneColour,
    tailColour,
    hornColour: rng.pick(HORNS).hex,
    patternColour: rng.pick(PATTERN_COLOURS).hex,
    patternAmount: rng.range(0.45, 0.85),
    patternScale: rng.range(2.5, 4.5),
    scale: bodyId === 'kropp_liten' ? rng.range(0.72, 0.85) : rng.range(0.92, 1.1),
  };
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
