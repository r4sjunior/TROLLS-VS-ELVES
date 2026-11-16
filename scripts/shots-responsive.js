// Matriz de capturas em vários tamanhos de tela. Uso: node scripts/shots-responsive.js <pasta> [porta]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const out = process.argv[2] || 'shots-resp';
const port = process.argv[3] || 3000;
fs.mkdirSync(out, { recursive: true });
const SIZES = [
  ['568x320', 568, 320, true], ['740x360', 740, 360, true], ['915x412', 915, 412, true],
  ['1024x768', 1024, 768, true], ['1366x768', 1366, 768, false], ['1920x1080', 1920, 1080, false],
];
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
for (const [name, w, h, touch] of SIZES) {
  if (only && !only.includes(name)) continue;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: false });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await page.addInitScript(() => localStorage.setItem('rp_profile_v1', JSON.stringify({ name: 'Tester', settings: { quality: 'baixa', volume: 0 } })));
  await page.goto(`http://localhost:${port}/`);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/${name}-1menu.png` });
  await page.getByText('Jogar contra bots').click(); await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${name}-2setup.png` });
  await page.evaluate(() => window.__rp.startLocal({ team: 'E', cls: 'cacador', difficulty: 'normal', map: 'floresta', match: 'curta', count: 10 }));
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const g = window.__rp.transport.game; g.players.get(1).res = { wood: 300, gold: 200, crystal: 20 }; });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${name}-3hud.png` });
  await page.keyboard.press('b'); await page.waitForTimeout(200);
  await page.locator('#h-items .item').first().dispatchEvent('pointerdown'); await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}-4build.png` });
  await page.keyboard.press('Escape'); await page.keyboard.press('Tab'); await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${name}-5prog.png` });
  await ctx.close();
}
console.log('erros:', errors.length ? errors : 'nenhum');
await browser.close();
