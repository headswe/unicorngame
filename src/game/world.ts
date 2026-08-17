/**
 * The meadow itself: the floor, what grows on it, and who lives there.
 *
 * Scenery is scattered from a seed rather than hand-placed, so the field is
 * large and varied without a level editor, and it comes back identical every
 * time. Trees and bushes are pushed out of a clearing around the spawn point so
 * the player never wakes up inside a shrub.
 */

import * as THREE from 'three';

import type { AssetLibrary, Part } from '../engine/assets.ts';
import { makeRng, type Rng } from '../engine/rng.ts';
import { createSprite, type Sprite } from '../engine/sprite.ts';
import { depthOrder, PART_ORDER, projectY } from '../engine/view.ts';
import { Backdrop } from './backdrop.ts';
import { BOARD_FACE, type Board } from './board.ts';
import { BLOOM_TIME, clutchSize, eggId } from '../../server/clutch.js';
import { EggNest, HATCH_TIME } from './eggs.ts';
import { MagicFlowers } from './flower.ts';
import { createGround } from './ground.ts';
import { WORLD_BOUNDS } from '../../server/herd.js';
import { HerdView } from './herd-view.ts';
import { clamp } from './player.ts';
import { shadowTexture } from './shadow.ts';
import { PoopField } from './poop.ts';
import { TreatField } from './treats.ts';
import { Unicorn } from './unicorn.ts';
import {
  foalVariant,
  randomSeed,
  siblingVariant,
  type UnicornVariant,
} from './variant.ts';

/**
 * Where the unicorns are allowed to walk.
 *
 * Re-exported from the simulation rather than declared here, so the relay and
 * the browser cannot come to disagree about the size of the field.
 */
export { WORLD_BOUNDS };

/**
 * Where the grass stops and the hills begin. Kept a few units beyond the
 * playable edge so the meadow always runs on past the last unicorn instead of
 * ending under its hooves — you can see the horizon, you just cannot reach it.
 */
export const HORIZON_Y = 40;

/** Nothing large is planted within this radius of where the player starts. */
const CLEARING_RADIUS = 6;

export const SPAWN = { x: 0, y: 8 };

/** Where the shovel is lying when the game starts — in plain sight of spawn. */
export const SHOVEL_SPOT = { x: 4.2, y: 9.5 };

/**
 * The letter table, where the spelling game lives. Far enough from spawn to be
 * something you walk over and discover, close enough that you cannot miss it on
 * the first stroll north.
 */
export const TABLE_SPOT = { x: -9.5, y: 14.5 };

/** Nothing large is planted within this radius of the letter table either. */
const TABLE_CLEARING = 4;

/**
 * And a wider one around the easel, because the easel is a thing you look *at*
 * from across the field. A tree four units south of it is still tall enough to
 * stand in front of the drawing, which defeats the point of hanging it there.
 */
const EASEL_CLEARING = 7;

/**
 * The gate through to the bouncing yard.
 *
 * On the other side of spawn from the letter table, so a child wandering out of
 * the clearing finds one of the two whichever way they turn, and neither is the
 * thing you trip over first.
 */
export const GATE_SPOT = { x: 8.5, y: 15.5 };

/**
 * The easel everybody draws on.
 *
 * South-east, which is the one quarter nothing else is in: the letter table is
 * north-west and the gate north-east, so a child leaving the clearing finds a
 * different thing whichever way they wander, and no two of them are close
 * enough to hint over each other.
 */
export const EASEL_SPOT = { x: 6.5, y: 4 };

interface ScatterSpec {
  id: string;
  count: number;
  /** Height range in world units. */
  min: number;
  max: number;
  /** Whether this thing is big enough to deserve a shadow. */
  shadow: boolean;
  /** Keep this far away from the spawn clearing. */
  avoidsClearing: boolean;
}

