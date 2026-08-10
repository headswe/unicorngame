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

  private readonly decor: THREE.Group = new THREE.Group();

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
    }
  }

  update(dt: number): void {
    for (const resident of this.residents) resident.update(dt);
  }
}
