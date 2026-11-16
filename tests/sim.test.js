import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, placementOk } from '../src/shared/sim.js';
import { generateMap } from '../src/shared/mapgen.js';
import { TILE, BUILDINGS, DT } from '../src/shared/defs.js';

const base = () => new Game({ seed: 42, mapPreset: 'floresta', matchPreset: 'curta', players: [
  { id: 1, name: 'Elfo', team: 'E' }, { id: 2, name: 'Troll', team: 'T', cls: 'cacador' },
] });
const elf = (g) => g.unitOf(g.players.get(1));
const troll = (g) => g.unitOf(g.players.get(2));
const steps = (g, s) => { for (let i = 0; i < s / DT; i++) g.step(); };
function freeSpotNear(g, u) {
  for (let r = 2; r < 9; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = Math.floor(u.x) + dx, y = Math.floor(u.y) + dy;
    if (placementOk(g, 'refugio', x, y, 0) && Math.hypot(x + 1 - u.x, y + 1 - u.y) > 2) return [x, y];
  }
  throw new Error('sem espaço');
}

test('mapa é determinístico pela seed', () => {
  const a = generateMap(7, 'vale'), b = generateMap(7, 'vale'), c = generateMap(8, 'vale');
  assert.deepEqual(a.tiles, b.tiles);
  assert.notDeepEqual(a.tiles, c.tiles);
  assert.equal(a.elfSpawns.length, 4);
});

test('construção valida recursos, terreno, alcance, requisito e equipe', () => {
  const g = base(); const u = elf(g); const p = g.players.get(1);
  const [x, y] = freeSpotNear(g, u);
  assert.equal(g.handleCommand(2, { t: 'build', type: 'muro', x, y }).ok, false, 'troll não constrói');
  p.res.wood = 0;
  assert.equal(g.handleCommand(1, { t: 'build', type: 'muro', x, y }).err, 'Recursos insuficientes');
  p.res.wood = 100;
  let water = -1; for (let i = 0; i < g.W * g.H; i++) if (g.tiles[i] === TILE.WATER) { water = i; break; }
  if (water >= 0) assert.equal(g.handleCommand(1, { t: 'build', type: 'muro', x: water % g.W, y: (water / g.W) | 0 }).ok, false);
  assert.equal(g.handleCommand(1, { t: 'build', type: 'muro', x: 2, y: 2 }).ok, false, 'longe demais');
  assert.equal(g.handleCommand(1, { t: 'build', type: 'altar', x, y }).err, 'Exige Árvore Ancestral');
  assert.equal(g.handleCommand(1, { t: 'build', type: 'muro_pedra', x, y }).ok, false, 'só via melhoria');
  const r = g.handleCommand(1, { t: 'build', type: 'muro', x, y });
  assert.equal(r.ok, true);
  assert.equal(p.res.wood, 100 - BUILDINGS.muro.cost.wood);
  assert.equal(g.handleCommand(1, { t: 'build', type: 'muro', x, y }).ok, false, 'não empilha');
  steps(g, 2);
  const b = g.buildings.get(r.id);
  assert.equal(b.progress, 1);
  assert.equal(Math.round(b.hp), b.maxHp);
  p.res.gold = 100;
  assert.equal(g.handleCommand(1, { t: 'upgrade', bid: r.id }).ok, true);
  assert.equal(g.buildings.get(r.id).type, 'muro_pedra');
});

test('comandos malformados não quebram a simulação', () => {
  const g = base();
  for (const c of [null, 5, 'x', {}, { t: 'build' }, { t: 'input', mx: 'NaN', my: Infinity }, { t: 'ability', i: 99 }, { t: 'buy', key: '__proto__' }, { t: 'upgrade', bid: -1 }, { t: 'ping', x: 1e9, y: -5 }]) {
    g.handleCommand(1, c);
  }
  // chaves herdadas do protótipo não podem virar construção/melhoria
  g.players.get(1).res = { wood: 999, gold: 999, crystal: 99 };
  const u = elf(g);
  for (const type of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.equal(g.handleCommand(1, { t: 'build', type, x: Math.floor(u.x) + 2, y: Math.floor(u.y) }).ok, false, type);
    assert.equal(g.handleCommand(1, { t: 'buy', key: type }).ok, false, type);
  }
  assert.equal(g.buildings.size, 0);
  steps(g, 1);
  assert.ok(Number.isFinite(u.x) && Number.isFinite(u.y));
});

test('trolls ficam presos no covil durante a preparação', () => {
  const g = base(); const t = troll(g);
  g.handleCommand(2, { t: 'input', mx: 1, my: 0 });
  steps(g, 10);
  assert.equal(g.tiles[g.idx(Math.floor(t.x), Math.floor(t.y))], TILE.SPAWN);
  assert.equal(g.phase, 1);
});

