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
import { Spelling } from './game/spelling.ts';
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
import { meadowDay, meadowSeed } from './game/day.ts';
import { EAT_RADIUS } from './game/treats.ts';
import { Marker, MINE } from './game/marker.ts';
import { Visitors } from './game/visitors.ts';
import { World, WORLD_BOUNDS, SHOVEL_SPOT, TABLE_SPOT } from './game/world.ts';
import { Session } from './net/session.ts';
import { LoopbackTransport, SocketTransport, type Transport } from './net/transport.ts';

/** How much sky is allowed above the far edge of the meadow. */
const SKY_HEADROOM = 5;
/** How much grass is allowed below the near edge. */
const SOUTH_MARGIN = 3;

/** Longest frame the simulation will accept, so a background tab cannot warp. */
const MAX_STEP = 1 / 20;

/** How close the player has to get to pick the shovel up off the grass. */
const SHOVEL_PICKUP = 1.6;

/** How close to the letter table you have to stand for the game to open. */
const TABLE_REACH = 2.2;
/**
 * And how far you have to walk off again before it will open a second time —
 * otherwise closing the game while still standing at the table reopens it.
 */
const TABLE_LEAVE = 3.6;
/** How near the table has to be before the hint points it out. */
const TABLE_NOTICE = 9;

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
  // A new field every morning: new scenery, new hills, a new herd. The foals
  // the children have hatched are the one thing that carries over.
  const world = new World(assets, player, meadowSeed());
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
  let openSpelling = (): void => undefined;

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
      // Everyone else should see the new colours straight away, not next time
      // this player reloads.
      session.announce();
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
  world.eggs.onCrack = () => sfx.crack();
  world.onHatch = (egg, born, x, y) => {
    sfx.hatch();
    hud.announce(`${born.name} kläcktes! Säg hej.`);
    // Everyone watching reports it; the relay keeps the first and files the
    // foal away so it is still here tomorrow.
    session.broadcastHatched(egg, born, x, y);
  };

  // --- spellcasting ---------------------------------------------------------

  /**
   * Performs a spell. Driven both by this player casting one and by the network
   * reporting that someone else did, which is why every random choice comes out
   * of `seed` rather than out of `Math.random` — cast with the same seed on two
   * machines, and the strawberries land in the same places on both screens.
   */
  const applySpell = (
    id: string,
    x: number,
    y: number,
    seed: string,
    /** Unix seconds the spell was cast — shared, so berries fall in step. */
    at: number,
    foal?: UnicornVariant,
    mine = false,
    /** Seconds since it was cast, when catching up on a meadow already in progress. */
    elapsed = 0,
  ): void => {
    const rng = makeRng(seed);
    // A spell being caught up on happened while nobody was here. Replaying its
    // sound would mean walking in to a fanfare for something already over.
    const audible = elapsed < 2;

    if (id === 'jordgubbsregn') {
      if (audible) sfx.rainSpell();
      world.rainStrawberries(x, y, rng, seed, at);
    } else if (id === 'blomstercirkel') {
      if (audible) sfx.bloomSpell();
      world.bloomFlowers(x, y, rng);
    } else if (id === 'trollagg' && foal) {
      if (audible) sfx.eggSpell();
      // Only the child who cast it is told to go and wait; announcing a friend's
      // egg across the meadow would just be noise.
      if (world.layEgg(seed, x, y, rng, foal, elapsed) && mine) {
        hud.announce('Ett ägg! Vänta hos det tills det kläcks.', 8);
      }
    }
  };

  const spellUi = new SpellUi(container, {
    onOpen: () => controller.stop(),
    onClose: () => undefined,
    onSound: (kind) => {
      if (kind === 'open') sfx.magicOpen();
      else if (kind === 'success') sfx.cast();
      else sfx.fizzle();
    },
    onCast: (spell) => {
      // Everything the spell needs to be reproduced elsewhere is settled here,
      // then performed locally and sent — never rolled twice.
      const seed = randomSeed();
      const at = Date.now() / 1000;
      const foal = spell.id === 'trollagg' ? world.rollFoal() : undefined;
      applySpell(spell.id, player.x, player.y, seed, at, foal, true);
      session.broadcastSpell(spell.id, player.x, player.y, seed, at, foal);
    },
  });
  openSpellbook = () => spellUi.show();

  // --- the shared meadow ----------------------------------------------------
  // Everyone generates the same field from the same seed, so the only things
  // worth sending are the children themselves and the spells they cast.
  // Eighteen residents wander this field and one of them may well be wearing a
  // coat like yours, so the child's own unicorn is marked. It follows whatever
  // `player` currently is, which means going through the wardrobe cannot lose it.
  const myMarker = new Marker(assets, MINE, false);
  world.scene.add(myMarker.group);

  const visitors = new Visitors(assets);
  world.scene.add(visitors.group);
  // Joining a busy meadow introduces everyone at once, and three fanfares in
  // half a second is noise rather than welcome. Arrivals are only announced once
  // the introductions have settled.
  let settledAt = Infinity;

  visitors.onCount = (count) => hud.setFriends(count);
  visitors.onArrive = (who) => {
    if (performance.now() < settledAt) return;
    sfx.sparkle();
    hud.announce(`${who.name} kom på besök!`);
  };

  const relay = import.meta.env.VITE_ANGEN_RELAY as string | undefined;
  // With no relay configured the game still plays with itself: a BroadcastChannel
  // joins up two tabs on the same machine. That is how this was built and
  // tested, and it means the code path is never cold.
  const transport: Transport = relay
    ? new SocketTransport(relay)
    : new LoopbackTransport();

  const session = new Session(
    transport,
    visitors,
    {
      pose: () => ({
        x: player.x,
        y: player.y,
        f: player.facing,
        m: controller.moving,
      }),
      variant: () => worn,
      cleaned: () => world.poop.shovelled,
    },
    {
      onSpell: (id, x, y, seed, at, foal) => applySpell(id, x, y, seed, at, foal),
      onPoop: (poop, x, y) => {
        if (world.poop.spawn(poop, x, y)) sfx.plop();
      },
      onEaten: (berry) => {
        if (world.treats.eatById(berry)) sfx.munch();
      },
      onClean: (poop) => {
        if (world.poop.cleanById(poop)) sfx.sparkle();
      },
      // A friend's record of the tidying, adopted so today's presents are not
      // all put back the moment a latecomer works out that they happened.
      onCleanedList: (poops) => world.poop.forget(poops),
      // The meadow as the relay remembers it: the tidying already done, the
      // eggs still waiting, and the foals from earlier days. Everything else —
      // the field, the herd, the residents' droppings — regenerates from the
      // clock and needs nothing here.
      onState: (state) => {
        // Both sides run the same rule, so this should never differ outside a
        // clock being badly wrong. Worth saying out loud if it ever does.
        if (state.day !== meadowDay()) {
          console.warn(`meadow day mismatch: relay says ${state.day}, this browser says ${meadowDay()}`);
        }
        world.poop.forget(state.cleaned);
        for (const p of state.poops) world.poop.spawn(p.id, p.x, p.y);

        const now = Date.now() / 1000;
        for (const egg of state.eggs) {
          applySpell('trollagg', egg.x, egg.y, egg.seed, egg.since, egg.foal, false, now - egg.since);
        }
        for (const born of state.foals) world.settle(born.foal, born.x, born.y);
      },
      onStatus: (status) => {
        if (status === 'online') {
          settledAt = performance.now() + 3000;
        } else {
          settledAt = Infinity;
          hud.setFriends(0);
        }
      },
    },
  );
  session.start();

  // --- spelling game --------------------------------------------------------
  const spelling = new Spelling(container, assets, {
    onClose: () => undefined,
    onSound: (kind) => {
      if (kind === 'open') sfx.magicOpen();
      else if (kind === 'pick') sfx.pickup();
      else if (kind === 'place') sfx.drop();
      else if (kind === 'right') sfx.cast();
      else sfx.fizzle();
    },
  });
  openSpelling = () => {
    controller.stop();
    spelling.show();
  };

  // The player's own unicorn is a pony like any other. Rarer, so it reads as a
  // surprise rather than a nuisance while you are trying to tidy up.
  let playerPoopIn = 30 + Math.random() * 40;

  // --- the letter table ------------------------------------------------------
  // The spelling game has no button: you have to walk to the little table with
  // the alphabet blocks on it, out in the meadow.
  let atTable = false;
  let nearTable = false;
  /** Whether the line currently on the HUD is the table's to take back. */
  let tableHint = false;

  const setTableHint = (text: string | null): void => {
    if (text === null && !tableHint) return;
    tableHint = text !== null;
    hud.setHint(text);
  };

  const letterTable = (): void => {
    if (!world.hasLetterTable) return;
    const away = Math.hypot(player.x - TABLE_SPOT.x, player.y - TABLE_SPOT.y);
    nearTable = away < TABLE_NOTICE;

    // Once you are standing at the table it will not grab you again until you
    // have properly walked off, so closing the game does not reopen it.
    if (atTable && away > TABLE_LEAVE) atTable = false;

    if (!atTable && away < TABLE_REACH) {
      atTable = true;
      setTableHint('Gå bort och tillbaka för ett nytt ord!');
      openSpelling();
      return;
    }

    if (!nearTable) setTableHint(null);
    else if (!atTable) setTableHint('Bokstavsbordet! Gå fram och stava.');
  };

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

  /** Shovels a poop and tells everyone, so it goes on both screens. */
  const shovel = (target: { id: string } | null): boolean => {
    if (!target || !world.poop.cleanById(target.id)) return false;
    sfx.sparkle();
    hud.setCleaned(world.poop.cleaned);
    session.broadcastClean(target.id);
    return true;
  };

  const shovelPoop = (): boolean => {
    if (!hasShovel) return false;
    return shovel(world.poop.nearest(player.x, player.y));
  };

  const caretaking = (dt: number): void => {
    letterTable();

    // The player's unicorn grazes on strawberries by walking over them.
    // Where a child walks is the one thing the clock cannot predict, so a berry
    // they eat has to be named and sent — otherwise a friend's residents would
    // go on chasing a strawberry that is not there any more, and the herds would
    // part company.
    const treat = world.treats.nearest(player.x, player.y, EAT_RADIUS);
    if (treat?.landed && world.treats.eat(treat)) {
      player.hop();
      sfx.munch();
      session.broadcastEaten(treat.id);
    }

    playerPoopIn -= dt;
    if (playerPoopIn <= 0) {
      playerPoopIn = 30 + Math.random() * 40;
      // The residents' presents are worked out from the clock on every machine.
      // This one cannot be — it depends on where the child happens to be
      // standing — so it is named after them and sent.
      const id = `${session.id}:${Math.round(Date.now() / 1000)}`;
      const x = player.x - player.facing * 0.55;
      const y = player.y - 0.15;
      if (!controller.moving && world.poop.spawn(id, x, y)) {
        sfx.plop();
        session.broadcastPoop(id, x, y);
      }
    }

    // Walking up to the shovel is enough to pick it up — no button to find.
    if (!hasShovel && world.shovelOnGround) {
      if (Math.hypot(player.x - SHOVEL_SPOT.x, player.y - SHOVEL_SPOT.y) < SHOVEL_PICKUP) {
        takeShovel();
      } else if (world.poop.count > 0 && !nearTable) {
        hud.setHint('Hitta spaden för att städa!');
      }
    }

    // Tapping a poop within reach shovels it, and that tap must not also be
    // read as "walk over there".
    if (hasShovel && input.pointer.pressed) {
      const at = camera.screenToWorld(input.pointer.x, input.pointer.y, viewport);
      if (shovel(world.poop.findTarget(at.x, at.y, player.x, player.y))) {
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
    Object.assign(window, {
      angen: {
        world, camera, assets, music, sfx, input, spelling, wardrobe,
        session, visitors,
        get player() { return player; },
      },
    });
  }

  loading?.classList.add('done');
  window.setTimeout(() => loading?.remove(), 600);

  let last = performance.now();
  const frame = (now: number): void => {
    const dt = Math.min((now - last) / 1000, MAX_STEP);
    last = now;

    input.beginFrame();

    wardrobe.tick();

    if (spellUi.open || wardrobe.open || spelling.open) {
      // The overlay swallows pointers, but not the keyboard, so the unicorn is
      // held still explicitly while a sigil is being drawn.
      player.update(dt, false);
    } else {
      caretaking(dt);
      controller.update(dt, input, camera, viewport);
    }
    world.update(dt);
    myMarker.follow(player, dt);
    session.update(dt);
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
