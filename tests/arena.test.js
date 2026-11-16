// Arena: partida contínua com bots entrando 1 a 1 e cedendo vaga a humanos.
// Tempos encurtados por variáveis de ambiente (1 min → 300 ms) para o teste rodar rápido.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

process.env.QUIET = '1';
process.env.ARENA_BOT_MS = '300';
process.env.ARENA_NEXT_MS = '400';
const { startServer, stopServer, _internals } = await import('../server/index.js');
const srv = await startServer(0);
const port = srv.address().port;
const open = [];
after(() => { for (const ws of open) ws.terminate(); return stopServer(); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(name) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  open.push(ws);
  const inbox = [];
  ws.on('message', (d) => inbox.push(JSON.parse(d.toString())));
  ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name })));
  const c = {
    ws, inbox,
    send: (m) => ws.send(JSON.stringify(m)),
    async wait(pred, ms = 8000) {
      const end = Date.now() + ms;
      for (;;) { const hit = inbox.find(pred); if (hit) return hit; if (Date.now() > end) throw new Error('timeout'); await sleep(20); }
    },
    lastSnap: () => [...inbox].reverse().find((m) => m.t === 'snap'),
  };
  return c;
}
const roster = (snap) => snap.players.map(([id, name, team, cls, alive, level, isBot]) => ({ id, name, team, isBot: !!isBot }));

test('arena: começa com 1 humano, bots entram 1 a 1, humano novo tira um bot, nova partida ao fim', async () => {
  const a = client('Ana');
  await a.wait((m) => m.t === 'welcome');
  a.send({ t: 'arena', team: 'E' });
  const initA = await a.wait((m) => m.t === 'init');
  assert.equal(initA.arena, true);
  await a.wait((m) => m.t === 'snap');
  assert.equal(roster(a.lastSnap()).length, 1, 'só o humano no começo');

  // depois de ~1 "minuto" entra o primeiro bot, e é troll (precisa de caçador)
  await a.wait((m) => m.t === 'snap' && m.players.length === 2, 2000);
  const r2 = roster(a.lastSnap());
  assert.equal(r2.filter((p) => p.isBot).length, 1);
  assert.equal(r2.find((p) => p.isBot).team, 'T');
  // um a um: nunca pula de 2 para 4 de uma vez
  await a.wait((m) => m.t === 'snap' && m.players.length === 3, 2000);

  // segundo humano: um bot sai e a contagem recomeça
  const before = roster(a.lastSnap());
  const b = client('Beto');
  await b.wait((m) => m.t === 'welcome');
  b.send({ t: 'arena', team: 'A' });
  const initB = await b.wait((m) => m.t === 'init');
  assert.equal(initB.seed, initA.seed, 'mesma partida');
  await a.wait((m) => m.t === 'notice' && /no lugar do bot/.test(m.msg));
  await sleep(100);
  const now = roster(a.lastSnap());
  assert.equal(now.length, before.length, 'total igual: bot cedeu a vaga');
  assert.equal(now.filter((p) => !p.isBot).length, 2);

  // completa até 10 e para
  await a.wait((m) => m.t === 'snap' && m.players.length === 10, 15000);
  await sleep(800);
  const full = roster(a.lastSnap());
  assert.equal(full.length, 10);
  assert.equal(full.filter((p) => p.team === 'T').length, 2);

  // humano sai: vira bot, partida segue
  b.send({ t: 'leave' });
  await sleep(150);
  assert.equal(roster(a.lastSnap()).filter((p) => !p.isBot).length, 1);

  // fim de partida → próxima arena abre sozinha e leva quem ficou
  const arena = [..._internals.rooms.values()].find((r) => r.isArena);
  arena.game.time = arena.game.duration;
  await a.wait((m) => m.t === 'snap' && m.over);
  const next = await a.wait((m) => m.t === 'init' && m.seed !== initA.seed, 3000);
  assert.equal(next.arena, true);
  await sleep(100);
  assert.ok(!_internals.rooms.has(arena.code) || _internals.rooms.get(arena.code) !== arena, 'arena antiga fechada');
  a.ws.close(); b.ws.close();
});
