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

/** A region of a sprite, 0..1, origin bottom-left. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BodyRig {
  /** Forehead, just in front of the ears — where the horn grows. */
  poll: Socket;
  /** Top of the neck — where the mane starts. */
  crest: Socket;
  /** Top of the rump — where the tail attaches. */
  dock: Socket;
  /**
   * The patch of the body drawing containing the ears.
   *
   * Ears are painted into the body sprite, but the mane is drawn on top of the
   * body, so a full mane buries them. Rather than drawing a separate ear — which
   * would never quite line up — this region is cut from the body's own texture
   * and drawn again over the hair. Same pixels, same tint, same coat pattern,
   * so it is invisible except where it rescues an ear.
   *
   * Keep it tight to the ears: everything inside also covers the mane.
   */
  ears?: Rect;
  /**
   * Nudges where the ear patch is *drawn*, without changing where it is cut
   * from — which is how the ears can be shifted forward at all, given they are
   * painted into the body and cannot be moved there.
   *
   * Keep it small. The copy has to stay overlapping the ear it was cut from,
   * or the original shows behind it as a doubled edge — measurably so past
   * about 0.015 with the current feather widths.
   */
  earsOffset?: { x: number; y: number };
}

const DEFAULT_RIG: BodyRig = {
  poll: { x: 0.7, y: 0.9, scale: 0.42 },
  crest: { x: 0.6, y: 0.93, scale: 0.6 },
  dock: { x: 0.06, y: 0.45, scale: 0.55 },
};

/**
 * Measured off `npx tsx scripts/rigcheck.ts`, which marks each socket on the
 * artwork. Two rules keep them honest:
 *
 * - The poll sits on the *forehead*, in front of the ear and a little inside
 *   the skull, so the horn grows out of the head rather than hovering over it.
 * - The crest sits just behind the ear at the top of the neck, low enough that
 *   the hair rests on the neck instead of floating above it.
 */
export const BODY_RIGS: Record<string, BodyRig> = {
  kropp_normal: {
    poll: { x: 0.755, y: 0.78, scale: 0.46, rotation: -0.22 },
    crest: { x: 0.635, y: 0.855, scale: 0.56 },
    dock: { x: 0.13, y: 0.5, scale: 0.5 },
    ears: { x: 0.585, y: 0.83, width: 0.17, height: 0.17 },
    earsOffset: { x: 0.012, y: 0 },
  },
  kropp_liten: {
    poll: { x: 0.715, y: 0.77, scale: 0.42, rotation: -0.22 },
    crest: { x: 0.585, y: 0.845, scale: 0.5 },
    dock: { x: 0.12, y: 0.47, scale: 0.44 },
    ears: { x: 0.49, y: 0.815, width: 0.175, height: 0.185 },
    earsOffset: { x: 0.012, y: 0 },
  },
  kropp_ludd: {
    poll: { x: 0.745, y: 0.78, scale: 0.44, rotation: -0.22 },
    crest: { x: 0.645, y: 0.845, scale: 0.55 },
    dock: { x: 0.12, y: 0.51, scale: 0.48 },
    // This one shows both ears, so the patch reaches further back.
    ears: { x: 0.575, y: 0.83, width: 0.245, height: 0.17 },
    earsOffset: { x: 0.012, y: 0 },
  },
};

export function rigFor(bodyId: string): BodyRig {
  return BODY_RIGS[bodyId] ?? DEFAULT_RIG;
}

/** How an attachable sprite meets its socket. */
export interface Pivot {
  /** The point on this sprite, 0..1, that is placed onto the socket. */
  x: number;
  y: number;
  /**
   * Multiplier on the socket's scale, for drawings whose subject fills their
   * frame differently from the rest of the set — a wide fan of a mane needs to
   * come out smaller than a narrow braid to cover the same neck.
   */
  scale?: number;
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

  man_vagig: { x: 0.4, y: 0.75 },
  man_lockig: { x: 0.4, y: 0.7 },
  man_taggig: { x: 0.4, y: 0.4, scale: 0.85 },
  man_fladar: { x: 0.4, y: 0.7 },

  svans_lang: { x: 1.05, y: 0.93 },
  svans_puff: { x: 1.15, y: 0.8 },
  svans_lockig: { x: 1.15, y: 0.93 },
  svans_fjader: { x: 1, y: 0.92 },
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
  /**
   * Draw only this region of the part's texture. Used by the ear patch, which
   * re-uses a slice of the body drawing.
   */
  uv?: Rect;
  /**
   * Edge fade widths as fractions of the quad: left, right, bottom, top. Lets
   * the ear patch dissolve into the hair instead of showing its own rectangle.
   */
  feather?: [number, number, number, number];
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
    const height = socket.scale * (pivot.scale ?? 1) * bodyH;
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

  // Finally the ears, cut from the body and laid back over the hair. Because
  // the UVs are the body's own, the tint and the coat pattern line up exactly
  // with the body underneath — only the mane is covered.
  if (rig.ears) {
    const { x, y, width, height } = rig.ears;
    const shift = rig.earsOffset ?? { x: 0, y: 0 };
    const centreX = (x + width / 2 - 0.5 + shift.x) * bodyW;
    const centreY = (y + height / 2 + shift.y) * bodyH;
    out.push({
      part: body,
      x: centreX,
      y: centreY,
      anchorX: centreX,
      anchorY: centreY,
      pivotX: 0.5,
      pivotY: 0.5,
      width: width * bodyW,
      height: height * bodyH,
      rotation: 0,
      tint: variant.coat,
      order: PART_ORDER.ears,
      pattern,
      uv: rig.ears,
      // Soft on three sides; the ear tips run right up to the top edge.
      feather: [0.22, 0.22, 0.3, 0],
    });
  }

  return out.sort((a, b) => a.order - b.order);
}
