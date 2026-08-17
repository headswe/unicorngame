/**
 * Finds the white board face inside the easel drawing.
 *
 *   node scripts/board-face.mjs
 *
 * The drawing is laid over the easel as a live texture, so the game has to know
 * exactly where the blank rectangle is. Measuring it off the art beats guessing
 * — and beats hand-tuning, because the art can be regenerated.
 */

import sharp from 'sharp';

const image = sharp('public/assets/parts/stafflig.png').ensureAlpha();
const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
const { width, height } = info;

const isWhite = (i) => {
  const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
  return a > 200 && r > 228 && g > 224 && b > 214;
};

// The widest run of white on each row, which ignores stray white highlights
// elsewhere in the picture and finds the board itself.
const rows = [];
for (let y = 0; y < height; y++) {
  let best = { from: 0, to: -1 };
  let start = -1;
  for (let x = 0; x <= width; x++) {
    const white = x < width && isWhite((y * width + x) * 4);
    if (white && start < 0) start = x;
    if (!white && start >= 0) {
      if (x - start > best.to - best.from) best = { from: start, to: x - 1 };
      start = -1;
    }
  }
  rows.push(best);
}

// The board is the tall block of rows whose widest run is close to the widest
// run anywhere in the image.
const widest = Math.max(...rows.map((r) => r.to - r.from));
const onBoard = rows.map((r) => r.to - r.from > widest * 0.75);

let top = onBoard.indexOf(true);
let bottom = onBoard.lastIndexOf(true);
// Trust only the longest unbroken block, in case the ledge is white too.
let runStart = -1, best = { from: top, to: bottom };
for (let y = 0; y <= height; y++) {
  if (y < height && onBoard[y]) { if (runStart < 0) runStart = y; }
  else if (runStart >= 0) {
    if (y - 1 - runStart > best.to - best.from) best = { from: runStart, to: y - 1 };
    runStart = -1;
  }
}
top = best.from;
bottom = best.to;

const left = Math.max(...rows.slice(top, bottom + 1).map((r) => r.from));
const right = Math.min(...rows.slice(top, bottom + 1).map((r) => r.to));

// Sprites are addressed with the origin at the bottom-left, y up.
const face = {
  x: +(left / width).toFixed(3),
  y: +(1 - (bottom + 1) / height).toFixed(3),
  width: +((right - left + 1) / width).toFixed(3),
  height: +((bottom - top + 1) / height).toFixed(3),
};
console.log(`sprite ${width}×${height}`);
console.log('BOARD_FACE =', JSON.stringify(face));
console.log(`face is ${((right - left + 1) / (bottom - top + 1)).toFixed(2)}:1`);
