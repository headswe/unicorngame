// How tight is every corner, and where are the ones a kart cannot make?
const { CENTRE, ROAD_WIDTH, LAP_LENGTH } = await import('../server/track.js');
const ARC = 22 / 4.2; // top speed over turn rate: the tightest arc, flat out.

const P = CENTRE, n = P.length;
const radii = [];
for (let i = 0; i < n; i++) {
  const a = P[i], b = P[(i + 8) % n], c = P[(i + 16) % n];
  const A = Math.hypot(b.x - a.x, b.y - a.y);
  const B = Math.hypot(c.x - b.x, c.y - b.y);
  const C = Math.hypot(c.x - a.x, c.y - a.y);
  const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
  radii.push({ i, r: area > 1e-6 ? (A * B * C) / (4 * area) : Infinity, at: b });
}
const bad = radii.filter((c) => c.r < ARC).sort((x, y) => x.r - y.r);
console.log(`lap ${LAP_LENGTH.toFixed(0)} units, road ${ROAD_WIDTH} wide`);
console.log(`tightest arc a kart can turn flat out: ${ARC.toFixed(1)}`);
console.log(`corners tighter than that: ${bad.length} of ${n} samples`);
for (const c of bad.slice(0, 6)) {
  console.log(`  r=${c.r.toFixed(1)} at (${c.at.x.toFixed(0)}, ${c.at.y.toFixed(0)})`);
}
const sorted = [...radii].sort((x, y) => x.r - y.r);
console.log(`tightest ${sorted[0].r.toFixed(1)}, 5th percentile ${sorted[Math.floor(n * 0.05)].r.toFixed(1)}`);
