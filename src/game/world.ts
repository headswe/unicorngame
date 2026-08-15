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
import { makeRng, type Rng } from '../engine/rng.ts';
import { createSprite, type Sprite } from '../engine/sprite.ts';
import { depthOrder, PART_ORDER, projectY } from '../engine/view.ts';
import { Backdrop } from './backdrop.ts';
import { EggNest, HATCH_TIME } from './eggs.ts';
import { createGround } from './ground.ts';
import { WORLD_BOUNDS } from '../../server/herd.js';
import { HerdView } from './herd-view.ts';
import { clamp } from './player.ts';
import { shadowTexture } from './shadow.ts';
import { PoopField } from './poop.ts';
import { TreatField } from './treats.ts';
import { Unicorn } from './unicorn.ts';
import { randomSeed, randomVariant, type UnicornVariant } from './variant.ts';

/**
 * Where the unicorns are allowed to walk.
 *
 * Re-exported from the simulation rather than declared here, so the relay and
 * the browser cannot come to disagree about the size of the field.
 */
export { WORLD_BOUNDS };

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
  readonly herd: HerdView;
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

    this.herd = new HerdView(assets);
    this.scene.add(this.herd.group);
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
    // Already due: it opened while nobody was looking. The foal is in the herd
    // the simulation sends us, so there is nothing to put down here.
    if (hatchIn <= 0) return true;
    return this.eggs.lay(id, eggX, eggY, foal, hatchIn);
  }

  /**
   * An egg has opened. Only announces it — the foal joins the herd through the
   * simulation, the same way every other pony does, so there is exactly one
   * place that decides who is in this field.
   */
  private hatch(id: string, variant: UnicornVariant, x: number, y: number): void {
    this.onHatch?.(id, variant, x, y);
  }

  /** Casts strawberry rain around a point. */
  rainStrawberries(x: number, y: number, rng: Rng, tag: string, at: number): void {
    this.treats.rain(x, y, 14, 5.5, rng, tag, at);
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
    const now = Date.now() / 1000;

    this.herd.update(dt);
    this.poop.update(dt);
    this.treats.update(dt, now);
    this.growBlooms(dt);
    this.eggs.update(dt);
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
