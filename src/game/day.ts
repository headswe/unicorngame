/**
 * Which day the meadow is on.
 *
 * The field is re-rolled every morning: new scenery, new hills, a new herd. The
 * seed is the date, so it needs to be a date that everybody agrees on.
 *
 * Two decisions make that work:
 *
 * **One fixed timezone, not the device's.** Cousins in different houses can be
 * in different countries, and two children in the same lobby looking at
 * differently-arranged meadows would be worse than either arrangement. So the
 * date is always read in one place's clock, wherever the child actually is.
 *
 * **The day turns over at four in the morning, not at midnight.** Nobody is
 * playing at four. Rolling over at midnight would mean the meadow could change
 * shape under a child still using it on a late holiday evening, and would put
 * the boundary right where the relay and a browser are most likely to disagree
 * by a few seconds.
 *
 * The relay applies exactly the same rule — see server/meadow.js. If you change
 * one, change the other.
 */

/** Everyone's meadow runs on this clock, whatever clock they are on. */
export const MEADOW_TIMEZONE = 'Europe/Stockholm';

/** Hour of the local morning at which a new meadow appears. */
export const DAY_STARTS_AT = 4;

/**
 * The meadow's date as `YYYY-MM-DD`.
 *
 * `en-CA` is used purely because it formats as ISO, which sorts and compares
 * the way a date ought to.
 */
export function meadowDay(at: Date = new Date()): string {
  // Shifting the instant back means the small hours still count as yesterday.
  const shifted = new Date(at.getTime() - DAY_STARTS_AT * 3600_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: MEADOW_TIMEZONE }).format(shifted);
}

/** The world seed for a given day. */
export function meadowSeed(day: string = meadowDay()): string {
  return `angen-${day}`;
}
