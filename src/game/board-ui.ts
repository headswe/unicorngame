/**
 * The drawing board, full screen, with the crayon box down one side.
 *
 * DOM and a 2D canvas rather than anything in the scene, for the same reasons
 * the spellbook is: drawing wants crisp lines at any screen density, and an
 * overlay is also what stops a stray finger ordering the unicorn to walk off
 * while somebody is colouring in.
 *
 * The board itself lives in `Board` and is shared with the easel out in the
 * meadow. This is only the hands: it reads the pointer, turns it into ink, and
 * hands finished chunks to whoever is sending them.
 */

import { CRAYONS, MAX_POINTS, NIBS, quantise, type Board } from './board.ts';

/** How often a line in progress is sent out, in milliseconds. */
const INK_EVERY = 90;

export interface BoardUiCallbacks {
  /** A chunk of a line to send. The first chunk of a line is its beginning. */
  onInk(stroke: string, colour: number, nib: number, xy: number[]): void;
  /** Lines to take away, whoever drew them. */
  onRub(strokes: string[]): void;
  onClose(): void;
  onSound(kind: 'open' | 'rub' | 'undo'): void;
}

export class BoardUi {
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;

  private colour = 0;
  private nib = 1;
  private rubbing = false;

  /** The line being drawn, if a finger is down. */
  private stroke: string | null = null;
  private pending: number[] = [];
  private points = 0;
  private lastSent = 0;
  private lastX = -1;
  private lastY = -1;

  /** True while the overlay is up, so the game can hold the unicorn still. */
  open = false;

