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

/** The karts a child can pick between. */
export const KARTS = [
  { id: 'kart_stjarna', name: 'Stjärna' },
  { id: 'kart_hjarta', name: 'Hjärta' },
  { id: 'kart_blixt', name: 'Blixt' },
] as const;

/** How big a kart is, nose to tail, in world units. */
const KART_LENGTH = 2.6;

/** Where the driver sits along the kart, as a fraction of its length. */
const SEAT = -0.06;

/** Draw order inside one kart, and how far apart two karts are kept. */
const KART_ORDER = 300000;
const KART_GAP = 20;

/** The kart id for a variant, tolerant of a save from before karts existed. */
export function kartIdFor(variant: UnicornVariant): string {
  const chosen = KARTS[variant.kart ?? 0] ?? KARTS[0];
  return chosen.id;
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

    paint(kartIdFor(variant), variant.maneColour, KART_LENGTH, 0);
    // The driver sits a little back from the middle, in the seat.
    const before = this.sprites.length;
    paint('forare', variant.coat, KART_LENGTH * 0.44, 1);
    const driver = this.sprites[before];
    if (driver) driver.position.y = KART_LENGTH * SEAT;
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
