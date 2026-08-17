/**
 * Keyboard and pointer input.
 *
 * Two ways to move, both always live: arrows/WASD on a laptop, and tap-or-drag
 * anywhere on a tablet. The pointer is reported in normalised device
 * coordinates; turning that into a spot in the meadow is the camera's job.
 */

const LEFT_KEYS = new Set(['ArrowLeft', 'KeyA']);
const RIGHT_KEYS = new Set(['ArrowRight', 'KeyD']);
const UP_KEYS = new Set(['ArrowUp', 'KeyW']);
const DOWN_KEYS = new Set(['ArrowDown', 'KeyS']);

export interface PointerState {
  /** A finger or button is currently down. */
  down: boolean;
  /** Went down since the last update(). */
  pressed: boolean;
  /** Came up since the last update(). */
  released: boolean;
  /** Normalised device coordinates, -1..1, y up. */
  x: number;
  y: number;
}

export class Input {
  private readonly held = new Set<string>();
  private pressedThisFrame = false;
  private releasedThisFrame = false;
  private readonly detach: Array<() => void> = [];

  readonly pointer: PointerState = {
    down: false,
    pressed: false,
    released: false,
    x: 0,
    y: 0,
  };

  constructor(private readonly element: HTMLElement) {
    this.on(window, 'keydown', (e) => {
      const ev = e as KeyboardEvent;
      if (ev.repeat) return;
      this.held.add(ev.code);
      // Arrow keys scroll the page on some setups; the game owns them here.
      if (ev.code.startsWith('Arrow') || ev.code === 'Space') ev.preventDefault();
    });
    this.on(window, 'keyup', (e) => this.held.delete((e as KeyboardEvent).code));
    // A window that loses focus mid-stride would otherwise keep walking.
    this.on(window, 'blur', () => {
      this.held.clear();
      this.pointer.down = false;
    });

    this.on(element, 'pointerdown', (e) => {
      const ev = e as PointerEvent;
      element.setPointerCapture?.(ev.pointerId);
      this.pointer.down = true;
      this.pressedThisFrame = true;
      this.updatePointer(ev);
    });
    this.on(element, 'pointermove', (e) => {
      const ev = e as PointerEvent;
      if (this.pointer.down) this.updatePointer(ev);
    });
    const end = (e: Event) => {
      const ev = e as PointerEvent;
      if (!this.pointer.down) return;
      this.pointer.down = false;
      this.releasedThisFrame = true;
      this.updatePointer(ev);
    };
    this.on(element, 'pointerup', end);
    this.on(element, 'pointercancel', end);
    this.on(element, 'contextmenu', (e) => e.preventDefault());
  }

  private on(target: EventTarget, type: string, handler: (e: Event) => void): void {
    const options = type === 'keydown' ? { passive: false } : undefined;
    target.addEventListener(type, handler, options);
    this.detach.push(() => target.removeEventListener(type, handler));
  }

  private updatePointer(ev: PointerEvent): void {
    const rect = this.element.getBoundingClientRect();
    this.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -(((ev.clientY - rect.top) / rect.height) * 2 - 1);
  }

  /** Keyboard movement axis, already clamped to unit length for diagonals. */
  moveAxis(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    for (const key of this.held) {
      if (LEFT_KEYS.has(key)) x -= 1;
      if (RIGHT_KEYS.has(key)) x += 1;
      if (UP_KEYS.has(key)) y += 1;
      if (DOWN_KEYS.has(key)) y -= 1;
    }
    const length = Math.hypot(x, y);
    return length > 1 ? { x: x / length, y: y / length } : { x, y };
  }

  isDown(code: string): boolean {
    return this.held.has(code);
  }

  /**
   * Holds or releases a key from somewhere other than a keyboard.
   *
   * The on-screen buttons press real arrow keys rather than having their own
   * path through the game: every place — the meadow, the bouncing yard, the
   * racing dimension — already reads `moveAxis`, and a second way of saying
   * "left" would be a second thing to keep in step with the first.
   */
  hold(code: string, down: boolean): void {
    if (down) this.held.add(code);
    else this.held.delete(code);
  }

  /** Publishes the edge-triggered flags for this frame. Call once per frame. */
  beginFrame(): void {
    this.pointer.pressed = this.pressedThisFrame;
    this.pointer.released = this.releasedThisFrame;
    this.pressedThisFrame = false;
    this.releasedThisFrame = false;
  }

  dispose(): void {
    for (const off of this.detach) off();
    this.detach.length = 0;
  }
}
