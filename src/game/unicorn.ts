/**
 * A unicorn standing in the meadow.
 *
 * The art is a stack of still drawings, so all the life has to come from how
 * they are moved: the body bobs and squashes on each step, the mane and tail
 * swing from the points they are pinned to, and the whole animal leans a little
 * into a walk. Idling unicorns keep breathing so nothing on screen is ever
 * completely frozen.
 */

import * as THREE from 'three';

import type { AssetLibrary } from '../engine/assets.ts';
import { createSprite, type Sprite } from '../engine/sprite.ts';
import { depthOrder, PART_ORDER, projectY } from '../engine/view.ts';
import { layoutUnicorn, type PlacedPart } from './rig.ts';
import { shadowTexture } from './shadow.ts';
import type { UnicornVariant } from './variant.ts';

/** Steps per second at full walking speed. */
const STEP_RATE = 5.5;

interface AnimatedPart {
  mesh: Sprite;
  order: number;
  /** How strongly this part swings when the unicorn moves. */
  sway: number;
  baseRotation: number;
}

export class Unicorn {
  readonly group = new THREE.Group();

  /** Position on the meadow floor. */
  x = 0;
  y = 0;

  /** 1 faces right, -1 faces left. */
  facing: 1 | -1 = 1;

  /** How much of the walk cycle is playing, 0..1. Drives bob and sway. */
  gait = 0;

  /** Height of this unicorn in world units, after its size multiplier. */
  readonly height: number;

  private readonly ground = new THREE.Group();
  private readonly flip = new THREE.Group();
  private readonly bob = new THREE.Group();
  private readonly parts: AnimatedPart[] = [];
  private readonly shadow: Sprite | null = null;
  private readonly phase: number;
  private clock = 0;
  private facingBlend = 1;

  constructor(
    readonly variant: UnicornVariant,
    assets: AssetLibrary,
    baseHeight = 1.85,
  ) {
    this.height = baseHeight * variant.scale;
    this.phase = (variant.seed.length * 1.7) % (Math.PI * 2);

    this.group.add(this.ground, this.flip);
    this.flip.add(this.bob);
    // Everything inside is laid out in body heights; one scale brings the whole
    // unicorn to its world size.
    this.flip.scale.setScalar(this.height);
    this.ground.scale.setScalar(this.height);

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
      tint: placed.tint,
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
    const sway =
      placed.order === PART_ORDER.tail ? 0.14 : placed.order === PART_ORDER.mane ? 0.07 : 0;

    return { mesh, order: placed.order, sway, baseRotation: placed.rotation };
  }

  /** Point the unicorn along a movement vector, ignoring pure vertical moves. */
  faceMovement(dx: number): void {
    if (dx > 0.01) this.facing = 1;
    else if (dx < -0.01) this.facing = -1;
  }

  update(dt: number, moving: boolean): void {
    this.clock += dt;

    // Ease the walk cycle in and out so starting and stopping is not a snap.
    const target = moving ? 1 : 0;
    this.gait += (target - this.gait) * Math.min(1, dt * 8);

    const step = this.clock * STEP_RATE * Math.PI * 2 + this.phase;
    const breathe = Math.sin(this.clock * 1.6 + this.phase) * 0.006;

    // Two bounces per stride, the way a trot reads.
    const bounce = Math.abs(Math.sin(step)) * 0.05 * this.gait;
    this.bob.position.y = bounce + breathe;
    this.bob.rotation.z = Math.sin(step) * 0.025 * this.gait;
    // Squash on the way down, stretch at the top of the bounce.
    this.bob.scale.set(1 - bounce * 0.35, 1 + bounce * 0.25, 1);

    for (const part of this.parts) {
      if (part.sway === 0) continue;
      const swing = Math.sin(step - 0.9) * part.sway * this.gait;
      const idle = Math.sin(this.clock * 1.1 + this.phase) * part.sway * 0.18;
      part.mesh.rotation.z = part.baseRotation + swing + idle;
    }

    // Turning is a quick flip rather than an instant mirror, which reads as the
    // unicorn actually pivoting on the spot.
    this.facingBlend += (this.facing - this.facingBlend) * Math.min(1, dt * 14);
    const flipScale = Math.abs(this.facingBlend) < 0.06
      ? Math.sign(this.facingBlend || 1) * 0.06
      : this.facingBlend;
    this.flip.scale.x = this.height * flipScale;

    this.group.position.set(this.x, projectY(this.y), 0);

    const base = depthOrder(this.y);
    for (const part of this.parts) part.mesh.renderOrder = base + part.order;
    if (this.shadow) this.shadow.renderOrder = base + PART_ORDER.shadow;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const part of this.parts) part.mesh.material.dispose();
    this.shadow?.material.dispose();
  }
}
