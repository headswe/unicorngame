/**
 * A unicorn standing in the meadow.
 *
 * The art is a stack of still drawings, so all the life has to come from how
 * they are moved. Two things are worth knowing about what that allows.
 *
 * The head is painted into the body sprite, so there is no neck to bend. A
 * unicorn gets its nose down to the grass by bending its knees and tipping
 * forward — a squash and a small rotation about the ground between its hooves,
 * which together read as grazing without any hoof leaving the ground.
 *
 * The ears are the other half of that. They are a patch cut from the body and
 * laid back over the mane, so they can only move as far as they can go while
 * still covering the ears painted underneath — a pixel or two at the size these
 * are drawn, which is not enough for anyone to see. So there are no ear flicks
 * in here, however much a pony wants them: it is not a thing this art can do.
 *
 * What is left is plenty. The body bobs and squashes on each step, leans into a
 * walk and nods once per stride; hair swings from where it is pinned and lags
 * behind the body as it rises and falls; a resting unicorn breathes, shifts its
 * weight, swishes its tail every few seconds and eventually puts its head down
 * to eat. And it does the last of those only while nothing more interesting is
 * happening, which is what `mood` is for.
 */

import * as THREE from 'three';

import type { AssetLibrary } from '../engine/assets.ts';
import { createSprite, type Sprite } from '../engine/sprite.ts';
import { depthOrder, PART_ORDER, projectY } from '../engine/view.ts';
import { RAINBOW } from './palette.ts';
import { layoutUnicorn, type PlacedPart } from './rig.ts';
import { shadowTexture } from './shadow.ts';
import type { UnicornVariant } from './variant.ts';

/** Steps per second at full walking speed. */
const STEP_RATE = 5.5;

/**
 * What a unicorn is feeling, as far as its body shows it.
 *
 * These are the herd's three moods under names that mean something to the
 * drawing rather than to the simulation: a pony that has noticed a child is
 * `watching`, and one that has just been fed or patted is `pleased`.
 */
export type Mood = 'calm' | 'watching' | 'pleased';

/** Seconds of standing about before a calm unicorn puts its head down. */
const GRAZE_AFTER = 3.2;

/**
 * How a unicorn reaches the grass, given it has no neck to bend.
 *
 * A tip forward alone will not do it: the body is rigid and pivots about the
 * ground between the hooves, so tipping far enough for the nose to matter buries
 * the front hooves and lifts the back ones off the grass. So most of the reach
 * comes from `squash` instead — bending at the knees, in effect, which brings
 * the head down while every hoof stays exactly where it was standing.
 */
const GRAZE = { tilt: 0.12, squash: 0.11, widen: 0.045 };

/** Seconds between tail swishes at rest, before the per-unicorn stagger. */
const SWISH_EVERY = { min: 3, max: 8 };
const SWISH_TIME = 0.55;

/** How much a length of hair lags behind the body as it rises and falls. */
const HAIR_LAG = 0.09;

/** How long a delighted little jump takes. */
const HOP_TIME = 0.5;

/** How far up the body a somersault turns about, in body heights. */
const SPIN_PIVOT = 0.5;

/**
 * Render order for the side-on yard, and the gap between one pony and the next.
 *
 * Nothing there has any depth to sort by, so the order is simply handed out.
 * The gap is comfortably wider than the parts of one unicorn, so two ponies can
 * never interleave.
 */
const SIDE_ORDER = 400000;
const SIDE_LAYER_GAP = 40;

interface AnimatedPart {
  mesh: Sprite;
  order: number;
  /** How strongly this part swings when the unicorn moves. */
  sway: number;
  /** How much it trails the body's bouncing. Hair only. */
  lag: number;
  baseRotation: number;
}

/** A stable 0..1 from a seed string, for staggering one unicorn against another. */
function stagger(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967296;
}

