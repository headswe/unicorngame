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
export const PROTOCOL_VERSION = 3;

/**
 * The three places a child can be.
 *
 * `angen` is the meadow, where y is depth into the field and squashed on
 * screen. `studs` is the bouncing yard through the gate, where y is height off
 * the ground. `bana` is the racing dimension through the portal, seen from
 * straight above, where y is north and nothing is squashed at all. The same two
 * numbers mean something different in each, which is exactly why a pose has to
 * say which one it is talking about.
 */
export type Place = 'angen' | 'studs' | 'bana';

/** How many times a second each player's position goes out. */
export const POSE_HZ = 10;

/** A peer that has said nothing for this long has gone. */
export const PEER_TIMEOUT = 6;

/** Where a unicorn is and what it is doing, as sent. Kept small; it is frequent. */
export interface Pose {
  x: number;
  /** Depth into the meadow, or height above the yard floor. See `p`. */
  y: number;
  /** 1 faces right, -1 faces left. */
  f: 1 | -1;
  /** Whether the walk cycle should be playing. */
  m: boolean;
  /** Which place this pose is in. Absent means the meadow. */
  p?: Place;
  /**
   * How far the pony is turned, in radians. A somersault in the yard, and which
   * way a kart is pointing on the track. Absent means upright, or due east.
   */
  r?: number;
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

/**
 * A chunk of a line being drawn on the shared board.
 *
 * Sent while the finger is still moving rather than when it lifts, so a line
 * appears on every screen as it is drawn. The first chunk of a line carries its
 * colour and thickness; later ones only add points to it, found by `stroke`.
 */
export interface InkMessage {
  t: 'ink';
  id: string;
  /** Names this line, so chunks of it can find each other. */
  stroke: string;
  colour: number;
  nib: number;
  /** `[x0, y0, x1, y1, …]`, each 0..1000 across the board. */
  xy: number[];
}

/**
 * Lines rubbed out, by name.
 *
 * Anybody may rub out anybody's line — it is one family sharing one board — so
 * this carries no claim about who owns what. Undo sends it too; the difference
 * is only in which line the sender picked.
 */
export interface RubMessage {
  t: 'rub';
  id: string;
  strokes: string[];
}

/**
 * What the racing dimension is doing, decided by the relay and sent to anyone
 * watching or driving.
 *
 * Races run on a loop whether or not anybody is there, so there is always
 * something to walk in on: a wait on the grid, a countdown, the race, the
 * results, and round again. `until` is when the current phase ends, in unix
 * seconds, so every screen counts down to the same instant rather than each
 * running its own clock.
 *
 * Driving is not in here. A kart is far too immediate to be worth anybody
 * else's connection having a say in, so each child drives their own and this
 * settles only what has to be agreed: when to go, who has done how many laps,
 * and who won.
 */
export interface RaceMessage {
  t: 'race';
  phase: 'waiting' | 'countdown' | 'racing' | 'results';
  /** Unix seconds this phase ends. */
  until: number;
  /** Laps completed, by peer id — only for those actually in this race. */
  laps: Record<string, number>;
  /** Everyone in the race, best first. Spectators are not in it. */
  order: string[];
  /** Who has crossed the line, in the order they did, and how long they took. */
  finished: Array<{ id: string; seconds: number }>;
  /** Which grid slot each racer starts from, settled when the countdown begins. */
  grid: Record<string, number>;
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
  /**
   * What is on the drawing board. Every line, so a child who arrives after
   * school sees the morning's drawing rather than a blank board.
   *
   * Optional because a relay that has not been redeployed yet will not send it,
   * and a missing board should mean an empty one rather than a broken game.
   */
  strokes?: Array<{ id: string; by: string; colour: number; nib: number; xy: number[] }>;
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
  /** `[x, y, facing, moving, mood]` per pony, in roster order. */
  ponies: Array<[number, number, number, number, number]>;
}

/** A child reached out and patted one of the herd. Index matches the roster. */
export interface PetMessage {
  t: 'pet';
  id: string;
  pony: number;
}

/** Ponies that are pleased about something: hearts over their heads. */
export interface CheerMessage {
  t: 'cheer';
  ponies: number[];
}

export interface ByeMessage {
  t: 'bye';
  id: string;
}

export type NetMessage =
  | HelloMessage
  | RaceMessage
  | InkMessage
  | RubMessage
  | PoseMessage
  | SpellMessage
  | PoopMessage
  | CleanMessage
  | EatenMessage
  | HatchedMessage
  | PetMessage
  | CheerMessage
  | RosterMessage
  | HerdMessage
  | StateMessage
  | ByeMessage;

/** A cheap unique name for this browser tab, for the length of one visit. */
export function newPeerId(): string {
  return Math.random().toString(36).slice(2, 10);
}