const SCATTER: ScatterSpec[] = [
  { id: 'trad_stort', count: 14, min: 3.4, max: 5, shadow: true, avoidsClearing: true },
  { id: 'buske_rund', count: 26, min: 0.9, max: 1.5, shadow: true, avoidsClearing: true },
  { id: 'buske_bar', count: 18, min: 0.8, max: 1.2, shadow: true, avoidsClearing: true },
  { id: 'sten_gra', count: 20, min: 0.4, max: 0.8, shadow: true, avoidsClearing: false },
  { id: 'blommor_vita', count: 55, min: 0.35, max: 0.6, shadow: false, avoidsClearing: false },
  { id: 'blommor_rosa', count: 45, min: 0.35, max: 0.6, shadow: false, avoidsClearing: false },
  { id: 'tuva_gras', count: 90, min: 0.28, max: 0.5, shadow: false, avoidsClearing: false },
  { id: 'hoball', count: 5, min: 0.9, max: 1.1, shadow: true, avoidsClearing: true },
  { id: 'vattenho', count: 4, min: 0.65, max: 0.8, shadow: true, avoidsClearing: true },
  { id: 'apelkorg', count: 4, min: 0.5, max: 0.6, shadow: true, avoidsClearing: true },
  { id: 'solros', count: 12, min: 1.6, max: 2.2, shadow: true, avoidsClearing: true },
  { id: 'stubbe', count: 8, min: 0.6, max: 0.85, shadow: true, avoidsClearing: true },
  { id: 'bikupa', count: 4, min: 0.85, max: 1.05, shadow: true, avoidsClearing: true },
  { id: 'brunn', count: 2, min: 1.6, max: 1.85, shadow: true, avoidsClearing: true },
  { id: 'flugsvamp', count: 22, min: 0.4, max: 0.65, shadow: true, avoidsClearing: false },
  { id: 'fagelbo', count: 5, min: 0.4, max: 0.5, shadow: true, avoidsClearing: false },
  { id: 'fjaril', count: 14, min: 0.3, max: 0.45, shadow: false, avoidsClearing: false },
  { id: 'nyckelpiga', count: 12, min: 0.22, max: 0.32, shadow: false, avoidsClearing: false },
];

/** A clutch that has been decided but is still shut inside its bud. */
interface PendingClutch {
  seed: string;
  atX: number;
  atY: number;
  foal: UnicornVariant;
  count: number;
  /** When each egg opens, in seconds after the spell was cast. */
  hatchTimes: number[];
  /** How far into that timeline the meadow already was, at least BLOOM_TIME. */
  spent: number;
}

export class World {
  readonly scene = new THREE.Scene();
  readonly backdrop: Backdrop;
  readonly player: Unicorn;
  readonly herd: HerdView;
  readonly poop: PoopField;
  readonly treats: TreatField;
  readonly eggs: EggNest;
  readonly flowers: MagicFlowers;
  /** Flowers conjured by a spell, kept so they can be animated in. */
  private readonly blooms: Array<{ sprite: Sprite; age: number }> = [];

  /** Called when a unicorn leaves a present, so the game can make a noise. */
  onPoop: (() => void) | null = null;
  /** Called when any unicorn eats a strawberry. */
  onEat: (() => void) | null = null;
  /** Called with the newcomer's name when an egg opens. */
  onHatch: ((id: string, variant: UnicornVariant, x: number, y: number) => void) | null = null;
  /** Called when a magic flower opens, with how many eggs were inside it. */
  onBloom: ((seed: string, eggs: number) => void) | null = null;

  /** Clutches whose flower has not opened yet, waiting to be laid. */
  private readonly pending = new Map<string, PendingClutch>();

  private readonly decor: THREE.Group = new THREE.Group();
  private shovelSprite: THREE.Object3D | null = null;
  /** False only when the sprite is missing, which keeps the hint honest. */
  hasLetterTable = false;
  hasGate = false;
  hasEasel = false;

  /** The live drawing hung on the easel, and which version of it is uploaded. */
  private boardTexture: THREE.CanvasTexture | null = null;
  private boardShown = -1;

  constructor(
    private readonly assets: AssetLibrary,
    playerUnicorn: Unicorn,
    seed = 'angen-1',
  ) {
    const rng = makeRng(seed);

    this.scene.add(createGround({ ...WORLD_BOUNDS, horizonY: HORIZON_Y }));

    this.backdrop = new Backdrop(assets, {
      horizonY: HORIZON_Y,
      worldWidth: WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX,
      seed,
    });
    this.scene.add(this.backdrop.group);

    this.scene.add(this.decor);
    this.scatterScenery(rng);

    this.poop = new PoopField(assets);
    this.scene.add(this.poop.group);
    this.treats = new TreatField(assets);
    this.scene.add(this.treats.group);
    this.eggs = new EggNest(assets);
    this.eggs.onHatch = (id, variant, x, y) => this.hatch(id, variant, x, y);
    this.flowers = new MagicFlowers(assets);
    this.flowers.onBloom = (seed) => {
      const waiting = this.pending.get(seed);
      if (!waiting) return;
      this.pending.delete(seed);
      this.bloom(waiting);
    };
    // The flowers go in before the eggs so a shell drawn at the same depth as
    // its own flower still comes out in front of the petals.
    this.scene.add(this.flowers.group);
    this.scene.add(this.eggs.group);
    this.placeShovel();
    this.placeLetterTable();
    this.placeGate();

    this.player = playerUnicorn;
    this.player.x = SPAWN.x;
    this.player.y = SPAWN.y;
    this.scene.add(this.player.group);

    this.herd = new HerdView(assets);
    this.scene.add(this.herd.group);
  }

