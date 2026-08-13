/**
 * The meadow itself: the floor, what grows on it, and who lives there.
 *
 * Scenery is scattered from a seed rather than hand-placed, so the field is
 * large and varied without a level editor, and it comes back identical every
 * time. Trees and bushes are pushed out of a clearing around the spawn point so
 * the player never wakes up inside a shrub.
 */

import * as THREE from 'three';

import type { AssetLibrary, Part } from '../engine/assets.ts';
import { hash01, hashSeed, makeRng, type Rng } from '../engine/rng.ts';
import { createSprite, type Sprite } from '../engine/sprite.ts';
import { depthOrder, PART_ORDER, projectY } from '../engine/view.ts';
import { Backdrop } from './backdrop.ts';
import { EggNest, HATCH_TIME } from './eggs.ts';
import { createGround } from './ground.ts';
import { WanderingUnicorn } from './npc.ts';
import { clamp, type WorldBounds } from './player.ts';
import { shadowTexture } from './shadow.ts';
import { PoopField } from './poop.ts';
import { TreatField, EAT_RADIUS } from './treats.ts';
import { Unicorn } from './unicorn.ts';
import { randomSeed, randomVariant, type UnicornVariant } from './variant.ts';

/** Where the unicorns are allowed to walk. */
export const WORLD_BOUNDS: WorldBounds = {
  minX: -42,
  maxX: 42,
  minY: 1,
  maxY: 36,
};

/**
 * Where the grass stops and the hills begin. Kept a few units beyond the
 * playable edge so the meadow always runs on past the last unicorn instead of
 * ending under its hooves — you can see the horizon, you just cannot reach it.
 */
export const HORIZON_Y = 40;

/** Nothing large is planted within this radius of where the player starts. */
const CLEARING_RADIUS = 6;

export const SPAWN = { x: 0, y: 8 };

/** Where the shovel is lying when the game starts — in plain sight of spawn. */
export const SHOVEL_SPOT = { x: 4.2, y: 9.5 };

/**
 * The letter table, where the spelling game lives. Far enough from spawn to be
 * something you walk over and discover, close enough that you cannot miss it on
 * the first stroll north.
 */
export const TABLE_SPOT = { x: -9.5, y: 14.5 };

/** Nothing large is planted within this radius of the letter table either. */
const TABLE_CLEARING = 4;

/**
 * Presents are generated from the clock, the same way the herd's positions are,
 * so both children find the same poop in the same places without a word passing
 * between them.
 *
 * Every resident gets one chance per slot to leave something. Which slots, and
 * exactly when within them, is hashed from the resident and the slot number, so
 * the whole day's droppings can be worked out from scratch by a browser that
 * only just opened.
 */
const POOP_SLOT = 40;

/** How likely a resident is to leave something in any given slot. */
const POOP_CHANCE = 0.03;

/**
 * Presents older than this are not replayed when the game opens. A meadow that
 * greets a child with nine hours of accumulated poop is a chore, not a game;
 * the last stretch is enough to give them something to do.
 */
const POOP_BACKLOG = 20 * 60;

/** How far a unicorn will notice a strawberry and come over for it. */
const TREAT_SMELL = 9;

interface ScatterSpec {
  id: string;
  count: number;
  /** Height range in world units. */
  min: number;
  max: number;
  /** Whether this thing is big enough to deserve a shadow. */
  shadow: boolean;
  /** Keep this far away from the spawn clearing. */
  avoidsClearing: boolean;
}

