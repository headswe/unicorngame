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

const smoothstep = (edge: number, x: number): number => {
  if (edge <= 0) return 1;
  const t = Math.min(1, Math.max(0, x / edge));
  return t * t * (3 - 2 * t);
};

/** Matches the sprite shader's edge fade, so the preview shows the real thing. */
async function applyFeather(
  png: Buffer,
  w: number,
  h: number,
  [left, right, bottom, top]: [number, number, number, number],
): Promise<Buffer> {
  const mask = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    // Image rows run top-down; the quad's v axis runs bottom-up.
    const v = 1 - (y + 0.5) / h;
    const vertical = smoothstep(bottom, v) * smoothstep(top, 1 - v);
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const fade = vertical * smoothstep(left, u) * smoothstep(right, 1 - u);
      const o = (y * w + x) * 4;
      mask[o] = 255;
      mask[o + 1] = 255;
      mask[o + 2] = 255;
      mask[o + 3] = Math.round(fade * 255);
    }
  }

  // dest-in keeps the image but multiplies its alpha by the mask's.
  return sharp(png)
    .composite([{ input: mask, raw: { width: w, height: h, channels: 4 }, blend: 'dest-in' }])
    .png()
    .toBuffer();
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

    let source = sharp(opts.partFile(p.part.id));
    if (p.uv) {
      // The renderer narrows the quad's UVs; here the pixels are cut out
      // instead. Rect y runs from the bottom, image rows from the top.
      const meta = await source.metadata();
      const iw = meta.width ?? 1;
      const ih = meta.height ?? 1;
      source = sharp(opts.partFile(p.part.id)).extract({
        left: Math.max(0, Math.round(p.uv.x * iw)),
        top: Math.max(0, Math.round((1 - p.uv.y - p.uv.height) * ih)),
        width: Math.max(1, Math.round(p.uv.width * iw)),
        height: Math.max(1, Math.round(p.uv.height * ih)),
      });
    }
    let resized = await source.resize(w, h, { fit: 'fill' }).png().toBuffer();
    if (p.feather) resized = await applyFeather(resized, w, h, p.feather);

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
