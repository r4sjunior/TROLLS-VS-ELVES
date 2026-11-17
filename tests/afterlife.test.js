// Mecânicas da v5: pós-morte (Espírito/Lobo), baú do covil, ninho de fadas, oficina e morte súbita.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/shared/sim.js';
import { TILE, BOUNTY, AFTERLIFE_DELAY } from '../src/shared/defs.js';

const mk = () => new Game({ seed: 3, mapPreset: 'floresta', matchPreset: 'padrao', players: [
  { id: 1, name: 'Ana', team: 'E' }, { id: 2, name: 'Bia', team: 'E' }, { id: 3, name: 'Grok', team: 'T', cls: 'cacador' },
] });
const run = (g, s) => { for (let i = 0; i < s * 20; i++) g.step(); };

test('elfo abatido escolhe Espírito: atravessa muros, não é visto nem atacado e conserta', () => {
  const g = mk(); run(g, 1);
  const ana = g.players.get(1), u = g.unitOf(ana), troll = g.unitOf(g.players.get(3));
  ana.res.gold = 77;
  g.damageUnit(u, 9999, troll);
  assert.equal(g.players.get(3).res.gold >= 77, true, 'troll fica com o ouro do elfo');
  assert.equal(g.handleCommand(1, { t: 'afterlife', choice: 'espirito' }).ok, false, 'precisa esperar');
  run(g, AFTERLIFE_DELAY + 0.2);
  assert.ok(g.snapshot(1).me.choose > 0);
  assert.equal(g.handleCommand(1, { t: 'afterlife', choice: 'espirito' }).ok, true);
  assert.equal(u.dead, false); assert.equal(u.cls, 'espirito');
  // invisível e imune para trolls
  troll.x = u.x + 1; troll.y = u.y; run(g, 0.2);
  assert.ok(!g.vis.T.has(u.id));
  const hp = u.hp; g.damageUnit(u, 500, troll); assert.equal(u.hp, hp);
  // não constrói, mas conserta
  assert.equal(g.handleCommand(1, { t: 'build', type: 'muro', x: Math.floor(u.x) + 2, y: Math.floor(u.y), rot: 0 }).ok, false);
  assert.equal(g.over, null, 'ainda há elfo vivo');
});

test('elfo vira Lobo: troca de time, recebe estado completo e partida termina quando não sobra elfo', () => {
  const g = mk(); run(g, 1);
  g.damageUnit(g.unitOf(g.players.get(1)), 9999, null);
  run(g, AFTERLIFE_DELAY + 0.2);
  assert.equal(g.handleCommand(1, { t: 'afterlife', choice: 'lobo' }).ok, true);
  const p = g.players.get(1);
  assert.equal(p.team, 'T'); assert.equal(p.cls, 'lobo');
  assert.equal(g.snapshot(1, g.tick).full, true, 'estado completo após trocar de lado');
  run(g, 4);
  assert.equal(g.unitOf(p).dead, false, 'lobo surge no covil');
  assert.equal(g.over, null);
  g.damageUnit(g.unitOf(g.players.get(2)), 9999, g.unitOf(p));
  run(g, 0.2);
  assert.equal(g.over && g.over.winner, 'T', 'último elfo caiu: trolls vencem');
  assert.equal(g.players.get(1).stats.kills, 1, 'lobo recebe o abate');
});

test('baú do covil: valor cresce e elfo saqueia com recarga', () => {
  const g = mk();
  assert.equal(g.bounty, BOUNTY.start);
  g.time = g.nextBountyAt; g.updateEvents();
  assert.equal(g.bounty, Math.round(BOUNTY.start * BOUNTY.mul));
  const ana = g.players.get(1), u = g.unitOf(ana);
  u.x = g.chest.x + 0.5; u.y = g.chest.y; const gold = ana.res.gold;
  g.tryInteract(u, 0.05);
  assert.equal(ana.res.gold, gold + g.bounty);
  g.tryInteract(u, 0.05);
  assert.equal(ana.res.gold, gold + g.bounty, 'recarga impede saque repetido');
});

test('ninho de fadas coleta madeira sozinho e oficina conserta sozinha', () => {
  const g = mk();
  const ana = g.players.get(1);
  // acha um lugar livre 2x2 com floresta por perto
  let spot = null;
  for (let y = 4; y < g.H - 6 && !spot; y++) for (let x = 4; x < g.W - 6 && !spot; x++) {
    let ok = true; for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) if (g.tiles[(y + dy) * g.W + x + dx] !== TILE.GRASS) ok = false;
    if (!ok) continue;
    let trees = 0; for (let dy = -3; dy <= 4; dy++) for (let dx = -3; dx <= 4; dx++) if (g.tiles[(y + dy) * g.W + x + dx] === TILE.FOREST) trees++;
    if (trees > 6) spot = { x, y };
  }
  assert.ok(spot);
  const id = g.nextId++;
  const b = { id, type: 'ninho', owner: 1, x: spot.x, y: spot.y, w: 2, h: 2, rot: 0, hp: 420, maxHp: 420, progress: 1, rev: 0, cd: 0 };
  g.buildings.set(id, b); for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) g.bgrid[(spot.y + dy) * g.W + spot.x + dx] = id;
  const wood = ana.res.wood; run(g, 10);
  assert.ok(ana.res.wood >= wood + 12, `ninho coletou ${ana.res.wood - wood}`);
  b.type = 'oficina'; b.hp = 100; run(g, 3);
  assert.ok(b.hp > 140, 'oficina consertou');
});