const SCATTER: ScatterSpec[] = [
  { id: 'trad_stort', count: 14, min: 3.4, max: 5, shadow: true, avoidsClearing: true },
  { id: 'buske_rund', count: 26, min: 0.9, max: 1.5, shadow: true, avoidsClearing: true },
  { id: 'buske_bar', count: 18, min: 0.8, max: 1.2, shadow: true, avoidsClearing: true },
  { id: 'sten_gra', count: 20, min: 0.4, max: 0.8, shadow: true, avoidsClearing: false },
  { id: 'blommor_vita', count: 55, min: 0.35, max: 0.6, shadow: false, avoidsClearing: false },
  { id: 'blommor_rosa', count: 45, min: 0.35, max: 0.6, shadow: false, avoidsClearing: false },
  { id: 'tuva_gras', count: 90, min: 0.28, max: 0.5, shadow: false, avoidsClearing: false },
  { id: 'hoball', count: 5, min: 0.9, max: 1.1, shadow: true, avoidsClearing: true },
  { id: 'vattenho', count: 4, min: 0.65, max: 0.8, shadow: true, avoidsClearing: true },
  { id: 'apelkorg', count: 4, min: 0.5, max: 0.6, shadow: true, avoidsClearing: true },
  { id: 'solros', count: 12, min: 1.6, max: 2.2, shadow: true, avoidsClearing: true },
  { id: 'stubbe', count: 8, min: 0.6, max: 0.85, shadow: true, avoidsClearing: true },
  { id: 'bikupa', count: 4, min: 0.85, max: 1.05, shadow: true, avoidsClearing: true },
  { id: 'brunn', count: 2, min: 1.6, max: 1.85, shadow: true, avoidsClearing: true },
  { id: 'flugsvamp', count: 22, min: 0.4, max: 0.65, shadow: true, avoidsClearing: false },
  { id: 'fagelbo', count: 5, min: 0.4, max: 0.5, shadow: true, avoidsClearing: false },
  { id: 'fjaril', count: 14, min: 0.3, max: 0.45, shadow: false, avoidsClearing: false },
  { id: 'nyckelpiga', count: 12, min: 0.22, max: 0.32, shadow: false, avoidsClearing: false },
];

export class World {
  readonly scene = new THREE.Scene();
  readonly backdrop: Backdrop;
  readonly player: Unicorn;
  readonly residents: WanderingUnicorn[] = [];
  readonly poop: PoopField;
  readonly treats: TreatField;
  readonly eggs: EggNest;
  /** Flowers conjured by a spell, kept so they can be animated in. */
  private readonly blooms: Array<{ sprite: Sprite; age: number }> = [];

  /** Called when a unicorn leaves a present, so the game can make a noise. */
  onPoop: (() => void) | null = null;
  /** Called when any unicorn eats a strawberry. */
  onEat: (() => void) | null = null;
  /** Called with the newcomer's name when an egg opens. */
  onHatch: ((id: string, variant: UnicornVariant, x: number, y: number) => void) | null = null;

  private readonly decor: THREE.Group = new THREE.Group();
  /** Next present slot to consider; null until the first frame catches up. */
  private poopSlot: number | null = null;
  private shovelSprite: THREE.Object3D | null = null;
  /** False only when the sprite is missing, which keeps the hint honest. */
  hasLetterTable = false;

  constructor(
    private readonly assets: AssetLibrary,
    playerUnicorn: Unicorn,
    seed = 'angen-1',
  ) {
    const rng = makeRng(seed);

    this.scene.add(createGround({ ...WORLD_BOUNDS, horizonY: HORIZON_Y }));

    this.backdrop = new Backdrop(assets, {
      horizonY: HORIZON_Y,
      worldWidth: WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX,
      seed,
    });
    this.scene.add(this.backdrop.group);

    this.scene.add(this.decor);
    this.scatterScenery(rng);

    this.poop = new PoopField(assets);
    this.scene.add(this.poop.group);
    this.treats = new TreatField(assets);
    this.scene.add(this.treats.group);
    this.eggs = new EggNest(assets);
    this.eggs.onHatch = (id, variant, x, y) => this.hatch(id, variant, x, y);
    this.scene.add(this.eggs.group);
    this.placeShovel();
    this.placeLetterTable();

    this.player = playerUnicorn;
    this.player.x = SPAWN.x;
    this.player.y = SPAWN.y;
    this.scene.add(this.player.group);

    this.populate(rng);
  }