  private plant(part: Part, x: number, y: number, height: number, withShadow: boolean): void {
    const order = depthOrder(y);

    if (withShadow) {
      const shadowPart = shadowTexture();
      if (shadowPart) {
        const shadow = createSprite(shadowPart, {
          height: height * 0.18,
          pivotY: 0.5,
          opacity: 0.4,
        });
        shadow.position.set(x, projectY(y) + height * 0.02, 0);
        shadow.renderOrder = order + PART_ORDER.shadow;
        this.decor.add(shadow);
      }
    }

    const sprite: Sprite = createSprite(part, { height });
    sprite.position.set(x, projectY(y), 0);
    sprite.renderOrder = order + PART_ORDER.body;
    this.decor.add(sprite);
  }

  private scatterScenery(rng: Rng): void {
    for (const spec of SCATTER) {
      if (!this.assets.has(spec.id)) continue;
      const part = this.assets.get(spec.id);

      for (let i = 0; i < spec.count; i++) {
        // A handful of tries to land outside the clearing, then give up and
        // skip — better a slightly emptier meadow than a tree on the player.
        let x = 0;
        let y = 0;
        let placed = false;

        for (let attempt = 0; attempt < 12; attempt++) {
          // Scenery spills past the fence line all the way to the horizon,
          // which is what gives the far grass some depth.
          x = rng.range(WORLD_BOUNDS.minX - 4, WORLD_BOUNDS.maxX + 4);
          y = rng.range(WORLD_BOUNDS.minY - 3, HORIZON_Y - 1.5);
          const clear =
            !spec.avoidsClearing ||
            (Math.hypot(x - SPAWN.x, y - SPAWN.y) > CLEARING_RADIUS &&
              Math.hypot(x - TABLE_SPOT.x, y - TABLE_SPOT.y) > TABLE_CLEARING &&
              Math.hypot(x - GATE_SPOT.x, y - GATE_SPOT.y) > TABLE_CLEARING &&
              Math.hypot(x - EASEL_SPOT.x, y - EASEL_SPOT.y) > EASEL_CLEARING);
          if (clear) {
            placed = true;
            break;
          }
        }
        if (!placed) continue;

        this.plant(part, x, y, rng.range(spec.min, spec.max), spec.shadow);
      }
    }
  }

  /**
   * Rolls the foal an egg would contain.
   *
   * Separate from laying it because whoever casts the spell decides what is
   * inside and tells everyone else — two children watching the same egg must
   * not see two different ponies come out of it.
   */
  rollFoal(): UnicornVariant {
    return foalVariant(this.assets, `agg-${randomSeed()}`);
  }

