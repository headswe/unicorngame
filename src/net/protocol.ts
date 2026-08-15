/**
 * What the meadow says over the wire.
 *
 * The guiding decision here is how *little* is sent. The field is generated
 * from the day's date rather than stored, so every browser already builds the
 * identical meadow — the same trees, the same eighteen residents, the same
 * colours — without a byte crossing the network. The herd's wandering, the
 * presents it leaves and which pony goes for which strawberry are all functions
 * of the clock too, so none of those are sent either.
 *
 * What is left is only what the clock cannot predict: where each child has
 * chosen to walk, what they cast, and what they picked up or ate. Everything in
 * this file is one of those.
 */

import type { UnicornVariant } from '../game/variant.ts';

/**
 * Bumped whenever the shape of a message changes. Two children on different
 * versions — one with a stale tab open — are dropped rather than left watching
 * each other glitch.
 */
export const PROTOCOL_VERSION = 1;

/** How many times a second each player's position goes out. */
export const POSE_HZ = 10;

/** A peer that has said nothing for this long has gone. */
export const PEER_TIMEOUT = 6;

/** Where a unicorn is and what it is doing, as sent. Kept small; it is frequent. */
export interface Pose {
  x: number;
  y: number;
  /** 1 faces right, -1 faces left. */
  f: 1 | -1;
  /** Whether the walk cycle should be playing. */
  m: boolean;
}

/** Announces a player, and re-announces after a wardrobe change. */
export interface HelloMessage {
  t: 'hello';
  v: number;
  id: string;
  variant: UnicornVariant;
  pose: Pose;
  /**
   * Every poop shovelled in this meadow today, as far as the sender knows.
   *
   * This is how a child who joins at four in the afternoon avoids arriving to a
   * field of poop their cousin cleared at ten — the day's droppings are worked
   * out from the clock, so without this they would all be recreated.
   */
  cleaned: string[];
  /**
   * "Introduce yourself back, even if you already know me." Sent by someone who
   * has realised they missed an introduction. Replies carry it as false, which
   * is what stops two browsers greeting each other forever.
   */
  ask?: boolean;
}

export interface PoseMessage {
  t: 'pose';
  id: string;
  pose: Pose;
}

/**
 * A spell someone cast. The caster decides the outcome and everyone replays it,
 * so a strawberry shower falls in the same places on both screens.
 *
 * `seed` drives the scatter. `variant` is only present for the egg, where the
 * foal is sent outright rather than re-rolled — the shell is painted in its
 * colours, and two children must not see different eggs.
 */
export interface SpellMessage {
  t: 'spell';
  id: string;
  spell: string;
  x: number;
  y: number;
  seed: string;
  variant?: UnicornVariant;
  /**
   * Unix seconds when it was cast. Strawberries fall on this clock rather than
   * on each browser's frame timing, so they touch down at the same moment
   * everywhere — which is what stops two herds picking different berries.
   */
  at: number;
}

/**
 * A present the *player's own* unicorn left. The residents' presents are worked
 * out from the clock and need no message at all; only this one is unpredictable
 * enough to have to be told.
 */
export interface PoopMessage {
  t: 'poop';
  id: string;
  poop: string;
  x: number;
  y: number;
}

/**
 * A player's own unicorn ate a strawberry.
 *
 * The residents' feeding needs no messages — they decide from positions that
 * are functions of the clock, so both browsers send the same ponies to the same
 * berries. Where a *child* walks is the one thing that cannot be predicted.
 */
export interface EatenMessage {
  t: 'eaten';
  id: string;
  berry: string;
}

/** Somebody shovelled one. Named, so both screens remove the same poop. */
export interface CleanMessage {
  t: 'clean';
  id: string;
  poop: string;
}

/** An egg opened. Sent by whoever sees it first; the relay keeps the first. */
export interface HatchedMessage {
  t: 'hatched';
  id: string;
  egg: string;
  foal: UnicornVariant;
  x: number;
  y: number;
}

/**
 * The meadow as it stands, sent by the relay to anyone who connects.
 *
 * Only what cannot be worked out from the clock is in here. The field, the
 * herd and the day's droppings all regenerate identically on every machine;
 * what does not is the *choices* — which poops were shovelled, which eggs are
 * waiting, and which foals have been hatched.
 */
export interface StateMessage {
  t: 'state';
  /** Local date the rest of this belongs to, e.g. `2026-08-13`. */
  day: string;
  cleaned: string[];
  /** Presents left by players rather than by residents; not derivable. */
  poops: Array<{ id: string; x: number; y: number }>;
  eggs: Array<{
    id: string;
    x: number;
    y: number;
    seed: string;
    foal: UnicornVariant;
    /** Unix seconds when the egg was conjured, so its timer can be resumed. */
    since: number;
  }>;
  /** Hatchlings. These outlive the day — a pony a child made is theirs. */
  foals: Array<{ foal: UnicornVariant; x: number; y: number }>;
}

/**
 * Who lives in the meadow, as a list of seeds.
 *
 * Only the seeds: a seed rebuilds the whole unicorn locally through the same
 * generator that made it, so a herd of eighteen costs eighteen short strings
 * rather than eighteen descriptions of a body, a horn, a mane and five colours.
 */
export interface RosterMessage {
  t: 'roster';
  day: string;
  ponies: string[];
}

/**
 * Where the herd is, ten times a second. Index matches the roster, which is why
 * there are no names in here — `[x, y, facing, moving]` and nothing else.
 */
export interface HerdMessage {
  t: 'herd';
  now: number;
  ponies: Array<[number, number, number, number]>;
}

export interface ByeMessage {
  t: 'bye';
  id: string;
}

export type NetMessage =
  | HelloMessage
  | PoseMessage
  | SpellMessage
  | PoopMessage
  | CleanMessage
  | EatenMessage
  | HatchedMessage
  | RosterMessage
  | HerdMessage
  | StateMessage
  | ByeMessage;

/** A cheap unique name for this browser tab, for the length of one visit. */
export function newPeerId(): string {
  return Math.random().toString(36).slice(2, 10);
}
