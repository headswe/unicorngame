/**
 * The herd, simulated in one place.
 *
 * This file is plain JavaScript on purpose: the relay imports it under Node and
 * the game imports it in the browser, and it must be *the same code* in both.
 * One simulation, two homes. It sits in `server/` rather than a `shared/` of
 * its own purely so that deploying the relay is still "upload this folder".
 *
 * Which is the whole point of the rewrite. The herd used to be a pure function
 * of the clock so that every browser could compute it identically without a
 * word passing between them — elegant, exactly synchronised, and free. But it
 * meant the ponies could never react to anything a child did, because a
 * reaction is not derivable from a clock. That is the wall: no feeding, no
 * following, and a strawberry shower that pulled the two screens apart because
 * each was deciding for itself who chased what.
 *
 * So now one machine decides. Normally the relay, which broadcasts the result;
 * with no relay configured, the browser runs this itself and plays alone. The
 * simulation has no idea which it is, and there is only ever one of it, so
 * there is nothing left to diverge.
 *
 * There is no three.js in here and no DOM. Positions are plain numbers in world
 * units; how they are drawn is entirely the client's business.
 */

/** Ticks a second. Ten is ample for walking pace and cheap to send. */
export const HERD_HZ = 10;

/**
 * Where the ponies are allowed to walk, and how many live here.
 *
 * Exported from the simulation rather than from the game so that the relay and
 * the browser cannot drift apart about the size of the field — a herd wandering
 * to different fences on the two sides would be a slow, baffling bug.
 */
export const WORLD_BOUNDS = { minX: -42, maxX: 42, minY: 1, maxY: 36 };

/** How many ponies live in the meadow before anybody hatches one. */
export const RESIDENTS = 18;

/** One walk plus one graze, in seconds. */
const LEG_SECONDS = 11;
/** A leg spends somewhere in this range walking; the rest is standing still. */
const WALK_FRACTION = { min: 0.35, max: 0.62 };
/** World units a second on a detour after something. */
const CHASE_SPEED = 1.9;
/** Seconds spent easing back onto the wandering path after a detour. */
const REJOIN_TIME = 1.6;

/** How far a pony will notice a strawberry and come over for it. */
export const TREAT_SMELL = 9;
/** How close its nose has to get. */
export const EAT_RADIUS = 0.75;

/** Seconds between chances for one pony to leave a present. */
const POOP_SLOT = 40;
/** How likely a pony is to take that chance. */
const POOP_CHANCE = 0.03;

/**
 * Deterministic value in [0, 1) from two integers.
 *
 * Still used, even though only one machine simulates now: it is what gives each
 * pony its own unrepeating ramble from nothing but a seed, so a herd needs no
 * stored paths and a pony's wandering is settled the moment it is born.
 */
export function hash01(a, b) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x165667b1, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491);
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2f);
  return (h >>> 0) / 4294967296;
}

/** FNV-1a, so a readable seed string maps to a stable 32-bit number. */
export function hashSeed(seed) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
/** Smooth start and stop, so a pony does not jerk into motion. */
const ease = (t) => t * t * (3 - 2 * t);

/**
 * @typedef {object} Pony
 * @property {string} seed   names it, and is what the client builds its looks from
 * @property {number} n      numeric form of the seed, for the path hashing
 * @property {number} homeX
 * @property {number} homeY
 * @property {number} roam
 * @property {number} x
 * @property {number} y
 * @property {1|-1}   facing
 * @property {boolean} moving
 * @property {{x:number,y:number}|null} chase
 * @property {number} rejoin  seconds left of easing back onto the path
 * @property {number} poopSlot last slot considered
 */

