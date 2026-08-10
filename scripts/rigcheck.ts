/**
 * Rig diagnostic.
 *
 * Two questions have to be answered separately, or tuning turns into guesswork:
 *
 *   1. Is each socket in the right place on the body? (row 1 — bodies with the
 *      poll / crest / dock marked)
 *   2. Is each part's pivot on the spot that should touch the body? (rows 2-4 —
 *      horns, manes and tails with their pivot marked)
 *
 * Then row 5 shows one body wearing every horn, and row 6 every mane, so the
 * result can be checked against the intent.
 *
 *   npx tsx scripts/rigcheck.ts [bodyId]
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

import type { AssetLibrary, PartInfo } from '../src/engine/assets.ts';
import { layoutUnicorn, pivotFor, rigFor, type LayoutDeps } from '../src/game/rig.ts';
import { randomVariant } from '../src/game/variant.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MANIFEST = join(ROOT, 'src/generated/parts-manifest.json');
const partFile = (id: string) => join(ROOT, 'public/assets/parts', `${id}.png`);

const CELL = 340;
const UNIT = 210; // pixels per body height
const BASELINE = CELL - 40; // where the hooves sit inside a cell

type Deps = LayoutDeps & Pick<AssetLibrary, 'ofKind'>;

function makeDeps(parts: PartInfo[]): Deps {
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

const crosshair = (x: number, y: number, label: string, colour: string) => `
  <line x1="${x - 14}" y1="${y}" x2="${x + 14}" y2="${y}" stroke="${colour}" stroke-width="1.6"/>
  <line x1="${x}" y1="${y - 14}" x2="${x}" y2="${y + 14}" stroke="${colour}" stroke-width="1.6"/>
  <circle cx="${x}" cy="${y}" r="4.5" fill="none" stroke="${colour}" stroke-width="1.6"/>
  <text x="${x + 8}" y="${y - 8}" font-size="13" font-weight="bold" fill="${colour}">${label}</text>`;

async function cell(
  layers: sharp.OverlayOptions[],
  markup: string,
  title: string,
  bg = { r: 226, g: 240, b: 233, alpha: 1 },
): Promise<Buffer> {
  const svg = Buffer.from(
    `<svg width="${CELL}" height="${CELL}" xmlns="http://www.w3.org/2000/svg">
       <line x1="0" y1="${BASELINE}" x2="${CELL}" y2="${BASELINE}" stroke="#b0c4bb" stroke-width="1"/>
       ${markup}
       <text x="6" y="16" font-size="13" font-weight="bold" fill="#333">${title}</text>
     </svg>`,
  );
  return sharp({ create: { width: CELL, height: CELL, channels: 4, background: bg } })
    .composite([...layers, { input: svg }])
    .png()
    .toBuffer();
}

/** A body with its three sockets marked. */
async function bodyCell(deps: Deps, bodyId: string): Promise<Buffer> {
  const body = deps.get(bodyId);
  const rig = rigFor(bodyId);
  const h = UNIT;
  const w = h * body.aspect;
  const left = CELL / 2 - w / 2;
  const top = BASELINE - h;

  const marks = (['poll', 'crest', 'dock'] as const)
    .map((name, i) => {
      const s = rig[name];
      // Socket coords are 0..1 over the body sprite, origin bottom-left.
      return crosshair(
        left + s.x * w,
        BASELINE - s.y * h,
        name[0]!.toUpperCase(),
        ['#e02020', '#1060d0', '#00902a'][i]!,
      );
    })
    .join('');

  const img = await sharp(partFile(bodyId)).resize(Math.round(w), Math.round(h), { fit: 'fill' }).png().toBuffer();
  return cell([{ input: img, left: Math.round(left), top: Math.round(top) }], marks, bodyId);
}

/** A single attachable part with its pivot marked. */
async function pivotCell(deps: Deps, id: string): Promise<Buffer> {
  const part = deps.get(id);
  const pivot = pivotFor(part);
  const h = UNIT * 0.9;
  const w = h * part.aspect;
  const left = CELL / 2 - w / 2;
  const top = CELL / 2 - h / 2;

  const img = await sharp(partFile(id)).resize(Math.round(w), Math.round(h), { fit: 'fill' }).png().toBuffer();
  return cell(
    [{ input: img, left: Math.round(left), top: Math.round(top) }],
    crosshair(left + pivot.x * w, top + (1 - pivot.y) * h, 'pivot', '#d000c0'),
    id,
    { r: 240, g: 236, b: 226, alpha: 1 },
  );
}

/** An assembled unicorn, with the socket the swapped part hangs from marked. */
async function assembledCell(deps: Deps, bodyId: string, override: Record<string, string>, title: string) {
  const variant = { ...randomVariant(deps as unknown as AssetLibrary, 'rigcheck'), bodyId, ...override };
  const layers: sharp.OverlayOptions[] = [];

  for (const p of layoutUnicorn(variant, deps)) {
    const w = p.width * UNIT;
    const h = p.height * UNIT;
    layers.push({
      input: await sharp(partFile(p.part.id))
        .resize(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)), { fit: 'fill' })
        .png()
        .toBuffer(),
      left: Math.round(CELL / 2 + p.x * UNIT - w / 2),
      top: Math.round(BASELINE - (p.y * UNIT + h / 2)),
    });
  }
  return cell(layers, '', title);
}

async function main() {
  const parts: PartInfo[] = JSON.parse(await readFile(MANIFEST, 'utf8'));
  const deps = makeDeps(parts);
  const bodyId = process.argv[2] ?? 'kropp_normal';

  const ids = (kind: string) => parts.filter((p) => p.kind === kind).map((p) => p.id);

  const rows: Buffer[][] = [
    await Promise.all(ids('body').map((id) => bodyCell(deps, id))),
    await Promise.all(ids('horn').map((id) => pivotCell(deps, id))),
    await Promise.all(ids('mane').map((id) => pivotCell(deps, id))),
    await Promise.all(ids('tail').map((id) => pivotCell(deps, id))),
    await Promise.all(ids('horn').map((id) => assembledCell(deps, bodyId, { hornId: id }, id))),
    await Promise.all(ids('mane').map((id) => assembledCell(deps, bodyId, { maneId: id }, id))),
  ];

  const cols = Math.max(...rows.map((r) => r.length));
  const sheet = await sharp({
    create: {
      width: cols * CELL,
      height: rows.length * CELL,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite(
      rows.flatMap((row, y) => row.map((input, x) => ({ input, left: x * CELL, top: y * CELL }))),
    )
    .png()
    .toBuffer();

  await mkdir(join(ROOT, '.cache'), { recursive: true });
  const out = join(ROOT, '.cache/rigcheck.png');
  await writeFile(out, sheet);
  console.log(out);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
