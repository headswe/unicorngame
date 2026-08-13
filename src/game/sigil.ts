/**
 * Sigil recognition.
 *
 * The player picks a spell first and then traces its shape, so this never has
 * to work out *which* sigil was drawn — only how closely one stroke matches one
 * template. That is a much easier problem, and a much more forgiving one, which
 * matters when the hand holding the finger is six years old.
 *
 * The method is the normalisation half of the $1 unistroke recogniser:
 * resample both strokes to the same number of evenly spaced points, centre
 * them, scale them to the same size, then average the distance between
 * corresponding points. Closed shapes are additionally compared at every
 * starting offset and in both directions, so it does not matter where on the
 * circle you begin or which way round you go.
 */

export interface Point {
  x: number;
  y: number;
}

/** Points per normalised stroke. Enough for a triangle, cheap enough to brute force. */
const SAMPLES = 32;

export interface SigilTemplate {
  id: string;
  /** Outline in a 0..1 box, y down, as it will be shown on screen. */
  points: Point[];
  /** Closed shapes may be started anywhere and drawn either way round. */
  closed: boolean;
  /** 0..1. Lower is more forgiving. */
  threshold: number;
}

function pathLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  }
  return total;
}

/** Evenly spaces `count` points along the stroke, regardless of drawing speed. */
export function resample(points: Point[], count = SAMPLES): Point[] {
  if (points.length < 2) return [];

  const interval = pathLength(points) / (count - 1);
  if (interval <= 0) return [];

  const out: Point[] = [{ ...points[0]! }];
  let accumulated = 0;
  const working = points.slice();

  for (let i = 1; i < working.length; i++) {
    const previous = working[i - 1]!;
    const current = working[i]!;
    const distance = Math.hypot(current.x - previous.x, current.y - previous.y);

    if (accumulated + distance >= interval) {
      const ratio = (interval - accumulated) / distance;
      const point = {
        x: previous.x + ratio * (current.x - previous.x),
        y: previous.y + ratio * (current.y - previous.y),
      };
      out.push(point);
      // Continue from the new point rather than the original vertex.
      working.splice(i, 0, point);
      accumulated = 0;
    } else {
      accumulated += distance;
    }
  }

  // Floating point can leave us one short.
  while (out.length < count) out.push({ ...working[working.length - 1]! });
  return out.slice(0, count);
}

/** Centres on the origin and scales the longer axis to 1. */
function normalise(points: Point[]): Point[] {
  if (!points.length) return points;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }

  // Uniform scale, so a squashed circle still reads as a circle but a line
  // drawn instead of a triangle does not.
  const size = Math.max(maxX - minX, maxY - minY) || 1;
  const centreX = (minX + maxX) / 2;
  const centreY = (minY + maxY) / 2;

  return points.map((p) => ({ x: (p.x - centreX) / size, y: (p.y - centreY) / size }));
}

function meanDistance(a: Point[], b: Point[], offset: number, reversed: boolean): number {
  let total = 0;
  const n = a.length;
  for (let i = 0; i < n; i++) {
    const j = reversed ? (n - 1 - ((i + offset) % n)) : (i + offset) % n;
    total += Math.hypot(a[i]!.x - b[j]!.x, a[i]!.y - b[j]!.y);
  }
  return total / n;
}

export interface SigilResult {
  /** 0..1, where 1 is a perfect trace. */
  score: number;
  passed: boolean;
}

/**
 * Scores a drawn stroke against a template.
 *
 * A stroke that is too short to be a deliberate shape scores zero rather than
 * accidentally matching — a stray tap should never cast a spell.
 */
export function scoreSigil(drawn: Point[], template: SigilTemplate): SigilResult {
  if (drawn.length < 8 || pathLength(drawn) < 60) return { score: 0, passed: false };

  const a = normalise(resample(drawn));
  const b = normalise(resample(template.points));
  if (a.length !== b.length || !a.length) return { score: 0, passed: false };

  let best = Infinity;
  // An open shape has one beginning; a closed one may be started anywhere.
  // Either kind may be drawn backwards — a spiral traced outward and one traced
  // inward are the same shape, and insisting on a direction would only fail
  // children who drew the right thing.
  const offsets = template.closed ? a.length : 1;
  for (let offset = 0; offset < offsets; offset++) {
    best = Math.min(best, meanDistance(a, b, offset, false));
    best = Math.min(best, meanDistance(a, b, offset, true));
  }

  // Half the normalised size is about as wrong as a stroke can get while still
  // being the same rough scale, so that is where the score bottoms out.
  const score = Math.max(0, 1 - best / 0.5);
  return { score, passed: score >= template.threshold };
}

/** A circle, starting at the top and going clockwise. */
function circle(steps = 40): Point[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const angle = (i / steps) * Math.PI * 2 - Math.PI / 2;
    return { x: 0.5 + Math.cos(angle) * 0.45, y: 0.5 + Math.sin(angle) * 0.45 };
  });
}

/** Fits an arbitrary shape into the 0..1 box the templates are drawn in. */
function fit(points: Point[], pad = 0.05): Point[] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }

  // One scale for both axes, then the shorter one is centred in the box.
  const size = Math.max(maxX - minX, maxY - minY) || 1;
  const span = 1 - pad * 2;
  const insetX = (size - (maxX - minX)) / 2;
  const insetY = (size - (maxY - minY)) / 2;

  return points.map((p) => ({
    x: pad + ((p.x - minX + insetX) / size) * span,
    y: pad + ((p.y - minY + insetY) / size) * span,
  }));
}

/**
 * A heart, starting at the notch between the lobes and going clockwise.
 *
 * Chosen over the more obvious egg shape because an egg is barely
 * distinguishable from the flower spell's circle, and over a spiral because a
 * spiral's score depends on how many turns you draw — and a six-year-old does
 * not count turns.
 */
function heart(steps = 64): Point[] {
  return fit(
    Array.from({ length: steps + 1 }, (_, i) => {
      const t = (i / steps) * Math.PI * 2;
      return {
        x: 16 * Math.sin(t) ** 3,
        // Screen y grows downward, so the classic curve is flipped.
        y: -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)),
      };
    }),
  );
}

/** Straight edges get intermediate points so resampling follows the corners. */
function polygon(corners: Point[]): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < corners.length - 1; i++) {
    const from = corners[i]!;
    const to = corners[i + 1]!;
    for (let t = 0; t < 12; t++) {
      out.push({
        x: from.x + ((to.x - from.x) * t) / 12,
        y: from.y + ((to.y - from.y) * t) / 12,
      });
    }
  }
  out.push(corners[corners.length - 1]!);
  return out;
}

export const SIGILS: Record<string, SigilTemplate> = {
  /** A strawberry is a triangle, point down. */
  triangle: {
    id: 'triangle',
    points: polygon([
      { x: 0.5, y: 0.06 },
      { x: 0.94, y: 0.88 },
      { x: 0.06, y: 0.88 },
      { x: 0.5, y: 0.06 },
    ]),
    closed: true,
    // A circle scores about 0.65 against this template — the two shapes are
    // not far apart once both are normalised — so the bar sits above that.
    threshold: 0.72,
  },
  circle: {
    id: 'circle',
    points: circle(),
    closed: true,
    threshold: 0.68,
  },
  heart: {
    id: 'heart',
    points: heart(),
    closed: true,
    threshold: 0.72,
  },
};
