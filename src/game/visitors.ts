/**
 * The other children's unicorns.
 *
 * A visitor is an ordinary `Unicorn` — same rig, same wardrobe, same walk —
 * with its position driven by the network instead of by a controller. Poses
 * arrive ten times a second, which is far too jerky to draw directly, so each
 * visitor eases toward the last place it was reported rather than teleporting
 * there. At walking speed that reads as a pony walking, and it quietly covers a
 * dropped packet or two.
 *
 * Visitors that stop reporting are removed. That is the only leaving there is:
 * a closed laptop and a clean disconnect look identical from here, and both
 * should end with the pony gone rather than standing frozen in the grass.
 */

import * as THREE from 'three';

import type { AssetLibrary } from '../engine/assets.ts';
import type { Pose } from '../net/protocol.ts';
import { PEER_TIMEOUT } from '../net/protocol.ts';
import { Marker, THEIRS } from './marker.ts';
import { Unicorn } from './unicorn.ts';
import type { UnicornVariant } from './variant.ts';

/**
 * How hard a visitor is pulled toward its reported position. High enough to
 * keep up with a canter, low enough that the motion stays smooth.
 */
const FOLLOW = 9;

/** Beyond this a visitor has clearly teleported — snap instead of sliding. */
const SNAP_DISTANCE = 6;

interface Visitor {
  unicorn: Unicorn;
  /** Floats above them with their name on it, so you know whose pony that is. */
  marker: Marker;
  variantKey: string;
  target: Pose;
  /** Seconds since this peer last said anything. */
  silent: number;
}

export class Visitors {
  readonly group = new THREE.Group();
  private readonly here = new Map<string, Visitor>();

  /** Fires whenever someone arrives or leaves, with the new head count. */
  onCount: ((count: number) => void) | null = null;
  /** Fires when a visitor's unicorn first appears, for a greeting noise. */
  onArrive: ((variant: UnicornVariant) => void) | null = null;

  constructor(private readonly assets: AssetLibrary) {}

  get count(): number {
    return this.here.size;
  }

  /** Everyone currently in the meadow, for the roster. */
  names(): string[] {
    return [...this.here.values()].map((v) => v.unicorn.variant.name);
  }

  /**
   * Adds a visitor, or re-dresses one that has been through the wardrobe.
   *
   * A variant is plain data, so comparing the serialised form is both the
   * cheapest and the most complete way to notice a change — it catches a
   * recoloured mane as readily as a whole new body.
   */
  greet(id: string, variant: UnicornVariant, pose: Pose): void {
    const key = JSON.stringify(variant);
    const existing = this.here.get(id);

    if (existing) {
      if (existing.variantKey === key) {
        existing.target = pose;
        existing.silent = 0;
        return;
      }
      // Changed clothes: rebuild in place, keeping where it was standing.
      existing.unicorn.dispose();
      const dressed = this.build(variant, existing.unicorn.x, existing.unicorn.y, pose.f);
      existing.unicorn = dressed;
      existing.variantKey = key;
      existing.target = pose;
      existing.silent = 0;
      return;
    }

    const unicorn = this.build(variant, pose.x, pose.y, pose.f);
    const marker = new Marker(this.assets, THEIRS, true);
    this.group.add(marker.group);
    this.here.set(id, { unicorn, marker, variantKey: key, target: pose, silent: 0 });
    this.onArrive?.(variant);
    this.onCount?.(this.here.size);
  }

  private build(variant: UnicornVariant, x: number, y: number, facing: 1 | -1): Unicorn {
    const unicorn = new Unicorn(variant, this.assets);
    unicorn.x = x;
    unicorn.y = y;
    unicorn.facing = facing;
    this.group.add(unicorn.group);
    unicorn.update(0, false);
    return unicorn;
  }

  /** A position update. Ignored for a peer we have not been introduced to. */
  moveTo(id: string, pose: Pose): void {
    const visitor = this.here.get(id);
    if (!visitor) return;
    visitor.target = pose;
    visitor.silent = 0;
  }

  /** True when this peer is unknown, so the caller can ask them to say hello. */
  isStranger(id: string): boolean {
    return !this.here.has(id);
  }

  remove(id: string): void {
    const visitor = this.here.get(id);
    if (!visitor) return;
    visitor.unicorn.dispose();
    visitor.marker.dispose();
    this.here.delete(id);
    this.onCount?.(this.here.size);
  }

  /** Sends everyone home, e.g. when the relay drops. */
  clear(): void {
    for (const visitor of this.here.values()) {
      visitor.unicorn.dispose();
      visitor.marker.dispose();
    }
    this.here.clear();
    this.onCount?.(0);
  }

  update(dt: number): void {
    for (const [id, visitor] of [...this.here]) {
      visitor.silent += dt;
      if (visitor.silent > PEER_TIMEOUT) {
        this.remove(id);
        continue;
      }

      const { unicorn, target } = visitor;
      const dx = target.x - unicorn.x;
      const dy = target.y - unicorn.y;

      if (Math.hypot(dx, dy) > SNAP_DISTANCE) {
        unicorn.x = target.x;
        unicorn.y = target.y;
      } else {
        const ease = 1 - Math.exp(-dt * FOLLOW);
        unicorn.x += dx * ease;
        unicorn.y += dy * ease;
      }

      unicorn.facing = target.f;
      unicorn.update(dt, target.m);
      visitor.marker.follow(unicorn, dt);
    }
  }
}
