/**
 * Renders a sheet of assembled unicorns straight from the manifest, using the
 * same layout function the game does. Tuning the rig without waiting on a
 * browser:
 *
 *   npx tsx scripts/preview.ts            # nine random unicorns
 *   npx tsx scripts/preview.ts --all-horns
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

import type { PartInfo } from '../src/engine/assets.ts';
import { layoutUnicorn, type LayoutDeps, type PlacedPart } from '../src/game/rig.ts';
import { randomVariant } from '../src/game/variant.ts';
import type { AssetLibrary } from '../src/engine/assets.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MANIFEST = join(ROOT, 'src/generated/parts-manifest.json');

/** Pixels per body height in the preview. */
const UNIT = 260;
const CELL_W = 420;
const CELL_H = 400;

type Info = PartInfo & { file: string };

/**
 * Stands in for AssetLibrary. The layout code only ever touches metadata, so
 * plain manifest entries are enough — no textures needed.
 */
function makeDeps(parts: Info[]): LayoutDeps & Pick<AssetLibrary, 'ofKind'> {
  const byId = new Map(parts.map((p) => [p.id, p]));
  return {
    has: (id) => byId.has(id),
    get: (id) => {
      const p = byId.get(id);
      if (!p) throw new Error(`unknown part ${id}`);
      return p as unknown as ReturnType<AssetLibrary['get']>;
    },
    ofKind: (kind) => parts.filter((p) => p.kind === kind) as never,
  };
}

/** Multiply tint, matching what the sprite shader does on the GPU. */
async function tinted(file: string, hex: number, w: number, h: number): Promise<Buffer> {
  // The rainbow marker is not a colour; composeParts paints those.
  if (hex < 0) hex = 0xffffff;
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  return sharp(file)
    .resize(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)), { fit: 'fill' })
    .linear([r, g, b], [0, 0, 0])
    .png()
    .toBuffer();
}

async function renderUnicorn(placed: PlacedPart[], partFile: (id: string) => string): Promise<Buffer> {
  const layers: sharp.OverlayOptions[] = [];

  for (const p of placed) {
    const w = p.width * UNIT;
    const h = p.height * UNIT;
    // Local space has y up from the hooves; the image has y down from the top.
    const left = Math.round(CELL_W / 2 + p.x * UNIT - w / 2);
    const top = Math.round(CELL_H - 30 - (p.y * UNIT + h / 2));
    layers.push({ input: await tinted(partFile(p.part.id), p.tint, w, h), left, top });
  }

  return sharp({
    create: { width: CELL_W, height: CELL_H, channels: 4, background: { r: 214, g: 234, b: 226, alpha: 1 } },
  })
    .composite(layers)
    .png()
    .toBuffer();
}

async function main() {
  const parts: Info[] = JSON.parse(await readFile(MANIFEST, 'utf8'));
  const deps = makeDeps(parts);
  const partFile = (id: string) => join(ROOT, 'public/assets/parts', `${id}.png`);

  const allHorns = process.argv.includes('--all-horns');
  const seeds = Array.from({ length: 9 }, (_, i) => `preview-${i}`);

  const variants = seeds.map((seed) => {
    const v = randomVariant(deps as unknown as AssetLibrary, seed);
    if (allHorns) {
      const horns = parts.filter((p) => p.kind === 'horn');
      const horn = horns[seeds.indexOf(seed) % horns.length];
      if (horn) v.hornId = horn.id;
    }
    return v;
  });

  const cells = await Promise.all(
    variants.map((v) => renderUnicorn(layoutUnicorn(v, deps), partFile)),
  );

  const cols = 3;
  const sheet = await sharp({
    create: {
      width: cols * CELL_W,
      height: Math.ceil(cells.length / cols) * CELL_H,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite(
      cells.map((input, i) => ({
        input,
        left: (i % cols) * CELL_W,
        top: Math.floor(i / cols) * CELL_H,
      })),
    )
    .png()
    .toBuffer();

  await mkdir(join(ROOT, '.cache'), { recursive: true });
  const out = join(ROOT, '.cache/preview.png');
  await writeFile(out, sheet);
  console.log(out);
  for (const v of variants) {
    console.log(`  ${v.name.padEnd(12)} ${v.bodyId} ${v.hornId} ${v.maneId} ${v.tailId}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
