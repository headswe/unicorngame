/**
 * Enhörningsängen — entry point.
 *
 * Loads the sprites, builds the meadow, and runs the frame loop.
 */

import * as THREE from 'three';

import { AssetLibrary } from './engine/assets.ts';
import { Input } from './engine/input.ts';
import { Music } from './engine/music.ts';
import { Sfx } from './engine/sfx.ts';
import { MeadowCamera, projectY, type ViewportSize } from './engine/view.ts';
import { Hud } from './game/hud.ts';
import { SpellUi } from './game/spell-ui.ts';
import { Wardrobe } from './game/wardrobe.ts';
import { PlayerController, clamp } from './game/player.ts';
import { Unicorn } from './game/unicorn.ts';
import { makeRng } from './engine/rng.ts';
import {
  loadVariant,
  randomSeed,
  randomVariant,
  saveVariant,
  type UnicornVariant,
} from './game/variant.ts';
import { EAT_RADIUS } from './game/treats.ts';
import { World, WORLD_BOUNDS, SHOVEL_SPOT } from './game/world.ts';

/** How much sky is allowed above the far edge of the meadow. */
const SKY_HEADROOM = 5;
/** How much grass is allowed below the near edge. */
const SOUTH_MARGIN = 3;

/** Longest frame the simulation will accept, so a background tab cannot warp. */
const MAX_STEP = 1 / 20;

/** How close the player has to get to pick the shovel up off the grass. */
const SHOVEL_PICKUP = 1.6;

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
  controller.onStep = () => sfx.step();

  const camera = new MeadowCamera(9.5);
  const input = new Input(renderer.domElement);

  const music = new Music();
  // Effects follow the same on/off switch as the music.
  const sfx = new Sfx(() => music.enabled);

  /** Rebuilds the player's unicorn in place, keeping where it was standing. */
  const wearVariant = (next: UnicornVariant): void => {
    const replacement = new Unicorn(next, assets);
    replacement.x = player.x;
    replacement.y = player.y;
    replacement.facing = player.facing;

    player.dispose();
    world.scene.add(replacement.group);
    player = replacement;
    controller = new PlayerController(player, WORLD_BOUNDS);
    controller.onStep = () => sfx.step();
    player.update(0, false);
    hud.setName(next.name);
  };

  let openSpellbook = (): void => undefined;
  let openWardrobe = (): void => undefined;

  const hud = new Hud(container, {
    onToggleMusic: () => music.toggle(),
    onCastSpell: () => openSpellbook(),
    onOpenWardrobe: () => openWardrobe(),
  }, { hasMusic: music.available, musicOn: music.enabled });
  hud.setName(variant.name);

  // --- wardrobe -------------------------------------------------------------
  let worn = variant;

  const wardrobe = new Wardrobe(container, assets, variant, {
    // Every change is applied to the real unicorn straight away, so the preview
    // and the meadow can never disagree about what it looks like.
    onChange: (next) => {
      worn = next;
      wearVariant(next);
    },
    onClose: (next) => {
      worn = next;
      saveVariant(next);
    },
    onSound: (kind) => {
      if (kind === 'swap') sfx.pickup();
      else if (kind === 'done') sfx.sparkle();
      else sfx.magicOpen();
    },
  });
  openWardrobe = () => {
    controller.stop();
    wardrobe.show(worn);
  };

  // Browsers will not allow this before the player touches something; Music
  // handles the retry itself.
  void music.start();

  world.onPoop = () => sfx.plop();
  world.onEat = () => sfx.munch();
  world.treats.onLand = () => sfx.drop();

  // --- spellcasting ---------------------------------------------------------
  const spellRng = makeRng(randomSeed());

  const spellUi = new SpellUi(container, {
    onOpen: () => controller.stop(),
    onClose: () => undefined,
    onSound: (kind) => {
      if (kind === 'open') sfx.magicOpen();
      else if (kind === 'success') sfx.cast();
      else sfx.fizzle();
    },
    onCast: (spell) => {
      // The cast chord has already played; this is the spell's own voice.
      if (spell.sound === 'rain') sfx.rainSpell();
      else sfx.bloomSpell();

      if (spell.id === 'jordgubbsregn') {
        world.rainStrawberries(player.x, player.y, spellRng);
      } else if (spell.id === 'blomstercirkel') {
        world.bloomFlowers(player.x, player.y, spellRng);
      }
    },
  });
  openSpellbook = () => spellUi.show();

  // The player's own unicorn is a pony like any other. Rarer, so it reads as a
  // surprise rather than a nuisance while you are trying to tidy up.
  let playerPoopIn = 30 + Math.random() * 40;

  // --- caretaking ----------------------------------------------------------
  let hasShovel = false;
  let spaceHeld = false;

  const takeShovel = (): void => {
    hasShovel = true;
    world.takeShovel();
    sfx.pickup();
    hud.setCleaned(world.poop.cleaned);
    hud.setHint('Peka på bajset för att skotta upp det!');
  };

  const shovelPoop = (): boolean => {
    if (!hasShovel) return false;
    const target = world.poop.nearest(player.x, player.y);
    if (!target || !world.poop.clean(target)) return false;
    sfx.sparkle();
    hud.setCleaned(world.poop.cleaned);
    return true;
  };

  const caretaking = (dt: number): void => {
    // The player's unicorn grazes on strawberries by walking over them.
    const treat = world.treats.nearest(player.x, player.y, EAT_RADIUS);
    if (treat && world.treats.eat(treat)) {
      player.hop();
      sfx.munch();
    }

    playerPoopIn -= dt;
    if (playerPoopIn <= 0) {
      playerPoopIn = 30 + Math.random() * 40;
      if (!controller.moving && world.poop.spawn(player.x - player.facing * 0.55, player.y - 0.15)) {
        sfx.plop();
      }
    }

    // Walking up to the shovel is enough to pick it up — no button to find.
    if (!hasShovel && world.shovelOnGround) {
      if (Math.hypot(player.x - SHOVEL_SPOT.x, player.y - SHOVEL_SPOT.y) < SHOVEL_PICKUP) {
        takeShovel();
      } else if (world.poop.count > 0) {
        hud.setHint('Hitta spaden för att städa!');
      }
    }

    // Tapping a poop within reach shovels it, and that tap must not also be
    // read as "walk over there".
    if (hasShovel && input.pointer.pressed) {
      const at = camera.screenToWorld(input.pointer.x, input.pointer.y, viewport);
      const target = world.poop.findTarget(at.x, at.y, player.x, player.y);
      if (target && world.poop.clean(target)) {
        sfx.sparkle();
        hud.setCleaned(world.poop.cleaned);
        controller.suppressPointer();
      }
    }

    // The keyboard equivalent: stand next to one and press space.
    if (hasShovel && input.isDown('Space')) {
      if (!spaceHeld) shovelPoop();
      spaceHeld = true;
    } else {
      spaceHeld = false;
    }
  };

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
    Object.assign(window, { angen: { world, camera, assets, music, sfx, input, get player() { return player; } } });
  }

  loading?.classList.add('done');
  window.setTimeout(() => loading?.remove(), 600);

  let last = performance.now();
  const frame = (now: number): void => {
    const dt = Math.min((now - last) / 1000, MAX_STEP);
    last = now;

    input.beginFrame();

    wardrobe.tick();

    if (spellUi.open || wardrobe.open) {
      // The overlay swallows pointers, but not the keyboard, so the unicorn is
      // held still explicitly while a sigil is being drawn.
      player.update(dt, false);
    } else {
      caretaking(dt);
      controller.update(dt, input, camera, viewport);
    }
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
