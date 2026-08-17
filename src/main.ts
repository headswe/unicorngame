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
import { Board } from './game/board.ts';
import { BoardUi } from './game/board-ui.ts';
import {
  World,
  WORLD_BOUNDS,
  EASEL_SPOT,
  GATE_SPOT,
  PORTAL_SPOT,
  SHOVEL_SPOT,
  TABLE_SPOT,
} from './game/world.ts';
import { BounceYard } from './game/yard.ts';
import { RaceTrack, TRACK_PORTAL, TRACK_VIEW_HEIGHT } from './game/racetrack.ts';
import { CENTRE, LAPS, gridSlot, locate } from '../server/track.js';
import { Herd, HERD_HZ, RESIDENTS, WORLD_BOUNDS as SIM_BOUNDS } from '../server/herd.js';
import type { Place, RaceMessage } from './net/protocol.ts';
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

/** How close you have to stand to pat a pony. Matches NOTICE in the herd. */
const PET_REACH = 3.4;

/** How close to the letter table you have to stand for the game to open. */
const TABLE_REACH = 2.2;
/**
 * And how far you have to walk off again before it will open a second time —
 * otherwise closing the game while still standing at the table reopens it.
 */
const TABLE_LEAVE = 3.6;
/** How near the table has to be before the hint points it out. */
const TABLE_NOTICE = 9;

/** How close to the easel you have to stand to start drawing, and to leave. */
const EASEL_REACH = 2.4;
const EASEL_LEAVE = 4;

/** How close to the portal you have to stand to be taken to the track. */
const PORTAL_REACH = 2.4;
const PORTAL_LEAVE = 4.5;

/** How close to the gate you have to stand to go through to the yard. */
const GATE_REACH = 2.2;
/** And how far back out you have to walk before it will take you again. */
const GATE_LEAVE = 4;

/**
 * How far to the side of the pony a finger has to land to count as a direction.
 *
 * Not zero: a touch landing right on the pony would otherwise flick between
 * left and right as the pony moved under the finger.
 */
const YARD_TOUCH_DEADZONE = 0.6;

/**
 * How much of the bouncing yard is on screen at once.
 *
 * Sized to the biggest bounce: the mat, plus the ceiling above it, plus a whole
 * unicorn, plus a little sky, all have to fit above the floor — and nothing
 * more, or the ponies come out tiny and the yard reads as empty air. Getting
 * this right is what keeps the view still: the camera can rise if a bounce
 * would go off the top, and a view that slides under a bouncing child is
 * seasick, so the point is that it never has to.
 */
