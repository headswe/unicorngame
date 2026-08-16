/**
 * The magic flowers unicorn eggs grow inside.
 *
 * Straight out of the picture book this game's egg spell came from: a unicorn
 * family that really wants a foal grows a magic flower, and when it opens there
 * is an egg lying in it. The book gives it seven days. A six-year-old gets
 * three seconds, which is long enough to run over and watch.
 *
 * The whole job here is the wait. A bud that pushes up out of the grass,
 * trembles, brightens and then bursts open is a promise; an egg that simply
 * appears is a delivery. Nothing in this file decides what is inside — that is
 * the egg's business, and it is settled before the bud is even planted.
 */

import * as THREE from 'three';

import type { AssetLibrary } from '../engine/assets.ts';
import { createSprite, type Sprite } from '../engine/sprite.ts';
import { setGlow } from '../engine/sprite-material.ts';
import { depthOrder, PART_ORDER, projectY } from '../engine/view.ts';

/** Seconds the bud takes to push up out of the grass. */
const SPROUT_TIME = 0.8;

/** Seconds the petals take to throw themselves open. */
const BURST_TIME = 0.5;

/** Seconds a spent flower takes to fold away once its eggs are gone. */
const WILT_TIME = 1.6;

interface Flower {
  id: string;
  x: number;
  y: number;
  age: number;
  /** When the petals open, in seconds since the flower was planted. */
  opensAt: number;
  /** When it starts folding away. */
  wiltsAt: number;
  opened: boolean;
  sprite: Sprite;
  group: THREE.Group;
}

export class MagicFlowers {
  readonly group = new THREE.Group();
  private readonly flowers: Flower[] = [];

  /** Fires the moment the petals open, which is when the eggs are revealed. */
  onBloom: ((id: string) => void) | null = null;

  constructor(private readonly assets: AssetLibrary) {}

  /** True when the parts this needs are on disk. */
  get available(): boolean {
    return this.assets.has('magiblomma') && this.assets.has('magiblomma_oppen');
  }

  private build(id: string): Sprite {
    const part = this.assets.get(id);
    return createSprite(part, { height: part.worldHeight });
  }

  /**
   * Plants a flower.
   *
   * `opensIn` may be zero or less, for a flower being caught up on — one that
   * bloomed while nobody was in the meadow. It then starts open, with no
   * fanfare, because the moment it is announcing has already passed.
   */
  plant(id: string, x: number, y: number, opensIn: number, standsFor: number): boolean {
    if (!this.available) return false;
    if (this.flowers.some((f) => f.id === id)) return false;

    const already = opensIn <= 0;
    const group = new THREE.Group();
    const sprite = this.build(already ? 'magiblomma_oppen' : 'magiblomma');
    group.add(sprite);
    group.position.set(x, projectY(y), 0);
    // Pushes up out of the grass rather than appearing on top of it.
    group.scale.set(1, already ? 1 : 0, 1);
    this.group.add(group);

    this.flowers.push({
      id,
      x,
      y,
      age: 0,
      opensAt: Math.max(0, opensIn),
      wiltsAt: Math.max(0, opensIn) + standsFor,
      opened: already,
      sprite,
      group,
    });
    return true;
  }

  /** Swaps the bud for the open bloom, keeping it in exactly the same spot. */
  private burst(flower: Flower): void {
    const open = this.build('magiblomma_oppen');
    flower.group.remove(flower.sprite);
    flower.sprite.material.dispose();
    flower.group.add(open);
    flower.sprite = open;
    flower.opened = true;
    this.onBloom?.(flower.id);
  }

  update(dt: number): void {
    for (let i = this.flowers.length - 1; i >= 0; i--) {
      const flower = this.flowers[i]!;
      flower.age += dt;

      if (!flower.opened && flower.age >= flower.opensAt) this.burst(flower);

      // Growing up out of the grass, then holding at full height.
      const sprouted = Math.min(1, flower.age / SPROUT_TIME);
      let height = sprouted * sprouted * (3 - 2 * sprouted);
      let width = 1;

      if (flower.opened) {
        // The petals throw themselves open: a wide overshoot that settles.
        const since = flower.age - flower.opensAt;
        if (since < BURST_TIME) {
          const t = since / BURST_TIME;
          const pop = Math.sin(t * Math.PI) * 0.28;
          width += pop;
          height += pop * 0.5;
        }
        setGlow(flower.sprite.material, Math.max(0, 0.5 - (flower.age - flower.opensAt)));
      } else {
        // Trembling and brightening: something is about to happen in there.
        const near = flower.opensAt > 0 ? flower.age / flower.opensAt : 1;
        flower.sprite.rotation.z = Math.sin(flower.age * (5 + near * 9)) * 0.015 * near;
        setGlow(flower.sprite.material, near * near * 0.45);
      }

      // Folding away, once the eggs it was holding have all hatched.
      if (flower.age >= flower.wiltsAt) {
        const t = Math.min(1, (flower.age - flower.wiltsAt) / WILT_TIME);
        height *= 1 - t;
        width *= 1 - t * 0.4;
        flower.sprite.material.uniforms.opacity!.value = 1 - t;
        if (t >= 1) {
          flower.group.removeFromParent();
          flower.sprite.material.dispose();
          this.flowers.splice(i, 1);
          continue;
        }
      }

      flower.group.scale.set(width, height, 1);
      // Behind whatever it is holding, so the eggs sit in front of the petals.
      flower.sprite.renderOrder = depthOrder(flower.y) + PART_ORDER.body;
    }
  }

  dispose(): void {
    for (const flower of this.flowers) {
      flower.group.removeFromParent();
      flower.sprite.material.dispose();
    }
    this.flowers.length = 0;
  }
}