  /**
   * Grows a magic flower beside a point, with a known foal waiting inside it.
   *
   * This is the picture book's rule rather than a game mechanic anyone invented:
   * a unicorn family that wants a foal grows a magic flower, the flower opens,
   * and there is the egg. Some flowers hold two eggs, or three, and those are
   * the twins and triplets — how many is worked out from the spell's seed by a
   * rule the relay shares, so nobody has to send it.
   *
   * Only the first foal is passed in. Its brothers and sisters are derived from
   * it, which is both cheaper and truer: they come out of the same flower, so
   * they share a coat, and the eggs they are in are painted to match.
   *
   * Everything else — where the flower stands, how long each egg takes — comes
   * from `rng`, so casting this with the same seed on two machines grows the
   * same flower in the same place. `elapsed` catches up a flower cast while
   * nobody was here: one far enough along starts already open.
   */
  layClutch(
    seed: string,
    x: number,
    y: number,
    rng: Rng,
    foal: UnicornVariant,
    /** Seconds since it was cast, when catching up. */
    elapsed = 0,
  ): number {
    if (!this.eggs.available) return 0;

    // Beside the caster rather than under them, and never outside the fence.
    const angle = rng.range(0, Math.PI * 2);
    const distance = rng.range(1.7, 2.7);
    const atX = clamp(x + Math.cos(angle) * distance, WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX);
    const atY = clamp(y + Math.sin(angle) * distance * 0.8, WORLD_BOUNDS.minY, WORLD_BOUNDS.maxY);

    const count = clutchSize(seed);
    const hatchTimes: number[] = [];
    for (let i = 0; i < count; i++) {
      // Siblings do not all go at once — a few seconds apart is three moments
      // instead of one, and it lets a child watch each one arrive.
      hatchTimes.push(rng.range(HATCH_TIME.min, HATCH_TIME.max) + i * rng.range(1.6, 3.2));
    }
    const last = Math.max(...hatchTimes);

    // Every time below is measured from when the spell was cast: the petals
    // open at BLOOM_TIME, egg i opens at BLOOM_TIME + hatchTimes[i], and the
    // flower folds away shortly after the last of them. `spent` is how far into
    // that the meadow already is, which is BLOOM_TIME at the earliest because
    // the eggs do not exist before the flower opens.
    const spent = Math.max(elapsed, BLOOM_TIME);

    // The flower stands a little behind its eggs, so they sit in the mouth of
    // it, and stays until the last of them has hatched.
    this.flowers.plant(
      seed,
      atX,
      clamp(atY + 0.7, WORLD_BOUNDS.minY, WORLD_BOUNDS.maxY),
      BLOOM_TIME - elapsed,
      last + 1.2 - (spent - BLOOM_TIME),
    );

    // Before the petals open there is nothing to put down yet; `bloom` lays the
    // eggs when they do. A flower being caught up on is already past that.
    const waiting = { seed, atX, atY, foal, count, hatchTimes, spent };
    if (elapsed < BLOOM_TIME) this.pending.set(seed, waiting);
    else this.bloom(waiting);

    return count;
  }

  /** Puts the eggs into a flower that has just opened. */
  private bloom(clutch: PendingClutch): void {
    const { seed, atX, atY, foal, count, hatchTimes, spent } = clutch;
    // Spread sideways rather than in depth: the view squashes depth, so a row
    // of eggs laid front-to-back would stack into one egg-shaped smudge.
    const spread = 0.62;

    for (let i = 0; i < count; i++) {
      const offset = count === 1 ? 0 : (i - (count - 1) / 2) * spread;
      const hatchIn = (hatchTimes[i] ?? HATCH_TIME.min) + BLOOM_TIME - spent;
      // Already due: it opened while nobody was looking. The foal is in the
      // herd the simulation sends us, so there is nothing to put down here.
      if (hatchIn <= 0) continue;
      this.eggs.lay(
        eggId(seed, i),
        clamp(atX + offset, WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX),
        // A hair of depth between them so they overlap like a real clutch
        // rather than sitting in a perfect line.
        clamp(atY - Math.abs(offset) * 0.12, WORLD_BOUNDS.minY, WORLD_BOUNDS.maxY),
        i === 0 ? foal : siblingVariant(this.assets, foal, i),
        hatchIn,
      );
    }
    this.onBloom?.(seed, count);
  }

  /**
   * An egg has opened. Only announces it — the foal joins the herd through the
   * simulation, the same way every other pony does, so there is exactly one
   * place that decides who is in this field.
   */
  private hatch(id: string, variant: UnicornVariant, x: number, y: number): void {
    this.onHatch?.(id, variant, x, y);
  }

  /** Casts strawberry rain around a point. */
  rainStrawberries(x: number, y: number, rng: Rng, tag: string, at: number): void {
    this.treats.rain(x, y, 14, 5.5, rng, tag, at);
  }

