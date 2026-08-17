/**
 * The racing dimension, through the portal.
 *
 * The third way of drawing this game, and the only one seen from straight
 * above: x is east, y is north, neither is squashed, and things turn. That is
 * why the karts and their drivers are their own sprites rather than the
 * side-on unicorns — from up here a pony in profile would be lying down.
 *
 * The road is not a picture. It is drawn by stroking the shared centre line
 * onto a canvas, which is the same line the relay counts laps along, so what a
 * child can see and what the referee believes in are the same circuit.
 *
 * Driving is each child's own, the way bouncing is: a kart is far too immediate
 * for anybody else's connection to have a say in it. What the relay decides is
 * only what has to be agreed — when a race starts, who has done how many laps,
 * and who won.
 */

import * as THREE from 'three';

import type { AssetLibrary } from '../engine/assets.ts';
import { makeRng } from '../engine/rng.ts';
import { createSprite, type Sprite } from '../engine/sprite.ts';
import { LAYER_ORDER } from '../engine/view.ts';
import { Kart } from './kart.ts';
import { CENTRE, ROAD_WIDTH, TRACK_BOUNDS, gridSlot, locate } from '../../server/track.js';
import type { UnicornVariant } from './variant.ts';

/**
 * How fast a kart goes flat out, on the road and off it.
 *
 * Off the road is a third slower rather than a third as fast. Running wide has
 * to cost something or the corners mean nothing, but for a six-year-old it has
 * to cost a moment and not the race.
 */
const TOP_SPEED = { road: 22, grass: 13 };

/** How briskly it gets there, and how quickly it slows when it should not be. */
const ACCELERATE = 26;
const BRAKE = 34;

/**
 * How fast the kart turns, and how much of that it keeps at a crawl.
 *
 * Flat out, a kart turns inside a circle of about `TOP_SPEED / TURN_RATE`
 * units. At the first tuning that came to seven units against a track whose
 * tightest corner is barely wider, which meant the circuit could only be driven
 * flat out by somebody who already knew it — an autopilot aiming straight at
 * the racing line spent over half the lap in the grass. Turning harder brings
 * that circle inside every corner on the track, so the road can be followed at
 * full speed by a child who is simply steering towards where they want to go.
 */
const TURN_RATE = 4.2;
const TURN_AT_REST = 0.25;

/**
 * How quickly the kart stops sliding and starts going where it points.
 *
 * The whole feel of a small kart is here. High and it is on rails and dull;
 * low and it is a hovercraft. This is enough that a hard corner washes out
 * into a slide a child can see, and recovers before they have to think.
 */
const GRIP = 6.5;

/**
 * How much of the world is on screen at once, in world units of height.
 *
 * A balance between two things a child needs: a kart big enough to see what it
 * is doing, and enough road ahead to see the corner coming. About three and a
 * half road widths, which leaves the next bend on screen at full speed.
 */
export const TRACK_VIEW_HEIGHT = 26;

/** How far the scenery is kept back from the road. */
const VERGE = ROAD_WIDTH / 2 + 2.4;

/**
 * Where the way home stands.
 *
 * Well off the racing line and well behind the grid, on purpose. Near enough
 * to walk into deliberately while waiting for the next race; far enough that a
 * kart sliding wide out of the first corner cannot fall through it and find
 * itself back in the meadow halfway through a race.
 */
export const TRACK_PORTAL = (() => {
  const grid = gridSlot(0);
  const aside = grid.heading - Math.PI / 2;
  return {
    x: grid.x - Math.cos(grid.heading) * 5 + Math.cos(aside) * 9,
    y: grid.y - Math.sin(grid.heading) * 5 + Math.sin(aside) * 9,
  };
})();

export interface TrackInput {
  /** -1, 0 or 1. */
  steer: number;
  /** Whether the kart is allowed to move at all — false before the flag. */
  rolling: boolean;
}

export class RaceTrack {
  readonly scene = new THREE.Scene();

  /** This child's kart, once they have come through the portal. */
  private mine: Kart | null = null;
  private speed = 0;
  /** Which way it is actually travelling, which is not always where it points. */
  private driftX = 0;
  private driftY = 0;

