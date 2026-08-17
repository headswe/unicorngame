/**
 * One go-kart, seen from above.
 *
 * A kart is two sprites in a group that turns: the bodywork, painted in its
 * driver's mane colour because that is usually the brighter of their two and
 * makes a kart easy to pick out at speed, and the little unicorn sitting in it,
 * painted in their coat. Nobody chooses any of that — a child arrives in the
 * racing dimension already recognisable, wearing whatever they are wearing in
 * the meadow.
 *
 * The sprites are drawn nose-up, so heading zero points up the screen and one
 * rotation is all the steering ever needs.
 */

import * as THREE from 'three';

import type { AssetLibrary } from '../engine/assets.ts';
import { createSprite, type Sprite } from '../engine/sprite.ts';
import { RAINBOW } from './palette.ts';
import type { UnicornVariant } from './variant.ts';

/**
 * The karts a child can pick between, and how each one is drawn.
 *
 * `length` is nose to tail in world units, and the three are not the same
 * because the drawings are not. Every sprite comes back from the generator
 * trimmed and scaled to one height, so drawing them all the same length made
 * the long narrow speeder cover well under half the screen the squat buggy
 * did — which reads as one kart simply being smaller than the others rather
 * than a different shape. These lengths give all three the same amount of
 * paint; `node scripts/kart-sizes.mjs` measures them.
 *
 * `seat` is where the driver goes, as a fraction of the kart's length up from
 * its middle, because the seat is drawn in a different place in each one.
 */
export const KARTS = [
  { id: 'kart_stjarna', name: 'Stjärna', length: 2.6, seat: 0.0 },
  { id: 'kart_hjarta', name: 'Hjärta', length: 2.31, seat: -0.02 },
  { id: 'kart_blixt', name: 'Blixt', length: 3.04, seat: -0.13 },
] as const;

/**
 * How big the driver is drawn, whichever kart they are in.
 *
 * Fixed rather than a fraction of the kart: it is the same unicorn in all
 * three, and a child who picked the long one should not find themselves
 * bigger for it.
 */
const DRIVER_HEIGHT = 1.15;

/** Draw order inside one kart, and how far apart two karts are kept. */
const KART_ORDER = 300000;
const KART_GAP = 20;

/** Which kart a variant drives, tolerant of a save from before karts existed. */
export function kartFor(variant: UnicornVariant): (typeof KARTS)[number] {
  return KARTS[variant.kart ?? 0] ?? KARTS[0]!;
}

export class Kart {
  readonly group = new THREE.Group();

  /** Where it is and which way it is pointing. Heading 0 points up the track. */
  x = 0;
  y = 0;
  heading = 0;

  private readonly sprites: Sprite[] = [];

  constructor(
    readonly variant: UnicornVariant,
    assets: AssetLibrary,
    /** Which kart is in front of which. There is no depth here to sort by. */
    layer = 0,
  ) {
    const paint = (id: string, colour: number, height: number, order: number): void => {
      if (!assets.has(id)) return;
      const part = assets.get(id);
      const sprite = createSprite(part, {
        height,
        pivotY: 0.5,
        rainbow: colour === RAINBOW,
        tint: colour === RAINBOW ? 0xffffff : colour,
      });
      sprite.renderOrder = KART_ORDER + layer * KART_GAP + order;
      this.group.add(sprite);
      this.sprites.push(sprite);
    };

    const chosen = kartFor(variant);
    paint(chosen.id, variant.maneColour, chosen.length, 0);

    const before = this.sprites.length;
    paint('forare', variant.coat, DRIVER_HEIGHT, 1);
    const driver = this.sprites[before];
    if (driver) driver.position.y = chosen.length * chosen.seat;
  }

  /** Puts the kart where it is and turns it to face where it is going. */
  place(): void {
    this.group.position.set(this.x, this.y, 0);
    // Heading is measured the usual way — anticlockwise from east — while the
    // sprites are drawn nose-up, so a quarter turn lines the two up.
    this.group.rotation.z = this.heading - Math.PI / 2;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const sprite of this.sprites) sprite.material.dispose();
    this.sprites.length = 0;
  }
}
