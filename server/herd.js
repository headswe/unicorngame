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

/** World units a second at an amble, and at an eager trot after a berry. */
const WANDER_SPEED = 1.3;
const CHASE_SPEED = 1.9;

/** How long a pony grazes where it stopped before choosing somewhere new. */
const REST = { min: 2.5, max: 9 };

/** Close enough to count as arrived. */
const ARRIVED = 0.25;

/**
 * How near a child has to be before a pony looks up at them.
 *
 * This is the whole difference between scenery and a creature. A pony you can
 * stand nose-to-nose with while it carries on grazing is furniture; one that
 * stops and turns to look at you is somebody.
 */
const NOTICE = 3.4;

/** How near it will settle when following someone, so it does not shove them. */
const HEEL = 1.7;

/**
 * A pony that has fallen behind hurries, and the further behind the harder.
 *
 * Without this, following does not work at all: a child runs at 6.4 units a
 * second and a pony ambles at 1.3, so "following" would mean being left in the
 * next field. It tops out just under a child's full pelt, so a determined
 * sprint can still lose them — which is fair, and funny.
 */
const HURRY = { gain: 0.95, max: 5.8 };

/** Beyond this it gives up and goes back to its own patch. */
const FOLLOW_GIVE_UP = 30;

/** How long a kindness buys you a companion, in seconds. */
const FED_BONUS = 25;
const PETTED_BONUS = 18;

/** Seconds a pony stays visibly delighted after being fed or petted. */
const CHEER_TIME = 1.4;

/** What a pony is feeling, for the client to draw. */
export const MOOD = { CALM: 0, LOOKING: 1, HAPPY: 2 };

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
 * @property {{x:number,y:number}|null} chase   a berry worth leaving the amble for
 * @property {{x:number,y:number}|null} target  where it is ambling to
 * @property {string|null} friend   the child it is tagging along with
 * @property {number} friendUntil   unix seconds it will keep tagging along
 * @property {number} cheerUntil    unix seconds it stays visibly delighted
 * @property {number} mood          see MOOD; only for drawing
 * @property {number} leg      counts the places it has ambled to, for the hashing
 * @property {number} restUntil unix seconds it will stand here until
 * @property {number} poopSlot last slot considered
 */