const YARD_VIEW_HEIGHT = 10.7;

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
    player = replacement;
    controller = new PlayerController(player, WORLD_BOUNDS);
    controller.onStep = () => sfx.step();
    // Changing clothes over the fence puts the new pony back in the yard, not
    // in the meadow it cannot currently see.
    if (place === 'bana') {
      // Changing clothes on the track repaints the kart, since it is painted in
      // this unicorn's colours; the meadow pony stays out of the scene.
      onGrid = -1;
    } else if (place === 'studs') {
      const wasX = replacement.x;
      yard.enter(replacement);
      replacement.x = wasX;
    } else {
      world.scene.add(replacement.group);
    }
    player.update(0, false);
    hud.setName(next.name);
  };

  const yard = new BounceYard(assets);
  const yardCamera = new MeadowCamera(YARD_VIEW_HEIGHT);
  const track = new RaceTrack(assets);
  const trackCamera = new MeadowCamera(TRACK_VIEW_HEIGHT);
  /** The last word from the referee, or nothing if we have never heard from it. */
  let race: RaceMessage | null = null;
  /** Which grid slot we were last put on, so we only line up when it changes. */
  let onGrid = -1;
  /**
   * The phase we last acted on.
   *
   * A child who keeps the same grid slot from one race to the next would
   * otherwise never be put back on the line, and would start the second race
   * from wherever they happened to finish the first.
   */
  let racePhase = '';

  /**
   * Which side of the gate this child is on.
   *
   * Declared up here rather than beside the rest of the gate because the pose
   * the network asks for names the place, and it is asked for the instant the
   * session connects — which happens before anything below this line exists.
   */
  let place: Place = 'angen';
  /** True while standing in a gateway, so it does not grab you twice. */
  let inGateway = false;
  /**
   * Which way a held finger is asking the pony to go in the yard.
   *
   * Latched rather than read fresh every frame. A touch steers the pony toward
   * itself, so once the pony has passed under the finger a fresh reading would
   * reverse — which on the ground is fine and in mid-air would turn a
   * somersault back on itself halfway round. So it is re-read while the hooves
   * are down and held for the whole of a jump.
   */
  let yardTouch = 0;

  /**
   * The shared drawing. One object: the overlay draws on it, the easel out in
   * the meadow is textured from it, and the network fills it in from everyone
   * else — so the board in the field and the board under a child's finger are
   * literally the same picture.
   */
  const board = new Board();
  // Hangs it on the easel out in the meadow as well, so a drawing is something
  // you can see from across the field rather than only once you are at it.
  world.showBoard(board);

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
    // With no relay there is nobody to put the foal in the herd and send it
    // back, so this browser — which is simulating the herd itself — does it.
    if (localHerd) {
      localHerd.add(born.seed, x, y);
      world.herd.setRoster(localHerd.roster());
    }
  };

  // --- spellcasting ---------------------------------------------------------

  /**
   * Flowers this child grew, so only they are told what came out of one. A
   * friend's twins are their news to be excited about, not a line on your HUD.
   */
  const myFlowers = new Set<string>();

  world.onBloom = (seed, eggs) => {
    if (!myFlowers.has(seed)) return;
    myFlowers.delete(seed);
    if (eggs >= 3) hud.announce('Trillingar! Tre ägg i blomman.', 8);
    else if (eggs === 2) hud.announce('Tvillingar! Två ägg i blomman.', 8);
    else hud.announce('Ett ägg! Vänta hos det tills det kläcks.', 8);
  };

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
      // Only the child who cast it is told what is happening; narrating a
      // friend's flower across the meadow would just be noise.
      if (mine) myFlowers.add(seed);
      if (world.layClutch(seed, x, y, rng, foal, elapsed) && mine && audible) {
        hud.announce('En magisk blomma växer! Vänta hos den.', 6);
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

  // --- simulating the herd when nobody else will ----------------------------
  //
  // "Is anyone simulating?" is not the same question as "is the socket up". A
  // BroadcastChannel between two tabs reports itself online quite happily and
  // has no server behind it at all, so asking the transport would leave the
  // meadow standing perfectly still. The honest test is whether snapshots are
  // actually arriving.
  let localHerd: Herd | null = null;
  let herdDue = 0;
  let lastSnapshot = 0;

  /** No word from a simulation for this long and this browser takes over. */
  const TAKE_OVER_AFTER = 2000;

  const startLocalHerd = (): void => {
    if (localHerd) return;
    localHerd = new Herd({ seed: meadowSeed(), count: RESIDENTS, bounds: SIM_BOUNDS });
    world.herd.setRoster(localHerd.roster());
  };

  /** Runs the herd here, at the same rate the relay would send it. */
  const tickLocalHerd = (dt: number): void => {
    if (performance.now() - lastSnapshot < TAKE_OVER_AFTER) return;
    startLocalHerd();
    if (!localHerd) return;
    herdDue -= dt;
    if (herdDue > 0) return;

    const step = 1 / HERD_HZ;
    herdDue = step;
    const { poops, eaten, cheers } = localHerd.tick(step, Date.now() / 1000, world.treats.forHerd(), [
      { id: session.id, x: player.x, y: player.y },
    ]);
    world.herd.apply(localHerd.snapshot());
    for (const poop of poops) {
      if (world.poop.spawn(poop.id, poop.x, poop.y)) sfx.plop();
    }
    for (const berry of eaten) {
      if (world.treats.eatById(berry)) sfx.munch();
    }
    for (const pony of cheers) world.herd.cheer(pony);
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
      // In the yard y means height rather than depth and the pony can be upside
      // down, so a pose has to say which place it belongs to — the same two
      // numbers mean different things on the two sides of the gate.
      pose: () => {
        if (place === 'bana') {
          // A kart's x and y are its own, and `r` is which way it points; the
          // referee works out the laps from that and nothing else is needed.
          const kart = track.kart;
          const x = kart?.x ?? 0;
          const y = kart?.y ?? 0;
          return { x, y, f: 1, m: false, p: place, r: kart?.heading ?? 0 };
        }
        if (place === 'studs') {
          return {
            x: player.x, y: player.y, f: player.facing, m: yard.running, p: place, r: player.spin,
          };
        }
        return { x: player.x, y: player.y, f: player.facing, m: controller.moving };
      },
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
      onRace: (update) => {
        // A new race and this child is in it: a fanfare on the line, once.
        if (race?.phase !== update.phase && update.phase === 'countdown') sfx.magicOpen();
        race = update;
      },
      onInk: (stroke, by, colour, nib, xy) => board.ink(stroke, by, colour, nib, xy),
      onRub: (strokes) => board.remove(strokes),
      // The meadow as the relay remembers it: the tidying already done, the
      // eggs still waiting, and the foals from earlier days. Everything else —
      // the field, the herd, the residents' droppings — regenerates from the
      // clock and needs nothing here.
      onRoster: (seeds) => {
        // Somebody out there is simulating, so stop doing it here.
        localHerd = null;
        world.herd.setRoster(seeds);
      },
      onHerd: (poses) => {
        lastSnapshot = performance.now();
        world.herd.apply(poses);
      },
      onCheer: (ponies) => {
        for (const i of ponies) world.herd.cheer(i);
        sfx.pickup();
      },
      onState: (state) => {
        // Both sides run the same rule, so this should never differ outside a
        // clock being badly wrong. Worth saying out loud if it ever does.
        if (state.day !== meadowDay()) {
          console.warn(`meadow day mismatch: relay says ${state.day}, this browser says ${meadowDay()}`);
        }
        world.poop.forget(state.cleaned);
        for (const p of state.poops) world.poop.spawn(p.id, p.x, p.y);
        // The board as the relay remembers it, so a child who comes in after
        // school finds this morning's drawing rather than a blank easel.
        board.load(state.strokes ?? []);

        const now = Date.now() / 1000;
        for (const egg of state.eggs) {
          applySpell('trollagg', egg.x, egg.y, egg.seed, egg.since, egg.foal, false, now - egg.since);
        }
        // Foals are not placed here: they are already in the herd the relay
        // sends, which is the one place that decides who is in this field.
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
  // Start out simulating for ourselves. The first snapshot from a relay hands
  // the job over; if none ever comes, this browser simply keeps it.
  startLocalHerd();

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

  // --- the drawing board -----------------------------------------------------

  const boardUi = new BoardUi(container, board, session.id, {
    onInk: (stroke, colour, nib, xy) => session.broadcastInk(stroke, colour, nib, xy),
    onRub: (strokes) => {
      // Applied here as well as sent, so a rubbed line goes at once rather than
      // after a round trip — and so it still works with nobody else about.
      board.remove(strokes);
      session.broadcastRub(strokes);
    },
    onClose: () => {
      atEasel = true;
      controller.stop();
    },
    onSound: (kind) => {
      if (kind === 'open') sfx.magicOpen();
      else if (kind === 'undo') sfx.pickup();
      else sfx.sparkle();
    },
  });
  /** True while standing at the easel, so closing it does not reopen it. */
  let atEasel = false;

  const easel = (): void => {
    if (!world.hasEasel || boardUi.open) return;
    const away = Math.hypot(player.x - EASEL_SPOT.x, player.y - EASEL_SPOT.y);
    if (atEasel && away > EASEL_LEAVE) atEasel = false;

    if (!atEasel && away < EASEL_REACH) {
      atEasel = true;
      controller.stop();
      boardUi.show();
      return;
    }
    if (!atEasel && away < TABLE_NOTICE && !nearTable) {
      setLandmarkHint('Ritbrädan! Gå fram och rita.');
    }
  };

  // --- the letter table ------------------------------------------------------
  // The spelling game has no button: you have to walk to the little table with
  // the alphabet blocks on it, out in the meadow.
  let atTable = false;
  let nearTable = false;
  /**
   * Whether the line currently on the HUD belongs to a landmark.
   *
   * Both the letter table and the gate point themselves out this way, and only
   * whoever put a line up is allowed to take it down — otherwise walking past
   * one of them wipes out whatever the other had just said.
   */
  let landmarkHint = false;

  const setLandmarkHint = (text: string | null): void => {
    if (text === null && !landmarkHint) return;
    landmarkHint = text !== null;
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
      setLandmarkHint('Gå bort och tillbaka för ett nytt ord!');
      openSpelling();
      return;
    }

    if (!nearTable) setLandmarkHint(null);
    else if (!atTable) setLandmarkHint('Bokstavsbordet! Gå fram och stava.');
  };

  /**
   * Pats a pony. Online the simulation decides whether it counted and tells
   * everyone; alone, this browser is the simulation, so it decides here.
   */
  const petLocally = (pony: number): void => {
    if (localHerd) {
      if (localHerd.pet(pony, { id: session.id, x: player.x, y: player.y }, Date.now() / 1000)) {
        world.herd.cheer(pony);
        sfx.pickup();
      }
      return;
    }
    session.pet(pony);
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

    // A tap can mean three things, and they are tried in the order a child
    // would expect: shovel what is under your nose, otherwise pat the pony you
    // are standing next to, otherwise walk there.
    if (input.pointer.pressed) {
      const at = camera.screenToWorld(input.pointer.x, input.pointer.y, viewport);

      if (hasShovel && shovel(world.poop.findTarget(at.x, at.y, player.x, player.y))) {
        controller.suppressPointer();
      } else {
        const pony = world.herd.findPettable(at.x, at.y, player.x, player.y, PET_REACH);
        if (pony >= 0) {
          petLocally(pony);
          controller.suppressPointer();
        }
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

  // --- through the gate -----------------------------------------------------

  const enterYard = (): void => {
    if (place === 'studs' || !yard.available) return;
    place = 'studs';
    inGateway = true;
    controller.stop();
    setLandmarkHint(null);
    // The ponies come too: one registry, one set of unicorns, drawn into
    // whichever scene the child is currently standing in.
    yard.scene.add(visitors.group);
    yard.enter(player);
    visitors.watch('studs');
    myMarker.group.removeFromParent();
    yard.scene.add(myMarker.group);
    sfx.magicOpen();
    hud.setRestingHint('Peka bredvid din enhörning för att gå');
    hud.announce('Studsa! Håll kvar fingret i luften så slår du en volt.', 9);
  };

  const leaveYard = (): void => {
    if (place !== 'studs') return;
    place = 'angen';
    inGateway = true;
    const pony = yard.leave();
    if (pony) {
      // Set down clear of the gate rather than back in the exact spot they left
      // from — which is always the gateway itself, and would mean having to
      // walk away and back before they could go in again.
      pony.x = GATE_SPOT.x;
      pony.y = Math.max(WORLD_BOUNDS.minY, GATE_SPOT.y - GATE_LEAVE - 0.5);
      world.scene.add(pony.group);
    }
    world.scene.add(visitors.group);
    visitors.watch('angen');
    myMarker.group.removeFromParent();
    world.scene.add(myMarker.group);
    yardTouch = 0;
    hud.setRestingHint('Gå med pilarna · eller peka där du vill gå');
    sfx.magicOpen();
    followPlayer(0, true);
  };

  yard.events.onBounce = (strength) => sfx.bounce(strength);
  yard.events.onFlips = (turned, total) => {
    sfx.sparkle();
    const what = turned === 1 ? 'En volt!' : `${turned} voltar!`;
    hud.announce(`${what} Du har slagit ${total} idag.`, 3);
  };

  const enterTrack = (): void => {
    if (place === 'bana' || !track.available) return;
    place = 'bana';
    inGateway = true;
    controller.stop();
    setLandmarkHint(null);
    // The pony steps out of the meadow and into a kart; nothing of the meadow
    // comes with it, because from up here a pony in profile is lying down.
    player.group.removeFromParent();
    visitors.watch('bana');
    myMarker.group.removeFromParent();
    onGrid = -1;
    sfx.magicOpen();
    hud.setRestingHint('Peka åt sidan för att svänga');
  };

  const leaveTrack = (): void => {
    if (place !== 'bana') return;
    place = 'angen';
    inGateway = true;
    track.clear();
    onGrid = -1;
    player.x = PORTAL_SPOT.x;
    player.y = Math.max(WORLD_BOUNDS.minY, PORTAL_SPOT.y - PORTAL_LEAVE - 0.5);
    world.scene.add(player.group);
    world.scene.add(visitors.group);
    visitors.watch('angen');
    world.scene.add(myMarker.group);
    hud.setRestingHint('Gå med pilarna · eller peka där du vill gå');
    sfx.magicOpen();
    followPlayer(0, true);
  };

  /**
   * Says what the racing dimension is doing, and puts this child on the grid.
   *
   * The referee decides both. A child who was not on the track when the grid
   * was frozen has no slot and no kart: they watch this race and are in the
   * next one, which is what makes walking in on a race worth doing.
   */
  const raceHint = (): void => {
    if (place !== 'bana') return;
    if (!race) {
      setLandmarkHint('Väntar på tävlingen…');
      return;
    }
    const left = Math.max(0, Math.ceil(race.until - Date.now() / 1000));
    const slot = race.grid[session.id];
    const racing = slot !== undefined;

    const fresh = race.phase === 'countdown' && racePhase !== 'countdown';
    racePhase = race.phase;
    if (racing && (slot !== onGrid || fresh)) {
      onGrid = slot;
      track.lineUp(worn, gridSlot(slot));
    }
    if (!racing && onGrid !== -1) {
      onGrid = -1;
      track.clear();
    }

    if (race.phase === 'waiting') {
      setLandmarkHint(racing ? `Starten går om ${left}…` : 'Du är med i nästa lopp.');
    } else if (race.phase === 'countdown') {
      setLandmarkHint(left <= 0 ? 'Kör!' : `${left}…`);
    } else if (race.phase === 'racing') {
      if (!racing) {
        setLandmarkHint('Du tittar på. Du är med i nästa lopp!');
      } else {
        const lap = Math.min(LAPS, (race.laps[session.id] ?? 0) + 1);
        const place = race.order.indexOf(session.id) + 1;
        setLandmarkHint(`Varv ${lap}/${LAPS} · ${place || '-'}:a`);
      }
    } else if (race.order.length === 0) {
      // A race with nobody in it, which is what the loop does when the track is
      // empty. Saying somebody won it would be a strange thing to walk in on.
      setLandmarkHint('Nästa lopp börjar strax!');
    } else {
      const won = race.order[0];
      const mine = race.order.indexOf(session.id) + 1;
      const name = won === session.id ? 'Du' : visitors.nameOf(won) ?? 'Någon';
      if (mine === 1) setLandmarkHint('Du vann!');
      else if (mine > 0) setLandmarkHint(`${name} vann! Du kom ${mine}:a.`);
      else setLandmarkHint(`${name} vann!`);
    }
  };

  /** Walking into a gateway, on either side of it. */
  const gateways = (): void => {
    if (place === 'bana') {
      // The portal you came through stands beside the grid; walking back into
      // it takes you home. Being on the grass and stopped is enough here —
      // there is no steering input to confuse it with, the way the yard has.
      return;
    }
    if (place === 'studs') {
      if (inGateway && !yard.nearGate) inGateway = false;
      if (!inGateway && yard.atGate) leaveYard();
      else if (yard.nearGate) setLandmarkHint('Stå stilla här för att gå tillbaka.');
      else setLandmarkHint(null);
      return;
    }
    if (!world.hasGate) return;
    const away = Math.hypot(player.x - GATE_SPOT.x, player.y - GATE_SPOT.y);
    if (inGateway && away > GATE_LEAVE) inGateway = false;
    if (!inGateway && away < GATE_REACH) enterYard();
    else if (!inGateway && away < TABLE_NOTICE && !nearTable) {
      setLandmarkHint('Grinden! Gå in och studsa.');
    }

    if (!world.hasPortal) return;
    const toPortal = Math.hypot(player.x - PORTAL_SPOT.x, player.y - PORTAL_SPOT.y);
    if (inGateway && toPortal > PORTAL_LEAVE && away > GATE_LEAVE) inGateway = false;
    if (!inGateway && toPortal < PORTAL_REACH) enterTrack();
    else if (!inGateway && toPortal < TABLE_NOTICE && !nearTable) {
      setLandmarkHint('Portalen! Gå in och kör kart.');
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
    yardCamera.resize(viewport);
    trackCamera.resize(viewport);
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
        session, visitors, board, boardUi, yard, track,
        trackApi: { locate, CENTRE },
        get race() { return race; },
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

    const busy = spellUi.open || wardrobe.open || spelling.open || boardUi.open;

    if (place === 'bana') {
      // Steering only: a kart drives itself. Arrows on a laptop, and on a phone
      // a finger held on the left or right of the screen — not toward the kart,
      // the way the yard does it, because a kart that has turned round would
      // then want the opposite side and nobody could follow that.
      let steer = Math.sign(input.moveAxis().x);
      if (steer === 0 && input.pointer.down) steer = input.pointer.x < 0 ? -1 : 1;
      const rolling = race?.phase === 'racing' && race.grid[session.id] !== undefined;
      track.update(dt, { steer: busy ? 0 : steer, rolling });
      raceHint();

      // Everyone else on the track, drawn as karts from their own poses.
      const here = new Set<string>();
      for (const other of visitors.inPlace('bana')) {
        here.add(other.id);
        track.show(other.id, other.variant, other.pose.x, other.pose.y, other.pose.r ?? 0);
      }
      for (const gone of track.drivers) if (!here.has(gone)) track.hide(gone);

      // The way home stands well behind the grid: drive back into it.
      const kart = track.kart;
      if (kart) {
        const away = Math.hypot(kart.x - TRACK_PORTAL.x, kart.y - TRACK_PORTAL.y);
        if (inGateway && away > PORTAL_LEAVE) inGateway = false;
        if (!inGateway && away < PORTAL_REACH) leaveTrack();
      }
    } else if (place === 'studs') {
      // Arrows on a laptop; on a phone there are none, so a finger held to one
      // side of the pony does the same job — walk that way on the ground, turn
      // that way in the air. Without this the yard could not be played on a
      // phone at all, which is what it is mostly played on.
      if (!input.pointer.down) {
        yardTouch = 0;
      } else if (yardTouch === 0 || !yard.airborne) {
        const { halfWidth } = yardCamera.extents(viewport);
        const touchX = yardCamera.camera.position.x + input.pointer.x * halfWidth;
        const gap = touchX - yard.ponyX;
        if (Math.abs(gap) > YARD_TOUCH_DEADZONE) yardTouch = Math.sign(gap);
      }
      // The overlay swallows pointers but not the keyboard, so a child fiddling
      // with the spellbook is not left steering a bouncing pony by accident.
      const keys = Math.sign(input.moveAxis().x);
      yard.update(dt, { steer: busy ? 0 : keys || yardTouch });
      gateways();
    } else if (busy) {
      player.update(dt, false);
    } else {
      caretaking(dt);
      controller.update(dt, input, camera, viewport);
      gateways();
      easel();
    }

    // The meadow keeps going while a child is over the fence: the herd wanders,
    // eggs hatch, strawberries land. Coming back to a meadow frozen exactly as
    // you left it would be the wrong kind of quiet.
    tickLocalHerd(dt);
    world.update(dt);
    myMarker.follow(player, dt);
    session.update(dt);

    if (place === 'bana') {
      const { halfWidth, halfHeight } = trackCamera.extents(viewport);
      // Watching rather than racing: follow whoever is leading.
      const look = track.cameraTarget(halfWidth, halfHeight, race?.order[0]);
      // Snapped rather than eased while racing: at twenty units a second an
      // easing camera trails behind the kart and the corner arrives unseen.
      trackCamera.lookAtScreenPoint(look.x, look.y);
      renderer.render(track.scene, trackCamera.camera);
    } else if (place === 'studs') {
      const { halfWidth, halfHeight } = yardCamera.extents(viewport);
      const look = yard.cameraTarget(halfWidth, halfHeight);
      const ease = 1 - Math.exp(-dt * 8);
      yardCamera.lookAtScreenPoint(
        yardCamera.camera.position.x + (look.x - yardCamera.camera.position.x) * ease,
        yardCamera.camera.position.y + (look.y - yardCamera.camera.position.y) * ease,
      );
      renderer.render(yard.scene, yardCamera.camera);
    } else {
      followPlayer(dt, false);
      world.backdrop.update(dt, camera.camera, camera.extents(viewport));
      renderer.render(world.scene, camera.camera);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

start().catch((err) => {
  console.error(err);
  const loading = document.getElementById('loading');
  if (loading) loading.innerHTML = `<p>Oj då!<br><small>${String(err)}</small></p>`;
});