test('coleta de madeira e ganho de XP', () => {
  const g = base(); const u = elf(g); const p = g.players.get(1);
  let spot = null;
  for (let i = 0; i < g.W * g.H && !spot; i++) {
    if (g.tiles[i] !== TILE.FOREST) continue;
    const x = i % g.W, y = (i / g.W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (g.tiles[g.idx(x + dx, y + dy)] === TILE.GRASS) { spot = [x + dx + 0.5, y + dy + 0.5]; break; }
    }
  }
  u.x = spot[0]; u.y = spot[1];
  const w0 = p.res.wood;
  g.handleCommand(1, { t: 'input', mx: 0, my: 0, int: true });
  steps(g, 10);
  assert.ok(p.res.wood > w0 + 15, `madeira ${p.res.wood}`);
  assert.ok(p.xp > 0 || p.level > 1);
});

test('torre e armadilha ferem trolls; troll destrói construção e ganha ouro', () => {
  const g = base(); const u = elf(g); const t = troll(g); const p = g.players.get(1);
  p.res = { wood: 500, gold: 500, crystal: 50 };
  const [x, y] = freeSpotNear(g, u);
  const tw = g.handleCommand(1, { t: 'build', type: 'torre', x, y });
  assert.ok(tw.ok, tw.err);
  steps(g, 6);
  g.time = g.prep + 1; g.step();
  t.x = x + 0.5 + 3; t.y = y + 0.5; g.unstick(t);
  const hp0 = t.hp;
  steps(g, 3);
  assert.ok(t.hp < hp0, 'torre atirou');
  const trap = g.createBuilding('espinhos', 1, Math.floor(t.x), Math.floor(t.y), 0, true);
  const hp1 = t.hp; g.step();
  assert.ok(t.hp < hp1 - 50, 'armadilha disparou');
  assert.equal(trap.revealed, true);
  const tower = g.buildings.get(tw.id);
  t.x = x + 1.6; t.y = y + 0.5; t.hp = t.maxHp;
  const gold0 = g.players.get(2).res.gold;
  g.handleCommand(2, { t: 'input', mx: 0, my: 0, atk: true });
  for (let i = 0; i < 25 / DT && g.buildings.has(tower.id); i++) { t.hp = t.maxHp; g.step(); }
  assert.ok(!g.buildings.has(tower.id), 'torre destruída');
  assert.ok(g.players.get(2).res.gold > gold0);
});

test('visão: snapshot não revela inimigos fora de alcance nem elfos camuflados', () => {
  const g = base(); const u = elf(g); const t = troll(g);
  g.step();
  if (Math.hypot(u.x - t.x, u.y - t.y) > 12) assert.equal(g.snapshot(1, 0).units.some((a) => a[0] === t.id), false);
  t.x = u.x + 2; t.y = u.y; g.computeVision();
  assert.ok(g.snapshot(1, 0).units.some((a) => a[0] === t.id));
  g.players.get(1).level = 3;
  g.time = 100; u.cds[1] = 0;
  assert.ok(g.handleCommand(1, { t: 'ability', i: 1 }).ok);
  t.x = u.x + 4; g.computeVision();
  assert.equal(g.snapshot(2, 0).units.some((a) => a[0] === u.id), false);
});

test('reconexão: jogador desconectado passa para a IA e retoma o controle', () => {
  const g = base();
  g.setConnected(1, false);
  assert.equal(g.players.get(1).takeover, true);
  steps(g, 3);
  g.setConnected(1, true);
  assert.equal(g.players.get(1).takeover, false);
});

test('partida completa só com bots termina com vencedor e sem NaN', () => {
  const players = [];
  for (let i = 1; i <= 8; i++) players.push({ id: i, name: 'E' + i, team: 'E', isBot: true, difficulty: 'dificil' });
  players.push({ id: 9, name: 'T1', team: 'T', cls: 'destruidor', isBot: true, difficulty: 'dificil' });
  players.push({ id: 10, name: 'T2', team: 'T', cls: 'xama', isBot: true, difficulty: 'dificil' });
  const g = new Game({ seed: 99, mapPreset: 'ruinas', matchPreset: 'curta', players });
  let built = 0;
  while (!g.over) {
    g.step();
    if (g.tick % 100 === 0) for (const u of g.units.values()) assert.ok(Number.isFinite(u.x) && Number.isFinite(u.hp));
    built = Math.max(built, g.buildings.size);
  }
  assert.ok(['E', 'T'].includes(g.over.winner));
  assert.ok(built > 20, `bots construíram ${built}`);
  assert.ok(g.over.players.some((p) => p.team === 'T' && p.stats.destroyed > 0), 'trolls destruíram algo');
});
