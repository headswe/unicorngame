/**
 * The bouncing yard, through the gate at the top of the meadow.
 *
 * A different kind of place, drawn a different way. The meadow is a field seen
 * at three-quarters, with y running away from you and squashed to sell the
 * depth. The yard is a picture book spread seen flat on: y is straight up, a
 * unicorn is exactly as tall as it is, and there is no depth at all. Both use
 * the same sprites, because a storybook pony is drawn in side view either way.
 *
 * There is nothing to win here and no way to lose. A child bounces, and the
 * bounces get bigger, and up in the air they can turn somersaults. That is the
 * whole game. It counts the somersaults because counting them is satisfying,
 * not because a number is the point — nothing is ever taken away, there is no
 * timer, and falling off the trampoline just means walking back to it.
 *
 * Everyone who has come through the gate is in the same yard. The physics is
 * each child's own — a bounce is not something anybody else should be able to
 * lag — and the others are drawn from their poses the same way visitors in the
 * meadow are.
 */

import * as THREE from 'three';

import type { AssetLibrary } from '../engine/assets.ts';
import { makeRng } from '../engine/rng.ts';
import { createSprite, type Sprite } from '../engine/sprite.ts';
import { LAYER_ORDER } from '../engine/view.ts';
import type { Unicorn } from './unicorn.ts';

/** How wide the yard is. Small enough that nobody can wander off and be lost. */
export const YARD = { minX: -13, maxX: 13, floor: 0 };

/** Where the way home stands, and how close you have to be to take it. */
export const GATE_HOME = { x: YARD.minX + 1.6, reach: 1.5 };

/** Where the trampoline is, how wide it is, and how high you stand on it. */
const TRAMPOLINE = { x: 0, halfWidth: 3.1, top: 1.02 };

/** Downward pull, in world units a second squared. */
const GRAVITY = 30;

/** Running speed on the ground, and how much steering you get in the air. */
const RUN = 6.4;
const AIR_STEER = 4.6;

/**
 * How fast sideways drift bleeds away in the air when nothing is held.
 *
 * Without this a child who runs onto the trampoline keeps every bit of that run
 * through every bounce and sails straight off the far side — which is exactly
 * what happened, and it made the trampoline almost impossible to stay on. Let
 * go and you settle over the middle; hold a direction and you still travel.
 */
const AIR_DRAG = 2.2;

/**
 * How a bounce turns into the next one.
 *
 * `keep` is how much of the landing speed comes back and `gain` is what the mat
 * adds on top, so bounces climb on their own without anybody having to time
 * anything — which is the difference between a five-year-old playing this and a
 * five-year-old watching someone else play it. `first` makes even stepping onto
 * the mat do something, and `max` is where it stops climbing: about four and a
 * half units up, which is a whole unicorn's worth of sky and comfortably inside
 * the view.
 */
const BOUNCE = { keep: 0.86, gain: 3.4, first: 6.5, max: 17 };

/** How fast a pony turns over in the air while a direction is held. */
const SPIN_RATE = 9;

/** How slowly a somersault winds down after the direction is let go. */
const SPIN_DRAG = 1.1;

/** How quickly a pony rights itself once it has landed. */
const RIGHTING = 16;

/** Below this much upward speed, a landing stops bouncing and just stands. */
const SETTLE = 1.2;

/** How fast a pony climbs onto the mat when it walks into the trampoline. */
const CLIMB_RATE = 6;

/**
 * How much grass shows below the floor line, and how much sky above a pony.
 *
 * The margin is generous because the HUD sits along the bottom of the screen:
 * a pony standing on a floor drawn any lower would have its legs behind a
 * button.
 */
const GROUND_MARGIN = 2.4;

/** How far the grass comes up over the line everything stands on. */
const GRASS_LIP = 0.14;
const HEADROOM = 2.6;

export interface YardInput {
  /** -1, 0 or 1. */
  steer: number;
}

/** What the yard wants said out loud, so the HUD can say it. */
export interface YardEvents {
  /** A landing that completed one or more somersaults. */
  onFlips: ((flips: number, total: number) => void) | null;
  /** Every landing on the mat, for the boing. */
  onBounce: ((strength: number) => void) | null;
  /** The child walked into the gate home. */
  onLeave: (() => void) | null;
}

export class BounceYard {
  readonly scene = new THREE.Scene();

  readonly events: YardEvents = { onFlips: null, onBounce: null, onLeave: null };

  /** Somersaults turned today, which is the only score there is. */
  flips = 0;

  private pony: Unicorn | null = null;
  private vx = 0;
  private vy = 0;
  private onGround = true;
  /** How fast the pony is turning over, in radians a second. */
  private spinVel = 0;
  /** Radians turned since leaving the ground, for counting somersaults. */
  private turned = 0;
  private readonly sprites: Sprite[] = [];

  constructor(private readonly assets: AssetLibrary) {
    this.build();
  }

  /** True when the parts this needs are on disk. */
  get available(): boolean {
    return this.assets.has('studsmatta') && this.assets.has('grind');
  }

