/**
 * The referee for the racing dimension.
 *
 * Races run on a loop whether or not anybody is there, so a child walking
 * through the portal always finds something happening: a wait on the grid, a
 * countdown, the race, the results, and round again. Nobody has to organise
 * anything, which is the point — there is no version of "who wants to race?"
 * that works when the youngest player is six and arrives alone.
 *
 * What is refereed here is only what has to be agreed. Driving is not: a kart
 * is far too immediate to put a round trip inside, so each child drives their
 * own and simply says where it ended up. This watches those positions, counts
 * the laps against the shared centre line, and decides the order — which is the
 * one thing three children in three houses cannot work out for themselves.
 *
 * Everybody finishes. There is no elimination and nobody is ever removed from
 * the track; the race ends when the last kart is home or when the clock runs
 * out, and coming last still means coming.
 */

import { LAPS, distance, gridSlot, lapStep, locate } from './track.js';

/** How long each phase lasts, in seconds. */
export const PHASES = {
  /** Long enough to walk in, see what is happening and get on the grid. */
  waiting: 10,
  /** One second a light: red, amber, green. Any longer and they fidget. */
  countdown: 3,
  /** A hard stop, so one child parked on the grass cannot hold up the next race. */
  racing: 210,
  results: 12,
};

/** As many as will fit on the grid without it being a scrum. */
const MAX_RACERS = 8;

/**
 * How long a racer can go without saying where they are before they are counted
 * out of the race.
 *
 * Without this, a child who drives back through the portal — or closes the lid —
 * halfway round leaves a kart nobody is driving that will never finish, and the
 * race cannot end until the three-and-a-half-minute stop. Everyone else sits
 * and waits for a kart that is not there.
 */
const GONE_AFTER = 3;

export class Race {
  #phase = 'waiting';
  #until = 0;
  /** Everyone in the current race: id → { lap, along, grid, finished }. */
  #racers = new Map();
  #startedAt = 0;
  #finished = [];
  /** When the last kart came home, so the results wait a beat after it. */
  #lastHome = null;

  constructor(now = Date.now() / 1000) {
    this.#until = now + PHASES.waiting;
  }

  get phase() {
    return this.#phase;
  }

  /** True while karts are allowed to move. */
  get rolling() {
    return this.#phase === 'racing';
  }

  /**
   * Advances the loop and takes in where everybody is.
   *
   * @param now unix seconds
   * @param onTrack ids of everyone currently in the racing dimension
   * @param at id → {x, y} for those same people
   * @returns true when the phase changed, which is worth telling everyone about
   */
  tick(now, onTrack, at) {
    if (this.#phase === 'racing') this.#watch(now, at);
    // While waiting, the grid is kept up to date as children arrive and leave,
    // so everybody can see where they will be starting from and sit on it.
    // At the countdown it simply stops changing.
    if (this.#phase === 'waiting') this.#seat(onTrack);

    if (now < this.#until && !this.#over(now)) return false;

    switch (this.#phase) {
      case 'waiting':
        this.#lineUp(onTrack, now);
        break;
      case 'countdown':
        this.#phase = 'racing';
        this.#startedAt = now;
        this.#until = now + PHASES.racing;
        break;
      case 'racing':
        this.#phase = 'results';
        this.#until = now + PHASES.results;
        break;
      default:
        this.#phase = 'waiting';
        this.#until = now + PHASES.waiting;
        this.#racers.clear();
        this.#finished = [];
        break;
    }
    return true;
  }

  /** Whether the race can stop early because everyone is home. */
  #over(now) {
    if (this.#phase !== 'racing') return false;
    if (this.#racers.size === 0) return true;
    for (const racer of this.#racers.values()) if (!racer.finished) return false;
    // Everybody is in. A breath on the line before the results, so the last
    // kart is seen crossing rather than vanishing at the moment it arrives.
    return now >= (this.#lastHome ?? now) + 1.5;
  }

  /** Hands out grid slots to whoever is on the track. */
  #seat(onTrack) {
    const wanted = onTrack.slice(0, MAX_RACERS);
    // Nothing to do is the common case, and it runs ten times a second.
    if (wanted.length === this.#racers.size && wanted.every((id) => this.#racers.has(id))) return;

    this.#racers.clear();
    for (const [place, id] of wanted.entries()) {
      const slot = gridSlot(place);
      this.#racers.set(id, {
        lap: 0,
        // Behind the line to start with, so the first crossing counts as lap
        // one rather than being mistaken for a wrap backwards.
        along: locate(slot.x, slot.y).along,
        grid: place,
        finished: false,
      });
    }
  }

  /** Freezes the grid and starts the countdown. */
  #lineUp(onTrack, now) {
    this.#finished = [];
    this.#lastHome = null;
    this.#seat(onTrack);
    this.#phase = 'countdown';
    this.#until = now + PHASES.countdown;
  }

  /** Follows the karts round and counts their laps. */
  #watch(now, at) {
    for (const [id, racer] of this.#racers) {
      if (racer.finished) continue;
      const where = at.get(id);
      if (!where) {
        // Gone quiet. Given a moment in case it is only a dropped packet, and
        // then counted out, so nobody is left waiting for an empty kart.
        racer.quiet = (racer.quiet ?? 0) + 1 / 10;
        if (racer.quiet > GONE_AFTER) this.#racers.delete(id);
        continue;
      }
      racer.quiet = 0;

      const along = locate(where.x, where.y).along;
      racer.lap = Math.max(0, racer.lap + lapStep(racer.along, along));
      racer.along = along;

      if (racer.lap >= LAPS) {
        racer.finished = true;
        this.#lastHome = now;
        this.#finished.push({ id, seconds: Math.round((now - this.#startedAt) * 10) / 10 });
      }
    }
  }

  /** Everyone in the race, best first. */
  #order() {
    const finishedFirst = this.#finished.map((f) => f.id);
    const rest = [...this.#racers.entries()]
      .filter(([id]) => !finishedFirst.includes(id))
      .sort((a, b) => distance(b[1].lap, b[1].along) - distance(a[1].lap, a[1].along))
      .map(([id]) => id);
    return [...finishedFirst, ...rest];
  }

  /** What the racing dimension is doing, for anyone watching or driving. */
  snapshot() {
    const laps = {};
    const grid = {};
    for (const [id, racer] of this.#racers) {
      laps[id] = racer.lap;
      grid[id] = racer.grid;
    }
    return {
      t: 'race',
      phase: this.#phase,
      until: Math.round(this.#until * 10) / 10,
      laps,
      order: this.#order(),
      finished: this.#finished,
      grid,
    };
  }
}
