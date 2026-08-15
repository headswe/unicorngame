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
import { MOOD, type PonyPose } from '../../server/herd.js';
import { createSprite, type Sprite } from '../engine/sprite.ts';
import { depthOrder, PART_ORDER, projectY } from '../engine/view.ts';
import { Unicorn, type Mood } from './unicorn.ts';
import { randomVariant } from './variant.ts';

/**
 * How hard a pony is pulled toward its reported position. High enough to keep
 * up with a canter, low enough that the motion stays smooth between updates.
 */
const FOLLOW = 9;

/** Beyond this it has clearly been put somewhere — snap rather than slide. */
const SNAP_DISTANCE = 6;

/** How long a puff of hearts drifts up for. */
const CHEER_TIME = 1.3;

/** How near a tap has to land on a pony to count as patting it. */
export const PET_RADIUS = 1.2;

/** The simulation's mood numbers, as the body understands them. */
function moodOf(mood: number): Mood {
  if (mood === MOOD.HAPPY) return 'pleased';
  if (mood === MOOD.LOOKING) return 'watching';
  return 'calm';
}

interface Member {
  seed: string;
  unicorn: Unicorn;
  targetX: number;
  targetY: number;
  facing: 1 | -1;
  moving: boolean;
}

interface Cheer {
  sprite: Sprite;
  x: number;
  y: number;
  age: number;
}

export class HerdView {
  readonly group = new THREE.Group();
  private members: Member[] = [];
  private cheers: Cheer[] = [];

  constructor(private readonly assets: AssetLibrary) {}

  /**
   * The pony nearest a tap, if the child is close enough to reach it.
   *
   * Two tests, not one: the tap has to land on a pony *and* the child has to be
   * standing by it, so patting is something you walk over and do rather than
   * something you do to a pony across the field.
   */
  findPettable(tapX: number, tapY: number, fromX: number, fromY: number, reach: number): number {
    let best = -1;
    let bestAway = PET_RADIUS;
    for (const [i, member] of this.members.entries()) {
      const { unicorn } = member;
      if (Math.hypot(unicorn.x - fromX, unicorn.y - fromY) > reach) continue;
      const away = Math.hypot(unicorn.x - tapX, unicorn.y - tapY);
      if (away < bestAway) {
        best = i;
        bestAway = away;
      }
    }
    return best;
  }

  /** Sends up a puff of hearts over a pony. */
  cheer(index: number): void {
    const member = this.members[index];
    if (!member || !this.assets.has('hjartan')) return;
    const part = this.assets.get('hjartan');
    const sprite = createSprite(part, { height: part.worldHeight });
    this.group.add(sprite);
    this.cheers.push({
      sprite,
      x: member.unicorn.x,
      y: member.unicorn.y + 0.01,
      age: 0,
    });
  }

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
      // The simulation knows perfectly well when a pony has noticed a child or
      // is pleased about a strawberry; until now the drawing threw that away
      // and every pony in the meadow stood exactly as blankly as every other.
      member.unicorn.mood = moodOf(pose[4]);
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
    this.driftCheers(dt);
  }

  /** Hearts rise, spread a little and fade. */
  private driftCheers(dt: number): void {
    for (let i = this.cheers.length - 1; i >= 0; i--) {
      const cheer = this.cheers[i]!;
      cheer.age += dt;
      const t = cheer.age / CHEER_TIME;

      if (t >= 1) {
        cheer.sprite.removeFromParent();
        cheer.sprite.material.dispose();
        this.cheers.splice(i, 1);
        continue;
      }

      cheer.sprite.position.set(
        cheer.x + Math.sin(t * 3.1) * 0.16,
        projectY(cheer.y) + 1.6 + t * 1.1,
        0,
      );
      // Pops in, then fades as it goes.
      cheer.sprite.scale.setScalar(Math.min(1, t * 5) * (1 - t * 0.25));
      cheer.sprite.material.uniforms.opacity!.value = 1 - t * t;
      cheer.sprite.renderOrder = depthOrder(cheer.y) + PART_ORDER.bubble;
    }
  }

  dispose(): void {
    for (const member of this.members) member.unicorn.dispose();
    for (const cheer of this.cheers) cheer.sprite.material.dispose();
    this.members = [];
    this.cheers = [];
  }
}
