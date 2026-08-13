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

export interface ByeMessage {
  t: 'bye';
  id: string;
}

export type NetMessage = HelloMessage | PoseMessage | SpellMessage | ByeMessage;

/** A cheap unique name for this browser tab, for the length of one visit. */
export function newPeerId(): string {
  return Math.random().toString(36).slice(2, 10);
}
