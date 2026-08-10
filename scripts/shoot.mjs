/**
 * Screenshots the running game, so changes can be checked without a browser.
 *
 *   node scripts/shoot.mjs out.png [waitMs] [width] [height]
 */

import { chromium } from 'playwright';

const [, , out = '.cache/shot.png', waitMs = '2500', width = '1280', height = '760'] =
  process.argv;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({
  viewport: { width: Number(width), height: Number(height) },
  deviceScaleFactor: 1,
});

const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForTimeout(Number(waitMs));
await page.screenshot({ path: out });
await browser.close();

for (const p of problems) console.log(p);
console.log(`wrote ${out}`);
