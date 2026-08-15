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

/**
 * A berry's fall, worked out rather than integrated.
 *
 * Two browsers stepping their own frame times land a berry a few frames apart,
 * and a few frames is enough to make one herd pick a different strawberry from
 * the other. Solving the drop instead means every screen agrees on exactly when
 * it touches down.
 */
function bounceOf(height: number): { drop: number; rebound: number } {
  const drop = Math.sqrt((2 * height) / GRAVITY);
  const rebound = GRAVITY * drop * BOUNCE;
  return { drop, rebound };
}

/** Seconds from being conjured to coming to rest. */
function fallTime(height: number): number {
  const { drop, rebound } = bounceOf(height);
  return rebound < REST_SPEED ? drop : drop + (2 * rebound) / GRAVITY;
}

/** Height above the grass `elapsed` seconds after being conjured. */
function heightAt(height: number, elapsed: number): number {
  const { drop, rebound } = bounceOf(height);
  if (elapsed < drop) return Math.max(0, height - 0.5 * GRAVITY * elapsed ** 2);
  const since = elapsed - drop;
  return Math.max(0, rebound * since - 0.5 * GRAVITY * since ** 2);
}

/** How close a unicorn's nose has to get. */
export const EAT_RADIUS = 0.75;

const EATEN_TIME = 0.35;

export interface Treat {
  /** `<spell seed>:<n>`, so both browsers name the same berry the same way. */
  id: string;
  x: number;
  y: number;
  /** Height above the grass. Zero once landed. */
  lift: number;
  /** Unix seconds this berry was conjured, and when it comes to rest. */
  bornAt: number;
  landsAt: number;
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
  rain(
    centreX: number,
    centreY: number,
    count: number,
    radius: number,
    rng: Rng,
    /** Names the berries. The spell's seed, so both screens agree. */
    tag: string,
    /** Unix seconds the spell was cast, shared by everyone who replays it. */
    at: number,
  ): void {
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

      // Staggered starting heights, so they do not all land on the same beat.
      const height = 9 + rng.range(0, 7) + i * 0.35;

      this.treats.push({
        id: `${tag}:${i}`,
        x,
        y,
        lift: height,
        bornAt: at,
        landsAt: at + fallTime(height),
        landed: false,
        eaten: null,
        group,
        sprite,
        shadow,
      });
    }
  }

  /**
   * The nearest uneaten berry within `radius`, whether or not it has landed.
   *
   * Deliberately not limited to landed ones. A berry's fall is integrated frame
   * by frame, so two browsers disagree by a few frames about when it touches
   * down — and if that decided which berries a pony can see, the two would pick
   * different ones and the herds would part company for the whole shower. A
   * berry's *position* is known the moment it is conjured, so ponies walk to
   * where it is going to land and wait for it. Which also looks better.
   */
  nearest(x: number, y: number, radius: number): Treat | null {
    let best: Treat | null = null;
    let bestDistance = radius;
    for (const treat of this.treats) {
      if (treat.eaten !== null) continue;
      const distance = Math.hypot(treat.x - x, treat.y - y);
      if (distance < bestDistance) {
        best = treat;
        bestDistance = distance;
      }
    }
    return best;
  }

  /**
   * The berries as the herd simulation wants them, for when this browser is the
   * one doing the simulating. Marking one eaten here is how the simulation says
   * a pony got it.
   */
  forHerd(): Array<{ id: string; x: number; y: number; landsAt: number; eaten: boolean }> {
    return this.treats
      .filter((t) => t.eaten === null)
      .map((t) => ({ id: t.id, x: t.x, y: t.y, landsAt: t.landsAt, eaten: false }));
  }

  /** Eats a named berry, wherever it is. Used when a friend eats one. */
  eatById(id: string): boolean {
    const treat = this.treats.find((t) => t.id === id);
    return treat ? this.eat(treat) : false;
  }

  /** Returns false if something else got there first. */
  eat(treat: Treat): boolean {
    if (treat.eaten !== null) return false;
    treat.eaten = 0;
    return true;
  }

  update(dt: number, now: number): void {
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
        const elapsed = now - treat.bornAt;
        treat.lift = heightAt(treat.lift, elapsed);

        if (now >= treat.landsAt) {
          treat.lift = 0;
          treat.landed = true;
          this.onLand?.();
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
