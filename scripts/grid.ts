/**
 * Debug helper: overlays a labelled 0..1 grid on a sprite so socket positions
 * can be read straight off the picture.
 *
 *   npx tsx scripts/grid.ts kropp_normal kropp_liten
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CELLS = 10;
const SIZE = 420;

async function gridFor(id: string): Promise<Buffer> {
  const src = join(ROOT, 'public/assets/parts', `${id}.png`);
  // Stretched to fill, so grid coordinates are exactly the sprite's own 0..1
  // space — which is what the rig sockets are expressed in.
  const sprite = await sharp({
    create: { width: SIZE, height: SIZE, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .composite([{ input: await sharp(src).resize(SIZE, SIZE, { fit: 'fill' }).png().toBuffer() }])
    .png()
    .toBuffer();

  const lines: string[] = [];
  for (let i = 0; i <= CELLS; i++) {
    const p = (i / CELLS) * SIZE;
    const heavy = i % 5 === 0;
    const stroke = heavy ? '#d02020' : '#60a0d0';
    const w = heavy ? 1.4 : 0.6;
    lines.push(`<line x1="${p}" y1="0" x2="${p}" y2="${SIZE}" stroke="${stroke}" stroke-width="${w}"/>`);
    lines.push(`<line x1="0" y1="${p}" x2="${SIZE}" y2="${p}" stroke="${stroke}" stroke-width="${w}"/>`);
    // y is labelled bottom-up to match the rig's coordinate space.
    lines.push(`<text x="2" y="${SIZE - p - 3}" font-size="11" fill="#d02020">${(i / CELLS).toFixed(1)}</text>`);
    lines.push(`<text x="${p + 2}" y="${SIZE - 3}" font-size="11" fill="#1050a0">${(i / CELLS).toFixed(1)}</text>`);
  }

  const overlay = Buffer.from(
    `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
       ${lines.join('')}
       <text x="6" y="16" font-size="15" font-weight="bold" fill="#202020">${id}</text>
     </svg>`,
  );

  return sharp(sprite).composite([{ input: overlay }]).png().toBuffer();
}

async function main() {
  const ids = process.argv.slice(2);
  if (!ids.length) {
    console.error('usage: npx tsx scripts/grid.ts <part-id> [...]');
    process.exit(1);
  }

  const tiles = await Promise.all(ids.map(gridFor));
  const cols = Math.min(ids.length, 3);
  const rows = Math.ceil(ids.length / cols);

  const sheet = await sharp({
    create: {
      width: cols * SIZE,
      height: rows * SIZE,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite(
      tiles.map((input, i) => ({
        input,
        left: (i % cols) * SIZE,
        top: Math.floor(i / cols) * SIZE,
      })),
    )
    .png()
    .toBuffer();

  const out = join(ROOT, '.cache/grid.png');
  await writeFile(out, sheet);
  console.log(out);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
