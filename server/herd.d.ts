/** Types for herd.js, which is plain JavaScript so the relay and the browser can share it. */

export declare const HERD_HZ: number;
export declare const TREAT_SMELL: number;
export declare const EAT_RADIUS: number;
export declare const RESIDENTS: number;
export declare const WORLD_BOUNDS: {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export declare function hash01(a: number, b: number): number;
export declare function hashSeed(seed: string): number;

/**
 * What the simulation needs to know about a berry: where it is, when it lands,
 * and whether somebody has had it. How it is drawn is nothing to do with here.
 */
export interface HerdTreat {
  id: string;
  x: number;
  y: number;
  landsAt: number;
  eaten: boolean;
}

/** What `scatterTreats` returns: a berry plus what the client needs to draw it. */
export interface ScatteredTreat extends HerdTreat {
  height: number;
  bornAt: number;
}

/** `[x, y, facing, moving, mood]`, in roster order. */
export type PonyPose = [number, number, number, number, number];

/** What a pony is feeling, for the client to draw. */
export declare const MOOD: { CALM: 0; LOOKING: 1; HAPPY: 2 };

export interface HerdEvents {
  poops: Array<{ id: string; x: number; y: number }>;
  eaten: string[];
  /** Roster indices of ponies that are pleased about something. */
  cheers: number[];
}

export declare class Herd {
  constructor(options: {
    seed: string;
    count: number;
    bounds: { minX: number; maxX: number; minY: number; maxY: number };
  });
  add(seed: string, homeX?: number, homeY?: number): unknown;
  roster(): string[];
  snapshot(): PonyPose[];
  tick(
    dt: number,
    now: number,
    treats?: HerdTreat[],
    players?: Array<{ id: string; x: number; y: number }>,
  ): HerdEvents;
  pet(index: number, player: { id: string; x: number; y: number }, now: number): boolean;
}

export declare function scatterTreats(
  centreX: number,
  centreY: number,
  count: number,
  radius: number,
  rng: { next(): number; range(min: number, max: number): number },
  tag: string,
  at: number,
): ScatteredTreat[];
