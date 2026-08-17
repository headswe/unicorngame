/**
 * Works out how long each kart should be drawn.
 *
 *   node scripts/kart-sizes.mjs
 *
 * Every sprite comes back from the generator trimmed to its content and scaled
 * to the same height, so drawing them all at one length makes a long narrow
 * kart cover far less screen than a squat wide one — which reads as one kart
 * simply being smaller than the others rather than a different shape.
 *
 * This measures how much paint each one actually puts down and reports the
 * length that gives them all the same. Paste the numbers into KARTS.
 */

import sharp from 'sharp';

const KARTS = ['kart_stjarna', 'kart_hjarta', 'kart_blixt'];

/** How long the reference kart is, in world units. The rest follow from it. */
const REFERENCE = { id: 'kart_stjarna', length: 2.6 };

const measured = [];
for (const id of KARTS) {
  const { data, info } = await sharp(`public/assets/parts/${id}.png`)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let painted = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 40) painted++;
  const aspect = info.width / info.height;
  const ink = painted / (info.width * info.height);
  // Area covered when drawn `length` long: length × (length × aspect) × ink.
  measured.push({ id, aspect, ink, per: aspect * ink });
}

const ref = measured.find((m) => m.id === REFERENCE.id);
const target = REFERENCE.length * REFERENCE.length * ref.per;

console.log('id              aspect   ink    length');
for (const m of measured) {
  const length = Math.sqrt(target / m.per);
  console.log(
    `${m.id.padEnd(15)} ${m.aspect.toFixed(3)}  ${(m.ink * 100).toFixed(0)}%   ${length.toFixed(2)}`,
  );
}
