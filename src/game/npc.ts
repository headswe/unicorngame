/**
 * The unicorns that live in the meadow and mind their own business.
 *
 * Each one alternates between grazing on the spot and ambling to somewhere
 * nearby. They keep to a home patch so the meadow stays evenly populated
 * instead of everyone drifting into one corner, and they wait a beat before
 * setting off so a group never moves in lockstep.
 */

import type { Rng } from '../engine/rng.ts';
import { clamp, type WorldBounds } from './player.ts';
import type { Unicorn } from './unicorn.ts';

const WANDER_SPEED = 1.5;
const ARRIVAL = 0.3;

export class WanderingUnicorn {
  private targetX: number;
  private targetY: number;
  private restFor: number;

  constructor(
    readonly unicorn: Unicorn,
    private readonly rng: Rng,
    private readonly homeX: number,
    private readonly homeY: number,
    private readonly roam: number,
    private readonly bounds: WorldBounds,
  ) {
    this.targetX = unicorn.x;
    this.targetY = unicorn.y;
    this.restFor = rng.range(0, 6);
  }

  /** Sends this unicorn somewhere specific, interrupting whatever it was doing. */
  goTo(x: number, y: number): void {
    this.targetX = clamp(x, this.bounds.minX, this.bounds.maxX);
    this.targetY = clamp(y, this.bounds.minY, this.bounds.maxY);
    this.restFor = 0;
  }

  private chooseTarget(): void {
    const angle = this.rng.range(0, Math.PI * 2);
    const distance = this.rng.range(1.5, this.roam);
    this.targetX = clamp(
      this.homeX + Math.cos(angle) * distance,
      this.bounds.minX,
      this.bounds.maxX,
    );
    this.targetY = clamp(
      this.homeY + Math.sin(angle) * distance,
      this.bounds.minY,
      this.bounds.maxY,
    );
  }

  update(dt: number): void {
    let moving = false;

    if (this.restFor > 0) {
      this.restFor -= dt;
      if (this.restFor <= 0) this.chooseTarget();
    } else {
      const dx = this.targetX - this.unicorn.x;
      const dy = this.targetY - this.unicorn.y;
      const distance = Math.hypot(dx, dy);

      if (distance < ARRIVAL) {
        this.restFor = this.rng.range(2.5, 9);
      } else {
        const ease = Math.min(1, distance / 1.5);
        this.unicorn.x += (dx / distance) * WANDER_SPEED * ease * dt;
        this.unicorn.y += (dy / distance) * WANDER_SPEED * ease * dt;
        this.unicorn.faceMovement(dx);
        moving = ease > 0.15;
      }
    }

    this.unicorn.update(dt, moving);
  }
}
