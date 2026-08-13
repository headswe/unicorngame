/**
 * What the meadow says over the wire.
 *
 * The guiding decision here is how *little* is sent. The field itself is
 * generated from the seed `angen-1` rather than stored, so every browser
 * already builds the identical meadow — the same trees, the same eighteen
 * residents, the same colours — without a byte crossing the network. That
 * leaves only two things worth sending: where each child's own unicorn is, and
 * the spells they cast.
 *
 * Deliberately *not* synchronised: the wandering residents, the poop they leave
 * and the grass they eat. Those run locally on each machine and are allowed to
 * drift apart. Keeping them in lockstep would mean a fixed timestep and
 * eighteen more moving things on the wire, to fix a difference no child will
 * ever notice — the cousin's meadow having a poop in a slightly different place
 * is not a bug anyone will report.
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
  | HatchedMessage
  | StateMessage
  | ByeMessage;

/** A cheap unique name for this browser tab, for the length of one visit. */
export function newPeerId(): string {
  return Math.random().toString(36).slice(2, 10);
}
