// Capturas visuais do jogo rodando (Chrome headless, viewport de celular landscape com toque).
// Uso: npm run build && node scripts/shots.js [pasta-saida]
import { chromium } from 'playwright-core';
import { startServer, stopServer } from '../server/index.js';
import fs from 'node:fs';
const out = process.argv[2] || 'shots';
fs.mkdirSync(out, { recursive: true });
process.env.QUIET = '1';
const srv = await startServer(3123);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 915, height: 412 }, deviceScaleFactor: 1, hasTouch: true, isMobile: false });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript(() => localStorage.setItem('rp_profile_v1', JSON.stringify({ name: 'Tester', settings: { quality: 'media', volume: 0 } })));
await page.goto('http://localhost:3123/');
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/01-menu.png` });
const shot = async (name) => page.screenshot({ path: `${out}/${name}.png` });
const team = process.env.TEAM || 'E';
await page.evaluate((team) => window.__rp.startLocal({ team, cls: 'destruidor', difficulty: 'normal', map: 'floresta', match: 'curta', count: 10 }), team);
await page.waitForTimeout(2500);
await shot('02-inicio');
// anda um pouco (teclado) e coleta
await page.keyboard.down('d'); await page.waitForTimeout(900); await page.keyboard.up('d');
await page.keyboard.down('e'); await page.waitForTimeout(2500); await page.keyboard.up('e');
await shot('03-andou');
if (team === 'E') {
  await page.keyboard.press('b'); await page.waitForTimeout(300);
  await page.locator('#h-items .item').first().dispatchEvent('pointerdown');
  await page.waitForTimeout(600);
  await shot('04-construir');
  await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
  await shot('05-construido');
  await page.keyboard.press('Escape');
}
// acelera o relógio da simulação para ver a fase de caçada
await page.evaluate(() => { const g = window.__rp.transport.game; for (let i = 0; i < 20 * 140; i++) g.step(); });
await page.waitForTimeout(1500);
await shot('06-cacada');
await page.keyboard.press('Tab'); await page.waitForTimeout(400);
await shot('07-progresso');
await page.keyboard.press('Tab');
const info = await page.evaluate(() => { const w = window.__rp.world; return { phase: w.phase, units: w.units.size, blds: w.buildings.size, res: w.me.res, lvl: w.me.level }; });
console.log(JSON.stringify(info));
console.log('erros:', errors.length ? errors.slice(0, 10) : 'nenhum');
await browser.close();
await stopServer();
process.exit(0);
