/**
 * What the meadow remembers.
 *
 * Almost nothing, deliberately. The field, the wandering herd and the day's
 * droppings are all worked out from the clock by each browser, identically, so
 * none of that is stored. What is left is only the *choices*: which poops were
 * shovelled, which eggs are waiting, which foals have been hatched. That fits
 * in a few kilobytes and makes the whole store a single small file.
 *
 * State is bucketed by local date and resets each morning — with one exception.
 * Hatchlings carry over, because a pony a child made should not be gone by
 * breakfast.
 *
 * The relay learns all of this by watching the messages it is already relaying,
 * so the clients need to tell it almost nothing extra.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { clutchOf, clutchSize } from './clutch.js';

/**
 * App Service mounts a persistent share at /home; everything else on the
 * instance is lost when a worker recycles. Locally this falls back to a folder
 * beside the server.
 */
const DATA_DIR = process.env.ANGEN_DATA_DIR ?? (process.env.WEBSITE_INSTANCE_ID ? '/home/data' : './data');
const FILE = join(DATA_DIR, 'meadow.json');

/**
 * The children are in Sweden, and the relay runs in UTC. Without this the
 * meadow would reset in the middle of a summer evening.
 *
 * This must match MEADOW_TIMEZONE in src/game/day.ts: the date is the seed the
 * whole field is generated from, so a relay and a browser that disagree about
 * the date would be looking at two different meadows.
 */
const TIMEZONE = process.env.ANGEN_TIMEZONE ?? 'Europe/Stockholm';

/** Hour of the local morning at which a new meadow appears. Matches the client. */
const DAY_STARTS_AT = 4;

/** Longest a wait between a change and it reaching disk. */
const SAVE_DEBOUNCE = 3000;

/** A cap so a stuck client cannot grow the file without bound. */
const LIMITS = { cleaned: 4000, poops: 200, eggs: 40, foals: 300 };

function today() {
  // Shifted back, so the small hours still count as yesterday and the meadow
  // never changes shape under a child who is still using it. en-CA is used
  // purely because it formats as ISO, which sorts and compares properly.
  const shifted = new Date(Date.now() - DAY_STARTS_AT * 3600_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(shifted);
}

/** The world seed for the current day. Must match meadowSeed in src/game/day.ts. */
export function meadowSeed() {
  return `angen-${today()}`;
}

function emptyDay(day) {
  return { day, cleaned: [], poops: [], eggs: [], foals: [] };
}

export class Meadow {
  #state = emptyDay(today());
  #dirty = false;
  #timer = null;

  async load() {
    try {
      const raw = JSON.parse(await readFile(FILE, 'utf8'));
      if (raw && Array.isArray(raw.foals)) {
        this.#state = raw.day === today()
          ? { ...emptyDay(raw.day), ...raw }
          // A new day: everything resets except the ponies they made.
          : { ...emptyDay(today()), foals: raw.foals };
      }
    } catch {
      // No file yet, or an unreadable one. A fresh meadow is a fine fallback —
      // far better than refusing to start and leaving the children with nothing.
    }
  }

  /** Rolls over to a new day if the clock has passed local midnight. */
  #freshen() {
    const now = today();
    if (this.#state.day === now) return;
    this.#state = { ...emptyDay(now), foals: this.#state.foals };
    this.#dirty = true;
  }

  /** The message handed to every browser as it connects. */
  snapshot() {
    this.#freshen();
    return { t: 'state', ...this.#state };
  }

  /**
   * Records anything worth keeping out of a message that is being relayed
   * anyway. Returns true when the message should still be passed on.
   */
  observe(message) {
    this.#freshen();
    const s = this.#state;

    switch (message?.t) {
      case 'clean':
        if (typeof message.poop !== 'string') return true;
        if (!s.cleaned.includes(message.poop)) {
          s.cleaned.push(message.poop);
          if (s.cleaned.length > LIMITS.cleaned) s.cleaned.shift();
        }
        // A cleaned poop is no longer waiting, whichever kind it was.
        s.poops = s.poops.filter((p) => p.id !== message.poop);
        this.#touch();
        break;

      case 'poop':
        if (typeof message.poop !== 'string') return true;
        if (s.cleaned.includes(message.poop)) return true;
        if (!s.poops.some((p) => p.id === message.poop) && s.poops.length < LIMITS.poops) {
          s.poops.push({ id: message.poop, x: message.x, y: message.y });
          this.#touch();
        }
        break;

      case 'spell':
        // Only the egg leaves anything behind; rain and flowers are over in a
        // few seconds and are not worth remembering.
        if (message.spell !== 'trollagg' || !message.variant) break;
        if (!s.eggs.some((e) => e.id === message.seed) && s.eggs.length < LIMITS.eggs) {
          s.eggs.push({
            id: message.seed,
            x: message.x,
            y: message.y,
            seed: message.seed,
            foal: message.variant,
            since: Math.floor(Date.now() / 1000),
          });
          this.#touch();
        }
        break;

      case 'hatched': {
        // A magic flower can hold twins or triplets, so a hatch names one egg
        // out of a clutch and the clutch is only forgotten once every egg in it
        // has been reported. Forgetting it on the first would lose the other
        // foals: their own reports would then find no record and be dropped,
        // and a child's twins would be one pony by the morning.
        const seed = clutchOf(message.egg);
        const clutch = s.eggs.find((e) => e.id === seed);
        if (!clutch) break;

        // Every browser watching reports it; the first report of each egg wins.
        clutch.hatched ??= [];
        if (clutch.hatched.includes(message.egg)) break;
        clutch.hatched.push(message.egg);

        if (s.foals.length < LIMITS.foals) {
          s.foals.push({ foal: message.foal, x: message.x, y: message.y });
        }
        if (clutch.hatched.length >= clutchSize(seed)) {
          s.eggs = s.eggs.filter((e) => e !== clutch);
        }
        this.#touch();
        break;
      }

      default:
        break;
    }
    return true;
  }

  #touch() {
    this.#dirty = true;
    if (this.#timer) return;
    // Batched: a busy afternoon of shovelling should not be a write per poop.
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.save();
    }, SAVE_DEBOUNCE);
    this.#timer.unref?.();
  }

  async save() {
    if (!this.#dirty) return;
    this.#dirty = false;
    try {
      await mkdir(dirname(FILE), { recursive: true });
      // Written aside and moved into place, so a recycle mid-write cannot leave
      // a half-file that fails to parse tomorrow morning.
      const temporary = `${FILE}.tmp`;
      await writeFile(temporary, JSON.stringify(this.#state));
      await rename(temporary, FILE);
    } catch (err) {
      // Losing the meadow is a shame; crashing the relay would end the game.
      console.error('could not save the meadow:', err.message);
    }
  }
}
