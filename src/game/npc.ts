/**
 * The unicorns that live in the meadow and mind their own business.
 *
 * Where each one stands is a **pure function of the clock**, not something
 * accumulated frame by frame. That is the whole design, and it exists because
 * two children have to see the same herd.
 *
 * The obvious way to write this — pick a target, walk toward it a bit each
 * frame — cannot be shared. Two browsers integrating their own frame times
 * drift apart whenever one of them stutters, and worse, a child who opens the
 * game half an hour later starts every resident back at its spawn point. The
 * herds would never have matched for a moment.
 *
 * So instead: time is chopped into legs of a fixed length, the endpoints of leg
 * *n* are hashed out of the resident's seed and *n*, and the position at any
 * moment is found by working out which leg the clock is in and how far through
 * it we are. Same answer on every machine, in constant time, whether you joined
 * at nine or at half past — and no positions on the wire at all.
 *
 * Chasing a strawberry is the one exception: a local detour off the shared path
 * that eases back onto it afterwards.
 */

import { hash01 } from '../engine/rng.ts';
import { clamp, type WorldBounds } from './player.ts';
import type { Unicorn } from './unicorn.ts';

/**
 * One walk plus one graze. Constant, so the leg containing a given moment is a
 * division rather than a walk through the resident's whole history — a client
 * joining in the afternoon must not have to replay the morning.
 */
const LEG_SECONDS = 11;

/** A leg spends somewhere in this range walking; the rest is standing still. */
const WALK_FRACTION = { min: 0.35, max: 0.62 };

/** How fast a detour toward a strawberry is walked, in world units a second. */
const CHASE_SPEED = 1.8;

/** Seconds spent easing back onto the shared path after a detour. */
const REJOIN_TIME = 1.6;

/** Smooth start and stop, so a resident does not jerk into motion. */
function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

export class WanderingUnicorn {
  /** Set while chasing something; the shared path resumes once it clears. */
  private chasing: { x: number; y: number } | null = null;
  /** Counts down while easing back onto the shared path after a chase. */
  private rejoining = 0;

  private lastX: number;
  private lastY: number;

  constructor(
    readonly unicorn: Unicorn,
    /** Also identifies this resident's presents, which are hashed from it. */
    readonly seed: number,
    private readonly homeX: number,
    private readonly homeY: number,
    private readonly roam: number,
    private readonly bounds: WorldBounds,
  ) {
    this.lastX = unicorn.x;
    this.lastY = unicorn.y;
  }

  /** Where this resident rests at the end of leg `n`. */
  private restingPlace(n: number): { x: number; y: number } {
    const angle = hash01(this.seed, n * 3) * Math.PI * 2;
    // Square-rooted so the resting places spread evenly over the patch instead
    // of bunching around the middle of it.
    const distance = Math.sqrt(hash01(this.seed, n * 3 + 1)) * this.roam;
    return {
      x: clamp(this.homeX + Math.cos(angle) * distance, this.bounds.minX, this.bounds.maxX),
      y: clamp(this.homeY + Math.sin(angle) * distance, this.bounds.minY, this.bounds.maxY),
    };
  }

  /**
   * Where this resident is at absolute time `now`, in seconds — past or future.
   *
   * Every browser passes the same wall-clock value and gets the same answer,
   * which is what makes the herd shared without sending anything. Answering for
   * *past* moments is what lets a present dropped ten minutes ago be placed
   * exactly where the pony was standing at the time.
   */
  positionAt(now: number): { x: number; y: number } {
    // Each resident starts its cycle at its own moment, so eighteen ponies do
    // not all set off on the same beat.
    const offset = hash01(this.seed, 0xffff) * LEG_SECONDS;
    const t = now + offset;
    const leg = Math.floor(t / LEG_SECONDS);
    const through = t / LEG_SECONDS - leg;

    const from = this.restingPlace(leg);
    const to = this.restingPlace(leg + 1);

    const walkFor =
      WALK_FRACTION.min +
      hash01(this.seed, leg * 3 + 2) * (WALK_FRACTION.max - WALK_FRACTION.min);

    // Past the walking part of the leg, it is standing at the far end grazing.
    if (through >= walkFor) return to;

    const k = ease(through / walkFor);
    return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
  }

  /** Sends this unicorn after something, interrupting its ramble. */
  goTo(x: number, y: number): void {
    this.chasing = {
      x: clamp(x, this.bounds.minX, this.bounds.maxX),
      y: clamp(y, this.bounds.minY, this.bounds.maxY),
    };
  }

  /** Gives up a chase and drifts back onto the shared path. */
  stopChasing(): void {
    if (!this.chasing) return;
    this.chasing = null;
    this.rejoining = REJOIN_TIME;
  }

  update(dt: number, now: number): void {
    const shared = this.positionAt(now);

    if (this.chasing) {
      const dx = this.chasing.x - this.unicorn.x;
      const dy = this.chasing.y - this.unicorn.y;
      const distance = Math.hypot(dx, dy);

      if (distance < 0.25) {
        this.stopChasing();
      } else {
        const step = Math.min(distance, CHASE_SPEED * dt);
        this.unicorn.x += (dx / distance) * step;
        this.unicorn.y += (dy / distance) * step;
      }
    } else if (this.rejoining > 0) {
      // Slide back onto the shared path rather than snapping, so a pony that
      // wandered off for a strawberry does not teleport home.
      this.rejoining = Math.max(0, this.rejoining - dt);
      const blend = 1 - this.rejoining / REJOIN_TIME;
      this.unicorn.x += (shared.x - this.unicorn.x) * blend;
      this.unicorn.y += (shared.y - this.unicorn.y) * blend;
    } else {
      this.unicorn.x = shared.x;
      this.unicorn.y = shared.y;
    }

    // The walk cycle and which way it faces both come from how far it actually
    // moved, which works the same whether it is on its path or off chasing.
    const movedX = this.unicorn.x - this.lastX;
    const movedY = this.unicorn.y - this.lastY;
    this.lastX = this.unicorn.x;
    this.lastY = this.unicorn.y;

    const speed = dt > 0 ? Math.hypot(movedX, movedY) / dt : 0;
    this.unicorn.faceMovement(movedX);
    this.unicorn.update(dt, speed > 0.12);
  }
}