/** Where a pony rests at the end of leg `leg`. */
function restingPlace(pony, leg, bounds) {
  const angle = hash01(pony.n, leg * 3) * Math.PI * 2;
  // Square-rooted so resting places spread evenly over the patch rather than
  // bunching in the middle of it.
  const distance = Math.sqrt(hash01(pony.n, leg * 3 + 1)) * pony.roam;
  return {
    x: clamp(pony.homeX + Math.cos(angle) * distance, bounds.minX, bounds.maxX),
    y: clamp(pony.homeY + Math.sin(angle) * distance, bounds.minY, bounds.maxY),
  };
}

/** Where a pony's ramble has it at time `now`, ignoring any detour. */
function wanderTo(pony, now, bounds) {
  // Each pony starts its cycle at its own moment, so they do not all set off
  // on the same beat.
  const t = now + hash01(pony.n, 0xffff) * LEG_SECONDS;
  const leg = Math.floor(t / LEG_SECONDS);
  const through = t / LEG_SECONDS - leg;

  const from = restingPlace(pony, leg, bounds);
  const to = restingPlace(pony, leg + 1, bounds);

  const walkFor =
    WALK_FRACTION.min +
    hash01(pony.n, leg * 3 + 2) * (WALK_FRACTION.max - WALK_FRACTION.min);

  if (through >= walkFor) return to;
  const k = ease(through / walkFor);
  return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
}

export class Herd {
  /**
   * @param {object} options
   * @param {string} options.seed   the day's seed, so the herd matches the field
   * @param {number} options.count  how many ponies live here
   * @param {{minX:number,maxX:number,minY:number,maxY:number}} options.bounds
   */
  constructor({ seed, count, bounds }) {
    this.bounds = bounds;
    /** @type {Pony[]} */
    this.ponies = [];
    for (let i = 0; i < count; i++) this.add(`${seed}-granne-${i}`);
  }

  /**
   * Adds a pony. Used for the day's residents and for anything a child hatches.
   * Everything about where it lives is derived from its seed, so a pony is
   * fully described by that one string.
   */
  add(seed, homeX, homeY) {
    const n = hashSeed(seed);
    const b = this.bounds;
    const pony = {
      seed,
      n,
      homeX: homeX ?? b.minX + 3 + hash01(n, 101) * (b.maxX - b.minX - 6),
      homeY: homeY ?? b.minY + 1 + hash01(n, 102) * (b.maxY - b.minY - 3),
      roam: 3 + hash01(n, 103) * 6,
      x: 0,
      y: 0,
      facing: hash01(n, 104) < 0.5 ? -1 : 1,
      moving: false,
      chase: null,
      rejoin: 0,
      poopSlot: -1,
    };
    const at = wanderTo(pony, Date.now() / 1000, b);
    pony.x = at.x;
    pony.y = at.y;
    this.ponies.push(pony);
    return pony;
  }

  /** The seeds, in order, so a client can build what each pony looks like. */
  roster() {
    return this.ponies.map((p) => p.seed);
  }

  /**
   * Positions, as a compact array. Index matches the roster, which is why this
   * carries no names: the client already knows who is who.
   *
   * Rounded to two places — a pony a centimetre out is a pony in the right
   * place, and it keeps the snapshot small enough not to think about.
   */
  snapshot() {
    return this.ponies.map((p) => [
      Math.round(p.x * 100) / 100,
      Math.round(p.y * 100) / 100,
      p.facing,
      p.moving ? 1 : 0,
    ]);
  }