  private plant(part: Part, x: number, y: number, height: number, withShadow: boolean): void {
    const order = depthOrder(y);

    if (withShadow) {
      const shadowPart = shadowTexture();
      if (shadowPart) {
        const shadow = createSprite(shadowPart, {
          height: height * 0.18,
          pivotY: 0.5,
          opacity: 0.4,
        });
        shadow.position.set(x, projectY(y) + height * 0.02, 0);
        shadow.renderOrder = order + PART_ORDER.shadow;
        this.decor.add(shadow);
      }
    }

    const sprite: Sprite = createSprite(part, { height });
    sprite.position.set(x, projectY(y), 0);
    sprite.renderOrder = order + PART_ORDER.body;
    this.decor.add(sprite);
  }

  private scatterScenery(rng: Rng): void {
    for (const spec of SCATTER) {
      if (!this.assets.has(spec.id)) continue;
      const part = this.assets.get(spec.id);

      for (let i = 0; i < spec.count; i++) {
        // A handful of tries to land outside the clearing, then give up and
        // skip — better a slightly emptier meadow than a tree on the player.
        let x = 0;
        let y = 0;
        let placed = false;

        for (let attempt = 0; attempt < 12; attempt++) {
          // Scenery spills past the fence line all the way to the horizon,
          // which is what gives the far grass some depth.
          x = rng.range(WORLD_BOUNDS.minX - 4, WORLD_BOUNDS.maxX + 4);
          y = rng.range(WORLD_BOUNDS.minY - 3, HORIZON_Y - 1.5);
          const clear =
            !spec.avoidsClearing ||
            (Math.hypot(x - SPAWN.x, y - SPAWN.y) > CLEARING_RADIUS &&
              Math.hypot(x - TABLE_SPOT.x, y - TABLE_SPOT.y) > TABLE_CLEARING);
          if (clear) {
            placed = true;
            break;
          }
        }
        if (!placed) continue;

        this.plant(part, x, y, rng.range(spec.min, spec.max), spec.shadow);
      }
    }
  }

  /**
   * Adds a unicorn to the herd. Residents and their poop clocks are parallel
   * arrays, so joining the meadow has to go through one place or the two will
   * drift apart.
   */
  private addResident(
    unicorn: Unicorn,
    wanderSeed: number,
    roam: number,
  ): void {
    this.scene.add(unicorn.group);
    this.residents.push(
      new WanderingUnicorn(unicorn, wanderSeed, unicorn.x, unicorn.y, roam, WORLD_BOUNDS),
    );
  }

  private populate(rng: Rng): void {
    const count = 18;
    for (let i = 0; i < count; i++) {
      const variant = randomVariant(this.assets, `granne-${i}-${rng.int(1e6)}`);
      const unicorn = new Unicorn(variant, this.assets);

      // Spread them over the field, but never right on top of the player.
      let x = 0;
      let y = 0;
      do {
        x = rng.range(WORLD_BOUNDS.minX + 3, WORLD_BOUNDS.maxX - 3);
        y = rng.range(WORLD_BOUNDS.minY + 1, WORLD_BOUNDS.maxY - 2);
      } while (Math.hypot(x - SPAWN.x, y - SPAWN.y) < 5);

      unicorn.x = x;
      unicorn.y = y;
      unicorn.facing = rng.chance(0.5) ? 1 : -1;
      // Staggered, so the meadow does not fill up all at once at the start.
      this.addResident(unicorn, rng.int(1e9), rng.range(3, 9));
    }
  }

  /**
   * Rolls the foal an egg would contain.
   *
   * Separate from laying it because whoever casts the spell decides what is
   * inside and tells everyone else — two children watching the same egg must
   * not see two different ponies come out of it.
   */
  rollFoal(): UnicornVariant {
    const foal = randomVariant(this.assets, `agg-${randomSeed()}`);
    // Whatever the roll said, something that just hatched is a foal.
    foal.scale = Math.min(foal.scale, 0.78);
    return foal;
  }

