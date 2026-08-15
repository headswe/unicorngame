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
 * How much further out each successive follower stands.
 *
 * Every pony walking at the child's exact feet is what made a crowd of
 * followers arrive as one pony-shaped pile. They take numbered places around
 * her instead, laid out in the spiral a sunflower uses — which is the cheapest
 * way to space any number of things evenly round a point without knowing in
 * advance how many there will be.
 */
const FOLLOW_RING = 1.05;

/** The angle between one follower's place and the next. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * How much wider than deep the ring of followers is drawn.
 *
 * Depth is squashed to about half on screen, so a ring that is round in world
 * units comes out as a thin line of ponies stacked on each other. Stretching it
 * sideways is what makes a crowd around a child read as a crowd.
 */
const RING_SHAPE = { x: 1.3, y: 0.8 };

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

/**
 * How much room a pony insists on having, side to side and front to back.
 *
 * Two figures rather than one because the meadow is drawn obliquely: depth is
 * squashed to about half on screen, so two ponies a stride apart *in depth*
 * still come out drawn on top of each other, while the same gap sideways reads
 * as two clearly separate ponies. The oval is therefore long in y and narrow in
 * x — it is a rule about what looks crowded, not about how fat a pony is.
 */
const PERSONAL_SPACE = { x: 1.25, y: 2.1 };

/**
 * How fast a pony shuffles aside, in world units a second.
 *
 * Faster than an amble, so making room always wins over walking into someone,
 * and slower than a chase, so a pony can still push through a crowd to a
 * strawberry rather than being held off it.
 */
const SHUFFLE = 1.6;

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

/**
 * Hands out the strawberries, one pony to a berry.
 *
 * Without this every pony within smelling distance walks at the *same* nearest
 * berry, so a shower that lands in a clump gathers the whole herd into one
 * spot — and all but one of them then stands there having lost the race. The
 * closest pairing is settled first and both are then out of the running, so a
 * shower spreads the herd over it instead of piling them onto the near edge.
 *
 * Ties break on index so that the result depends only on where everyone is
 * standing, never on the order two equally close ponies happen to be visited.
 */
function shareOutTreats(ponies, treats) {
  /** @type {Array<{treat: object, away: number}|null>} */
  const claims = ponies.map(() => null);
  const pairs = [];

  for (const [p, pony] of ponies.entries()) {
    for (const [t, treat] of treats.entries()) {
      if (treat.eaten) continue;
      const away = Math.hypot(treat.x - pony.x, treat.y - pony.y);
      if (away < TREAT_SMELL) pairs.push({ p, t, away });
    }
  }
  if (pairs.length === 0) return claims;

  pairs.sort((a, b) => a.away - b.away || a.p - b.p || a.t - b.t);
  const taken = new Set();
  for (const pair of pairs) {
    if (claims[pair.p] || taken.has(pair.t)) continue;
    claims[pair.p] = { treat: treats[pair.t], away: pair.away };
    taken.add(pair.t);
  }
  return claims;
}

/**
 * Where each pony that is following someone should be standing.
 *
 * Places are handed out in roster order so a pony keeps the same one for as
 * long as the same crowd is together, and the first place is right at the
 * child's side — one pony following looks exactly as it did before, and it is
 * only the second, third and eighteenth that get sent further out.
 *
 * @returns {Array<{x:number,y:number}|null>} indexed like the herd
 */
