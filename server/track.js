/**
 * The circuit, and everything anybody needs to know about being on it.
 *
 * Plain JavaScript in `server/` for the same reason the herd is: the relay and
 * the browser both need it and they must not disagree. The relay is the referee
 * — it counts the laps and decides who won — and it can only do that from the
 * karts' positions if it knows the same track the children are driving on.
 *
 * The track is a *path*, not a picture. A dozen or so control points are
 * smoothed into a closed loop, and everything else falls out of that: the road
 * is drawn by stroking the loop, being on the road is being near it, and how
 * far round you are is how far along it you are. That means there is exactly
 * one description of the circuit, so the road a child can see and the road the
 * lap counter believes in cannot come apart.
 */

/**
 * How wide the road is, in world units. A kart is a little over two long.
 *
 * Wide enough for three abreast, which is what makes it forgiving: a child who
 * misjudges a corner runs wide onto the other side of the road rather than
 * straight into the grass.
 */
export const ROAD_WIDTH = 9;

/** How many laps a race is. */
export const LAPS = 3;

/**
 * The circuit, as control points running clockwise from the start line.
 *
 * Drawn by hand rather than generated, because the whole pleasure of a small
 * kart is a corner that rewards knowing it — a long right sweep to open up on,
 * a hairpin at the far end that has to be taken slowly, and a quick left-right
 * before the line that is easy to get wrong in a hurry.
 *
 * Every corner has to be wider than the tightest arc a kart can turn flat out,
 * which is its top speed over its turn rate. That is not a nicety: a corner
 * tighter than that cannot be taken at all, however well you drive, and the
 * first draft of this circuit had a kink at the chicane of half the necessary
 * radius. `scripts/corners.mjs` measures them, and nothing here should go below
 * about eight.
 */
const CONTROL = [
  [0, -27],
  [16, -26],
  [28, -19],
  [33, -7],
  [30, 5],
  [33, 17],
  [25, 27],
  [11, 30],
  [-1, 26],
  [-14, 29],
  [-26, 25],
  [-33, 13],
  [-31, 0],
  [-24, -13],
  [-13, -25],
];

/** How finely the smoothed loop is sampled. Every metre or so of track. */
const SAMPLES = 480;

/** Catmull-Rom through four control points. */
function spline(a, b, c, d, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return [0, 1].map((i) =>
    0.5 *
    (2 * b[i] +
      (-a[i] + c[i]) * t +
      (2 * a[i] - 5 * b[i] + 4 * c[i] - d[i]) * t2 +
      (-a[i] + 3 * b[i] - 3 * c[i] + d[i]) * t3),
  );
}

/** The smoothed centre line, with how far along each point is. */
function build() {
  const points = [];
  const n = CONTROL.length;
  for (let i = 0; i < n; i++) {
    const a = CONTROL[(i - 1 + n) % n];
    const b = CONTROL[i];
    const c = CONTROL[(i + 1) % n];
    const d = CONTROL[(i + 2) % n];
    const steps = Math.max(1, Math.round(SAMPLES / n));
    for (let s = 0; s < steps; s++) {
      const [x, y] = spline(a, b, c, d, s / steps);
      points.push({ x, y, at: 0 });
    }
  }

  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const next = points[(i + 1) % points.length];
    points[i].at = total;
    total += Math.hypot(next.x - points[i].x, next.y - points[i].y);
  }
  return { points, total };
}

const LINE = build();

/** The centre line, for drawing the road and for standing things beside it. */
export const CENTRE = LINE.points;

/** How long one lap is, in world units. */
export const LAP_LENGTH = LINE.total;

/** How far the world extends around the track. */
export const TRACK_BOUNDS = { minX: -42, maxX: 44, minY: -40, maxY: 42 };

/**
 * Where a point is relative to the track.
 *
 * `along` is 0..1 round the lap and is the only measure of who is ahead;
 * `off` is how far from the middle of the road, so anything over half the road
 * width is on the grass.
 */
export function locate(x, y) {
  const points = LINE.points;
  let best = 0;
  let bestSq = Infinity;
  for (let i = 0; i < points.length; i++) {
    const dx = x - points[i].x;
    const dy = y - points[i].y;
    const sq = dx * dx + dy * dy;
    if (sq < bestSq) {
      bestSq = sq;
      best = i;
    }
  }
  return {
    along: points[best].at / LINE.total,
    off: Math.sqrt(bestSq),
    index: best,
  };
}

/** True when a point is on the tarmac rather than out in the grass. */
export function onRoad(x, y) {
  return locate(x, y).off <= ROAD_WIDTH / 2;
}

/** Which way the track is heading at a point on it, in radians. */
export function headingAt(index) {
  const points = LINE.points;
  const a = points[index % points.length];
  const b = points[(index + 4) % points.length];
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/**
 * Where the karts line up: two abreast, just *past* the start line.
 *
 * Past it rather than behind it, and that is the whole reason this comment
 * exists. A grid behind the line means the first crossing comes a couple of
 * kart lengths after the flag, so a kart banks a lap almost immediately and a
 * three-lap race is really two — and worse, the back row banks it later than
 * the front, so the rows are not even racing the same distance. Starting just
 * past the line means everybody drives very nearly a full lap to their first
 * crossing, and three laps is three laps for all of them.
 */
export function gridSlot(place) {
  const points = LINE.points;
  const row = Math.floor(place / 2);
  const side = place % 2 === 0 ? -1 : 1;
  const back = (3 + row * 9) % points.length;
  const at = points[back];
  const heading = headingAt(back);
  return {
    x: at.x + Math.cos(heading + Math.PI / 2) * side * (ROAD_WIDTH * 0.22),
    y: at.y + Math.sin(heading + Math.PI / 2) * side * (ROAD_WIDTH * 0.22),
    heading,
  };
}

/**
 * Counts a lap from where a kart was and where it is now.
 *
 * A lap is the moment `along` wraps past the start line going forwards. The
 * jump has to be big to count, which is what stops a kart parked on the line
 * from scoring a lap every time it wobbles — and going backwards over the line
 * takes the lap away again, so reversing over it cannot farm laps either.
 *
 * @returns -1, 0 or 1 to add to the lap count.
 */
export function lapStep(was, now) {
  if (was > 0.75 && now < 0.25) return 1;
  if (was < 0.25 && now > 0.75) return -1;
  return 0;
}

/** How far round in total, laps included — the one number that ranks a kart. */
export function distance(lap, along) {
  return lap + along;
}