  /** Everyone else's karts, by peer id. */
  private readonly others = new Map<string, { kart: Kart; variantKey: string }>();
  private readonly sprites: Sprite[] = [];

  constructor(private readonly assets: AssetLibrary) {
    this.build();
  }

  /** True when the parts this needs are on disk. */
  get available(): boolean {
    return this.assets.has('kart_stjarna') && this.assets.has('forare');
  }

  get kart(): Kart | null {
    return this.mine;
  }

  /** How fast this child is going, 0..1 of flat out, for the engine note. */
  get pace(): number {
    return Math.min(1, Math.abs(this.speed) / TOP_SPEED.road);
  }

  private build(): void {
    // Grass, then the road painted on top of it as one canvas the size of the
    // world. One texture and one quad for the whole circuit.
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(
        TRACK_BOUNDS.maxX - TRACK_BOUNDS.minX + 40,
        TRACK_BOUNDS.maxY - TRACK_BOUNDS.minY + 40,
      ),
      new THREE.MeshBasicMaterial({ color: 0x7fb86e }),
    );
    grass.position.set(
      (TRACK_BOUNDS.minX + TRACK_BOUNDS.maxX) / 2,
      (TRACK_BOUNDS.minY + TRACK_BOUNDS.maxY) / 2,
      0,
    );
    grass.renderOrder = LAYER_ORDER.ground;
    this.scene.add(grass);

    const road = this.paintRoad();
    if (road) this.scene.add(road);
    this.scatter();

