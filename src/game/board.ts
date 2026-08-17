/**
 * The drawing board everybody shares.
 *
 * One board, one drawing, everyone at once. A line appears on every screen as
 * it is being drawn rather than when it is finished, because half the fun is
 * watching a cousin's flower arrive stroke by stroke — so ink goes out in
 * chunks while the finger is still moving.
 *
 * Anyone may rub out anything, including someone else's line. That is a
 * decision rather than an oversight: it is one family sharing one board, the
 * way they would share a real one. Undo is different — it takes back the last
 * thing *you* drew, because an undo that removed whatever your sister had just
 * finished would not be an undo, it would be a lottery.
 *
 * Coordinates are 0..1 across the board, quantised to whole thousandths on the
 * wire. That is finer than any finger and it keeps a whole day's drawing to a
 * few tens of kilobytes, which matters because the entire board is handed to
 * every child who joins.
 */

/** How finely a point is recorded. A thousandth of a board is sub-pixel. */
export const INK_SCALE = 1000;

/**
 * What the board is drawn at, and its shape.
 *
 * Square, because that is the shape of the easel and the shape a phone held
 * upright can actually show: a landscape board on a portrait screen can only
 * ever be as tall as the screen is wide, which threw away half the drawing
 * area. Matching the white face in the artwork exactly is what stops the
 * drawing being stretched between the board a child draws on and the board they
 * see out in the meadow.
 */
export const BOARD = { width: 900, height: 882 };

/**
 * Where the white face sits inside the easel drawing, as fractions of the
 * sprite. Measured off the generated art by `scripts/board-face.mjs`, which
 * finds the big white rectangle — the same way the ear patch rect was found.
 */
export const BOARD_FACE = { x: 0.094, y: 0.32, width: 0.811, height: 0.527 };

/** The crayon box. Bright, well separated, and readable against white. */
export const CRAYONS = [
  { name: 'Svart', hex: '#3b2b22' },
  { name: 'Röd', hex: '#e8443a' },
  { name: 'Orange', hex: '#f4923b' },
  { name: 'Gul', hex: '#f6cf3e' },
  { name: 'Grön', hex: '#4bb45e' },
  { name: 'Blå', hex: '#3d8fd6' },
  { name: 'Lila', hex: '#9a6ad4' },
  { name: 'Rosa', hex: '#f27bb0' },
] as const;

/** Crayon thicknesses, as a fraction of the board's height. */
export const NIBS = [0.008, 0.018, 0.036];

/** How near the rubber has to pass a line to take it away. */
const RUB_RADIUS = 0.03;

/** As many lines as the board will hold before the oldest start to go. */
export const MAX_STROKES = 300;
/** And how long one line may be before it is broken into another. */
export const MAX_POINTS = 120;

/**
 * One line, as it travels and as it is stored.
 *
 * `xy` is a flat run of quantised coordinates rather than an array of objects:
 * it is a third of the size on the wire and it is what a canvas wants anyway.
 */
export interface Stroke {
  id: string;
  /** Who drew it, so undo can find its owner's last line. */
  by: string;
  /** Index into CRAYONS. */
  colour: number;
  /** Index into NIBS. */
  nib: number;
  /** `[x0, y0, x1, y1, …]`, each 0..INK_SCALE. */
  xy: number[];
  /**
   * What the line fits inside, kept up to date as it grows.
   *
   * Only so the rubber can skip a line in one comparison instead of walking a
   * hundred and twenty points of it. With a full board that is the difference
   * between a few dozen checks per wipe and a few tens of thousands.
   */
  box?: { minX: number; minY: number; maxX: number; maxY: number };
}

/** A tidy hex for a colour index, tolerant of a value from an older version. */
export function crayonHex(colour: number): string {
  return (CRAYONS[colour] ?? CRAYONS[0]!).hex;
}

function nibWidth(nib: number): number {
  return (NIBS[nib] ?? NIBS[1]!) * BOARD.height;
}

/**
 * Everything on the board, and the drawing of it.
 *
 * Keeps its own canvas, which is both what the overlay shows and what the easel
 * out in the meadow is textured with — one drawing, so the two can never
 * disagree about what is on the board.
 */
export class Board {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private strokes: Stroke[] = [];
  private readonly byId = new Map<string, Stroke>();

