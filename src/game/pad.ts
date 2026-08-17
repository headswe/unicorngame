/**
 * On-screen arrows, for the children playing on a tablet.
 *
 * Tapping where you want to go works, and steering by holding a finger to one
 * side of the screen works, but neither is obvious to a child who has just
 * been handed the thing — you have to be told. Arrows do not need explaining:
 * they are visibly there, they light up when pressed, and they are the same
 * shape in all three places.
 *
 * They press real arrow keys through `Input.hold` rather than having their own
 * route into the game, so the meadow, the bouncing yard and the racing
 * dimension all pick them up through the `moveAxis` they already read.
 *
 * The shape changes with the place, because the places do not ask the same
 * thing: the meadow is walk-anywhere, and the other two are only ever left and
 * right.
 */

import type { Input } from '../engine/input.ts';

/**
 * `walk` is the full cross, `sides` is left and right only, `none` hides them
 * — which is what an overlay wants, so nobody is steering a pony from behind
 * the spellbook.
 */
export type PadShape = 'walk' | 'sides' | 'none';

const KEYS = [
  ['up', 'ArrowUp', '▲', 'Gå uppåt'],
  ['left', 'ArrowLeft', '◀', 'Gå åt vänster'],
  ['right', 'ArrowRight', '▶', 'Gå åt höger'],
  ['down', 'ArrowDown', '▼', 'Gå nedåt'],
] as const;

export class Pad {
  private readonly root: HTMLDivElement;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private shape: PadShape = 'none';

  constructor(parent: HTMLElement, private readonly input: Input) {
    this.root = document.createElement('div');
    this.root.className = 'pad';
    this.root.hidden = true;
    this.root.innerHTML = KEYS.map(
      ([name, , glyph, label]) =>
        `<button type="button" class="pad-key pad-${name}" aria-label="${label}">` +
        `<span aria-hidden="true">${glyph}</span></button>`,
    ).join('');
    parent.appendChild(this.root);

    for (const [name, code] of KEYS) {
      const button = this.root.querySelector<HTMLButtonElement>(`.pad-${name}`);
      if (!button) throw new Error('pad markup did not build');
      this.buttons.set(name, button);

      const press = (down: boolean): void => {
        button.classList.toggle('down', down);
        this.input.hold(code, down);
      };

      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        // Captured, so a thumb that drifts off the edge of the button keeps
        // walking instead of stopping dead halfway across the meadow.
        button.setPointerCapture(event.pointerId);
        press(true);
      });
      // One release for all the ways a press can end, capture included.
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
        button.addEventListener(type, () => press(false));
      }
      // Holding an arrow and then switching tabs would otherwise leave the key
      // down; Input clears everything on blur, so only the lit look is left.
      window.addEventListener('blur', () => press(false));
    }
  }

  setShape(shape: PadShape): void {
    if (shape === this.shape) return;
    this.shape = shape;
    this.root.hidden = shape === 'none';
    this.root.dataset.shape = shape;
    // Anything on its way out has to let go of its key, or a child who taps
    // "up" as they walk through the gate arrives in the yard still holding it.
    if (shape !== 'walk') {
      for (const name of ['up', 'down'] as const) {
        const button = this.buttons.get(name);
        if (!button) continue;
        button.classList.remove('down');
        this.input.hold(name === 'up' ? 'ArrowUp' : 'ArrowDown', false);
      }
    }
    if (shape === 'none') {
      for (const [name, code] of KEYS) {
        this.buttons.get(name)?.classList.remove('down');
        this.input.hold(code, false);
      }
    }
  }
}
