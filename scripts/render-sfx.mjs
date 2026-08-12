/**
 * Renders every sound effect to a WAV file so they can be listened to.
 *
 * Runs the real Sfx class against an OfflineAudioContext in a headless browser,
 * so what comes out is exactly what the game plays — not a reimplementation
 * that can drift. Needs the dev server up.
 *
 *   node scripts/render-sfx.mjs [outDir]
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const outDir = process.argv[2] ?? '.cache/sfx';
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForTimeout(2000);

const rendered = await page.evaluate(async () => {
  const { Sfx } = await import('/src/engine/sfx.ts');

  const names = [
    'step', 'plop', 'sparkle', 'drop', 'munch', 'pickup',
    'magicOpen', 'cast', 'fizzle', 'rainSpell', 'bloomSpell',
  ];

  /** Longer than the tail of each sound, so nothing is cut off. */
  const seconds = { cast: 3.2, rainSpell: 3.4, bloomSpell: 3.0, magicOpen: 2.4, sparkle: 2.2 };

  const out = [];
  for (const name of names) {
    const length = seconds[name] ?? 1.2;
    const ctx = new OfflineAudioContext(2, Math.ceil(44100 * length), 44100);
    const sfx = new Sfx(() => true, ctx);
    sfx[name]();
    const buffer = await ctx.startRendering();

    // Interleave to 16-bit PCM.
    const left = buffer.getChannelData(0);
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
    const frames = buffer.length;
    const pcm = new Int16Array(frames * 2);
    let peak = 0;
    for (let i = 0; i < frames; i++) {
      peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
      pcm[i * 2] = Math.max(-1, Math.min(1, left[i])) * 32767;
      pcm[i * 2 + 1] = Math.max(-1, Math.min(1, right[i])) * 32767;
    }

    out.push({
      name,
      peak: Number(peak.toFixed(3)),
      seconds: Number(length.toFixed(2)),
      pcm: Array.from(new Uint8Array(pcm.buffer)),
    });
  }
  return out;
});

await browser.close();

function wav(bytes, sampleRate = 44100, channels = 2) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + bytes.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(bytes.length, 40);
  return Buffer.concat([header, bytes]);
}

/** Every sound in a row with gaps, so the set can be auditioned in one listen. */
const montage = [];
const gap = Buffer.alloc(44100 * 2 * 2 * 0.45 | 0);

console.log('sound         peak   length');
for (const sound of rendered) {
  const bytes = Buffer.from(sound.pcm);
  await writeFile(`${outDir}/${sound.name}.wav`, wav(bytes));
  // A peak at or above 1.0 is clipping; near 0 means it rendered silence.
  const flag = sound.peak >= 0.999 ? '  CLIPPING' : sound.peak < 0.01 ? '  SILENT' : '';
  console.log(`${sound.name.padEnd(13)} ${String(sound.peak).padEnd(6)} ${sound.seconds}s${flag}`);
  montage.push(bytes, gap);
}

await writeFile(`${outDir}/all.wav`, wav(Buffer.concat(montage)));
console.log(`\nwrote ${rendered.length} files to ${outDir}/`);
