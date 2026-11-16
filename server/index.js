// Servidor autoritativo: salas, equipes, bots, reconexão e simulação a 20 ticks/s.
// O cliente só envia intenções (comandos); o servidor valida tudo via Game.handleCommand.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Game } from '../src/shared/sim.js';
import { DT, TROLL_CLASSES, MATCH_PRESETS } from '../src/shared/defs.js';
import { MAP_PRESETS } from '../src/shared/mapgen.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(ROOT, '..', 'dist');
const DATA = path.resolve(ROOT, 'data');
const PORT = Number(process.env.PORT || 3000);
const MAX_PLAYERS = 10;
const TROLLS = 2;
const PUBLIC_WAIT_MS = 20000;
const RECONNECT_GRACE_MS = 120000;
const BOT_ELVES = ['Lirael', 'Thandor', 'Sylwen', 'Aerin', 'Faelar', 'Nimue', 'Elowen', 'Caelum', 'Ithil', 'Mirren'];
const BOT_TROLLS = ['Grokk', 'Zulmak', 'Rhaxa', 'Mograth'];

const log = (...a) => { if (!process.env.QUIET) console.log(new Date().toISOString().slice(11, 19), ...a); };

// ---------------------------------------------------------------- ranking persistente
let ranking = {};
try { ranking = JSON.parse(fs.readFileSync(path.join(DATA, 'ranking.json'), 'utf8')); } catch { ranking = {}; }
function saveRanking() {
  try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(path.join(DATA, 'ranking.json'), JSON.stringify(ranking)); } catch (e) { log('ranking não salvo', e.message); }
}

// ---------------------------------------------------------------- sessões e salas
const sessions = new Map(); // token -> { token, name, ws, room, team, cls, lastMsgs }
const rooms = new Map();

const send = (ws, m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
const newCode = () => { let c; do { c = Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[crypto.randomInt(24)]).join(''); } while (rooms.has(c)); return c; };

class Room {
  constructor(isPrivate, settings = {}) {
    this.code = newCode();
    this.isPrivate = isPrivate;
    this.settings = {
      map: typeof settings.map === 'string' && Object.hasOwn(MAP_PRESETS, settings.map) ? settings.map : 'floresta',
      match: typeof settings.match === 'string' && Object.hasOwn(MATCH_PRESETS, settings.match) ? settings.match : 'padrao',
      difficulty: ['facil', 'normal', 'dificil'].includes(settings.difficulty) ? settings.difficulty : 'normal',
    };
    this.members = []; // tokens
    this.host = null;
    this.state = 'lobby';
    this.game = null;
    this.pids = new Map(); // token -> pid
    this.sent = new Map(); // token -> último tick enviado
    this.startAt = isPrivate ? 0 : Date.now() + PUBLIC_WAIT_MS;
    rooms.set(this.code, this);
    this.lobbyTimer = setInterval(() => this.lobbyTick(), 1000);
  }

  join(s) {
    if (this.state !== 'lobby') return 'A partida já começou';
    if (this.members.length >= MAX_PLAYERS) return 'Sala cheia';
    if (s.room && s.room !== this) s.room.leave(s);
    if (!this.members.includes(s.token)) this.members.push(s.token);
    s.room = this; s.team = s.team || 'A'; s.cls = s.cls || 'cacador';
    if (!this.host) this.host = s.token;
    this.broadcastLobby();
    return null;
  }

  leave(s) {
    if (this.state === 'lobby') {
      this.members = this.members.filter((t) => t !== s.token);
      if (this.host === s.token) this.host = this.members[0] || null;
      s.room = null;
      if (!this.members.length) this.destroy(); else this.broadcastLobby();
    } else if (this.game) {
      const pid = this.pids.get(s.token);
      if (pid) this.game.setConnected(pid, false); // a IA assume definitivamente
      s.room = null;
    }
  }

  lobbyInfo(token) {
    return {
      code: this.code, isPrivate: this.isPrivate, max: MAX_PLAYERS, settings: this.settings,
      startsIn: this.startAt ? Math.max(0, Math.ceil((this.startAt - Date.now()) / 1000)) : 0,
      players: this.members.map((t) => { const s = sessions.get(t); return { name: s.name, team: s.team, cls: s.cls, host: t === this.host, you: t === token }; }),
    };
  }
  broadcastLobby() { for (const t of this.members) { const s = sessions.get(t); send(s && s.ws, { t: 'lobby', room: this.lobbyInfo(t) }); } }

