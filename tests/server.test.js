// Teste de integração do multiplayer: clientes WebSocket reais contra o servidor autoritativo.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

process.env.QUIET = '1';
const { startServer, stopServer } = await import('../server/index.js');
const srv = await startServer(0);
const port = srv.address().port;
after(() => stopServer());

function client(name, token) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    inbox.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); }
  });
  const c = {
    ws, inbox,
    send: (m) => ws.send(JSON.stringify(m)),
    wait: (pred, ms = 8000) => new Promise((res, rej) => {
      const hit = inbox.find(pred); if (hit) return res(hit);
      const w = { pred, res }; waiters.push(w);
      setTimeout(() => rej(new Error('timeout esperando mensagem')), ms);
    }),
    clear: () => { inbox.length = 0; },
  };
  ws.on('open', () => c.send({ t: 'hello', name, token }));
  return c;
}

test('sala privada: entrar por código, escolher equipe, jogar, reconectar e ranking', async () => {
  const a = client('Ana');
  const welcomeA = await a.wait((m) => m.t === 'welcome');
  assert.match(welcomeA.token, /^[0-9a-f]{32}$/);
  a.send({ t: 'create', settings: { map: 'vale', match: 'curta', difficulty: 'facil' } });
  const lob = await a.wait((m) => m.t === 'lobby');
  assert.equal(lob.room.isPrivate, true);
  assert.equal(lob.room.code.length, 5);

  const b = client('Beto');
  await b.wait((m) => m.t === 'welcome');
  b.send({ t: 'join', code: 'ZZZZZ' });
  assert.equal((await b.wait((m) => m.t === 'error')).msg, 'Sala não encontrada');
  b.send({ t: 'join', code: lob.room.code });
  await b.wait((m) => m.t === 'lobby' && m.room.players.length === 2);
  b.send({ t: 'team', team: 'T', cls: 'assassino' });
  await a.wait((m) => m.t === 'lobby' && m.room.players.some((p) => p.name === 'Beto' && p.team === 'T'));

  // só o anfitrião inicia sala privada
  b.send({ t: 'start' });
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(!b.inbox.some((m) => m.t === 'init'));
  a.send({ t: 'start' });
  const initA = await a.wait((m) => m.t === 'init');
  const initB = await b.wait((m) => m.t === 'init');
  assert.equal(initA.seed, initB.seed);
  assert.equal(initA.mapPreset, 'vale');

  const snapA = await a.wait((m) => m.t === 'snap' && m.me);
  const snapB = await b.wait((m) => m.t === 'snap' && m.me);
  assert.equal(snapA.me.team, 'E');
  assert.equal(snapB.me.team, 'T');
  assert.equal(snapB.me.cls, 'assassino');
  assert.equal(snapA.players.length, 10, 'vagas completadas por bots');

  // comando inválido volta com erro; anti-trapaça: troll não constrói
  b.send({ t: 'cmd', cmd: { t: 'build', type: 'muro', x: 10, y: 10 } });
  assert.equal((await b.wait((m) => m.t === 'res')).ok, false);
  // input válido move o elfo
  const u0 = snapA.units.find((u) => u[0] === snapA.me.uid);
  a.send({ t: 'cmd', cmd: { t: 'input', mx: 1, my: 0 } });
  a.send({ t: 'cmd', cmd: { t: 'input', mx: 0, my: 1 } });
  await new Promise((r) => setTimeout(r, 700));
  const later = a.inbox.filter((m) => m.t === 'snap').pop();
  const u1 = later.units.find((u) => u[0] === snapA.me.uid);
  assert.ok(Math.hypot(u1[4] - u0[4], u1[5] - u0[5]) > 0.3, 'elfo andou');

  // na preparação os trolls estão no covil, longe: o elfo não recebe a posição deles
  assert.equal(later.units.filter((u) => u[2] === 'T').length, 0);

  // queda e reconexão com o token: volta para a mesma partida
  a.ws.close();
  await new Promise((r) => setTimeout(r, 300));
  const a2 = client('Ana', welcomeA.token);
  const w2 = await a2.wait((m) => m.t === 'welcome');
  assert.equal(w2.resumed, true);
  const init2 = await a2.wait((m) => m.t === 'init');
  assert.equal(init2.seed, initA.seed);
  const full = await a2.wait((m) => m.t === 'snap' && m.full);
  assert.equal(full.me.pid, snapA.me.pid);

  const r = await fetch(`http://localhost:${port}/api/ranking`);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(await r.json()));
  a2.ws.close(); b.ws.close();
});

test('partida rápida pública e mensagens inválidas', async () => {
  const c = client('Caio');
  await c.wait((m) => m.t === 'welcome');
  c.ws.send('isto não é json');
  c.ws.send(JSON.stringify({ t: 'cmd', cmd: { t: 'build', type: 'constructor' } }));
  c.send({ t: 'quick' }); // partida rápida = arena (começa na hora)
  const init = await c.wait((m) => m.t === 'init');
  assert.ok(init.seed >= 0);
  assert.equal(init.arena, true);
  c.ws.close();
});