  /**
   * Conjures an egg beside a point, with a known foal inside it.
   *
   * The foal is settled before the shell exists, which is the whole trick: it
   * can then be painted in that foal's coat colour and coat pattern, so you can
   * see what is coming while you wait. Everything else about the egg — where it
   * lands, how long it takes — comes from `rng`, so casting this with the same
   * seed on two machines puts the same egg in the same place.
   */
  layEgg(
    id: string,
    x: number,
    y: number,
    rng: Rng,
    foal: UnicornVariant,
    /** Seconds this egg has already been sitting there, when catching up. */
    elapsed = 0,
  ): boolean {
    if (!this.eggs.available) return false;

    // Beside the caster rather than under them, and never outside the fence.
    const angle = rng.range(0, Math.PI * 2);
    const distance = rng.range(1.7, 2.7);
    const eggX = clamp(x + Math.cos(angle) * distance, WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX);
    const eggY = clamp(
      y + Math.sin(angle) * distance * 0.8,
      WORLD_BOUNDS.minY,
      WORLD_BOUNDS.maxY,
    );

    const hatchIn = rng.range(HATCH_TIME.min, HATCH_TIME.max) - elapsed;
    // Already due: it opened while nobody was looking, so the foal is simply
    // here rather than being made to hatch all over again.
    if (hatchIn <= 0) {
      this.settle(foal, eggX, eggY);
      return true;
    }
    return this.eggs.lay(id, eggX, eggY, foal, hatchIn);
  }

  /** An egg has opened: the foal joins the herd where the shell was. */
  private hatch(id: string, variant: UnicornVariant, x: number, y: number): void {
    this.settle(variant, x, y, true);
    this.onHatch?.(id, variant, x, y);
  }

  /**
   * Puts a foal into the herd. Used both by an egg opening in front of the
   * child and by one that opened while they were away, which is why the
   * celebrating is optional.
   */
  settle(variant: UnicornVariant, x: number, y: number, celebrate = false): void {
    const unicorn = new Unicorn(variant, this.assets);
    unicorn.x = x;
    unicorn.y = y;
    unicorn.facing = hash01(hashSeed(variant.seed), 3) < 0.5 ? 1 : -1;
    // Arrives mid-bounce, which is the first thing you see it do.
    if (celebrate) unicorn.hop();
    this.addResident(
      unicorn,
      // Derived from the foal rather than rolled, so a hatchling rambles the
      // same way on every screen that watched it hatch.
      hashSeed(variant.seed),
      // Newborns keep close to where they hatched.
      4,
    );
  }

  /** Casts strawberry rain around a point. */
  rainStrawberries(x: number, y: number, rng: Rng): void {
    this.treats.rain(x, y, 14, 5.5, rng);
  }