  lobbyTick() {
    if (this.state !== 'lobby') return;
    if (!this.members.length) return this.destroy();
    if (this.startAt && Date.now() >= this.startAt) this.start();
    else if (this.startAt) this.broadcastLobby();
  }

  // Seleção de equipes: respeita preferências enquanto houver vaga, completa o resto automaticamente
  assignTeams() {
    const humans = this.members.map((t) => sessions.get(t));
    const trolls = [], elves = [], auto = [];
    for (const s of humans) (s.team === 'T' ? trolls : s.team === 'E' ? elves : auto).push(s);
    while (trolls.length > TROLLS) auto.push(trolls.pop());
    while (elves.length > MAX_PLAYERS - TROLLS) auto.push(elves.pop());
    // Com 2+ humanos, pelo menos um vira troll (1 a cada 5, até o limite); sozinho, vira elfo
    const wantTrolls = humans.length >= 2 ? Math.min(TROLLS, Math.max(1, Math.round(humans.length / 5))) : 0;
    for (const s of auto) {
      if (trolls.length < wantTrolls || elves.length >= MAX_PLAYERS - TROLLS) trolls.push(s);
      else elves.push(s);
    }
    return { trolls, elves };
  }

  start() {
    if (this.state !== 'lobby') return;
    clearInterval(this.lobbyTimer);
    this.state = 'playing';
    const { trolls, elves } = this.assignTeams();
    const players = []; let id = 1;
    for (const s of elves) { this.pids.set(s.token, id); players.push({ id: id++, name: s.name, team: 'E', isBot: false }); }
    for (const s of trolls) { this.pids.set(s.token, id); players.push({ id: id++, name: s.name, team: 'T', cls: s.cls, isBot: false }); }
    let e = elves.length, t = trolls.length;
    const classes = Object.keys(TROLL_CLASSES);
    while (e < MAX_PLAYERS - TROLLS) players.push({ id: id++, name: BOT_ELVES[e++ % BOT_ELVES.length], team: 'E', isBot: true, difficulty: this.settings.difficulty, skin: e % 6 });
    while (t < TROLLS) players.push({ id: id++, name: BOT_TROLLS[t], team: 'T', cls: classes[(t++ + 1) % classes.length], isBot: true, difficulty: this.settings.difficulty });
    this.game = new Game({ seed: crypto.randomInt(1e9), mapPreset: this.settings.map, matchPreset: this.settings.match, players });
    for (const tok of this.members) {
      const s = sessions.get(tok);
      if (!s.ws) this.game.setConnected(this.pids.get(tok), false);
      this.sendInit(s);
    }
    log(`sala ${this.code} começou: ${elves.length} elfos humanos, ${trolls.length} trolls humanos`);
    this.loop = setInterval(() => this.tick(), DT * 1000);
  }

  sendInit(s) {
    const pid = this.pids.get(s.token);
    this.sent.set(s.token, 0);
    send(s.ws, this.game.initInfo(pid));
  }

  tick() {
    const g = this.game;
    g.step(DT);
    for (const tok of this.members) {
      const s = sessions.get(tok);
      if (!s || !s.ws || s.room !== this) continue;
      const pid = this.pids.get(tok);
      const snap = g.snapshot(pid, this.sent.get(tok) || 0);
      this.sent.set(tok, g.tick);
      send(s.ws, snap);
    }
    if (g.over && !this.ended) {
      this.ended = true;
      for (const p of g.over.players) {
        if (p.isBot) continue;
        const r = ranking[p.name] || (ranking[p.name] = { name: p.name, wins: 0, matches: 0, kills: 0 });
        r.matches++; r.kills += p.stats.kills; if (p.team === g.over.winner) r.wins++;
      }
      saveRanking();
      log(`sala ${this.code} terminou: vitória ${g.over.winner === 'E' ? 'dos elfos' : 'dos trolls'}`);
      setTimeout(() => this.destroy(), 30000);
    }
  }

  destroy() {
    clearInterval(this.lobbyTimer); clearInterval(this.loop);
    for (const t of this.members) { const s = sessions.get(t); if (s && s.room === this) s.room = null; }
    rooms.delete(this.code);
  }
}

