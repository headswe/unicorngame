/**
 * Drawing a herd somebody else is thinking about.
 *
 * The ponies are simulated in one place now — the relay when there is one, this
 * browser when there is not — and this only draws the result. Positions arrive
 * ten times a second, which is far too jerky to render directly, so each pony
 * eases toward where it was last reported. That is the ordinary way games do
 * it: the authority decides, everyone else interpolates a fraction behind.
 *
 * What a pony *looks* like is never sent. A roster is a list of seeds, and a
 * seed rebuilds the whole unicorn locally through the same generator that made
 * it — so a herd of eighteen costs eighteen short strings instead of eighteen
 * descriptions of a body, a horn, a mane, a tail and five colours.
 */

import * as THREE from 'three';

import type { AssetLibrary } from '../engine/assets.ts';
import type { PonyPose } from '../../server/herd.js';
import { Unicorn } from './unicorn.ts';
import { randomVariant } from './variant.ts';

/**
 * How hard a pony is pulled toward its reported position. High enough to keep
 * up with a canter, low enough that the motion stays smooth between updates.
 */
const FOLLOW = 9;

/** Beyond this it has clearly been put somewhere — snap rather than slide. */
const SNAP_DISTANCE = 6;

interface Member {
  seed: string;
  unicorn: Unicorn;
  targetX: number;
  targetY: number;
  facing: 1 | -1;
  moving: boolean;
}

export class HerdView {
  readonly group = new THREE.Group();
  private members: Member[] = [];

  constructor(private readonly assets: AssetLibrary) {}

  get count(): number {
    return this.members.length;
  }

  /** The unicorns themselves, for anything that needs to look at them. */
  get ponies(): Unicorn[] {
    return this.members.map((m) => m.unicorn);
  }

  /**
   * Takes a new cast list.
   *
   * Ponies that were already here keep their unicorn and their place on screen,
   * so a roster arriving because *one* foal hatched does not make the whole
   * herd blink.
   */
  setRoster(seeds: string[]): void {
    const existing = new Map(this.members.map((m) => [m.seed, m]));
    const next: Member[] = [];

    for (const seed of seeds) {
      const already = existing.get(seed);
      if (already) {
        existing.delete(seed);
        next.push(already);
        continue;
      }
      const unicorn = new Unicorn(randomVariant(this.assets, seed), this.assets);
      this.group.add(unicorn.group);
      unicorn.update(0, false);
      next.push({
        seed,
        unicorn,
        targetX: unicorn.x,
        targetY: unicorn.y,
        facing: 1,
        moving: false,
      });
    }

    // Anyone left over is no longer in the meadow.
    for (const gone of existing.values()) gone.unicorn.dispose();
    this.members = next;
  }

  /** A snapshot of where everyone is. Index matches the roster. */
  apply(poses: PonyPose[]): void {
    for (const [i, member] of this.members.entries()) {
      const pose = poses[i];
      if (!pose) continue;
      member.targetX = pose[0];
      member.targetY = pose[1];
      member.facing = pose[2] < 0 ? -1 : 1;
      member.moving = pose[3] === 1;
    }
  }

  update(dt: number): void {
    for (const member of this.members) {
      const { unicorn } = member;
      const dx = member.targetX - unicorn.x;
      const dy = member.targetY - unicorn.y;

      if (Math.hypot(dx, dy) > SNAP_DISTANCE) {
        unicorn.x = member.targetX;
        unicorn.y = member.targetY;
      } else {
        const ease = 1 - Math.exp(-dt * FOLLOW);
        unicorn.x += dx * ease;
        unicorn.y += dy * ease;
      }

      unicorn.facing = member.facing;
      unicorn.update(dt, member.moving);
    }
  }

  dispose(): void {
    for (const member of this.members) member.unicorn.dispose();
    this.members = [];
  }
}