    // The way home, standing on the grass behind the grid.
    if (this.assets.has('portal')) {
      const part = this.assets.get('portal');
      const portal = createSprite(part, { height: 5, pivotY: 0.5 });
      portal.position.set(TRACK_PORTAL.x, TRACK_PORTAL.y, 0);
      portal.renderOrder = LAYER_ORDER.groundDecal + 5;
      this.scene.add(portal);
      this.sprites.push(portal);
    }
  }

  /** Strokes the centre line into a canvas and lays it over the grass. */
  private paintRoad(): THREE.Mesh | null {
    const pad = 20;
    const worldWidth = TRACK_BOUNDS.maxX - TRACK_BOUNDS.minX + pad * 2;
    const worldHeight = TRACK_BOUNDS.maxY - TRACK_BOUNDS.minY + pad * 2;
    // Enough pixels that a kerb is a few of them, and no more.
    const scale = 12;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(worldWidth * scale);
    canvas.height = Math.round(worldHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const toCanvas = (x: number, y: number): [number, number] => [
      (x - (TRACK_BOUNDS.minX - pad)) * scale,
      // Canvas y runs down the image and the world's runs up it.
      canvas.height - (y - (TRACK_BOUNDS.minY - pad)) * scale,
    ];

    const trace = (): void => {
      ctx.beginPath();
      for (const [i, point] of CENTRE.entries()) {
        const [cx, cy] = toCanvas(point.x, point.y);
        if (i === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      }
      ctx.closePath();
    };

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // A soft verge, then a kerb, then the tarmac itself.
    for (const [width, colour] of [
      [ROAD_WIDTH + 2.4, '#9ccd83'],
      [ROAD_WIDTH + 0.9, '#e8e2d2'],
      [ROAD_WIDTH, '#8d8b93'],
    ] as const) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = width * scale;
      trace();
      ctx.stroke();
    }

    // A dashed line down the middle, which is most of what tells a child at a
    // glance that this grey band is a road.
    ctx.strokeStyle = 'rgba(255, 253, 245, 0.55)';
    ctx.lineWidth = 0.28 * scale;
    ctx.setLineDash([2.4 * scale, 3 * scale]);
    trace();
    ctx.stroke();
    ctx.setLineDash([]);

    this.paintStartLine(ctx, toCanvas, scale);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.LinearSRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(worldWidth, worldHeight),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true }),
    );
    mesh.position.set(
      (TRACK_BOUNDS.minX + TRACK_BOUNDS.maxX) / 2,
      (TRACK_BOUNDS.minY + TRACK_BOUNDS.maxY) / 2,
      0,
    );
    mesh.renderOrder = LAYER_ORDER.groundDecal;
    return mesh;
  }

  /** Chequered paint across the road at the start of the lap. */
  private paintStartLine(
    ctx: CanvasRenderingContext2D,
    toCanvas: (x: number, y: number) => [number, number],
    scale: number,
  ): void {
    const start = CENTRE[0];
    const next = CENTRE[3];
    if (!start || !next) return;
    const heading = Math.atan2(next.y - start.y, next.x - start.x);
    const across = heading + Math.PI / 2;

    const squares = 8;
    const step = ROAD_WIDTH / squares;
    for (let i = 0; i < squares; i++) {
      const offset = -ROAD_WIDTH / 2 + step * (i + 0.5);
      const cx = start.x + Math.cos(across) * offset;
      const cy = start.y + Math.sin(across) * offset;
      for (const row of [-0.5, 0.5]) {
        const px = cx + Math.cos(heading) * row * step;
        const py = cy + Math.sin(heading) * row * step;
        const [ax, ay] = toCanvas(px, py);
        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(-heading);
        ctx.fillStyle = (i + (row > 0 ? 1 : 0)) % 2 === 0 ? '#fffdf5' : '#3b2b22';
        ctx.fillRect((-step / 2) * scale, (-step / 2) * scale, step * scale, step * scale);
        ctx.restore();
      }
    }
  }

  /** Trees and bushes around the circuit, well clear of the road. */
  private scatter(): void {
    const rng = makeRng('kartbana');
    const kinds = ['trad_stort', 'buske_rund', 'buske_bar', 'blommor_rosa', 'flugsvamp']
      .filter((id) => this.assets.has(id));
    if (!kinds.length) return;

    for (let i = 0; i < 150; i++) {
      const x = rng.range(TRACK_BOUNDS.minX, TRACK_BOUNDS.maxX);
      const y = rng.range(TRACK_BOUNDS.minY, TRACK_BOUNDS.maxY);
      if (locate(x, y).off < VERGE) continue;

      const id = rng.pick(kinds);
      const part = this.assets.get(id);
      // Big things beside a tiny kart: the scale is half the joke.
      const height = id === 'trad_stort' ? rng.range(5, 7.5) : rng.range(1.2, 2.6);
      const sprite = createSprite(part, { height, pivotY: 0.5 });
      sprite.position.set(x, y, 0);
      sprite.renderOrder = LAYER_ORDER.groundDecal + 10 + i;
      this.scene.add(sprite);
      this.sprites.push(sprite);
    }
  }

  /** Puts this child on the grid. Called every time a race is about to start. */
  lineUp(variant: UnicornVariant, at: { x: number; y: number; heading: number }): void {
    if (!this.mine || this.mine.variant !== variant) {
      this.mine?.dispose();
      this.mine = new Kart(variant, this.assets, 0);
      this.scene.add(this.mine.group);
    }
    this.mine.x = at.x;
    this.mine.y = at.y;
    this.mine.heading = at.heading;
    this.mine.place();
    this.speed = 0;
    this.driftX = 0;
    this.driftY = 0;
  }

  /** Takes the kart away, on leaving through the portal. */
  clear(): void {
    this.mine?.dispose();
    this.mine = null;
    for (const other of this.others.values()) other.kart.dispose();
    this.others.clear();
  }

  /** Somebody else's kart, wherever they have got to. */
  show(id: string, variant: UnicornVariant, x: number, y: number, heading: number): void {
    const key = JSON.stringify(variant);
    let entry = this.others.get(id);
    if (entry && entry.variantKey !== key) {
      entry.kart.dispose();
      entry = undefined;
    }
    if (!entry) {
      const kart = new Kart(variant, this.assets, this.others.size + 1);
      this.scene.add(kart.group);
      entry = { kart, variantKey: key };
      this.others.set(id, entry);
    }
    // Eased rather than snapped: poses arrive ten times a second and a kart
    // covers two units between them.
    const kart = entry.kart;
    const jumped = Math.hypot(x - kart.x, y - kart.y) > 12;
    const ease = jumped ? 1 : 0.35;
    kart.x += (x - kart.x) * ease;
    kart.y += (y - kart.y) * ease;
    kart.heading += angleTo(kart.heading, heading) * (jumped ? 1 : 0.4);
    kart.place();
  }

  /** Somebody has gone home, or been quiet long enough to count as gone. */
  hide(id: string): void {
    const entry = this.others.get(id);
    if (!entry) return;
    entry.kart.dispose();
    this.others.delete(id);
  }

  /** Everyone the track is currently drawing, so the caller can prune them. */
  get drivers(): string[] {
    return [...this.others.keys()];
  }

  update(dt: number, input: TrackInput): void {
    const kart = this.mine;
    if (!kart) return;

    const where = locate(kart.x, kart.y);
    const road = where.off <= ROAD_WIDTH / 2;
    const top = road ? TOP_SPEED.road : TOP_SPEED.grass;

    // No throttle to hold: a kart drives itself and a child only steers. Off
    // the road it is slower rather than stopped — a mistake costs a moment,
    // never the race.
    if (!input.rolling) this.speed = approach(this.speed, 0, BRAKE * 2, dt);
    else if (this.speed > top) this.speed = approach(this.speed, top, BRAKE, dt);
    else this.speed = approach(this.speed, top, ACCELERATE, dt);

    // Turning is weaker when barely moving, so a stationary kart cannot spin on
    // the spot — but not zero, or lining up on the grid would be impossible.
    const bite = TURN_AT_REST + (1 - TURN_AT_REST) * Math.min(1, Math.abs(this.speed) / 6);
    kart.heading -= input.steer * TURN_RATE * bite * dt;

    // Where it points and where it is going are two different things, and the
    // gap between them is the slide.
    const wantX = Math.cos(kart.heading) * this.speed;
    const wantY = Math.sin(kart.heading) * this.speed;
    const grip = 1 - Math.exp(-dt * GRIP);
    this.driftX += (wantX - this.driftX) * grip;
    this.driftY += (wantY - this.driftY) * grip;

    kart.x += this.driftX * dt;
    kart.y += this.driftY * dt;

    // The world has edges even out here; nothing beyond them is drawn.
    kart.x = clamp(kart.x, TRACK_BOUNDS.minX, TRACK_BOUNDS.maxX);
    kart.y = clamp(kart.y, TRACK_BOUNDS.minY, TRACK_BOUNDS.maxY);
    kart.place();
  }

  /**
   * Where the camera should look, held inside the world.
   *
   * On this child's own kart when they have one. When they have not — they
   * walked in on a race and are watching it — it follows whoever is winning,
   * because a spectator staring at the middle of an empty field is not
   * spectating, and watching is half of what the portal is for.
   */
  cameraTarget(
    halfWidth: number,
    halfHeight: number,
    follow?: string,
  ): { x: number; y: number } {
    const kart = this.mine ?? (follow ? this.others.get(follow)?.kart : undefined) ?? null;
    const midX = (TRACK_BOUNDS.minX + TRACK_BOUNDS.maxX) / 2;
    const midY = (TRACK_BOUNDS.minY + TRACK_BOUNDS.maxY) / 2;
    // Nobody to watch at all — an empty track between races. The start line is
    // where the next thing happens, and it is a good deal more interesting to
    // arrive at than the middle of the infield.
    if (!kart) return { x: CENTRE[0]?.x ?? midX, y: CENTRE[0]?.y ?? midY };

    const spanX = (TRACK_BOUNDS.maxX - TRACK_BOUNDS.minX) / 2;
    const spanY = (TRACK_BOUNDS.maxY - TRACK_BOUNDS.minY) / 2;
    return {
      x: halfWidth >= spanX ? midX : clamp(kart.x, midX - spanX + halfWidth, midX + spanX - halfWidth),
      y: halfHeight >= spanY ? midY : clamp(kart.y, midY - spanY + halfHeight, midY + spanY - halfHeight),
    };
  }

  dispose(): void {
    this.clear();
    for (const sprite of this.sprites) sprite.material.dispose();
    this.sprites.length = 0;
  }
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Approaches a value at a fixed rate rather than a fixed fraction. */
function approach(from: number, to: number, rate: number, dt: number): number {
  const step = rate * dt;
  return Math.abs(to - from) <= step ? to : from + Math.sign(to - from) * step;
}

/** The short way round from one heading to another. */
function angleTo(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
