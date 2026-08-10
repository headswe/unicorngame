/**
 * How the pieces of a unicorn fit together.
 *
 * Each body sprite carries three sockets — poll, crest and dock — measured off
 * the artwork in the sprite's own 0..1 space (origin bottom-left, y up). Each
 * horn, mane and tail carries a pivot: the point on *that* sprite which is
 * placed onto the socket.
 *
 * `layoutUnicorn` turns a variant plus the loaded sprites into a flat list of
 * placed quads. It is deliberately pure and free of three.js so the same maths
 * drives both the game and the offline preview in scripts/preview.ts — the rig
 * can never drift between what is tuned and what ships.
 */

import type { Part, PartKind } from '../engine/assets.ts';
import { PART_ORDER } from '../engine/view.ts';
import type { UnicornVariant } from './variant.ts';

export interface Socket {
  /** Position on the body sprite, 0..1, origin bottom-left. */
  x: number;
  y: number;
  /** Height of the attached part as a fraction of the body's height. */
  scale: number;
  /** Clockwise-negative tilt in radians. */
  rotation?: number;
}

export interface BodyRig {
  /** Forehead, just in front of the ears — where the horn grows. */
  poll: Socket;
  /** Top of the neck — where the mane starts. */
  crest: Socket;
  /** Top of the rump — where the tail attaches. */
  dock: Socket;
}

const DEFAULT_RIG: BodyRig = {
  poll: { x: 0.7, y: 0.9, scale: 0.42 },
  crest: { x: 0.6, y: 0.93, scale: 0.6 },
  dock: { x: 0.06, y: 0.45, scale: 0.55 },
};

export const BODY_RIGS: Record<string, BodyRig> = {
  kropp_normal: {
    poll: { x: 0.68, y: 0.87, scale: 0.44 },
    crest: { x: 0.6, y: 0.88, scale: 0.62 },
    dock: { x: 0.13, y: 0.5, scale: 0.55 },
  },
  kropp_liten: {
    poll: { x: 0.65, y: 0.88, scale: 0.4 },
    crest: { x: 0.56, y: 0.89, scale: 0.56 },
    dock: { x: 0.12, y: 0.47, scale: 0.48 },
  },
  kropp_ludd: {
    poll: { x: 0.7, y: 0.89, scale: 0.42 },
    crest: { x: 0.62, y: 0.9, scale: 0.6 },
    dock: { x: 0.12, y: 0.51, scale: 0.53 },
  },
};

export function rigFor(bodyId: string): BodyRig {
  return BODY_RIGS[bodyId] ?? DEFAULT_RIG;
}

/** Point on an attachable sprite that lands on its socket. */
export interface Pivot {
  x: number;
  y: number;
}

const PIVOT_BY_KIND: Partial<Record<PartKind, Pivot>> = {
  horn: { x: 0.47, y: 0.04 },
  mane: { x: 0.72, y: 0.9 },
  tail: { x: 0.86, y: 0.88 },
};

/**
 * Per-sprite pivots, read off the grid overlays in .cache/grid.png. Each one is
 * the spot on that drawing which should touch the body — the root of the tail,
 * the crown of the mane, the base of the horn.
 */
const PIVOT_BY_ID: Record<string, Pivot> = {
  horn_bojt: { x: 0.5, y: 0.04 },

  man_vagig: { x: 0.76, y: 0.9 },
  man_lockig: { x: 0.76, y: 0.84 },
  man_taggig: { x: 0.5, y: 0.58 },
  man_fladar: { x: 0.82, y: 0.9 },

  svans_lang: { x: 0.88, y: 0.93 },
  svans_puff: { x: 0.84, y: 0.8 },
  svans_lockig: { x: 0.76, y: 0.93 },
  svans_fjader: { x: 0.64, y: 0.92 },
};

export function pivotFor(part: Part): Pivot {
  return PIVOT_BY_ID[part.id] ?? PIVOT_BY_KIND[part.kind] ?? { x: 0.5, y: 0.5 };
}

/**
 * One placed quad. Coordinates are in "body heights", with the origin on the
 * ground between the unicorn's hooves and y pointing up.
 */
export interface PlacedPart {
  part: Part;
  /** Centre of the quad — what a flat compositor wants. */
  x: number;
  y: number;
  /**
   * The socket the part hangs from, and which point of the sprite is pinned to
   * it. The renderer builds the quad around this pivot so a mane or tail can be
   * rotated to sway from where it actually attaches.
   */
  anchorX: number;
  anchorY: number;
  pivotX: number;
  pivotY: number;
  width: number;
  height: number;
  rotation: number;
  tint: number;
  order: number;
  /** Set on the body so the coat pattern can be masked to its silhouette. */
  pattern?: { part: Part; tint: number; amount: number; repeat: number };
}

/** Total height of a laid-out unicorn, in body heights. Useful for framing. */
export const BODY_HEIGHT_UNITS = 1;

export interface LayoutDeps {
  get(id: string): Part;
  has(id: string): boolean;
}

/**
 * Stacks a variant into placed quads, back to front. Missing sprites are
 * skipped rather than throwing, so a half-generated asset folder still renders
 * something recognisable.
 */
export function layoutUnicorn(variant: UnicornVariant, assets: LayoutDeps): PlacedPart[] {
  const out: PlacedPart[] = [];

  if (!assets.has(variant.bodyId)) return out;
  const body = assets.get(variant.bodyId);
  const rig = rigFor(variant.bodyId);

  const bodyH = BODY_HEIGHT_UNITS;
  const bodyW = bodyH * body.aspect;

  /** Socket position in unicorn-local space. */
  const socketPoint = (socket: Socket) => ({
    x: (socket.x - 0.5) * bodyW,
    y: socket.y * bodyH,
  });

  const attach = (
    id: string,
    socket: Socket,
    tint: number,
    order: number,
  ): void => {
    if (!assets.has(id)) return;
    const part = assets.get(id);
    const pivot = pivotFor(part);
    const height = socket.scale * bodyH;
    const width = height * part.aspect;
    const at = socketPoint(socket);
    out.push({
      part,
      // Shift so the pivot, not the centre, sits on the socket.
      x: at.x + (0.5 - pivot.x) * width,
      y: at.y + (0.5 - pivot.y) * height,
      anchorX: at.x,
      anchorY: at.y,
      pivotX: pivot.x,
      pivotY: pivot.y,
      width,
      height,
      rotation: socket.rotation ?? 0,
      tint,
      order,
    });
  };

  // Back to front: tail, body (with its coat pattern), mane, horn.
  attach(variant.tailId, rig.dock, variant.tailColour, PART_ORDER.tail);

  const pattern =
    variant.patternId && assets.has(variant.patternId)
      ? {
          part: assets.get(variant.patternId),
          tint: variant.patternColour,
          amount: variant.patternAmount,
          repeat: variant.patternScale,
        }
      : undefined;

  out.push({
    part: body,
    x: 0,
    y: bodyH / 2,
    // The body hangs from the ground between its hooves.
    anchorX: 0,
    anchorY: 0,
    pivotX: 0.5,
    pivotY: 0,
    width: bodyW,
    height: bodyH,
    rotation: 0,
    tint: variant.coat,
    order: PART_ORDER.body,
    pattern,
  });

  attach(variant.maneId, rig.crest, variant.maneColour, PART_ORDER.mane);
  attach(variant.hornId, rig.poll, variant.hornColour, PART_ORDER.horn);

  return out.sort((a, b) => a.order - b.order);
}