  /**
   * Advances the herd.
   *
   * @param {number} dt    seconds since the last tick
   * @param {number} now   unix seconds
   * @param {Array<{id:string,x:number,y:number,landsAt:number,eaten:boolean}>} treats
   * @returns {{poops: Array<{id:string,x:number,y:number}>, eaten: string[]}}
   *   what happened, for the caller to broadcast and remember
   */
  tick(dt, now, treats = []) {
    const poops = [];
    const eaten = [];
    const b = this.bounds;

    for (const pony of this.ponies) {
      const wasX = pony.x;
      const wasY = pony.y;

      // Anything to go and eat? Berries are chosen by proximity, and because
      // one machine decides, two ponies can never pick the same one twice.
      let target = null;
      let best = TREAT_SMELL;
      for (const treat of treats) {
        if (treat.eaten) continue;
        const d = Math.hypot(treat.x - pony.x, treat.y - pony.y);
        if (d < best) {
          best = d;
          target = treat;
        }
      }

      if (target && best <= EAT_RADIUS && now >= target.landsAt) {
        target.eaten = true;
        eaten.push(target.id);
        pony.chase = null;
        pony.rejoin = REJOIN_TIME;
      } else if (target && best > EAT_RADIUS) {
        pony.chase = { x: target.x, y: target.y };
      } else if (!target && pony.chase) {
        pony.chase = null;
        pony.rejoin = REJOIN_TIME;
      }

      if (pony.chase) {
        const dx = pony.chase.x - pony.x;
        const dy = pony.chase.y - pony.y;
        const distance = Math.hypot(dx, dy);
        if (distance > 0.01) {
          const step = Math.min(distance, CHASE_SPEED * dt);
          pony.x += (dx / distance) * step;
          pony.y += (dy / distance) * step;
        }
      } else {
        const path = wanderTo(pony, now, b);
        if (pony.rejoin > 0) {
          // Slide back onto the ramble rather than snapping, so a pony that
          // wandered off for a strawberry does not teleport home.
          pony.rejoin = Math.max(0, pony.rejoin - dt);
          const blend = 1 - pony.rejoin / REJOIN_TIME;
          pony.x += (path.x - pony.x) * blend;
          pony.y += (path.y - pony.y) * blend;
        } else {
          pony.x = path.x;
          pony.y = path.y;
        }
      }

      pony.x = clamp(pony.x, b.minX, b.maxX);
      pony.y = clamp(pony.y, b.minY, b.maxY);

      const movedX = pony.x - wasX;
      const speed = dt > 0 ? Math.hypot(movedX, pony.y - wasY) / dt : 0;
      pony.moving = speed > 0.12;
      if (movedX > 0.005) pony.facing = 1;
      else if (movedX < -0.005) pony.facing = -1;

      // Presents. One chance per slot, taken somewhere inside it so that
      // several ponies never go at once.
      const slot = Math.floor(now / POOP_SLOT);
      if (pony.poopSlot < 0) pony.poopSlot = slot;
      while (pony.poopSlot < slot) {
        pony.poopSlot += 1;
        if (hash01(pony.n, pony.poopSlot) >= POOP_CHANCE) continue;
        poops.push({
          id: `${pony.n}:${pony.poopSlot}`,
          x: pony.x - 0.55,
          y: pony.y - 0.15,
        });
      }
    }

    return { poops, eaten };
  }
}

/**
 * Where a strawberry shower lands, and when each berry comes to rest.
 *
 * Lives here rather than with the drawing because the simulation has to know
 * about berries to send ponies after them, and the two must agree exactly about
 * where they are.
 */
export function scatterTreats(centreX, centreY, count, radius, rng, tag, at) {
  const GRAVITY = 34;
  const BOUNCE = 0.34;
  const REST_SPEED = 1.2;

  const out = [];
  for (let i = 0; i < count; i++) {
    // Even angular spread with a jittered radius, so it reads as a shower
    // rather than a clump.
    const angle = (i / count) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const distance = Math.sqrt(rng.next()) * radius;
    // Staggered starting heights, so they do not all land on the same beat.
    const height = 9 + rng.range(0, 7) + i * 0.35;

    const drop = Math.sqrt((2 * height) / GRAVITY);
    const rebound = GRAVITY * drop * BOUNCE;
    const fall = rebound < REST_SPEED ? drop : drop + (2 * rebound) / GRAVITY;

    out.push({
      id: `${tag}:${i}`,
      x: centreX + Math.cos(angle) * distance,
      y: centreY + Math.sin(angle) * distance * 0.8,
      height,
      bornAt: at,
      landsAt: at + fall,
      eaten: false,
    });
  }
  return out;
}