  /** Blooms a ring of flowers around a point, each popping up in turn. */
  bloomFlowers(x: number, y: number, rng: Rng): void {
    const kinds = ['blommor_rosa', 'blommor_vita'].filter((id) => this.assets.has(id));
    if (!kinds.length) return;

    const count = 14;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const radius = rng.range(2.2, 3.1);
      const fx = x + Math.cos(angle) * radius;
      // The depth axis is squashed on screen, so the ring is squashed to match
      // and comes out looking round.
      const fy = y + Math.sin(angle) * radius * 0.75;

      const part = this.assets.get(rng.pick(kinds));
      const sprite = createSprite(part, { height: rng.range(0.4, 0.62) });
      sprite.position.set(fx, projectY(fy), 0);
      sprite.renderOrder = depthOrder(fy) + PART_ORDER.body;
      sprite.scale.setScalar(0);
      this.decor.add(sprite);
      // Staggered so the ring opens outward rather than all at once.
      this.blooms.push({ sprite, age: -i * 0.045 });
    }
  }

  /** Lays the shovel on the grass for the player to find. */
  private placeShovel(): void {
    if (!this.assets.has('spade')) return;
    const part = this.assets.get('spade');
    const order = depthOrder(SHOVEL_SPOT.y);
    const group = new THREE.Group();

    const shadowPart = shadowTexture();
    if (shadowPart) {
      const shadow = createSprite(shadowPart, { height: 0.12, pivotY: 0.5, opacity: 0.4 });
      shadow.position.y = 0.02;
      shadow.renderOrder = order + PART_ORDER.shadow;
      group.add(shadow);
    }

    const sprite = createSprite(part, { height: part.worldHeight });
    sprite.renderOrder = order + PART_ORDER.body;
    group.add(sprite);

    group.position.set(SHOVEL_SPOT.x, projectY(SHOVEL_SPOT.y), 0);
    this.scene.add(group);
    this.shovelSprite = group;
  }

  /**
   * Stands the letter table in the meadow. It is only scenery as far as the
   * world is concerned — walking up to it is what opens the spelling game, and
   * that check lives with the rest of the caretaking.
   */
  private placeLetterTable(): void {
    if (!this.assets.has('bokstavsbord')) return;
    const part = this.assets.get('bokstavsbord');
    this.plant(part, TABLE_SPOT.x, TABLE_SPOT.y, part.worldHeight, true);
    this.hasLetterTable = true;
  }

  private placeGate(): void {
    if (!this.assets.has('grind')) return;
    const part = this.assets.get('grind');
    this.plant(part, GATE_SPOT.x, GATE_SPOT.y, part.worldHeight, true);
    this.hasGate = true;
  }

  /**
   * Stands the easel in the meadow and hangs the shared drawing on it.
   *
   * The drawing is the very canvas the overlay draws on, uploaded as a texture,
   * so what is on the board in the field is what is on the board — never a copy
   * that can fall behind. It is placed by the white rectangle measured off the
   * easel artwork, which is why the two line up exactly.
   */
  showBoard(board: Board): void {
    if (!this.assets.has('stafflig')) return;
    const part = this.assets.get('stafflig');
    const height = part.worldHeight;
    const width = height * part.aspect;

    this.plant(part, EASEL_SPOT.x, EASEL_SPOT.y, height, true);
    this.hasEasel = true;

    const texture = new THREE.CanvasTexture(board.canvas);
    texture.colorSpace = THREE.LinearSRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;

    const faceWidth = BOARD_FACE.width * width;
    const faceHeight = BOARD_FACE.height * height;
    const sprite = createSprite(
      { ...part, texture, aspect: faceWidth / faceHeight },
      { height: faceHeight, pivotY: 0.5 },
    );
    sprite.position.set(
      EASEL_SPOT.x + (BOARD_FACE.x + BOARD_FACE.width / 2 - 0.5) * width,
      projectY(EASEL_SPOT.y) + (BOARD_FACE.y + BOARD_FACE.height / 2) * height,
      0,
    );
    // Over the easel's own white face, under nothing else standing here.
    sprite.renderOrder = depthOrder(EASEL_SPOT.y) + PART_ORDER.pattern;
    this.decor.add(sprite);

    this.boardTexture = texture;
    this.board = board;
  }

  private board: Board | null = null;

  /** Removes the shovel from the grass once it has been picked up. */
  takeShovel(): void {
    this.shovelSprite?.removeFromParent();
    this.shovelSprite = null;
  }

  get shovelOnGround(): boolean {
    return this.shovelSprite !== null;
  }

  update(dt: number): void {
    const now = Date.now() / 1000;

    this.herd.update(dt);
    this.poop.update(dt);
    this.treats.update(dt, now);
    this.growBlooms(dt);
    this.flowers.update(dt);
    this.eggs.update(dt);

    // The easel only re-uploads when somebody has actually drawn something.
    if (this.board && this.boardTexture && this.board.version !== this.boardShown) {
      this.boardShown = this.board.version;
      this.boardTexture.needsUpdate = true;
    }
  }

  private growBlooms(dt: number): void {
    for (let i = this.blooms.length - 1; i >= 0; i--) {
      const bloom = this.blooms[i]!;
      bloom.age += dt;
      if (bloom.age <= 0) continue;

      const t = Math.min(1, bloom.age / 0.45);
      // Overshoot then settle, so each flower springs up.
      bloom.sprite.scale.setScalar(t < 1 ? t * (1 + Math.sin(t * Math.PI) * 0.35) : 1);
      if (t >= 1) this.blooms.splice(i, 1);
    }
  }
}
