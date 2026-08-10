/**
 * Steering for the unicorn the child is actually driving.
 *
 * Both control schemes are live at once and neither has to be chosen up front:
 * arrows and WASD steer directly, and a tap or drag anywhere sets a spot to
 * walk to. Touching the keyboard cancels a pending tap so the two never fight.
 */

import type { Input } from '../engine/input.ts';
import type { MeadowCamera, ViewportSize } from '../engine/view.ts';
import type { Unicorn } from './unicorn.ts';

/** World units per second at a full canter. */
const SPEED = 6.4;

/** How close counts as having arrived at a tapped spot. */
const ARRIVAL = 0.35;

export interface WorldBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export class PlayerController {
  /** Where a tap asked the unicorn to go, if anywhere. */
  private target: { x: number; y: number } | null = null;

  /** True while the unicorn is actually travelling — drives the walk cycle. */
  moving = false;

  constructor(
    readonly unicorn: Unicorn,
    private readonly bounds: WorldBounds,
  ) {}

  /** Cancels any walk-to order, e.g. when a mini-game takes over. */
  stop(): void {
    this.target = null;
    this.moving = false;
  }

  update(
    dt: number,
    input: Input,
    camera: MeadowCamera,
    viewport: ViewportSize,
  ): void {
    const axis = input.moveAxis();
    const keyboard = axis.x !== 0 || axis.y !== 0;

    if (keyboard) {
      this.target = null;
    } else if (input.pointer.down) {
      this.target = camera.screenToWorld(input.pointer.x, input.pointer.y, viewport);
    }

    let dx = axis.x;
    let dy = axis.y;

    if (!keyboard && this.target) {
      const toX = this.target.x - this.unicorn.x;
      const toY = this.target.y - this.unicorn.y;
      const distance = Math.hypot(toX, toY);
      if (distance < ARRIVAL) {
        this.target = null;
        dx = 0;
        dy = 0;
      } else {
        dx = toX / distance;
        dy = toY / distance;
        // Ease down over the last stride so the unicorn settles instead of
        // stopping dead on the spot.
        const ease = Math.min(1, distance / 1.2);
        dx *= ease;
        dy *= ease;
      }
    }

    const speed = Math.hypot(dx, dy);
    this.moving = speed > 0.05;

    if (this.moving) {
      this.unicorn.x += dx * SPEED * dt;
      this.unicorn.y += dy * SPEED * dt;
      this.unicorn.faceMovement(dx);
    }

    this.unicorn.x = clamp(this.unicorn.x, this.bounds.minX, this.bounds.maxX);
    this.unicorn.y = clamp(this.unicorn.y, this.bounds.minY, this.bounds.maxY);
    this.unicorn.update(dt, this.moving);
  }
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