  /**
   * Bumped on every change, so the easel out in the meadow knows to upload the
   * canvas again.
   *
   * Every path that touches the canvas has to bump it, which is a rule easy to
   * forget — and forgetting it once already meant a child arriving to a blank
   * easel that filled in the moment they drew on it, because taking the whole
   * board from the relay repainted the canvas without saying so. `repaint` bumps
   * it itself now, so the only path left to remember by hand is `ink`.
   */
  version = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = BOARD.width;
    this.canvas.height = BOARD.height;
    this.ctx = this.canvas.getContext('2d');
    this.repaint();
  }

  get count(): number {
    return this.strokes.length;
  }

  /** Throws away everything and takes a whole board, as sent on joining. */
  load(strokes: Stroke[]): void {
    this.strokes = [];
    this.byId.clear();
    for (const stroke of strokes) this.add(stroke);
    this.repaint();
  }

  /**
   * Adds points to a line, creating it if this is the first anyone has heard.
   *
   * Called both for this child's own drawing and for everyone else's, which is
   * what makes a line appear on every screen while it is still being drawn.
   */
  ink(id: string, by: string, colour: number, nib: number, xy: number[]): void {
    const existing = this.byId.get(id);
    if (!existing) {
      this.add({ id, by, colour, nib, xy: [...xy] });
      this.drawStroke(this.byId.get(id)!);
      this.version += 1;
      return;
    }
    // Draw only the new part: repainting the whole board on every chunk of a
    // long scribble is the one thing here that could actually cost anything.
    const from = Math.max(0, existing.xy.length - 2);
    existing.xy.push(...xy);
    this.grow(existing, from);
    this.drawStroke(existing, from / 2);
    this.version += 1;
  }

  /** Widens a line's bounding box to take in the points from `from` onward. */
  private grow(stroke: Stroke, from = 0): void {
    let box = stroke.box;
    for (let i = from; i < stroke.xy.length; i += 2) {
      const x = stroke.xy[i]!;
      const y = stroke.xy[i + 1]!;
      if (!box) box = { minX: x, minY: y, maxX: x, maxY: y };
      else {
        if (x < box.minX) box.minX = x;
        if (x > box.maxX) box.maxX = x;
        if (y < box.minY) box.minY = y;
        if (y > box.maxY) box.maxY = y;
      }
    }
    stroke.box = box;
  }

  private add(stroke: Stroke): void {
    this.grow(stroke);
    this.strokes.push(stroke);
    this.byId.set(stroke.id, stroke);
    // The board is a day long, not forever. When it is full the oldest lines
    // go, which is gentler than refusing to draw.
    while (this.strokes.length > MAX_STROKES) {
      const oldest = this.strokes.shift();
      if (oldest) this.byId.delete(oldest.id);
    }
  }

  /** Takes lines away by name. Used by both the rubber and undo. */
  remove(ids: string[]): boolean {
    let removed = false;
    for (const id of ids) {
      if (!this.byId.delete(id)) continue;
      removed = true;
    }
    if (!removed) return false;
    this.strokes = this.strokes.filter((s) => this.byId.has(s.id));
    this.repaint();
    return true;
  }

  /** The last line this child drew, for undo. */
  lastBy(who: string): string | null {
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const stroke = this.strokes[i]!;
      if (stroke.by === who) return stroke.id;
    }
    return null;
  }

  /**
   * Every line the rubber is touching, whoever drew it.
   *
   * Whole lines rather than the pixels under the rubber: a child expects a line
   * to come away when they rub it, and it keeps a rubbing-out to one small
   * message instead of a fresh copy of the drawing.
   */
  under(x: number, y: number): string[] {
    const hits: string[] = [];
    const reach = RUB_RADIUS * INK_SCALE;
    const px = x * INK_SCALE;
    const py = y * INK_SCALE;
    for (const stroke of this.strokes) {
      const pad = reach + (nibWidth(stroke.nib) / BOARD.height) * INK_SCALE * 0.5;
      const box = stroke.box;
      if (
        box &&
        (px < box.minX - pad || px > box.maxX + pad || py < box.minY - pad || py > box.maxY + pad)
      ) {
        continue;
      }
      for (let i = 0; i < stroke.xy.length; i += 2) {
        if (Math.hypot(stroke.xy[i]! - px, stroke.xy[i + 1]! - py) < pad) {
          hits.push(stroke.id);
          break;
        }
      }
    }
    return hits;
  }

  /** Redraws everything from scratch, and says so. */
  private repaint(): void {
    this.version += 1;
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.fillStyle = '#fffdf8';
    ctx.fillRect(0, 0, BOARD.width, BOARD.height);
    for (const stroke of this.strokes) this.drawStroke(stroke);
  }

  /** Draws one line, or the part of it from `fromPoint` onward. */
  private drawStroke(stroke: Stroke, fromPoint = 0): void {
    const ctx = this.ctx;
    if (!ctx || stroke.xy.length < 2) return;

    ctx.strokeStyle = crayonHex(stroke.colour);
    ctx.lineWidth = nibWidth(stroke.nib);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // A single tap is a dot, which a stroked path of one point would not draw.
    if (stroke.xy.length === 2) {
      ctx.fillStyle = crayonHex(stroke.colour);
      ctx.beginPath();
      ctx.arc(
        (stroke.xy[0]! / INK_SCALE) * BOARD.width,
        (stroke.xy[1]! / INK_SCALE) * BOARD.height,
        ctx.lineWidth / 2,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      return;
    }

    ctx.beginPath();
    for (let i = fromPoint * 2; i < stroke.xy.length; i += 2) {
      const x = (stroke.xy[i]! / INK_SCALE) * BOARD.width;
      const y = (stroke.xy[i + 1]! / INK_SCALE) * BOARD.height;
      if (i === fromPoint * 2) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

/** Turns a point on the board into what goes on the wire. */
export const quantise = (v: number): number =>
  Math.max(0, Math.min(INK_SCALE, Math.round(v * INK_SCALE)));