  private stand(id: string, x: number, height: number, order: number): void {
    if (!this.assets.has(id)) return;
    const sprite = createSprite(this.assets.get(id), { height });
    sprite.position.set(x, YARD.floor, 0);
    sprite.renderOrder = order;
    this.scene.add(sprite);
    this.sprites.push(sprite);
  }

  private build(): void {
    // Grass, as one flat slab below the line everything stands on. There is no
    // horizon here — the yard is a wall of sky with a floor across it.
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(YARD.maxX - YARD.minX + 60, 40),
      new THREE.MeshBasicMaterial({ color: 0x8fc27f }),
    );
    // The top of the grass sits a hair above the line hooves stand on, so a
    // pony is standing *in* the grass rather than floating a few pixels over a
    // hard green edge — the body sprites carry a little clear space under the
    // hooves, which nothing hides when the floor is a straight line.
    grass.position.set((YARD.minX + YARD.maxX) / 2, YARD.floor + GRASS_LIP - 20, 0);
    grass.renderOrder = LAYER_ORDER.ground;
    this.scene.add(grass);

    // A hedge of scenery along the back, so the yard is somewhere rather than a
    // green stripe. Seeded, so it is the same yard every time you come through.
    const rng = makeRng('studsgarden');

    // Trees only beyond the ends, where they frame the yard instead of standing
    // in the middle of it. A tree is nearly twice a unicorn's height, so one in
    // the playing area would tower over the whole game.
    for (let i = 0; i < 8; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      this.stand(
        'trad_stort',
        side * rng.range(YARD.maxX - 0.5, YARD.maxX + 11),
        rng.range(2.6, 3.4),
        LAYER_ORDER.groundDecal + i,
      );
    }

    // Low things all along the floor, as ground detail rather than scenery.
    const low = ['buske_rund', 'buske_bar', 'blommor_rosa', 'blommor_vita', 'tuva_gras']
      .filter((id) => this.assets.has(id));
    if (low.length) {
      for (let i = 0; i < 34; i++) {
        const id = rng.pick(low);
        const bush = id.startsWith('buske');
        this.stand(
          id,
          rng.range(YARD.minX - 10, YARD.maxX + 10),
          bush ? rng.range(0.7, 1.1) : rng.range(0.3, 0.55),
          LAYER_ORDER.groundDecal + 20 + i,
        );
      }
    }

