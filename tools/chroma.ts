/**
 * Cutout helper for gpt-image-2 output.
 *
 * The Azure gpt-image-2 deployment refuses `background: "transparent"`, so every
 * sprite is generated on a flat magenta field and keyed out here instead.
 *
 * Keying is restricted to magenta that is *connected to the image border*, so a
 * pink mane or a purple star in the middle of a sprite is never eaten.
 */

import sharp from 'sharp';

/** How magenta a pixel is: high for #FF00FF, ~0 for white, grey and skin tones. */
function magentaness(r: number, g: number, b: number): number {
  return Math.min(r, b) - g;
}

const KEY_FULL = 150; // >= this is definitely background
const KEY_EDGE = 60; // <= this is definitely subject; between the two is feathered

/**
 * Nothing in the illustrations comes close to pure #FF00FF, so a pixel this
 * magenta is background even when it is walled in — the holes inside a curly
 * tail, for instance, which the border flood fill can never reach.
 */
const KEY_HARD = 200;

export interface CutoutResult {
  /** Trimmed RGBA png. */
  png: Buffer;
  width: number;
  height: number;
  /**
   * Where the trimmed sprite sat inside the original square, normalised 0..1.
   * Lets the rig keep a stable frame of reference after trimming.
   */
  offsetX: number;
  offsetY: number;
}

export async function chromaKey(
  input: Buffer,
  opts: { maxSize?: number; padding?: number } = {},
): Promise<CutoutResult> {
  const { maxSize = 512, padding = 2 } = opts;

  const src = sharp(input).ensureAlpha();
  const { width: w, height: h } = await src.metadata();
  if (!w || !h) throw new Error('could not read image dimensions');
  const data = await src.raw().toBuffer();

  // --- pass 1: classify -----------------------------------------------------
  const score = new Int16Array(w * h);
  for (let i = 0; i < w * h; i++) {
    score[i] = magentaness(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  }

  // --- pass 2: flood fill the background --------------------------------
  // Seeded from the border and from any unmistakably magenta pixel, then grown
  // through everything magenta enough to be background. Growing from seeds
  // rather than keying globally is what protects a pink mane or a purple star
  // sitting in the middle of a sprite.
  const isBg = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (i: number) => {
    if (!isBg[i] && score[i] > KEY_EDGE) {
      isBg[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  for (let i = 0; i < w * h; i++) {
    if (score[i] >= KEY_HARD) push(i);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i / w) | 0;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }

  // --- pass 3: alpha + despill ---------------------------------------------
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;

  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    let alpha = 255;

    if (isBg[i]) {
      const s = score[i];
      if (s >= KEY_FULL) alpha = 0;
      else alpha = Math.round(255 * (1 - (s - KEY_EDGE) / (KEY_FULL - KEY_EDGE)));
    }

    if (alpha > 0 && score[i] > KEY_EDGE) {
      // Despill: pull the magenta cast out of semi-transparent fringe pixels by
      // dragging red and blue back down toward green.
      const g = data[o + 1];
      if (data[o] > g) data[o] = Math.round(g + (data[o] - g) * 0.35);
      if (data[o + 2] > g) data[o + 2] = Math.round(g + (data[o + 2] - g) * 0.35);
    }

    data[o + 3] = alpha;

    if (alpha > 8) {
      const x = i % w;
      const y = (i / w) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) throw new Error('cutout is empty — the whole frame keyed out');

  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(w - 1, maxX + padding);
  maxY = Math.min(h - 1, maxY + padding);

  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const scale = Math.min(1, maxSize / Math.max(cw, ch));
  const outW = Math.max(1, Math.round(cw * scale));
  const outH = Math.max(1, Math.round(ch * scale));

  const png = await sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left: minX, top: minY, width: cw, height: ch })
    .resize(outW, outH, { fit: 'fill' })
    // Palette PNGs are roughly a third of the size here and the difference is
    // invisible: the art is flat gouache with a limited range of colours, and
    // the whole set has to come down a phone connection before anyone can play.
    .png({ palette: true, quality: 90, effort: 9 })
    .toBuffer();

  return {
    png,
    width: outW,
    height: outH,
    offsetX: minX / w,
    offsetY: minY / h,
  };
}
