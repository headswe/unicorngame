/**
 * The manifest is derived from whatever PNGs are actually on disk, joined with
 * the catalogue metadata. Deriving it rather than accumulating it in memory
 * means an interrupted generation run still leaves a usable game, and a part
 * deleted by hand disappears from the game too.
 */

import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

import { PARTS, type PartKind } from './parts.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT_DIR = join(ROOT, 'public/assets/parts');
const MANIFEST = join(ROOT, 'src/generated/parts-manifest.json');

export interface ManifestEntry {
  id: string;
  kind: PartKind;
  label: string;
  url: string;
  width: number;
  height: number;
  aspect: number;
  worldHeight: number;
  tintable: boolean;
}

export async function writeManifest(): Promise<ManifestEntry[]> {
  const files = new Set(
    (await readdir(OUT_DIR).catch(() => []))
      .filter((f) => f.endsWith('.png'))
      .map((f) => f.slice(0, -4)),
  );

  const entries: ManifestEntry[] = [];

  // Catalogue order, so the manifest diff stays readable between runs.
  for (const spec of PARTS) {
    if (!files.has(spec.id)) continue;
    const file = `${spec.id}.png`;
    const { width, height } = await sharp(join(OUT_DIR, file)).metadata();
    if (!width || !height) continue;
    entries.push({
      id: spec.id,
      kind: spec.kind,
      label: spec.label,
      url: `assets/parts/${file}`,
      width,
      height,
      aspect: width / height,
      worldHeight: spec.worldHeight,
      tintable: !spec.fullColour,
    });
  }

  await writeFile(MANIFEST, `${JSON.stringify(entries, null, 2)}\n`);
  return entries;
}
