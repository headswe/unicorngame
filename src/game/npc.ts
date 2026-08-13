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
 * Chasing a strawberry is a detour off that path, and it is built the same way:
 * a walk from where the pony was to where the berry is, over a duration fixed
 * when the chase begins. Not integrated frame by frame — that was measured
 * pulling a third of the herd up to thirteen world units apart between two
 * browsers, which is most of a screen.
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

interface Detour {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** Wall-clock seconds, snapped to the decision grid. */
  start: number;
  duration: number;
}

export class WanderingUnicorn {
  /** Set while walking to something; the shared path resumes once it clears. */
  private chase: Detour | null = null;
  /** Set while easing back onto the shared path after a chase. */
  private rejoin: { fromX: number; fromY: number; start: number } | null = null;

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

  /**
   * Where this resident actually is: on its shared path, off chasing something,
   * or easing back onto the path afterwards. All three are functions of the
   * clock, so two browsers asking at the same moment get the same answer.
   */
  placeAt(now: number): { x: number; y: number } {
    const shared = this.positionAt(now);

    if (this.chase) {
      const t = Math.min(1, (now - this.chase.start) / this.chase.duration);
      const k = ease(t);
      return {
        x: this.chase.fromX + (this.chase.toX - this.chase.fromX) * k,
        y: this.chase.fromY + (this.chase.toY - this.chase.fromY) * k,
      };
    }

    if (this.rejoin) {
      const t = (now - this.rejoin.start) / REJOIN_TIME;
      if (t >= 1) {
        this.rejoin = null;
        return shared;
      }
      const k = ease(Math.max(0, t));
      return {
        x: this.rejoin.fromX + (shared.x - this.rejoin.fromX) * k,
        y: this.rejoin.fromY + (shared.y - this.rejoin.fromY) * k,
      };
    }

    return shared;
  }

  /** What this resident is currently walking to, if anything. For diagnosis. */
  get target(): { x: number; y: number } | null {
    return this.chase ? { x: this.chase.toX, y: this.chase.toY } : null;
  }

  /** Sends this unicorn after something, interrupting its ramble. */
  goTo(x: number, y: number, now: number): void {
    const toX = clamp(x, this.bounds.minX, this.bounds.maxX);
    const toY = clamp(y, this.bounds.minY, this.bounds.maxY);
    // Already walking to this very spot: leave the walk alone rather than
    // restarting it from here every frame.
    if (this.chase && Math.hypot(this.chase.toX - toX, this.chase.toY - toY) < 0.05) return;

    const at = this.placeAt(now);
    const distance = Math.hypot(toX - at.x, toY - at.y);
    this.chase = {
      fromX: at.x,
      fromY: at.y,
      toX,
      toY,
      start: now,
      duration: Math.max(0.2, distance / CHASE_SPEED),
    };
    this.rejoin = null;
  }

  /** Gives up a chase and drifts back onto the shared path. */
  stopChasing(now: number): void {
    if (!this.chase) return;
    const at = this.placeAt(now);
    this.chase = null;
    this.rejoin = { fromX: at.x, fromY: at.y, start: now };
  }

  update(dt: number, now: number): void {
    const at = this.placeAt(now);
    this.unicorn.x = at.x;
    this.unicorn.y = at.y;

    // The walk cycle and which way it faces both come from how far it actually
    // moved, which works the same on its path or off chasing.
    const movedX = this.unicorn.x - this.lastX;
    const movedY = this.unicorn.y - this.lastY;
    this.lastX = this.unicorn.x;
    this.lastY = this.unicorn.y;

    const speed = dt > 0 ? Math.hypot(movedX, movedY) / dt : 0;
    this.unicorn.faceMovement(movedX);
    this.unicorn.update(dt, speed > 0.12);
  }
}
