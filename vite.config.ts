import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, type Plugin } from 'vite';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const MUSIC_DIR = join(ROOT, 'public/assets/music');
const AUDIO = /\.(mp3|ogg|m4a|wav)$/i;

const VIRTUAL_ID = 'virtual:music';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

/**
 * Lists whatever audio sits in public/assets/music/.
 *
 * Music lives beside the sprites in public/ rather than in src/, so Vite never
 * sees it as an import and cannot glob it. This hands the game the filenames
 * instead, which keeps "drop a file in the folder" working with no manifest to
 * regenerate and no filename hard-coded in the source.
 */
function musicManifest(): Plugin {
  return {
    name: 'unicorn-music-manifest',
    resolveId: (id) => (id === VIRTUAL_ID ? RESOLVED_ID : undefined),
    load(id) {
      if (id !== RESOLVED_ID) return undefined;
      const files = existsSync(MUSIC_DIR)
        ? readdirSync(MUSIC_DIR)
            .filter((f) => AUDIO.test(f))
            .sort()
        : [];
      return `export default ${JSON.stringify(files.map((f) => `assets/music/${f}`))};`;
    },
    configureServer(server) {
      // Adding or removing a track during development takes effect on reload
      // rather than needing the dev server restarted.
      server.watcher.add(MUSIC_DIR);
      server.watcher.on('all', (_event, path) => {
        if (!path.startsWith(MUSIC_DIR)) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [musicManifest()],
  server: { host: true, port: 5173 },
  build: { target: 'es2022', outDir: 'dist' },
});