  constructor(
    parent: HTMLElement,
    private readonly board: Board,
    private readonly me: string,
    private readonly callbacks: BoardUiCallbacks,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'board';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="board-panel" role="dialog" aria-modal="true" aria-label="Rita">
        <button type="button" class="board-close" aria-label="Klar">✕</button>
        <div class="board-sheet"></div>
        <div class="board-tools">
          <div class="board-crayons"></div>
          <div class="board-nibs"></div>
          <button type="button" class="board-tool board-rub" aria-label="Sudda">🧽</button>
          <button type="button" class="board-tool board-undo" aria-label="Ångra">↩︎</button>
        </div>
      </div>
    `;
    parent.appendChild(this.root);

    const q = <T extends HTMLElement>(sel: string): T => {
      const el = this.root.querySelector<T>(sel);
      if (!el) throw new Error(`board overlay markup missing ${sel}`);
      return el;
    };

    // The board's own canvas *is* the visible one — shown here, and read
    // straight off as the texture hanging on the easel. Drawing into a second
    // canvas and copying it across would be one full-board blit per chunk of
    // ink from every child in the meadow, for no gain at all.
    this.canvas = board.canvas;
    this.canvas.className = 'board-canvas';
    q<HTMLDivElement>('.board-sheet').appendChild(this.canvas);

    q<HTMLButtonElement>('.board-close').addEventListener('click', () => this.close());
    this.buildCrayons(q<HTMLDivElement>('.board-crayons'));
    this.buildNibs(q<HTMLDivElement>('.board-nibs'));

    const rub = q<HTMLButtonElement>('.board-rub');
    rub.addEventListener('click', () => {
      this.rubbing = !this.rubbing;
      this.paintTools();
    });
    q<HTMLButtonElement>('.board-undo').addEventListener('click', () => {
      const last = this.board.lastBy(this.me);
      if (!last) return;
      this.callbacks.onSound('undo');
      this.callbacks.onRub([last]);
    });

    this.attachDrawing();
    this.paintTools();
  }

  private buildCrayons(into: HTMLDivElement): void {
    for (const [i, crayon] of CRAYONS.entries()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'board-crayon';
      button.style.setProperty('--crayon', crayon.hex);
      button.setAttribute('aria-label', crayon.name);
      button.addEventListener('click', () => {
        this.colour = i;
        // Picking a colour is also how you put the rubber down, which saves a
        // child working out that the rubber is still on.
        this.rubbing = false;
        this.paintTools();
      });
      into.appendChild(button);
    }
  }

  private buildNibs(into: HTMLDivElement): void {
    for (const [i, nib] of NIBS.entries()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'board-nib';
      button.setAttribute('aria-label', `Tjocklek ${i + 1}`);
      button.innerHTML = `<span style="width:${6 + nib * 340}px;height:${6 + nib * 340}px"></span>`;
      button.addEventListener('click', () => {
        this.nib = i;
        this.rubbing = false;
        this.paintTools();
      });
      into.appendChild(button);
    }
  }

  /** Shows which crayon, which thickness, and whether the rubber is up. */
  private paintTools(): void {
    const crayons = this.root.querySelectorAll<HTMLButtonElement>('.board-crayon');
    crayons.forEach((el, i) => el.classList.toggle('on', i === this.colour && !this.rubbing));
    const nibs = this.root.querySelectorAll<HTMLButtonElement>('.board-nib');
    nibs.forEach((el, i) => el.classList.toggle('on', i === this.nib && !this.rubbing));
    this.root.querySelector('.board-rub')?.classList.toggle('on', this.rubbing);
    this.canvas.classList.toggle('rubbing', this.rubbing);
  }

  private attachDrawing(): void {
    /** Pointer position as a fraction of the board, 0..1. */
    const place = (event: PointerEvent): { x: number; y: number } => {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
      };
    };

    this.canvas.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.canvas.setPointerCapture(event.pointerId);
      const at = place(event);
      if (this.rubbing) {
        this.rub(at.x, at.y);
        return;
      }
      this.begin(at.x, at.y);
    });

    this.canvas.addEventListener('pointermove', (event) => {
      if (!event.buttons && !this.stroke) return;
      const at = place(event);
      if (this.rubbing) {
        if (event.buttons) this.rub(at.x, at.y);
        return;
      }
      if (!this.stroke) return;
      event.preventDefault();
      this.extend(at.x, at.y);
    });

    const finish = (): void => {
      if (!this.stroke) return;
      this.flush();
      this.stroke = null;
    };
    this.canvas.addEventListener('pointerup', finish);
    this.canvas.addEventListener('pointercancel', finish);
    this.canvas.addEventListener('pointerleave', finish);
  }

  private begin(x: number, y: number): void {
    this.stroke = `${this.me}:${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
    this.pending = [];
    this.points = 0;
    this.lastSent = 0;
    this.lastX = -1;
    this.lastY = -1;
    this.extend(x, y);
  }

  private extend(x: number, y: number): void {
    const qx = quantise(x);
    const qy = quantise(y);
    // Points closer together than the ink is thick add nothing but bytes.
    if (this.lastX >= 0 && Math.hypot(qx - this.lastX, qy - this.lastY) < 4) return;
    this.lastX = qx;
    this.lastY = qy;
    this.pending.push(qx, qy);
    this.points += 1;

    // A line that has run on long enough is finished and a fresh one started,
    // so one endless scribble cannot become one enormous message.
    if (this.points >= MAX_POINTS) {
      this.flush();
      // Starting the new one where the old one ended keeps the join invisible.
      this.begin(x, y);
      return;
    }
    if (performance.now() - this.lastSent >= INK_EVERY) this.flush();
  }

  /** Sends whatever has been drawn since the last time, and draws it here. */
  private flush(): void {
    if (!this.stroke || this.pending.length === 0) return;
    const xy = this.pending;
    this.pending = [];
    this.lastSent = performance.now();
    // Straight into the shared board as well as out onto the wire, so this
    // child's own line appears under their finger rather than after a round
    // trip they can feel.
    this.board.ink(this.stroke, this.me, this.colour, this.nib, xy);
    this.callbacks.onInk(this.stroke, this.colour, this.nib, xy);
  }

  private rub(x: number, y: number): void {
    const hits = this.board.under(x, y);
    if (hits.length === 0) return;
    this.callbacks.onSound('rub');
    this.callbacks.onRub(hits);
  }

  show(): void {
    if (this.open) return;
    this.open = true;
    this.root.hidden = false;
    this.rubbing = false;
    this.paintTools();
    this.callbacks.onSound('open');
  }

  close(): void {
    if (!this.open) return;
    this.stroke = null;
    this.open = false;
    this.root.hidden = true;
    this.callbacks.onClose();
  }
}
