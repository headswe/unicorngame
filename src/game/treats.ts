/**
 * Things that fall out of the sky and get eaten.
 *
 * Strawberries drop in from above the view, bounce once on the grass, and sit
 * there until a unicorn reaches them. The bounce is what makes them feel like
 * objects rather than sprites that appeared — it is worth the twelve lines.
 */

import * as THREE from 'three';

import type { AssetLibrary } from '../engine/assets.ts';
import type { Rng } from '../engine/rng.ts';
import { createSprite, type Sprite } from '../engine/sprite.ts';
import { depthOrder, PART_ORDER, projectY } from '../engine/view.ts';
import { shadowTexture } from './shadow.ts';

const GRAVITY = 34;
const BOUNCE = 0.34;
/** Below this the berry has settled and stops bouncing. */
const REST_SPEED = 1.2;

/** How close a unicorn's nose has to get. */
export const EAT_RADIUS = 0.75;

const EATEN_TIME = 0.35;

export interface Treat {
  x: number;
  y: number;
  /** Height above the grass. Zero once landed. */
  lift: number;
  velocity: number;
  landed: boolean;
  eaten: number | null;
  group: THREE.Group;
  sprite: Sprite;
  shadow: Sprite | null;
}

export class TreatField {
  readonly group = new THREE.Group();
  private readonly treats: Treat[] = [];

  /** Fires when a berry lands, for the little tap sound. */
  onLand: (() => void) | null = null;

  constructor(private readonly assets: AssetLibrary) {}

  get count(): number {
    return this.treats.filter((t) => t.eaten === null).length;
  }

  /** Drops a scatter of berries around a point. */
  rain(centreX: number, centreY: number, count: number, radius: number, rng: Rng): void {
    if (!this.assets.has('jordgubbe')) return;
    const part = this.assets.get('jordgubbe');

    for (let i = 0; i < count; i++) {
      // Even angular spread with a jittered radius, so it reads as a shower
      // rather than a clump.
      const angle = (i / count) * Math.PI * 2 + rng.range(-0.3, 0.3);
      const distance = Math.sqrt(rng.next()) * radius;
      const x = centreX + Math.cos(angle) * distance;
      const y = centreY + Math.sin(angle) * distance * 0.8;

      const group = new THREE.Group();

      let shadow: Sprite | null = null;
      const shadowPart = shadowTexture();
      if (shadowPart) {
        shadow = createSprite(shadowPart, { height: 0.1, pivotY: 0.5, opacity: 0.35 });
        shadow.position.y = 0.02;
        group.add(shadow);
      }

      const sprite = createSprite(part, { height: part.worldHeight });
      group.add(sprite);
      this.group.add(group);

      this.treats.push({
        x,
        y,
        // Staggered starting heights, so they do not all land on the same beat.
        lift: 9 + rng.range(0, 7) + i * 0.35,
        velocity: 0,
        landed: false,
        eaten: null,
        group,
        sprite,
        shadow,
      });
    }
  }

  /** The nearest landed, uneaten berry within `radius`. */
  nearest(x: number, y: number, radius: number): Treat | null {
    let best: Treat | null = null;
    let bestDistance = radius;
    for (const treat of this.treats) {
      if (treat.eaten !== null || !treat.landed) continue;
      const distance = Math.hypot(treat.x - x, treat.y - y);
      if (distance < bestDistance) {
        best = treat;
        bestDistance = distance;
      }
    }
    return best;
  }

  /** Returns false if something else got there first. */
  eat(treat: Treat): boolean {
    if (treat.eaten !== null) return false;
    treat.eaten = 0;
    return true;
  }

  update(dt: number): void {
    for (let i = this.treats.length - 1; i >= 0; i--) {
      const treat = this.treats[i]!;

      if (treat.eaten !== null) {
        treat.eaten += dt;
        const t = Math.min(1, treat.eaten / EATEN_TIME);
        treat.group.scale.setScalar(1 - t);
        treat.sprite.material.uniforms.opacity!.value = 1 - t;
        if (treat.shadow) treat.shadow.material.uniforms.opacity!.value = 0.35 * (1 - t);
        if (t >= 1) {
          treat.group.removeFromParent();
          treat.sprite.material.dispose();
          treat.shadow?.material.dispose();
          this.treats.splice(i, 1);
        }
        continue;
      }

      if (!treat.landed) {
        treat.velocity -= GRAVITY * dt;
        treat.lift += treat.velocity * dt;

        if (treat.lift <= 0) {
          treat.lift = 0;
          if (Math.abs(treat.velocity) < REST_SPEED) {
            treat.landed = true;
            this.onLand?.();
          } else {
            treat.velocity = -treat.velocity * BOUNCE;
            this.onLand?.();
          }
        }
        // The shadow stays on the grass and tightens as the berry drops, which
        // is what tells you where it is going to land.
        if (treat.shadow) {
          const closeness = Math.max(0, 1 - treat.lift / 9);
          treat.shadow.scale.setScalar(0.5 + closeness * 0.5);
          treat.shadow.material.uniforms.opacity!.value = 0.1 + closeness * 0.3;
        }
      }

      treat.group.position.set(treat.x, projectY(treat.y), 0);
      treat.sprite.position.y = treat.lift;

      const order = depthOrder(treat.y);
      treat.sprite.renderOrder = order + PART_ORDER.body;
      if (treat.shadow) treat.shadow.renderOrder = order + PART_ORDER.shadow;
    }
  }
}
