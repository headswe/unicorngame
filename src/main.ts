/**
 * Enhörningsängen — entry point.
 *
 * Loads the sprites, builds the meadow, and runs the frame loop.
 */

import * as THREE from 'three';

import { AssetLibrary } from './engine/assets.ts';
import { Input } from './engine/input.ts';
import { MeadowCamera, projectY, type ViewportSize } from './engine/view.ts';
import { Hud } from './game/hud.ts';
import { PlayerController, clamp } from './game/player.ts';
import { Unicorn } from './game/unicorn.ts';
import { loadVariant, randomSeed, randomVariant, saveVariant } from './game/variant.ts';
import { World, WORLD_BOUNDS } from './game/world.ts';

/** How much sky is allowed above the far edge of the meadow. */
const SKY_HEADROOM = 5;
/** How much grass is allowed below the near edge. */
const SOUTH_MARGIN = 3;

/** Longest frame the simulation will accept, so a background tab cannot warp. */
const MAX_STEP = 1 / 20;

/**
 * The whole renderer works in sRGB byte space, so three must not helpfully
 * convert colours to linear behind our backs — a Color built from 0x8fc2a1 has
 * to stay exactly that colour when the shader multiplies with it.
 */
THREE.ColorManagement.enabled = false;

async function start(): Promise<void> {
  const container = document.getElementById('app');
  const loading = document.getElementById('loading');
  const loadingBar = document.getElementById('loading-bar');
  if (!container) throw new Error('#app is missing from the page');

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: 'low-power',
  });
  // Everything is authored in sRGB and composited flat — see sprite-material.
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(0xbfe3f2, 1);
  container.appendChild(renderer.domElement);

  const assets = new AssetLibrary();
  await assets.loadAll(document.baseURI, (done, total) => {
    if (loadingBar) loadingBar.style.width = `${Math.round((done / total) * 100)}%`;
  });

  if (!assets.ofKind('body').length) {
    if (loading) {
      loading.innerHTML =
        '<p>Inga bilder hittades.<br><small>Kör <code>npm run gen:assets</code> först.</small></p>';
    }
    return;
  }

  // The player's unicorn is remembered between visits.
  const variant = loadVariant() ?? randomVariant(assets, randomSeed());
  saveVariant(variant);

  let player = new Unicorn(variant, assets);
  const world = new World(assets, player);
  let controller = new PlayerController(player, WORLD_BOUNDS);

  const camera = new MeadowCamera(9.5);
  const input = new Input(renderer.domElement);

  const hud = new Hud(container, {
    onReroll: () => {
      const next = randomVariant(assets, randomSeed());
      saveVariant(next);

      const replacement = new Unicorn(next, assets);
      // Step straight into the old unicorn's hoofprints.
      replacement.x = player.x;
      replacement.y = player.y;
      replacement.facing = player.facing;

      player.dispose();
      world.scene.add(replacement.group);
      player = replacement;
      controller = new PlayerController(player, WORLD_BOUNDS);
      player.update(0, false);
      hud.setName(next.name);
    },
  });
  hud.setName(variant.name);

  const viewport: ViewportSize = { width: 0, height: 0 };

  const resize = (): void => {
    viewport.width = container.clientWidth;
    viewport.height = container.clientHeight;
    // Cap the pixel ratio: a 3× phone screen gains nothing here and costs a lot.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(viewport.width, viewport.height, false);
    camera.resize(viewport);
  };
  resize();
  window.addEventListener('resize', resize);

  /** Keeps the view inside the meadow, leaving a strip of sky at the north edge. */
  const followPlayer = (dt: number, snap: boolean): void => {
    const { halfWidth, halfHeight } = camera.extents(viewport);
    const worldHalfWidth = (WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX) / 2 + 4;

    let targetX = player.x;
    if (halfWidth >= worldHalfWidth) targetX = 0;
    else targetX = clamp(targetX, -worldHalfWidth + halfWidth, worldHalfWidth - halfWidth);

    const lowest = projectY(WORLD_BOUNDS.minY - SOUTH_MARGIN) + halfHeight;
    const highest = projectY(WORLD_BOUNDS.maxY) + SKY_HEADROOM - halfHeight;
    // Look slightly ahead of the unicorn's feet so it does not sit on the floor
    // of the screen.
    let targetY = projectY(player.y) + 0.8;
    targetY = highest > lowest ? clamp(targetY, lowest, highest) : (lowest + highest) / 2;

    if (snap) {
      camera.lookAtScreenPoint(targetX, targetY);
      return;
    }
    const ease = 1 - Math.exp(-dt * 6);
    camera.lookAtScreenPoint(
      camera.camera.position.x + (targetX - camera.camera.position.x) * ease,
      camera.camera.position.y + (targetY - camera.camera.position.y) * ease,
    );
  };

  player.update(0, false);
  followPlayer(0, true);

  if (import.meta.env.DEV) {
    // Handy for poking at the meadow from the console while tuning.
    Object.assign(window, { angen: { world, camera, assets, get player() { return player; } } });
  }

  loading?.classList.add('done');
  window.setTimeout(() => loading?.remove(), 600);

  let last = performance.now();
  const frame = (now: number): void => {
    const dt = Math.min((now - last) / 1000, MAX_STEP);
    last = now;

    input.beginFrame();
    controller.update(dt, input, camera, viewport);
    world.update(dt);
    followPlayer(dt, false);
    world.backdrop.update(dt, camera.camera, camera.extents(viewport));

    renderer.render(world.scene, camera.camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

start().catch((err) => {
  console.error(err);
  const loading = document.getElementById('loading');
  if (loading) loading.innerHTML = `<p>Oj då!<br><small>${String(err)}</small></p>`;
});
