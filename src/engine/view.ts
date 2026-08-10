/**
 * How the meadow is projected onto the screen.
 *
 * The world is a flat field with x running east and y running away from the
 * viewer. Characters are drawn in side view, storybook style, so "away" is
 * squashed: walking north moves you up the screen more slowly than walking east
 * moves you sideways. That single trick is what makes a stack of flat sprites
 * read as a field you can wander around in.
 *
 * Depth sorting is done entirely with renderOrder rather than the depth buffer,
 * because every sprite is transparent and cut out. Anything further north is
 * drawn first, and parts within one character are separated by a small index.
 */

import * as THREE from 'three';

/** Vertical squash applied to the y axis when projecting to the screen. */
export const DEPTH_SQUASH = 0.52;

/** renderOrder steps per world unit of depth. */
const ORDER_PER_UNIT = 100;

/** Northern edge used as the origin for render order, so orders stay positive. */
const ORDER_ORIGIN = 1000;

export const LAYER_ORDER = {
  sky: -100000,
  hills: -90000,
  clouds: -80000,
  ground: -70000,
  groundDecal: -60000,
  foreground: 900000,
  ui: 1000000,
} as const;

/** Sub-order for the pieces that make up one character, back to front. */
export const PART_ORDER = {
  shadow: 0,
  tail: 1,
  bodyBack: 2,
  body: 3,
  pattern: 4,
  mane: 5,
  horn: 6,
  accessory: 7,
  bubble: 9,
} as const;

/** Screen-space y for a point at world depth y, lifted by `lift` units. */
export function projectY(worldY: number, lift = 0): number {
  return worldY * DEPTH_SQUASH + lift;
}

/** Painter's order for something standing at world depth y. */
export function depthOrder(worldY: number, part = 0): number {
  return Math.round((ORDER_ORIGIN - worldY) * ORDER_PER_UNIT) + part;
}

/** Places an object on the ground at (x, y), optionally hopping `lift` above it. */
export function placeOnGround(object: THREE.Object3D, x: number, y: number, lift = 0): void {
  object.position.set(x, projectY(y, lift), 0);
}

export interface ViewportSize {
  width: number;
  height: number;
}

/**
 * An orthographic camera that always shows the same height of meadow, however
 * wide or narrow the window is. On a phone in portrait you see less to the
 * sides, never less vertically.
 */
export class MeadowCamera {
  readonly camera: THREE.OrthographicCamera;

  /** Half-height of the visible area in screen-space world units. */
  private halfHeight: number;

  constructor(viewHeight = 11) {
    this.halfHeight = viewHeight / 2;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
    this.camera.position.z = 100;
  }

  get viewHeight(): number {
    return this.halfHeight * 2;
  }

  set viewHeight(value: number) {
    this.halfHeight = value / 2;
  }

  /** Visible half-extents in screen-space units. */
  extents(size: ViewportSize): { halfWidth: number; halfHeight: number } {
    const aspect = size.width / Math.max(1, size.height);
    return { halfWidth: this.halfHeight * aspect, halfHeight: this.halfHeight };
  }

  resize(size: ViewportSize): void {
    const { halfWidth, halfHeight } = this.extents(size);
    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
  }

  /** Centres the view on a screen-space point. */
  lookAtScreenPoint(x: number, y: number): void {
    this.camera.position.x = x;
    this.camera.position.y = y;
  }

  /** Turns a pointer position in NDC into a point on the meadow floor. */
  screenToWorld(ndcX: number, ndcY: number, size: ViewportSize): { x: number; y: number } {
    const { halfWidth, halfHeight } = this.extents(size);
    const sceneX = this.camera.position.x + ndcX * halfWidth;
    const sceneY = this.camera.position.y + ndcY * halfHeight;
    return { x: sceneX, y: sceneY / DEPTH_SQUASH };
  }
}