/** Smooth approach that behaves the same whatever the frame rate. */
const approach = (from: number, to: number, rate: number, dt: number): number =>
  from + (to - from) * (1 - Math.exp(-dt * rate));

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export class Unicorn {
  readonly group = new THREE.Group();

  /** Position on the meadow floor. */
  x = 0;
  y = 0;

  /** 1 faces right, -1 faces left. */
  facing: 1 | -1 = 1;

  /** How much of the walk cycle is playing, 0..1. Drives bob and sway. */
  gait = 0;

  /**
   * How the unicorn is feeling. Set it and the body follows over the next
   * fraction of a second — nothing here snaps.
   */
  mood: Mood = 'calm';

  /** Height of this unicorn in world units, after its size multiplier. */
  readonly height: number;

  /**
   * Where this unicorn is standing, and how it is drawn.
   *
   * `meadow` is the field: y is depth, squashed on screen, and everything is
   * sorted north to south. `side` is the bouncing yard, drawn flat-on like a
   * picture book spread: y is how high off the ground it is, and there is no
   * depth at all — which is why the sorting has to be told rather than worked
   * out, and why the ground shadow goes away.
   */
  view: 'meadow' | 'side' = 'meadow';

  /** Which pony is in front of which, in the side view. Ignored in the meadow. */
  layer = 0;

  /**
   * How far the whole unicorn is rotated, in radians, about its middle.
   *
   * Real screen rotation, not body-relative: it is applied outside the mirror
   * that turns the pony round, so a spinning pony keeps spinning the same way
   * whichever way it is facing.
   */
  spin = 0;

  private readonly ground = new THREE.Group();
  private readonly spinner = new THREE.Group();
  private readonly flip = new THREE.Group();
  private readonly bob = new THREE.Group();
  private readonly parts: AnimatedPart[] = [];
  private readonly shadow: Sprite | null = null;
  private readonly phase: number;
  private readonly stagger: number;
  private clock = 0;
  private facingBlend = 1;
  private hopLeft = 0;

  /** How long it has been standing still, which is what brings its head down. */
  private stillFor = 0;
  /** Eased weights for the three things a mood can do to a body. */
  private grazing = 0;
  private watching = 0;
  private pleased = 0;
  /** Last frame's bounce, so the hair can lag behind it. */
  private lastBounce = 0;
  private hairLag = 0;
  /** Counts down a tail swish, and up to the next one. */
  private swishLeft = 0;
  private swishIn: number;
  /** Left over from a hop, so eating something makes it briefly pleased. */
  private delightLeft = 0;

  constructor(
    readonly variant: UnicornVariant,
    assets: AssetLibrary,
    baseHeight = 1.85,
  ) {
    this.height = baseHeight * variant.scale;
    // Off the whole seed, not its length: the residents are named
    // `<day>-granne-0`, `-1`, `-2` and so on, so anything derived from the
    // length alone gives eighteen ponies the identical phase — and a herd
    // breathing and swishing in perfect unison is the one thing that makes it
    // obvious they are all the same machinery.
    this.stagger = stagger(variant.seed);
    this.phase = this.stagger * Math.PI * 2;
    this.swishIn = SWISH_EVERY.min + this.stagger * (SWISH_EVERY.max - SWISH_EVERY.min);

    this.group.add(this.ground, this.spinner);
    this.spinner.add(this.flip);
    this.flip.add(this.bob);
    // Everything inside is laid out in body heights; one scale brings the whole
    // unicorn to its world size.
    this.flip.scale.setScalar(this.height);
    this.ground.scale.setScalar(this.height);
    // A somersault turns about the middle of the pony rather than about its
    // hooves, so the spinner sits half a body up and the body hangs back down
    // from it. Both offsets are in world units — the spinner is outside the
    // scale, which is exactly what keeps its rotation unmirrored.
    this.spinner.position.y = this.height * SPIN_PIVOT;
    this.flip.position.y = -this.height * SPIN_PIVOT;

    // The shadow stays flat on the grass while the body bounces above it.
    const shadowPart = shadowTexture();
    if (shadowPart) {
      this.shadow = createSprite(shadowPart, { height: 0.26, pivotY: 0.5, opacity: 0.75 });
      this.shadow.position.y = 0.04;
      this.ground.add(this.shadow);
    }

    for (const placed of layoutUnicorn(variant, assets)) {
      this.parts.push(this.buildPart(placed));
    }
  }

  private buildPart(placed: PlacedPart): AnimatedPart {
    const mesh = createSprite(placed.part, {
      height: placed.height,
      pivotX: placed.pivotX,
      pivotY: placed.pivotY,
      uv: placed.uv,
      feather: placed.feather ? new THREE.Vector4(...placed.feather) : undefined,
      // The rainbow is a marker rather than a colour; the shader draws the ramp.
      rainbow: placed.tint === RAINBOW,
      tint: placed.tint === RAINBOW ? 0xffffff : placed.tint,
      patternMap: placed.pattern?.part.texture,
      patternTint: placed.pattern?.tint,
      patternAmount: placed.pattern?.amount,
      // The body quad is wider than it is tall, so the horizontal repeat is
      // stretched to match — otherwise round dots come out as ovals.
      patternRepeat: placed.pattern
        ? new THREE.Vector2(placed.pattern.repeat * placed.part.aspect, placed.pattern.repeat)
        : undefined,
    });

    // createSprite derives width from the part's aspect; the rig already did
    // that, so the two agree and only the height needs passing.
    mesh.position.set(placed.anchorX, placed.anchorY, 0);
    mesh.rotation.z = placed.rotation;
    this.bob.add(mesh);

    // Hair swings; horn and body do not.
    const hair = placed.order === PART_ORDER.tail || placed.order === PART_ORDER.mane;
    const sway =
      placed.order === PART_ORDER.tail ? 0.14 : placed.order === PART_ORDER.mane ? 0.07 : 0;
    // A tail hangs loose and trails the body freely; a mane lies along the neck
    // and has much less room to lag.
    const lag = placed.order === PART_ORDER.tail ? 1 : placed.order === PART_ORDER.mane ? 0.45 : 0;

    return { mesh, order: placed.order, sway, lag: hair ? lag : 0, baseRotation: placed.rotation };
  }

  /** How long this one waits before grazing, so a herd does not dip as one. */
  private get grazeAfter(): number {
    return GRAZE_AFTER + this.stagger * 3.5;
  }

  /**
   * A delighted little jump, for eating something nice.
   *
   * Also leaves the unicorn pleased with itself for a moment afterwards, which
   * is how the player's own pony gets a mood — nothing sets one for it the way
   * the simulation does for the herd.
   */
  hop(): void {
    this.hopLeft = HOP_TIME;
    this.delightLeft = 1.6;
  }

  /** Point the unicorn along a movement vector, ignoring pure vertical moves. */
  faceMovement(dx: number): void {
    if (dx > 0.01) this.facing = 1;
    else if (dx < -0.01) this.facing = -1;
  }

  update(dt: number, moving: boolean): void {
    this.clock += dt;
    this.stillFor = moving ? 0 : this.stillFor + dt;

    // Ease the walk cycle in and out so starting and stopping is not a snap.
    const target = moving ? 1 : 0;
    this.gait += (target - this.gait) * Math.min(1, dt * 8);

    // Three ways of standing, each eased in over its own time. Coming out of a
    // graze is quicker than going into one: a pony's head snaps up when it
    // notices you, and then goes back down slowly once you are boring again.
    this.delightLeft = Math.max(0, this.delightLeft - dt);
    const pleased = this.mood === 'pleased' || this.delightLeft > 0;
    const wantsGrass =
      !moving && this.mood === 'calm' && !pleased && this.stillFor > this.grazeAfter;
    this.grazing = approach(this.grazing, wantsGrass ? 1 : 0, wantsGrass ? 2.2 : 7, dt);
    this.watching = approach(this.watching, this.mood === 'watching' ? 1 : 0, 6, dt);
    this.pleased = approach(this.pleased, pleased ? 1 : 0, 8, dt);

    const step = this.clock * STEP_RATE * Math.PI * 2 + this.phase;
    const breathe = Math.sin(this.clock * 1.6 + this.phase) * 0.006;

    // Two bounces per stride, the way a trot reads.
    let bounce = Math.abs(Math.sin(step)) * 0.05 * this.gait;
    // Delight is a jig on the spot, so it bounces without walking anywhere.
    const jig = this.clock * 7.4 + this.phase;
    bounce += Math.abs(Math.sin(jig)) * 0.055 * this.pleased;
    if (this.hopLeft > 0) {
      this.hopLeft = Math.max(0, this.hopLeft - dt);
      // One arc up and back down over the life of the hop, with a crouch at the
      // very start — the dip before a jump is what sells the jump.
      const t = 1 - this.hopLeft / HOP_TIME;
      bounce += t < 0.16 ? -Math.sin((t / 0.16) * Math.PI) * 0.05 : Math.sin(t * Math.PI) * 0.22;
    }

    // Nose down to the grass, or up to look at whoever turned up. The head is
    // painted into the body, so this tips the whole unicorn about its hooves.
    const munch = Math.sin(this.clock * 6.4 + this.phase) * 0.012 * this.grazing;
    const tilt = -GRAZE.tilt * this.grazing + 0.045 * this.watching + munch;

    this.bob.position.y = bounce + breathe + 0.012 * this.watching;
    // Weight shifts from hoof to hoof while it stands about, so a still unicorn
    // is never quite still.
    this.bob.position.x = Math.sin(this.clock * 0.7 + this.phase) * 0.012 * (1 - this.gait);
    this.bob.rotation.z =
      tilt +
      // Leans into a walk, and nods once per stride.
      (Math.sin(step) * 0.025 - 0.03) * this.gait +
      Math.sin(jig * 0.5) * 0.05 * this.pleased;
    // Squash on the way down, stretch at the top of the bounce — and down onto
    // its knees to graze, or up onto its toes to have a proper look at you.
    this.bob.scale.set(
      1 - bounce * 0.35 + GRAZE.widen * this.grazing,
      1 + bounce * 0.25 - GRAZE.squash * this.grazing + 0.02 * this.watching,
      1,
    );

    // Hair carries on rising after the body has stopped, and drops after it has
    // landed. Following the bounce's rate of change is the cheap way to get
    // that, and it costs one subtraction.
    const rise = dt > 0 ? (bounce - this.lastBounce) / dt : 0;
    this.lastBounce = bounce;
    this.hairLag = approach(this.hairLag, clamp(-rise * HAIR_LAG, -0.16, 0.16), 18, dt);

    // Tail swishes: every few seconds at rest, and constantly when delighted.
    this.swishIn -= dt * (1 + this.pleased * 3);
    if (this.swishIn <= 0 && this.swishLeft <= 0) {
      this.swishLeft = SWISH_TIME;
      this.swishIn =
        SWISH_EVERY.min + this.stagger * (SWISH_EVERY.max - SWISH_EVERY.min);
    }
    let swish = 0;
    if (this.swishLeft > 0) {
      this.swishLeft = Math.max(0, this.swishLeft - dt);
      // Out and back, twice, so it reads as a flick rather than a wave.
      const t = 1 - this.swishLeft / SWISH_TIME;
      swish = Math.sin(t * Math.PI * 2) * Math.sin(t * Math.PI) * 0.3;
    }

    for (const part of this.parts) {
      if (part.sway === 0) continue;
      const swing = Math.sin(step - 0.9) * part.sway * this.gait;
      const idle = Math.sin(this.clock * 1.1 + this.phase) * part.sway * 0.18;
      const flick = part.order === PART_ORDER.tail ? swish : swish * 0.25;
      part.mesh.rotation.z =
        part.baseRotation + swing + idle + flick + this.hairLag * part.lag;
    }

    // Turning is a quick flip rather than an instant mirror, which reads as the
    // unicorn actually pivoting on the spot.
    this.facingBlend += (this.facing - this.facingBlend) * Math.min(1, dt * 14);
    const flipScale = Math.abs(this.facingBlend) < 0.06
      ? Math.sign(this.facingBlend || 1) * 0.06
      : this.facingBlend;
    this.flip.scale.x = this.height * flipScale;
    this.spinner.rotation.z = this.spin;

    // In the yard y is height off the ground rather than depth into the field,
    // so it is not squashed, nothing is sorted by it, and the shadow — which
    // belongs on the grass — would otherwise ride up into the air.
    const side = this.view === 'side';
    this.group.position.set(this.x, side ? this.y : projectY(this.y), 0);
    if (this.shadow) this.shadow.visible = !side;

    const base = side ? SIDE_ORDER + this.layer * SIDE_LAYER_GAP : depthOrder(this.y);
    for (const part of this.parts) part.mesh.renderOrder = base + part.order;
    if (this.shadow) this.shadow.renderOrder = base + PART_ORDER.shadow;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const part of this.parts) part.mesh.material.dispose();
    this.shadow?.material.dispose();
  }
}