  /** Blooms a ring of flowers around a point, each popping up in turn. */
  bloomFlowers(x: number, y: number, rng: Rng): void {
    const kinds = ['blommor_rosa', 'blommor_vita'].filter((id) => this.assets.has(id));
    if (!kinds.length) return;

    const count = 14;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const radius = rng.range(2.2, 3.1);
      const fx = x + Math.cos(angle) * radius;
      // The depth axis is squashed on screen, so the ring is squashed to match
      // and comes out looking round.
      const fy = y + Math.sin(angle) * radius * 0.75;

      const part = this.assets.get(rng.pick(kinds));
      const sprite = createSprite(part, { height: rng.range(0.4, 0.62) });
      sprite.position.set(fx, projectY(fy), 0);
      sprite.renderOrder = depthOrder(fy) + PART_ORDER.body;
      sprite.scale.setScalar(0);
      this.decor.add(sprite);
      // Staggered so the ring opens outward rather than all at once.
      this.blooms.push({ sprite, age: -i * 0.045 });
    }
  }

  /** Lays the shovel on the grass for the player to find. */
  private placeShovel(): void {
    if (!this.assets.has('spade')) return;
    const part = this.assets.get('spade');
    const order = depthOrder(SHOVEL_SPOT.y);
    const group = new THREE.Group();

    const shadowPart = shadowTexture();
    if (shadowPart) {
      const shadow = createSprite(shadowPart, { height: 0.12, pivotY: 0.5, opacity: 0.4 });
      shadow.position.y = 0.02;
      shadow.renderOrder = order + PART_ORDER.shadow;
      group.add(shadow);
    }

    const sprite = createSprite(part, { height: part.worldHeight });
    sprite.renderOrder = order + PART_ORDER.body;
    group.add(sprite);

    group.position.set(SHOVEL_SPOT.x, projectY(SHOVEL_SPOT.y), 0);
    this.scene.add(group);
    this.shovelSprite = group;
  }

  /**
   * Stands the letter table in the meadow. It is only scenery as far as the
   * world is concerned — walking up to it is what opens the spelling game, and
   * that check lives with the rest of the caretaking.
   */
  private placeLetterTable(): void {
    if (!this.assets.has('bokstavsbord')) return;
    const part = this.assets.get('bokstavsbord');
    this.plant(part, TABLE_SPOT.x, TABLE_SPOT.y, part.worldHeight, true);
    this.hasLetterTable = true;
  }

  /** Removes the shovel from the grass once it has been picked up. */
  takeShovel(): void {
    this.shovelSprite?.removeFromParent();
    this.shovelSprite = null;
  }

  get shovelOnGround(): boolean {
    return this.shovelSprite !== null;
  }

  update(dt: number): void {
    // The herd's positions are a function of the wall clock, so every browser
    // showing this meadow draws it the same way — including one that opened
    // half an hour later than the other.
    const now = Date.now() / 1000;

    for (const resident of this.residents) resident.update(dt, now);

    this.dropPresents(now);
    this.poop.update(dt);
    this.treats.update(dt);
    this.feedResidents();
    this.growBlooms(dt);
    // Last, because a hatching egg adds to `residents` and nothing above may
    // still be part-way through iterating it.
    this.eggs.update(dt);
  }

  /**
   * Works out which presents exist by now and puts down any that are missing.
   *
   * Slots are scanned once each, from a cursor, so the cost is a short catch-up
   * on the first frame and almost nothing after that. Because a resident's
   * position can be asked for at any past moment, each present lands exactly
   * where that pony was standing when it left it.
   */
  private dropPresents(now: number): void {
    const current = Math.floor(now / POOP_SLOT);
    // First frame: replay only the recent past, not the whole day.
    const from = this.poopSlot ?? Math.floor((now - POOP_BACKLOG) / POOP_SLOT);

    for (let slot = from; slot <= current; slot++) {
      for (const resident of this.residents) {
        if (hash01(resident.seed, slot) >= POOP_CHANCE) continue;

        // Somewhere inside the slot, so eighteen ponies do not go at once.
        const when = (slot + hash01(resident.seed, slot ^ 0x5bd1)) * POOP_SLOT;
        if (when > now) continue;

        const id = `${resident.seed}:${slot}`;
        if (this.poop.knows(id)) continue;

        const at = resident.positionAt(when);
        if (this.poop.spawn(id, at.x - 0.55, at.y - 0.15)) {
          // Only the ones that have just happened are worth a noise; the
          // catch-up ones were dropped while nobody was watching.
          if (now - when < 2) this.onPoop?.();
        }
      }
    }
    this.poopSlot = current + 1;
  }

  /** Unicorns notice strawberries nearby, walk over, and eat them. */
  private feedResidents(): void {
    if (!this.treats.count) {
      // Nothing left to chase: everyone drifts back onto the shared path.
      for (const resident of this.residents) resident.stopChasing();
      return;
    }

    for (const resident of this.residents) {
      const unicorn = resident.unicorn;
      const treat = this.treats.nearest(unicorn.x, unicorn.y, TREAT_SMELL);
      if (!treat) {
        resident.stopChasing();
        continue;
      }

      if (Math.hypot(treat.x - unicorn.x, treat.y - unicorn.y) <= EAT_RADIUS) {
        if (this.treats.eat(treat)) {
          unicorn.hop();
          this.onEat?.();
        }
      } else {
        resident.goTo(treat.x, treat.y);
      }
    }
  }

  private growBlooms(dt: number): void {
    for (let i = this.blooms.length - 1; i >= 0; i--) {
      const bloom = this.blooms[i]!;
      bloom.age += dt;
      if (bloom.age <= 0) continue;

      const t = Math.min(1, bloom.age / 0.45);
      // Overshoot then settle, so each flower springs up.
      bloom.sprite.scale.setScalar(t < 1 ? t * (1 + Math.sin(t * Math.PI) * 0.35) : 1);
      if (t >= 1) this.blooms.splice(i, 1);
    }
  }
}