// ---------------------------------------------------------------- mensagens
function onMessage(ws, raw) {
  if (raw.length > 4096) return;
  let m; try { m = JSON.parse(raw); } catch { return; }
  if (!m || typeof m.t !== 'string') return;
  let s = ws.session;
  if (m.t === 'hello') {
    const name = String(m.name || 'Jogador').replace(/[<>]/g, '').slice(0, 16) || 'Jogador';
    const existing = m.token && sessions.get(m.token);
    if (existing) {
      s = existing; if (s.ws && s.ws !== ws) try { s.ws.close(); } catch { /* ok */ }
      s.ws = ws; s.name = name; clearTimeout(s.expire);
    } else {
      s = { token: crypto.randomBytes(16).toString('hex'), name, ws, room: null, team: 'A', cls: 'cacador', bucket: { at: Date.now(), n: 0 } };
      sessions.set(s.token, s);
    }
    ws.session = s;
    const resumed = !!(s.room && s.room.state === 'playing');
    send(ws, { t: 'welcome', token: s.token, resumed });
    if (resumed) {
      s.room.game.setConnected(s.room.pids.get(s.token), true);
      s.room.sendInit(s);
    } else if (s.room) s.room.broadcastLobby();
    return;
  }
  if (!s) return;
  // limite de taxa: 80 mensagens/s por sessão
  const now = Date.now();
  if (now - s.bucket.at > 1000) { s.bucket.at = now; s.bucket.n = 0; }
  if (++s.bucket.n > 80) return;

  switch (m.t) {
    case 'quick': {
      let room = [...rooms.values()].find((r) => !r.isPrivate && r.state === 'lobby' && r.members.length < MAX_PLAYERS);
      if (!room) room = new Room(false);
      const err = room.join(s); if (err) send(ws, { t: 'error', msg: err });
      break;
    }
    case 'create': { const room = new Room(true, m.settings || {}); room.join(s); break; }
    case 'join': {
      const room = rooms.get(String(m.code || '').toUpperCase());
      if (!room) { send(ws, { t: 'error', msg: 'Sala não encontrada' }); break; }
      const err = room.join(s); if (err) send(ws, { t: 'error', msg: err });
      break;
    }
    case 'team':
      if (s.room && s.room.state === 'lobby') {
        s.team = ['A', 'E', 'T'].includes(m.team) ? m.team : 'A';
        s.cls = typeof m.cls === 'string' && Object.hasOwn(TROLL_CLASSES, m.cls) ? m.cls : s.cls;
        s.room.broadcastLobby();
      }
      break;
    case 'start':
      if (s.room && s.room.state === 'lobby' && (!s.room.isPrivate || s.room.host === s.token)) s.room.start();
      break;
    case 'leave': if (s.room) s.room.leave(s); break;
    case 'cmd':
      if (s.room && s.room.state === 'playing' && s.room.game) {
        const pid = s.room.pids.get(s.token);
        const r = s.room.game.handleCommand(pid, m.cmd);
        if (!r.ok && m.cmd && m.cmd.t !== 'input') send(ws, { t: 'res', ok: false, err: r.err, cmd: m.cmd.t });
      }
      break;
    default: break;
  }
}

function onClose(ws) {
  const s = ws.session; if (!s || s.ws !== ws) return;
  s.ws = null;
  if (s.room) {
    if (s.room.state === 'lobby') s.room.leave(s);
    else if (s.room.game) s.room.game.setConnected(s.room.pids.get(s.token), false);
  }
  s.expire = setTimeout(() => { if (!s.ws) { if (s.room) s.room.leave(s); sessions.delete(s.token); } }, RECONNECT_GRACE_MS);
  s.expire.unref();
}

// ---------------------------------------------------------------- HTTP (build do jogo + API)
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/ranking') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify(Object.values(ranking).sort((a, b) => b.wins - a.wins || b.kills - a.kills).slice(0, 50)));
    return;
  }
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, sessions: sessions.size }));
    return;
  }
  let file = path.normalize(path.join(DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Rode "npm run build" antes de iniciar o servidor.'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8192 });
wss.on('connection', (ws) => {
  ws.on('message', (data) => onMessage(ws, data.toString()));
  ws.on('close', () => onClose(ws));
  ws.on('error', () => {});
});

export function startServer(port = PORT) {
  return new Promise((resolve) => server.listen(port, () => { log(`Raízes & Presas no ar: http://localhost:${server.address().port}`); resolve(server); }));
}
export function stopServer() {
  for (const r of rooms.values()) r.destroy();
  wss.close(); return new Promise((r) => server.close(r));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startServer();
