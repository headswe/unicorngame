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
import { createGround } from './ground.ts';
import { WanderingUnicorn } from './npc.ts';
import type { WorldBounds } from './player.ts';
import { shadowTexture } from './shadow.ts';
import { PoopField } from './poop.ts';
import { TreatField, EAT_RADIUS } from './treats.ts';
import { Unicorn } from './unicorn.ts';
import { randomVariant } from './variant.ts';

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

/** Seconds between one unicorn's presents. Long enough to stay a treat. */
const POOP_INTERVAL = { min: 14, max: 38 };

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
];

export class World {
  readonly scene = new THREE.Scene();
  readonly backdrop: Backdrop;
  readonly player: Unicorn;
  readonly residents: WanderingUnicorn[] = [];
  readonly poop: PoopField;
  readonly treats: TreatField;
  /** Flowers conjured by a spell, kept so they can be animated in. */
  private readonly blooms: Array<{ sprite: Sprite; age: number }> = [];

  /** Called when a unicorn leaves a present, so the game can make a noise. */
  onPoop: (() => void) | null = null;
  /** Called when any unicorn eats a strawberry. */
  onEat: (() => void) | null = null;

  private readonly decor: THREE.Group = new THREE.Group();
  private readonly poopTimers: number[] = [];
  private shovelSprite: THREE.Object3D | null = null;

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
    this.placeShovel();

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
            !spec.avoidsClearing || Math.hypot(x - SPAWN.x, y - SPAWN.y) > CLEARING_RADIUS;
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
      this.scene.add(unicorn.group);

      this.residents.push(
        new WanderingUnicorn(unicorn, makeRng(`vandra-${i}`), x, y, rng.range(3, 9), WORLD_BOUNDS),
      );
      // Staggered, so the meadow does not fill up all at once at the start.
      this.poopTimers.push(rng.range(4, POOP_INTERVAL.max));
    }
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

  /** Removes the shovel from the grass once it has been picked up. */
  takeShovel(): void {
    this.shovelSprite?.removeFromParent();
    this.shovelSprite = null;
  }

  get shovelOnGround(): boolean {
    return this.shovelSprite !== null;
  }

  update(dt: number): void {
    for (const [i, resident] of this.residents.entries()) {
      resident.update(dt);

      // Presents arrive on each unicorn's own clock, so they never all go at
      // once, and only while it is standing still.
      this.poopTimers[i] = (this.poopTimers[i] ?? 0) - dt;
      if ((this.poopTimers[i] ?? 0) <= 0) {
        this.poopTimers[i] = randomBetween(POOP_INTERVAL.min, POOP_INTERVAL.max);
        const unicorn = resident.unicorn;
        // Behind the unicorn, which is where you would expect to find it.
        if (this.poop.spawn(unicorn.x - unicorn.facing * 0.55, unicorn.y - 0.15)) {
          this.onPoop?.();
        }
      }
    }

    this.poop.update(dt);
    this.treats.update(dt);
    this.feedResidents();
    this.growBlooms(dt);
  }

  /** Unicorns notice strawberries nearby, walk over, and eat them. */
  private feedResidents(): void {
    if (!this.treats.count) return;

    for (const resident of this.residents) {
      const unicorn = resident.unicorn;
      const treat = this.treats.nearest(unicorn.x, unicorn.y, TREAT_SMELL);
      if (!treat) continue;

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

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
