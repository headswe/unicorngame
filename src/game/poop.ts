/**
 * Rainbow poop, and the shovelling of it.
 *
 * The first caretaking job in the meadow: unicorns leave presents behind them,
 * and the player picks up the shovel and taps them away. Poops pop in with a
 * bounce and puff out when cleaned, because the whole point is that clearing
 * one is satisfying.
 */

import * as THREE from 'three';

import type { AssetLibrary } from '../engine/assets.ts';
import { createSprite, type Sprite } from '../engine/sprite.ts';
import { depthOrder, PART_ORDER, projectY } from '../engine/view.ts';
import { shadowTexture } from './shadow.ts';

/** Beyond this the meadow starts to look neglected rather than fun. */
const MAX_POOPS = 22;

/** How close the player has to be to shovel one up. */
export const REACH = 2.2;

/** How close a tap has to land on a poop to count as aiming at it. */
const TAP_RADIUS = 1.1;

const POP_IN = 0.35;
const PUFF_OUT = 0.4;

interface Poop {
  x: number;
  y: number;
  group: THREE.Group;
  sprite: Sprite;
  shadow: Sprite | null;
  /** Counts up while popping in. */
  age: number;
  /** Counts up once shovelled; the poop is removed when it finishes. */
  cleaning: number | null;
  wobble: number;
}

export class PoopField {
  readonly group = new THREE.Group();

  private readonly poops: Poop[] = [];

  /** How many have been cleaned up — the score, such as it is. */
  cleaned = 0;

  constructor(private readonly assets: AssetLibrary) {}

  get count(): number {
    return this.poops.filter((p) => p.cleaning === null).length;
  }

  /** True if a poop actually appeared, so the caller knows whether to play a sound. */
  spawn(x: number, y: number): boolean {
    if (!this.assets.has('bajs_regnbage')) return false;
    if (this.count >= MAX_POOPS) return false;

    const part = this.assets.get('bajs_regnbage');
    const group = new THREE.Group();

    let shadow: Sprite | null = null;
    const shadowPart = shadowTexture();
    if (shadowPart) {
      shadow = createSprite(shadowPart, { height: 0.13, pivotY: 0.5, opacity: 0.45 });
      shadow.position.y = 0.02;
      group.add(shadow);
    }

    const sprite = createSprite(part, { height: part.worldHeight });
    group.add(sprite);
    group.position.set(x, projectY(y), 0);
    this.group.add(group);

    this.poops.push({
      x,
      y,
      group,
      sprite,
      shadow,
      age: 0,
      cleaning: null,
      wobble: Math.random() * Math.PI * 2,
    });
    return true;
  }

  /**
   * The nearest poop that is both close to the tap and within the player's
   * reach — so tapping a distant one walks you there instead of cleaning it
   * from across the meadow.
   */
  findTarget(
    tapX: number,
    tapY: number,
    playerX: number,
    playerY: number,
  ): Poop | null {
    let best: Poop | null = null;
    let bestDistance = Infinity;

    for (const poop of this.poops) {
      if (poop.cleaning !== null) continue;
      if (Math.hypot(poop.x - playerX, poop.y - playerY) > REACH) continue;
      const distance = Math.hypot(poop.x - tapX, poop.y - tapY);
      if (distance <= TAP_RADIUS && distance < bestDistance) {
        best = poop;
        bestDistance = distance;
      }
    }
    return best;
  }

  /** The closest poop within reach, for the keyboard shortcut. */
  nearest(playerX: number, playerY: number): Poop | null {
    let best: Poop | null = null;
    let bestDistance = REACH;

    for (const poop of this.poops) {
      if (poop.cleaning !== null) continue;
      const distance = Math.hypot(poop.x - playerX, poop.y - playerY);
      if (distance < bestDistance) {
        best = poop;
        bestDistance = distance;
      }
    }
    return best;
  }

  /** Starts the puff-out. Returns false if it was already on its way out. */
  clean(poop: Poop): boolean {
    if (poop.cleaning !== null) return false;
    poop.cleaning = 0;
    this.cleaned++;
    return true;
  }

  update(dt: number): void {
    for (let i = this.poops.length - 1; i >= 0; i--) {
      const poop = this.poops[i]!;

      if (poop.cleaning !== null) {
        poop.cleaning += dt;
        const t = Math.min(1, poop.cleaning / PUFF_OUT);
        // Swells and fades, like it went up in glitter.
        poop.group.scale.setScalar(1 + t * 0.7);
        poop.group.position.y = projectY(poop.y) + t * 0.5;
        poop.sprite.material.uniforms.opacity!.value = 1 - t;
        if (poop.shadow) poop.shadow.material.uniforms.opacity!.value = 0.45 * (1 - t);

        if (t >= 1) {
          poop.group.removeFromParent();
          poop.sprite.material.dispose();
          poop.shadow?.material.dispose();
          this.poops.splice(i, 1);
        }
        continue;
      }

      if (poop.age < POP_IN) {
        poop.age += dt;
        const t = Math.min(1, poop.age / POP_IN);
        // Overshoot and settle, so it lands with a bit of weight.
        const bounce = 1 + Math.sin(t * Math.PI) * 0.25;
        poop.group.scale.setScalar(t < 1 ? t * bounce : 1);
      } else {
        poop.wobble += dt;
        poop.group.scale.setScalar(1 + Math.sin(poop.wobble * 2) * 0.015);
      }

      const order = depthOrder(poop.y);
      poop.sprite.renderOrder = order + PART_ORDER.body;
      if (poop.shadow) poop.shadow.renderOrder = order + PART_ORDER.shadow;
    }
  }
}

export type { Poop };