    // The way home, and the reason anybody came.
    this.stand('grind', GATE_HOME.x, 2.4, LAYER_ORDER.groundDecal + 100);
    if (this.assets.has('studsmatta')) {
      const part = this.assets.get('studsmatta');
      const mat = createSprite(part, { height: part.worldHeight });
      mat.position.set(TRAMPOLINE.x, YARD.floor, 0);
      // Behind the ponies, so a pony on the mat is never half-hidden by the rim
      // and one running past in front is never swallowed by it.
      mat.renderOrder = LAYER_ORDER.groundDecal + 200;
      this.scene.add(mat);
      this.sprites.push(mat);
    }
  }

  /** Where the trampoline's surface is, for anything that needs to know. */
  get matTop(): number {
    return TRAMPOLINE.top;
  }

  /**
   * Takes charge of a unicorn and stands it by the gate.
   *
   * The pony is the same object the meadow was driving — reparented, not
   * copied — so whatever a child is wearing comes through the gate with them.
   */
  enter(pony: Unicorn): void {
    this.pony = pony;
    this.scene.add(pony.group);
    pony.view = 'side';
    pony.layer = 0;
    pony.spin = 0;
    pony.x = GATE_HOME.x + 2.6;
    pony.y = YARD.floor;
    pony.facing = 1;
    this.vx = 0;
    this.vy = 0;
    this.turned = 0;
    this.onGround = true;
    pony.update(0, false);
  }

  /** Hands the unicorn back. The caller puts it wherever it came from. */
  leave(): Unicorn | null {
    const pony = this.pony;
    if (pony) {
      pony.view = 'meadow';
      pony.spin = 0;
      pony.group.removeFromParent();
    }
    this.pony = null;
    return pony;
  }

  /** Whether the legs should be running, for the walk cycle sent to friends. */
  get running(): boolean {
    return this.onGround && Math.abs(this.vx) > 0.1;
  }

  /** Whether the child is standing in the gateway home. */
  get atGate(): boolean {
    return !!this.pony && this.onGround && Math.abs(this.pony.x - GATE_HOME.x) < GATE_HOME.reach;
  }

  update(dt: number, input: YardInput): void {
    const pony = this.pony;
    if (!pony) return;

    // On the ground you run; in the air you steer, which is weaker on purpose —
    // where a bounce takes you should be mostly settled before you leave.
    const wanted = input.steer * RUN;
    if (this.onGround) {
      this.vx = wanted;
    } else if (input.steer !== 0) {
      this.vx += Math.sign(wanted - this.vx) * AIR_STEER * dt * Math.abs(input.steer);
      this.vx = clamp(this.vx, -RUN, RUN);
    } else {
      this.vx *= Math.exp(-dt * AIR_DRAG);
    }

    pony.x = clamp(pony.x + this.vx * dt, YARD.minX, YARD.maxX);
    if (pony.x <= YARD.minX || pony.x >= YARD.maxX) this.vx = 0;

    this.vy -= GRAVITY * dt;
    const wasY = pony.y;
    pony.y += this.vy * dt;

    // Somersaults. Holding a direction in the air turns you over that way, and
    // the whole point of bouncing higher is having time to get all the way
    // round. Letting go does not stop you dead — the turn winds down the way a
    // real one would — but landing always does, and always on your feet.
    if (!this.onGround && input.steer !== 0) this.spinVel = -input.steer * SPIN_RATE;

    if (this.spinVel !== 0) {
      const turn = this.spinVel * dt;
      pony.spin += turn;
      this.turned += Math.abs(turn);
      if (input.steer === 0 || this.onGround) this.spinVel *= Math.exp(-dt * SPIN_DRAG);
    } else {
      // Upright again, the short way round. This runs through the bounces
      // *after* a landing as well as while standing about, because a bouncing
      // pony is hardly ever touching anything — righting only while it rests
      // would leave a half-turn stuck on it for as long as it kept bouncing.
      pony.spin = wrap(pony.spin) * Math.exp(-dt * RIGHTING);
    }

    this.land(pony, wasY, dt);

    pony.facing = this.vx > 0.05 ? 1 : this.vx < -0.05 ? -1 : pony.facing;
    // The legs run on the ground and hang still in the air, which is what makes
    // the difference between the two read at a glance.
    pony.update(dt, this.onGround && Math.abs(this.vx) > 0.1);
  }

  /** Handles arriving on the mat, climbing onto it, or coming down on grass. */
  private land(pony: Unicorn, wasY: number, dt: number): void {
    const overMat = Math.abs(pony.x - TRAMPOLINE.x) < TRAMPOLINE.halfWidth;

    // Coming down onto the mat. Caught only on the way *down* and only from
    // above, so walking about beside the trampoline is never snatched upward.
    if (overMat && this.vy <= 0 && wasY >= TRAMPOLINE.top && pony.y <= TRAMPOLINE.top) {
      pony.y = TRAMPOLINE.top;
      this.score(pony);
      const back = Math.min(
        BOUNCE.max,
        Math.max(BOUNCE.first, -this.vy * BOUNCE.keep + BOUNCE.gain),
      );
      if (back < SETTLE) {
        this.vy = 0;
        this.onGround = true;
        return;
      }
      this.vy = back;
      this.onGround = false;
      this.events.onBounce?.(back / BOUNCE.max);
      return;
    }

    // Walking into the trampoline from the grass climbs onto it. Getting on is
    // not the game and should never be a puzzle: you walk at it and you are on.
    if (overMat && this.onGround && pony.y < TRAMPOLINE.top) {
      pony.y = Math.min(TRAMPOLINE.top, pony.y + CLIMB_RATE * dt);
      this.vy = 0;
      return;
    }

    // The grass. Also the floor under everything, so nothing can fall through.
    if (pony.y <= YARD.floor) {
      pony.y = YARD.floor;
      this.score(pony);
      this.vy = 0;
      this.onGround = true;
      return;
    }

    this.onGround = false;
  }

  /** Counts whole somersaults on landing, and straightens the pony out. */
  private score(pony: Unicorn): void {
    if (this.onGround) return;
    const turns = Math.floor(this.turned / (Math.PI * 2));
    this.turned = 0;
    // Landing on your feet however the spin ended: a child should never be
    // punished with a pony lying on its back.
    this.spinVel = 0;
    pony.spin = wrap(pony.spin);
    if (turns > 0) {
      this.flips += turns;
      this.events.onFlips?.(turns, this.flips);
    }
  }

  /** Where the camera should look, given how much of the yard fits on screen. */
  cameraTarget(halfWidth: number, halfHeight: number): { x: number; y: number } {
    const pony = this.pony;
    const midX = (YARD.minX + YARD.maxX) / 2;
    const span = (YARD.maxX - YARD.minX) / 2;
    // Never show past the ends of the yard, unless the yard is narrower than
    // the screen, in which case centre it and stop worrying.
    const x = pony
      ? halfWidth >= span
        ? midX
        : clamp(pony.x, YARD.minX + halfWidth, YARD.maxX - halfWidth)
      : midX;

    // The floor stays put on screen — a view that slides up and down under a
    // bouncing child is seasick. It only ever rises if a bounce would otherwise
    // go off the top, which with the current ceiling it never does; the term is
    // there so that raising the ceiling later cannot quietly break the framing.
    const resting = YARD.floor - GROUND_MARGIN + halfHeight;
    const needed = (pony?.y ?? 0) + HEADROOM - halfHeight;
    return { x, y: Math.max(resting, needed) };
  }

  dispose(): void {
    for (const sprite of this.sprites) sprite.material.dispose();
    this.sprites.length = 0;
  }
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** The same angle, expressed as the short way round from upright. */
function wrap(angle: number): number {
  const turn = Math.PI * 2;
  let a = angle % turn;
  if (a > Math.PI) a -= turn;
  if (a < -Math.PI) a += turn;
  return a;
}
