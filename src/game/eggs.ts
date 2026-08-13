/**
 * Eggs waiting to hatch.
 *
 * An egg is a unicorn that has not arrived yet. The foal inside is rolled the
 * moment the egg is conjured, and the shell is then painted with that foal's
 * coat colour and coat pattern through the same shader the unicorn's own body
 * uses — so the egg is a genuine preview, and the wait is spent guessing rather
 * than just waiting.
 *
 * The rocking is what sells it. A still egg is scenery; an egg that tips a
 * little further every few seconds is something about to happen.
 */

import * as THREE from 'three';

import type { AssetLibrary } from '../engine/assets.ts';
import { createSprite, type Sprite } from '../engine/sprite.ts';
import { setGlow } from '../engine/sprite-material.ts';
import { depthOrder, PART_ORDER, projectY } from '../engine/view.ts';
import { RAINBOW } from './palette.ts';
import { shadowTexture } from './shadow.ts';
import type { UnicornVariant } from './variant.ts';

/** How long an egg sits there before it opens. Long enough to go and watch it. */
export const HATCH_TIME = { min: 14, max: 20 };

/** The shell cracks this many seconds before the foal comes out. */
const CRACK_LEAD = 4.5;

/** Seconds the shell takes to swell and vanish once it opens. */
const POP_TIME = 0.45;

/** Seconds the egg takes to appear, springing up out of nothing. */
const ARRIVE_TIME = 0.5;

interface Egg {
  x: number;
  y: number;
  variant: UnicornVariant;
  age: number;
  hatchAt: number;
  cracked: boolean;
  /** Counts up once the shell has opened; null until then. */
  popping: number | null;
  group: THREE.Group;
  shell: Sprite;
  shadow: Sprite | null;
}

export class EggNest {
  readonly group = new THREE.Group();
  private readonly eggs: Egg[] = [];

  /** Fires when a shell opens, with the foal that was inside it. */
  onHatch: ((variant: UnicornVariant, x: number, y: number) => void) | null = null;
  /** Fires the moment the first crack shows. */
  onCrack: (() => void) | null = null;

  constructor(private readonly assets: AssetLibrary) {}

  get count(): number {
    return this.eggs.length;
  }

  /** True when the parts this needs are on disk. */
  get available(): boolean {
    return this.assets.has('agg');
  }

  /**
   * Paints a shell in the colours of the foal inside it. Both the whole egg and
   * the cracked one go through here, so swapping the art keeps the colouring.
   */
  private buildShell(variant: UnicornVariant, id: string): Sprite {
    const part = this.assets.get(id);
    const pattern =
      variant.patternId && this.assets.has(variant.patternId)
        ? this.assets.get(variant.patternId)
        : null;

    // The egg is a good deal smaller than a body, so the pattern is tiled more
    // loosely than it would be on the foal — at the body's own repeat the dots
    // would collapse into texture.
    const repeat = variant.patternScale * 0.55;

    return createSprite(part, {
      height: part.worldHeight,
      rainbow: variant.coat === RAINBOW,
      tint: variant.coat === RAINBOW ? 0xffffff : variant.coat,
      patternMap: pattern?.texture,
      patternTint: variant.patternColour,
      patternAmount: pattern ? variant.patternAmount : undefined,
      patternRepeat: pattern
        ? new THREE.Vector2(repeat * part.aspect, repeat)
        : undefined,
    });
  }

  /** Conjures an egg onto the grass. Returns false if the art is missing. */
  lay(x: number, y: number, variant: UnicornVariant, hatchIn: number): boolean {
    if (!this.available) return false;

    const group = new THREE.Group();

    let shadow: Sprite | null = null;
    const shadowPart = shadowTexture();
    if (shadowPart) {
      shadow = createSprite(shadowPart, { height: 0.16, pivotY: 0.5, opacity: 0.4 });
      shadow.position.y = 0.02;
      group.add(shadow);
    }

    const shell = this.buildShell(variant, 'agg');
    group.add(shell);
    group.position.set(x, projectY(y), 0);
    // Springs up from nothing rather than blinking into existence.
    group.scale.setScalar(0);
    this.group.add(group);

    this.eggs.push({
      x,
      y,
      variant,
      age: 0,
      hatchAt: hatchIn,
      cracked: false,
      popping: null,
      group,
      shell,
      shadow,
    });
    return true;
  }

  /** Swaps the whole shell for the cracked one, keeping its colours. */
  private crack(egg: Egg): void {
    if (egg.cracked || !this.assets.has('agg_spricka')) {
      egg.cracked = true;
      return;
    }
    const replacement = this.buildShell(egg.variant, 'agg_spricka');
    replacement.rotation.z = egg.shell.rotation.z;
    egg.group.remove(egg.shell);
    egg.shell.material.dispose();
    egg.group.add(replacement);
    egg.shell = replacement;
    egg.cracked = true;
    this.onCrack?.();
  }

  update(dt: number): void {
    for (let i = this.eggs.length - 1; i >= 0; i--) {
      const egg = this.eggs[i]!;
      egg.age += dt;

      if (egg.popping !== null) {
        egg.popping += dt;
        const t = Math.min(1, egg.popping / POP_TIME);
        // The shell swells and fades rather than shattering — no pieces to
        // clean up, and it reads as magic rather than as breakage.
        egg.shell.scale.setScalar(1 + t * 0.7);
        egg.shell.material.uniforms.opacity!.value = 1 - t;
        setGlow(egg.shell.material, t * 0.8);
        if (egg.shadow) egg.shadow.material.uniforms.opacity!.value = 0.4 * (1 - t);
        if (t >= 1) {
          egg.group.removeFromParent();
          egg.shell.material.dispose();
          egg.shadow?.material.dispose();
          this.eggs.splice(i, 1);
        }
        continue;
      }

      // Arrival: overshoot then settle.
      if (egg.age < ARRIVE_TIME) {
        const t = egg.age / ARRIVE_TIME;
        egg.group.scale.setScalar(t * (1 + Math.sin(t * Math.PI) * 0.3));
      } else {
        egg.group.scale.setScalar(1);
      }

      const remaining = egg.hatchAt - egg.age;
      if (!egg.cracked && remaining <= CRACK_LEAD) this.crack(egg);

      if (remaining <= 0) {
        egg.popping = 0;
        this.onHatch?.(egg.variant, egg.x, egg.y);
        continue;
      }

      // Rocking, growing more urgent as the hatch approaches. The sprite pivots
      // on its base, so tilting it reads as the egg tipping on the grass.
      const urgency = 1 - Math.max(0, Math.min(1, remaining / egg.hatchAt));
      const rate = 2.2 + urgency * 7;
      const tilt = (0.02 + urgency * 0.16) * Math.sin(egg.age * rate);
      egg.shell.rotation.z = tilt;
      // A faint glow that builds, so an egg about to go is readable from across
      // the meadow.
      setGlow(egg.shell.material, urgency * 0.16);

      const order = depthOrder(egg.y);
      egg.shell.renderOrder = order + PART_ORDER.body;
      if (egg.shadow) egg.shadow.renderOrder = order + PART_ORDER.shadow;
    }
  }
}
