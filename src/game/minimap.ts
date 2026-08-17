/**
 * A little map of the meadow, with everybody on it.
 *
 * The field is a good deal bigger than the screen, so a child who wanders off
 * to the letter table has no way of knowing whether their cousin is two steps
 * behind them or right over by the portal. This answers that in one glance.
 *
 * The landmarks are drawn as themselves — the actual gate, easel, portal and
 * table sprites, shrunk — rather than as coloured blobs with a legend to learn.
 * At this size they are barely more than shapes, but they are the right shapes,
 * and a six-year-old who has stood next to the easel recognises it.
 *
 * Meadow only. The bouncing yard is one screen wide and the racing dimension
 * has a lap board, so neither has anything a map could tell them.
 */

import type { AssetLibrary } from '../engine/assets.ts';
import { WORLD_BOUNDS } from '../../server/herd.js';
import { EASEL_SPOT, GATE_SPOT, PORTAL_SPOT, TABLE_SPOT } from './world.ts';
import { MINE, THEIRS } from './marker.ts';
import { RAINBOW } from './palette.ts';

/** Ten a second, which is exactly how often the other children report in. */
const REDRAW_HZ = 10;

/** Never more than this, whatever the tablet claims — it is a small picture. */
const MAX_PIXEL_RATIO = 2;

interface Landmark {
  id: string;
  x: number;
  y: number;
  /** Drawn height in map pixels, before the pixel ratio. */
  height: number;
}

const LANDMARKS: Landmark[] = [
  { id: 'grind', x: GATE_SPOT.x, y: GATE_SPOT.y, height: 19 },
  { id: 'portal', x: PORTAL_SPOT.x, y: PORTAL_SPOT.y, height: 19 },
  { id: 'stafflig', x: EASEL_SPOT.x, y: EASEL_SPOT.y, height: 18 },
  { id: 'bokstavsbord', x: TABLE_SPOT.x, y: TABLE_SPOT.y, height: 16 },
];

export interface MapPony {
  x: number;
  y: number;
  /** Coat colour, so a child can find their own by the colour they picked. */
  colour: number;
  mine: boolean;
}

export class Minimap {
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly images = new Map<string, CanvasImageSource>();
  private wide = 0;
  private high = 0;
  private since = 0;

  constructor(parent: HTMLElement, assets: AssetLibrary) {
    this.root = document.createElement('div');
    this.root.className = 'minimap';
    this.root.hidden = true;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'minimap-canvas';
    // Decorative: everything it says is also said by the meadow itself.
    this.root.setAttribute('aria-hidden', 'true');
    this.root.appendChild(this.canvas);
    parent.appendChild(this.root);
    this.ctx = this.canvas.getContext('2d');

    // The sprites are already decoded — the game is drawing them — so this only
    // borrows the image the texture was built from.
    for (const mark of LANDMARKS) {
      if (!assets.has(mark.id)) continue;
      const image = assets.get(mark.id).texture.image as CanvasImageSource | undefined;
      if (image) this.images.set(mark.id, image);
    }
  }

  setShown(shown: boolean): void {
    if (this.root.hidden === !shown) return;
    this.root.hidden = !shown;
    // Already due, so it comes back with the right thing on it rather than a
    // frame of wherever everybody was when it was last hidden.
    this.since = 1 / REDRAW_HZ;
  }

  /**
   * @param dt      Seconds since the last frame, for the redraw throttle.
   * @param ponies  Everyone in the meadow, this child included.
   */
  update(dt: number, ponies: MapPony[]): void {
    if (this.root.hidden) return;
    this.since += dt;
    if (this.since < 1 / REDRAW_HZ) return;
    this.since = 0;
    this.paint(ponies);
  }

  private paint(ponies: MapPony[]): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const box = this.canvas.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    const wide = Math.round(box.width * ratio);
    const high = Math.round(box.height * ratio);
    // Only when it has actually changed: assigning to width clears the canvas,
    // and reading a size back into the size that produced it is how a canvas
    // ends up growing a little every frame.
    if (wide !== this.wide || high !== this.high) {
      this.canvas.width = wide;
      this.canvas.height = high;
      this.wide = wide;
      this.high = high;
    }

    const spanX = WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX;
    const spanY = WORLD_BOUNDS.maxY - WORLD_BOUNDS.minY;
    const inset = 3 * ratio;
    const toX = (x: number): number =>
      inset + ((x - WORLD_BOUNDS.minX) / spanX) * (wide - inset * 2);
    // North is up the field and up the map, so y is flipped on the way in.
    const toY = (y: number): number =>
      inset + ((WORLD_BOUNDS.maxY - y) / spanY) * (high - inset * 2);

    ctx.clearRect(0, 0, wide, high);

    for (const mark of LANDMARKS) {
      const image = this.images.get(mark.id);
      if (!image) continue;
      const source = image as { width?: number; height?: number };
      const aspect = (source.width ?? 1) / (source.height ?? 1);
      const h = mark.height * ratio;
      const w = h * aspect;
      // Standing on their spot rather than centred on it, the way they are
      // drawn in the meadow.
      ctx.drawImage(image, toX(mark.x) - w / 2, toY(mark.y) - h, w, h);
    }

    for (const pony of ponies) {
      if (pony.mine) continue;
      this.dot(ctx, toX(pony.x), toY(pony.y), 4.4 * ratio, pony.colour, ratio, false);
    }
    // Yours last, so it is never the one hidden underneath.
    for (const pony of ponies) {
      if (pony.mine) this.dot(ctx, toX(pony.x), toY(pony.y), 5.8 * ratio, pony.colour, ratio, true);
    }
  }

  private dot(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    colour: number,
    ratio: number,
    mine: boolean,
  ): void {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    if (colour === RAINBOW) {
      // The rainbow coat has no one colour, so its dot does not either.
      const bow = ctx.createLinearGradient(x - radius, y - radius, x + radius, y + radius);
      const stops = ['#ff8f8f', '#ffd166', '#8fe08f', '#7fc7ff', '#c9a3ff'];
      stops.forEach((stop, i) => bow.addColorStop(i / (stops.length - 1), stop));
      ctx.fillStyle = bow;
    } else {
      ctx.fillStyle = `#${colour.toString(16).padStart(6, '0')}`;
    }
    ctx.fill();
    // The ring says who, the middle says which one: gold for you and blue for
    // everybody else, the same two colours as the arrows floating over their
    // heads out in the field. Without it a child whose cousin also picked the
    // cream coat has two identical dots and no way to tell which is theirs.
    const ring = mine ? MINE : THEIRS;
    ctx.lineWidth = (mine ? 3 : 2.4) * ratio;
    ctx.strokeStyle = `#${ring.toString(16).padStart(6, '0')}`;
    ctx.stroke();
    ctx.lineWidth = 1.4 * ratio;
    ctx.strokeStyle = '#4a3327';
    ctx.stroke();
  }
}
