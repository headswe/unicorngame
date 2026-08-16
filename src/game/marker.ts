/**
 * "This one is yours."
 *
 * Eighteen residents wander the meadow and any of them might be wearing a coat
 * much like your own, so a child can genuinely lose track of which unicorn they
 * are driving — and once a friend is in the field too, telling their pony from
 * a neighbour's is guesswork. A marker floating over the head fixes both, and
 * it has to work for a six-year-old at a glance: a shape, not a label.
 *
 * Your own is gold and unlabelled — the HUD already has your unicorn's name on
 * it. A friend's is blue and carries their name, because that is exactly the
 * question you ask about someone else's pony.
 *
 * The marker is not parented to the unicorn. It follows it instead, because the
 * unicorn's group is mirrored when it turns around and a parented arrow would
 * flip with it — and a name would come out backwards.
 */

import * as THREE from 'three';

import type { AssetLibrary } from '../engine/assets.ts';
import { createSprite, type Sprite } from '../engine/sprite.ts';
import { depthOrder, PART_ORDER, projectY } from '../engine/view.ts';
import type { Unicorn } from './unicorn.ts';

/** Warm gold for the child's own unicorn. */
export const MINE = 0xffc44a;
/** A cool contrast for everybody else's, so the two never read as the same. */
export const THEIRS = 0x8ab6ff;

/**
 * How far above the unicorn's feet the arrow's tip sits, in unicorn heights.
 *
 * Just clear of the mane. Further up and it stops
 * reading as pointing at anything — it becomes a thing floating in the sky near
 * a pony, which is exactly what it must not be.
 */
const HEIGHT = 1.06;

/** Above every pony in the yard, which has no depth of its own to sort by. */
const SIDE_MARKER_ORDER = 500000;

/** How far it bobs, and how fast. Enough to catch the eye, not enough to nag. */
const BOB = 0.07;
const BOB_RATE = 2.1;

/** Renders a name onto a canvas so it can hang under the arrow. */
function nameTexture(name: string): { texture: THREE.Texture; aspect: number } | null {
  if (typeof document === 'undefined') return null;

  const scale = 3;
  const font = `bold ${18 * scale}px "Baloo 2", "Comic Sans MS", system-ui, sans-serif`;

  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) return null;
  measure.font = font;
  const width = Math.ceil(measure.measureText(name).width) + 22 * scale;
  const height = 30 * scale;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // A rounded plaque behind the text, so a pale name stays readable over grass.
  const radius = height / 2;
  ctx.fillStyle = 'rgba(255, 251, 242, 0.92)';
  ctx.strokeStyle = 'rgba(74, 51, 39, 0.85)';
  ctx.lineWidth = 2 * scale;
  ctx.beginPath();
  ctx.roundRect(ctx.lineWidth / 2, ctx.lineWidth / 2, width - ctx.lineWidth, height - ctx.lineWidth, radius);
  ctx.fill();
  ctx.stroke();

  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#4a3327';
  ctx.fillText(name, width / 2, height / 2 + 1 * scale);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return { texture, aspect: width / height };
}

export class Marker {
  readonly group = new THREE.Group();
  private readonly arrow: Sprite | null;
  private label: Sprite | null = null;
  private labelFor = '';
  private clock = 0;

  constructor(
    private readonly assets: AssetLibrary,
    tint: number,
    /** Names are for other people's unicorns; your own is already in the HUD. */
    private readonly named: boolean,
  ) {
    if (this.assets.has('pekare')) {
      const part = this.assets.get('pekare');
      this.arrow = createSprite(part, { height: part.worldHeight, tint });
      this.group.add(this.arrow);
    } else {
      this.arrow = null;
    }
  }

  private setName(name: string): void {
    if (name === this.labelFor) return;
    this.labelFor = name;

    this.label?.removeFromParent();
    this.label?.material.dispose();
    this.label = null;

    const made = nameTexture(name);
    if (!made) return;

    const height = 0.3;
    const part = {
      id: '__name',
      kind: 'decor' as const,
      label: name,
      url: '',
      width: 1,
      height: 1,
      aspect: made.aspect,
      worldHeight: height,
      tintable: false,
      texture: made.texture,
    };
    this.label = createSprite(part, { height });
    // Sits above the arrow, so the arrow keeps pointing at the unicorn.
    this.label.position.y = 0.46;
    this.group.add(this.label);
  }

  /** Places the marker over a unicorn for this frame. */
  follow(unicorn: Unicorn, dt: number): void {
    this.clock += dt;
    if (this.named) this.setName(unicorn.variant.name);

    // In the yard the unicorn's y is height off the ground, not depth into the
    // field, so it is neither squashed nor sorted by.
    const side = unicorn.view === 'side';
    const bob = Math.sin(this.clock * BOB_RATE) * BOB;
    this.group.position.set(
      unicorn.x,
      (side ? unicorn.y : projectY(unicorn.y)) + unicorn.height * HEIGHT + bob,
      0,
    );

    // Above everything else standing at this depth, so it is never lost behind
    // a bush or another pony's mane.
    const order = (side ? SIDE_MARKER_ORDER : depthOrder(unicorn.y)) + PART_ORDER.bubble;
    if (this.arrow) this.arrow.renderOrder = order;
    if (this.label) this.label.renderOrder = order + 1;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.arrow?.material.dispose();
    this.label?.material.dispose();
  }
}
