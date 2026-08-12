/**
 * Exercises the sigil recogniser with synthetic strokes.
 *
 * The thresholds decide whether a six-year-old feels like a wizard or like the
 * game is broken, so they are worth checking against deliberately sloppy input
 * rather than only against a perfect trace.
 *
 *   npx tsx scripts/sigil-check.ts
 */

import { SIGILS, scoreSigil, type Point } from '../src/game/sigil.ts';

/** Screen-sized strokes, since the recogniser rejects tiny ones. */
const SIZE = 300;

function scale(points: Point[]): Point[] {
  return points.map((p) => ({ x: p.x * SIZE, y: p.y * SIZE }));
}

/** Adds hand-wobble: jitter per point plus a slow drift. */
function sloppy(points: Point[], jitter: number, seed = 1): Point[] {
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648 - 0.5;
  };
  return points.map((p, i) => ({
    x: p.x + rand() * jitter + Math.sin(i * 0.3) * jitter * 0.4,
    y: p.y + rand() * jitter + Math.cos(i * 0.25) * jitter * 0.4,
  }));
}

function line(from: Point, to: Point, steps = 40): Point[] {
  return Array.from({ length: steps }, (_, i) => ({
    x: from.x + ((to.x - from.x) * i) / (steps - 1),
    y: from.y + ((to.y - from.y) * i) / (steps - 1),
  }));
}

/** Same shape, started a third of the way round and drawn backwards. */
function rotateAndReverse(points: Point[]): Point[] {
  const offset = Math.floor(points.length / 3);
  return [...points.slice(offset), ...points.slice(0, offset)].reverse();
}

const triangle = scale(SIGILS.triangle!.points);
const circle = scale(SIGILS.circle!.points);

const cases: Array<{ name: string; stroke: Point[]; template: string; expect: boolean }> = [
  { name: 'triangle, traced exactly', stroke: triangle, template: 'triangle', expect: true },
  { name: 'triangle, a bit wobbly', stroke: sloppy(triangle, 14, 7), template: 'triangle', expect: true },
  { name: 'triangle, very wobbly', stroke: sloppy(triangle, 30, 3), template: 'triangle', expect: true },
  { name: 'triangle, drawn by a small child', stroke: sloppy(triangle, 45, 5), template: 'triangle', expect: true },
  { name: 'triangle, started elsewhere + backwards', stroke: rotateAndReverse(triangle), template: 'triangle', expect: true },
  { name: 'circle drawn, triangle wanted', stroke: circle, template: 'triangle', expect: false },
  { name: 'straight line, triangle wanted', stroke: line({ x: 20, y: 20 }, { x: 280, y: 280 }), template: 'triangle', expect: false },
  { name: 'tiny scribble, triangle wanted', stroke: line({ x: 100, y: 100 }, { x: 112, y: 108 }), template: 'triangle', expect: false },

  { name: 'circle, traced exactly', stroke: circle, template: 'circle', expect: true },
  { name: 'circle, a bit wobbly', stroke: sloppy(circle, 14, 11), template: 'circle', expect: true },
  { name: 'circle, started at the bottom, backwards', stroke: rotateAndReverse(circle), template: 'circle', expect: true },
  { name: 'circle, drawn by a small child', stroke: sloppy(circle, 45, 13), template: 'circle', expect: true },
  { name: 'circle, squashed oval', stroke: circle.map((p) => ({ x: p.x, y: p.y * 0.72 })), template: 'circle', expect: true },
  { name: 'triangle drawn, circle wanted', stroke: triangle, template: 'circle', expect: false },
  { name: 'straight line, circle wanted', stroke: line({ x: 20, y: 150 }, { x: 280, y: 150 }), template: 'circle', expect: false },
];

let failures = 0;
console.log('stroke                                     wanted    score  pass  expected');
for (const test of cases) {
  const template = SIGILS[test.template]!;
  const { score, passed } = scoreSigil(test.stroke, template);
  const ok = passed === test.expect;
  if (!ok) failures++;
  console.log(
    `${test.name.padEnd(42)} ${test.template.padEnd(9)} ${score.toFixed(3)}  ${String(passed).padEnd(5)} ${String(test.expect).padEnd(5)} ${ok ? '' : '  <-- WRONG'}`,
  );
}

console.log(failures ? `\n${failures} case(s) behaved unexpectedly` : '\nall cases behaved as expected');
if (failures) process.exit(1);
