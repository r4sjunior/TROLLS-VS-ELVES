// Roda partidas headless só com bots e imprime um resumo. Uso: node scripts/simulate.js [n] [dificuldade] [preset]
import { Game } from '../src/shared/sim.js';
import { BUILDINGS } from '../src/shared/defs.js';
const N = Number(process.argv[2] || 3), diff = process.argv[3] || 'normal', preset = process.argv[4] || 'curta';
const classes = ['cacador', 'destruidor', 'assassino', 'xama'];
let wins = { E: 0, T: 0 };
for (let m = 0; m < N; m++) {
  const players = [];
  for (let i = 1; i <= 8; i++) players.push({ id: i, name: 'Elfo' + i, team: 'E', isBot: true, difficulty: diff });
  for (let i = 9; i <= 10; i++) players.push({ id: i, name: 'Troll' + i, team: 'T', cls: classes[(m * 2 + i) % 4], isBot: true, difficulty: diff });
  const t0 = Date.now();
  const g = new Game({ seed: 1000 + m, mapPreset: ['floresta', 'vale', 'ruinas'][m % 3], matchPreset: preset, players });
  let maxB = 0, ticks = 0;
  const typeCount = {};
  while (!g.over && ticks < 20 * 60 * 30) {
    g.step(); ticks++;
    if (ticks % 200 === 0) {
      maxB = Math.max(maxB, g.buildings.size);
      for (const u of g.units.values()) if (!Number.isFinite(u.x) || !Number.isFinite(u.hp)) throw new Error('NaN unit ' + u.id);
    }
  }
  for (const b of g.buildings.values()) typeCount[b.type] = (typeCount[b.type] || 0) + 1;
  wins[g.over.winner]++;
  const ms = Date.now() - t0;
  const el = g.over.players.filter(p => p.team === 'E'), tr = g.over.players.filter(p => p.team === 'T');
  console.log(`#${m} ${g.mapPreset} vencedor=${g.over.winner} t=${g.over.time}s sim=${ms}ms (${(ms / ticks).toFixed(2)}ms/tick) maxBld=${maxB} fim=${g.buildings.size}`);
  console.log('   elfos vivos:', el.filter(p => p.alive).length, 'construídas:', el.reduce((a, p) => a + p.stats.built, 0), 'madeira:', el.reduce((a, p) => a + p.stats.wood, 0), 'lvls:', el.map(p => p.level).join(','));
  console.log('   trolls:', tr.map(p => `${p.cls} lv${p.level}${p.ancestral ? '*' : ''} k${p.stats.kills} d${p.stats.deaths} destr${p.stats.destroyed}`).join(' | '));
  console.log('   tipos:', JSON.stringify(typeCount));
}
console.log('placar', wins);
