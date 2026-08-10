/** Ad-hoc debugging: runs an expression in the live page and prints the result. */

import { chromium } from 'playwright';

const expression = process.argv[2];
if (!expression) {
  console.error('usage: node scripts/probe.mjs "<js expression>"');
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
page.on('pageerror', (e) => console.log(`pageerror: ${e.message}`));
await page.goto('http://localhost:5173/', { waitUntil: 'load' });
await page.waitForTimeout(2500);
console.log(JSON.stringify(await page.evaluate(expression), null, 2));
await browser.close();
