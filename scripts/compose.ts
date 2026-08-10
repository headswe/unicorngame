/**
 * Flat compositor for the offline rig tools.
 *
 * Mirrors what the renderer does with a placed part — including rotating about
 * the part's pivot rather than its centre, which is the difference between a
 * horn that tilts on its base and one that swings through the skull. Shared by
 * scripts/preview.ts and scripts/rigcheck.ts so neither can quietly disagree
 * with the game.
 */

import sharp from 'sharp';

import type { PlacedPart } from '../src/game/rig.ts';

export interface ComposeOptions {
  /** Pixels per body height. */
  unit: number;
  /** Where the unicorn's hooves sit on the canvas. */
  originX: number;
  originY: number;
  /** Canvas bounds, so overlays that fall outside can be dropped. */
  canvasWidth: number;
  canvasHeight: number;
  partFile(id: string): string;
}

/**
 * Grows the image until `pivot` is dead centre, so a plain centre-rotation is
 * a rotation about the pivot.
 */
async function centreOnPivot(
  input: Buffer,
  w: number,
  h: number,
  pivotX: number,
  pivotY: number,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const px = pivotX * w;
  const py = (1 - pivotY) * h; // pivot y is measured from the bottom

  const width = Math.max(1, Math.ceil(2 * Math.max(px, w - px)));
  const height = Math.max(1, Math.ceil(2 * Math.max(py, h - py)));

  const buffer = await sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input, left: Math.round(width / 2 - px), top: Math.round(height / 2 - py) }])
    .png()
    .toBuffer();

  return { buffer, width, height };
}

/** Turns laid-out parts into sharp overlays, back to front. */
export async function composeParts(
  placed: PlacedPart[],
  opts: ComposeOptions,
): Promise<sharp.OverlayOptions[]> {
  const overlays: sharp.OverlayOptions[] = [];

  for (const p of placed) {
    const w = Math.max(1, Math.round(p.width * opts.unit));
    const h = Math.max(1, Math.round(p.height * opts.unit));
    const resized = await sharp(opts.partFile(p.part.id)).resize(w, h, { fit: 'fill' }).png().toBuffer();

    let input = resized;
    let left: number;
    let top: number;

    if (p.rotation === 0) {
      left = Math.round(opts.originX + p.x * opts.unit - w / 2);
      top = Math.round(opts.originY - (p.y * opts.unit + h / 2));
    } else {
      const centred = await centreOnPivot(resized, w, h, p.pivotX, p.pivotY);
      // sharp turns clockwise for positive degrees; three.js turns
      // anticlockwise for positive radians.
      const rotated = await sharp(centred.buffer)
        .rotate(-(p.rotation * 180) / Math.PI, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer({ resolveWithObject: true });

      input = rotated.data;
      // The pivot stayed at the centre through both operations, so the anchor
      // is all that is needed to place it.
      left = Math.round(opts.originX + p.anchorX * opts.unit - rotated.info.width / 2);
      top = Math.round(opts.originY - p.anchorY * opts.unit - rotated.info.height / 2);
    }

    if (
      left + (p.rotation === 0 ? w : 0) <= -opts.canvasWidth ||
      left >= opts.canvasWidth * 2 ||
      top >= opts.canvasHeight * 2
    ) {
      continue;
    }
    overlays.push({ input, left, top });
  }

  return overlays;
}