function fanOut(ponies, players, bounds) {
  const spots = ponies.map(() => null);
  if (players.length === 0) return spots;

  for (const player of players) {
    let place = 0;
    for (const [i, pony] of ponies.entries()) {
      if (pony.friend !== player.id) continue;
      // A little of the pony's own seed in the angle, so the ring is a herd
      // standing about rather than a diagram.
      const angle = place * GOLDEN_ANGLE + hash01(pony.n, 0xbeef) * 0.5;
      const radius = HEEL + Math.sqrt(place) * FOLLOW_RING;
      spots[i] = {
        x: clamp(player.x + Math.cos(angle) * radius * RING_SHAPE.x, bounds.minX, bounds.maxX),
        y: clamp(player.y + Math.sin(angle) * radius * RING_SHAPE.y, bounds.minY, bounds.maxY),
      };
      place += 1;
    }
  }
  return spots;
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

    const claims = shareOutTreats(this.ponies, treats);
    const spots = fanOut(this.ponies, players, b);
    // Kept so that facing and the walk cycle can be worked out at the end of
    // the tick, once everyone has both walked and made room for each other.
    const before = this.ponies.map((p) => ({ x: p.x, y: p.y }));
    /** Who each pony has an eye on, for the second pass. */
    const watching = [];

    for (const [index, pony] of this.ponies.entries()) {
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
      watching.push(nearest);

      // Whichever strawberry was put aside for this one, if any.
      const claim = claims[index];
      const target = claim ? claim.treat : null;
      const best = claim ? claim.away : Infinity;

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
      const spot = spots[index];
      if (!pony.chase && leader && spot) {
        const away = Math.hypot(leader.x - pony.x, leader.y - pony.y);
        if (away > FOLLOW_GIVE_UP) {
          pony.friend = null;
        } else if (Math.hypot(spot.x - pony.x, spot.y - pony.y) > ARRIVED) {
          pony.target = spot;
          hurry = Math.min(HURRY.max, WANDER_SPEED + Math.max(0, away - HEEL) * HURRY.gain);
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

    this.makeRoom(dt, players);

    // Which way each is facing, and whether the legs are moving, is settled
    // last — after shuffling aside as well as after walking, so a pony edging
    // out of someone's way turns and steps rather than sliding sideways.
    for (const [index, pony] of this.ponies.entries()) {
      const was = before[index];
      const nearest = watching[index];
      const movedX = pony.x - was.x;
      const speed = dt > 0 ? Math.hypot(movedX, pony.y - was.y) / dt : 0;
      pony.moving = speed > 0.12;
      if (movedX > 0.005) pony.facing = 1;
      else if (movedX < -0.005) pony.facing = -1;
      // Standing still with a child beside it: turn and face them.
      else if (nearest && !pony.moving) pony.facing = nearest.x < pony.x ? -1 : 1;

      pony.mood =
        now < pony.cheerUntil ? MOOD.HAPPY : nearest || pony.friend ? MOOD.LOOKING : MOOD.CALM;
    }

    return { poops, eaten, cheers };
  }

  /**
   * Nudges apart anyone standing on top of somebody else.
   *
   * Ponies have no idea they are drawn as pictures, so nothing in the walking
   * above stops two of them ending up in the same square metre — and when they
   * do, the two sprites overlay into one unreadable smudge of legs. This is the
   * fix: after everyone has moved, anything inside somebody's personal space
   * gets a gentle shove out of it.
   *
   * The shove is capped by speed rather than applied outright, so a crowd
   * loosens over about half a second — ponies shuffling apart, not popping.
   * Children are pushed *from* but never pushed: their position is theirs to
   * decide, and a meadow that shoved a child around would be a poor meadow.
   */
  makeRoom(dt, players = []) {
    const b = this.bounds;
    const budget = SHUFFLE * dt;
    const shove = this.ponies.map(() => ({ x: 0, y: 0 }));

    /** How far out of the oval a pair is, and which way that points. */
    const overlap = (fromX, fromY, toX, toY, n) => {
      let dx = toX - fromX;
      let dy = toY - fromY;
      // Dead centre on top of each other has no direction to push along, so
      // the seed picks one — the same one every tick, so they part cleanly
      // instead of jittering.
      if (Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4) {
        dx = hash01(n, 0xc0de) < 0.5 ? -1e-3 : 1e-3;
      }
      const nx = dx / PERSONAL_SPACE.x;
      const ny = dy / PERSONAL_SPACE.y;
      const d = Math.hypot(nx, ny);
      if (d >= 1) return null;
      // Back into world units, scaled to how deep inside the oval they are.
      const out = (1 - d) / d;
      return { x: nx * PERSONAL_SPACE.x * out, y: ny * PERSONAL_SPACE.y * out };
    };

    for (let i = 0; i < this.ponies.length; i++) {
      const a = this.ponies[i];
      for (let j = i + 1; j < this.ponies.length; j++) {
        const c = this.ponies[j];
        const push = overlap(a.x, a.y, c.x, c.y, a.n ^ c.n);
        if (!push) continue;
        // Half each, so neither is held responsible for the crowding.
        shove[i].x -= push.x * 0.5;
        shove[i].y -= push.y * 0.5;
        shove[j].x += push.x * 0.5;
        shove[j].y += push.y * 0.5;
      }
      for (const player of players) {
        const push = overlap(a.x, a.y, player.x, player.y, a.n);
        if (!push) continue;
        shove[i].x -= push.x;
        shove[i].y -= push.y;
      }
    }

    for (const [i, pony] of this.ponies.entries()) {
      const want = shove[i];
      const size = Math.hypot(want.x, want.y);
      if (size < 1e-6) continue;
      const step = Math.min(size, budget) / size;
      pony.x = clamp(pony.x + want.x * step, b.minX, b.maxX);
      pony.y = clamp(pony.y + want.y * step, b.minY, b.maxY);
    }
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
