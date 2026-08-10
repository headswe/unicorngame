/**
 * Builds every sprite in the game.
 *
 *   npm run gen:assets            # draw anything not already cached
 *   npm run gen:assets -- --force # ignore the cache and redraw
 *   npm run gen:assets -- horn_   # only ids containing "horn_"
 *   npm run gen:assets -- --manifest-only
 *
 * Generated PNGs land in public/assets/parts/ and the manifest describing them
 * is rewritten after every part, so an interrupted run still leaves a playable
 * game. Raw API responses are cached in .cache/images/ keyed by prompt, so
 * re-running only pays for prompts that actually changed.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromaKey } from '../tools/chroma.js';
import { generateImage } from '../tools/imagegen.js';
import { writeManifest } from './manifest.js';
import { PARTS, type PartSpec } from './parts.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CACHE_DIR = join(ROOT, '.cache/images');
const OUT_DIR = join(ROOT, 'public/assets/parts');

/** The Azure S0 tier throttles hard, so parts are drawn one at a time. */
const GAP_MS = 2500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function buildPart(spec: PartSpec, force: boolean): Promise<void> {
  const raw = await generateImage({
    prompt: spec.prompt,
    size: spec.size ?? '1024x1024',
    quality: 'medium',
    cacheDir: CACHE_DIR,
    bypassCache: force,
  });

  const cut = await chromaKey(raw, { maxSize: 512 });
  await writeFile(join(OUT_DIR, `${spec.id}.png`), cut.png);
  console.log(`  ✓ ${spec.id.padEnd(16)} ${cut.width}×${cut.height}`);
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const manifestOnly = args.includes('--manifest-only');
  const filters = args.filter((a) => !a.startsWith('--'));

  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(join(ROOT, 'src/generated'), { recursive: true });

  if (manifestOnly) {
    const entries = await writeManifest();
    console.log(`manifest rebuilt with ${entries.length} part(s)`);
    return;
  }

  const todo = filters.length
    ? PARTS.filter((p) => filters.some((f) => p.id.includes(f)))
    : PARTS;

  if (!todo.length) {
    console.error(`no parts matched ${filters.join(', ')}`);
    process.exit(1);
  }

  console.log(`drawing ${todo.length} part(s)…`);

  const failures: Array<{ id: string; error: string }> = [];

  for (const [index, spec] of todo.entries()) {
    try {
      await buildPart(spec, force);
    } catch (err) {
      const error = (err as Error).message;
      failures.push({ id: spec.id, error });
      console.error(`  ✗ ${spec.id.padEnd(16)} ${error}`);
    }
    // Rewritten every time so the preview and the game can be run mid-build.
    await writeManifest();
    if (index < todo.length - 1) await sleep(GAP_MS);
  }

  const entries = await writeManifest();
  console.log(`\n${entries.length} part(s) in manifest`);

  if (failures.length) {
    console.error(`\n${failures.length} failed:`);
    for (const f of failures) console.error(`  ${f.id}: ${f.error}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