/** Somewhere in this pony's patch to head for next. */
function somewhereNearHome(pony, leg, bounds) {
  const angle = hash01(pony.n, leg * 3) * Math.PI * 2;
  // Square-rooted so resting places spread evenly over the patch rather than
  // bunching in the middle of it.
  const distance = Math.sqrt(hash01(pony.n, leg * 3 + 1)) * pony.roam;
  return {
    x: clamp(pony.homeX + Math.cos(angle) * distance, bounds.minX, bounds.maxX),
    y: clamp(pony.homeY + Math.sin(angle) * distance, bounds.minY, bounds.maxY),
  };
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
      target: null,
      friend: null,
      friendUntil: 0,
      cheerUntil: 0,
      mood: MOOD.CALM,
      leg: 0,
      // Staggered, so eighteen ponies do not all set off on the same beat.
      restUntil: Date.now() / 1000 + hash01(n, 105) * REST.max,
      poopSlot: -1,
    };
    const at = somewhereNearHome(pony, 0, b);
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
      p.mood,
    ]);
  }

  /**
   * Advances the herd.
   *
   * @param {number} dt    seconds since the last tick
   * @param {number} now   unix seconds
   * @param {Array<{id:string,x:number,y:number,landsAt:number,eaten:boolean}>} treats
   * @param {Array<{id:string,x:number,y:number}>} players where the children are
   * @returns {{poops: Array<{id:string,x:number,y:number}>, eaten: string[], cheers: number[]}}
   *   what happened, for the caller to broadcast and remember
   */
  tick(dt, now, treats = [], players = []) {
    const poops = [];
    const eaten = [];
    const cheers = [];
    const b = this.bounds;

    for (const [index, pony] of this.ponies.entries()) {
      const wasX = pony.x;
      const wasY = pony.y;

      // Who is nearby, and are we tagging along with anyone?
      let nearest = null;
      let nearestAway = NOTICE;
      for (const player of players) {
        const away = Math.hypot(player.x - pony.x, player.y - pony.y);
        if (away < nearestAway) {
          nearestAway = away;
          nearest = player;
        }
      }
      if (pony.friend && now >= pony.friendUntil) pony.friend = null;
      const leader = pony.friend
        ? players.find((pl) => pl.id === pony.friend) ?? null
        : null;
      // A friend who has closed their laptop is no longer a friend.
      if (pony.friend && !leader) pony.friend = null;

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
        // Whoever was standing near enough to have brought it gets the credit.
        if (nearest) {
          pony.friend = nearest.id;
          pony.friendUntil = Math.max(pony.friendUntil, now + FED_BONUS);
        }
        pony.cheerUntil = now + CHEER_TIME;
        cheers.push(index);
        // Finished with it. Stand a moment where it was eaten and then carry on
        // from here — there is nowhere it is supposed to be.
        pony.chase = null;
        pony.target = null;
        pony.restUntil = now + REST.min;
      } else if (target && best > EAT_RADIUS) {
        pony.chase = { x: target.x, y: target.y };
        pony.target = null;
      } else if (!target && pony.chase) {
        // Somebody else got it. Same again: no snapping back anywhere.
        pony.chase = null;
        pony.target = null;
        pony.restUntil = now + 0.4;
      }

      // Following comes after berries and before ambling: a pony will leave its
      // friend for a strawberry, which is exactly what a pony would do.
      let hurry = 0;
      if (!pony.chase && leader) {
        const away = Math.hypot(leader.x - pony.x, leader.y - pony.y);
        if (away > FOLLOW_GIVE_UP) {
          pony.friend = null;
        } else if (away > HEEL) {
          pony.target = { x: leader.x, y: leader.y };
          hurry = Math.min(HURRY.max, WANDER_SPEED + (away - HEEL) * HURRY.gain);
        } else {
          pony.target = null;
          pony.restUntil = now;
        }
      }

      const goal = pony.chase ?? pony.target;
      if (goal) {
        const dx = goal.x - pony.x;
        const dy = goal.y - pony.y;
        const distance = Math.hypot(dx, dy);
        if (distance <= ARRIVED) {
          if (pony.chase) {
            // Standing over a berry that has not landed yet: wait for it.
          } else {
            pony.target = null;
            pony.restUntil =
              now + REST.min + hash01(pony.n, pony.leg + 0x600d) * (REST.max - REST.min);
          }
        } else {
          const speed = pony.chase ? CHASE_SPEED : hurry || WANDER_SPEED;
          const step = Math.min(distance, speed * dt);
          pony.x += (dx / distance) * step;
          pony.y += (dy / distance) * step;
        }
      } else if (leader) {
        // At heel and nothing to chase: stand with them and watch.
      } else if (nearest) {
        // Somebody is right here. Stop grazing and look up — the one behaviour
        // that turns a decoration into a creature.
      } else if (now >= pony.restUntil) {
        // Done grazing: pick somewhere else in the patch and amble over.
        pony.leg += 1;
        pony.target = somewhereNearHome(pony, pony.leg, b);
      }

      pony.x = clamp(pony.x, b.minX, b.maxX);
      pony.y = clamp(pony.y, b.minY, b.maxY);

      const movedX = pony.x - wasX;
      const speed = dt > 0 ? Math.hypot(movedX, pony.y - wasY) / dt : 0;
      pony.moving = speed > 0.12;
      if (movedX > 0.005) pony.facing = 1;
      else if (movedX < -0.005) pony.facing = -1;
      // Standing still with a child beside it: turn and face them.
      else if (nearest && !pony.moving) pony.facing = nearest.x < pony.x ? -1 : 1;

      pony.mood =
        now < pony.cheerUntil ? MOOD.HAPPY : nearest || leader ? MOOD.LOOKING : MOOD.CALM;

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

    return { poops, eaten, cheers };
  }

  /**
   * A child reached out and patted one. Returns false if they are not actually
   * next to it, so a tap across the meadow does nothing.
   */
  pet(index, player, now) {
    const pony = this.ponies[index];
    if (!pony || !player) return false;
    if (Math.hypot(player.x - pony.x, player.y - pony.y) > NOTICE) return false;
    pony.friend = player.id;
    pony.friendUntil = Math.max(pony.friendUntil, now + PETTED_BONUS);
    pony.cheerUntil = now + CHEER_TIME;
    return true;
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
