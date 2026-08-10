/**
 * Walks the meadow and screenshots it, so the whole world can be reviewed
 * without a person at the keyboard.
 *
 *   node scripts/tour.mjs
 */

import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });

const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(m.text());
});
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForTimeout(2500);

/** Teleports the player, which is far quicker than walking there. */
const goTo = async (x, y) => {
  await page.evaluate(([px, py]) => {
    const p = window.angen.player;
    p.x = px;
    p.y = py;
  }, [x, y]);
  await page.waitForTimeout(900);
};

const shot = async (name) => {
  await page.screenshot({ path: `.cache/tour-${name}.png` });
  console.log(`.cache/tour-${name}.png`);
};

await shot('spawn');

await goTo(0, 39);
await shot('north');

await goTo(-40, 20);
await shot('west');

// Hold a key so the walk cycle is caught mid-stride.
await goTo(0, 8);
await page.keyboard.down('ArrowRight');
await page.waitForTimeout(700);
await shot('walking');
await page.keyboard.up('ArrowRight');

await page.click('.hud-button');
await page.waitForTimeout(700);
await page.click('.hud-button');
await page.waitForTimeout(700);
await shot('rerolled');

await browser.close();
for (const p of problems) console.log(`ERROR ${p}`);
