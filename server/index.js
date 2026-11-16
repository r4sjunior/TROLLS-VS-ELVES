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
const RECONNECT_GRACE_MS = 5 * 60000; // tempo que o lugar do jogador fica guardado
const HEARTBEAT_MS = 5000;
const MAX_BUFFERED = 512 * 1024; // cliente lento: pula snapshots em vez de acumular memória
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

const send = (ws, m) => {
  if (!ws || ws.readyState !== 1) return false;
  try { ws.send(JSON.stringify(m)); return true; } catch (e) { log('falha ao enviar', e.message); return false; }
};
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
    try {
      g.step(DT);
      this.errors = 0;
    } catch (e) {
      // Um erro numa sala nunca derruba o servidor inteiro
      this.errors = (this.errors || 0) + 1;
      log(`erro na sala ${this.code} (tick ${g.tick}):`, e.stack || e);
      if (this.errors > 40) { log(`sala ${this.code} encerrada por erros repetidos`); this.destroy(); }
      return;
    }
    for (const tok of this.members) {
      const s = sessions.get(tok);
      if (!s || !s.ws || s.room !== this) continue;
      // Contrapressão: se o cliente não está dando conta, pula este envio;
      // o próximo snapshot delta cobre tudo que mudou desde o último entregue.
      if (s.ws.bufferedAmount > MAX_BUFFERED) continue;
      try {
        const pid = this.pids.get(tok);
        const snap = g.snapshot(pid, this.sent.get(tok) || 0);
        if (send(s.ws, snap)) this.sent.set(tok, g.tick);
      } catch (e) { log(`erro no snapshot ${this.code}:`, e.stack || e); }
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
      if (this.isArena) this.onEnded();
      else setTimeout(() => this.destroy(), 30000).unref();
    }
  }

  destroy() {
    clearInterval(this.lobbyTimer); clearInterval(this.loop);
    for (const t of this.members) { const s = sessions.get(t); if (s && s.room === this) s.room = null; }
    if (rooms.get(this.code) === this) rooms.delete(this.code);
  }
}

// ---------------------------------------------------------------- arena (partida pública contínua)
// Regras:
//  - A arena fica sempre aberta. O 1º humano que entra inicia a partida na hora.
//  - A cada ARENA_BOT_MS (1 min) sem novidades entra UM bot, até completar 10 vagas.
//  - Quando entra mais um humano, um bot sai para dar a vaga a ele e a contagem de 1 min recomeça.
//  - Quando a partida acaba, uma nova arena abre sozinha e quem ainda está conectado é levado para ela.
const ARENA_BOT_MS = Number(process.env.ARENA_BOT_MS || 60000);
const ARENA_NEXT_MS = Number(process.env.ARENA_NEXT_MS || 15000);
const MAX_TROLLS = 2, MAX_ELVES = MAX_PLAYERS - MAX_TROLLS;
const wantTrolls = (n) => (n <= 1 ? 0 : n >= 6 ? 2 : 1);

class Arena extends Room {
  constructor() {
    super(false, { map: Object.keys(MAP_PRESETS)[crypto.randomInt(Object.keys(MAP_PRESETS).length)], match: 'padrao', difficulty: 'normal' });
    clearInterval(this.lobbyTimer);
    this.isArena = true;
    this.state = 'waiting';
    this.nextPid = 1;
    this.nextBotAt = 0;
    this.botN = 0;
  }

  counts() {
    const c = { E: 0, T: 0, bots: 0, total: 0 };
    for (const p of this.game.players.values()) { c[p.team]++; c.total++; if (p.isBot) c.bots++; }
    return c;
  }
  open() { return !this.ended && (this.state === 'waiting' || (this.game && this.game.time < this.game.duration - 45)); }
  hasHumanSlot() { if (this.state === 'waiting') return true; const c = this.counts(); return c.bots > 0 || c.total < MAX_PLAYERS; }

  startGame() {
    this.state = 'playing';
    this.game = new Game({ seed: crypto.randomInt(1e9), mapPreset: this.settings.map, matchPreset: this.settings.match, players: [] });
    this.loop = setInterval(() => this.tick(), DT * 1000);
    log(`arena ${this.code} aberta (${this.settings.map})`);
  }

  notice(msg, except) { for (const t of this.members) if (t !== except) { const s = sessions.get(t); send(s && s.ws, { t: 'notice', msg }); } }

  join(s, pref = 'A', cls = 'cacador') {
    if (!this.open() || !this.hasHumanSlot()) return 'Arena cheia';
    if (s.room && s.room !== this) s.room.leave(s);
    if (this.state === 'waiting') this.startGame();
    const g = this.game;
    let c = this.counts();
    // Escolhe a equipe: preferência do jogador quando há vaga, senão a que equilibra a partida
    const after = c.bots > 0 ? c.total : c.total + 1; // com bot na sala, um deles cede a vaga
    let team;
    if (pref === 'T' && (c.T < MAX_TROLLS || this.botOf('T'))) team = 'T';
    else if (pref === 'E' && (c.E < MAX_ELVES || this.botOf('E'))) team = 'E';
    else team = c.T < wantTrolls(after) || c.E >= MAX_ELVES ? 'T' : 'E';
    // Um bot cai para dar lugar ao humano (de preferência da mesma equipe)
    let replaced = null;
    if (c.bots > 0) {
      replaced = this.botOf(team) || this.botOf(team === 'E' ? 'T' : 'E');
      g.removePlayer(replaced.id);
    }
    c = this.counts();
    if (c.total >= MAX_PLAYERS) return 'Arena cheia';
    if ((team === 'T' && c.T >= MAX_TROLLS) || (team === 'E' && c.E >= MAX_ELVES)) team = team === 'T' ? 'E' : 'T';
    const pid = this.nextPid++;
    g.addPlayer({ id: pid, name: s.name, team, cls: typeof cls === 'string' && Object.hasOwn(TROLL_CLASSES, cls) ? cls : 'cacador', isBot: false });
    if (!this.members.includes(s.token)) this.members.push(s.token);
    this.pids.set(s.token, pid);
    s.room = this; s.team = pref; s.cls = cls;
    this.nextBotAt = Date.now() + ARENA_BOT_MS; // recomeça a contagem de 1 min
    this.sendInit(s);
    this.notice(replaced ? `${s.name} entrou no lugar do bot ${replaced.name}` : `${s.name} entrou na partida (${team === 'E' ? 'elfos' : 'trolls'})`, s.token);
    log(`arena ${this.code}: ${s.name} entrou como ${team}${replaced ? `, bot ${replaced.name} saiu` : ''}`);
    return null;
  }

  botOf(team) {
    let pick = null;
    for (const p of this.game.players.values()) if (p.isBot && p.team === team) pick = p; // o mais recente sai primeiro
    return pick;
  }

  addBot() {
    const c = this.counts();
    if (c.total >= MAX_PLAYERS) return;
    const team = (c.T < wantTrolls(c.total + 1) || c.E >= MAX_ELVES) && c.T < MAX_TROLLS ? 'T' : 'E';
    const classes = Object.keys(TROLL_CLASSES);
    const n = this.botN++;
    const name = team === 'E' ? BOT_ELVES[n % BOT_ELVES.length] : BOT_TROLLS[n % BOT_TROLLS.length];
    this.game.addPlayer({ id: this.nextPid++, name, team, cls: classes[n % classes.length], isBot: true, difficulty: this.settings.difficulty, skin: n % 6 });
    this.notice(`Bot ${name} entrou (${team === 'E' ? 'elfos' : 'trolls'}) · ${c.total + 1}/${MAX_PLAYERS}`);
  }

  sendInit(s) {
    const pid = this.pids.get(s.token);
    this.sent.set(s.token, 0);
    send(s.ws, { ...this.game.initInfo(pid), arena: true });
  }

  leave(s) {
    const pid = this.pids.get(s.token);
    const p = this.game && this.game.players.get(pid);
    if (p) { this.game.setConnected(pid, false); p.isBot = true; p.takeover = false; p.connected = true; }
    this.members = this.members.filter((t) => t !== s.token);
    this.pids.delete(s.token);
    if (s.room === this) s.room = null;
    if (p && !this.ended) this.notice(`${p.name} saiu; um bot assumiu o personagem`);
  }

  tick() {
    super.tick();
    if (!this.game || rooms.get(this.code) !== this) return;
    if (this.game.tick % 20 !== 0) return; // regras da arena 1x por segundo
    if (!this.members.length) { log(`arena ${this.code} fechada: sem humanos`); this.destroy(); return; }
    if (!this.ended && Date.now() >= this.nextBotAt && this.counts().total < MAX_PLAYERS) {
      this.addBot();
      this.nextBotAt = Date.now() + ARENA_BOT_MS;
    }
  }

  // Fim de partida: abre a próxima arena e leva quem ainda está aqui
  onEnded() {
    this.notice(`Nova partida em ${Math.round(ARENA_NEXT_MS / 1000)}s`);
    setTimeout(() => {
      const stay = this.members.map((t) => sessions.get(t)).filter((s) => s && s.room === this && s.ws);
      this.destroy();
      for (const s of stay) { s.room = null; joinArena(s, s.team, s.cls); }
    }, ARENA_NEXT_MS).unref();
  }
}

function joinArena(s, pref, cls) {
  for (const r of rooms.values()) if (r.isArena && r.open() && r.hasHumanSlot() && !r.join(s, pref, cls)) return null;
  const a = new Arena();
  return a.join(s, pref, cls);
}

// ---------------------------------------------------------------- mensagens
function onMessage(ws, raw) {
  try { handleMessage(ws, raw); } catch (e) { log('erro ao tratar mensagem:', e.stack || e); }
}

function handleMessage(ws, raw) {
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
    case 'quick': case 'arena': {
      if (s.room && s.room.isArena && s.room.state === 'playing') { s.room.sendInit(s); break; }
      const pref = ['A', 'E', 'T'].includes(m.team) ? m.team : 'A';
      const err = joinArena(s, pref, m.cls); if (err) send(ws, { t: 'error', msg: err });
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
  let url;
  try { url = new URL(req.url, 'http://x'); decodeURIComponent(url.pathname); } catch { res.writeHead(400); res.end(); return; }
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
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable' });
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
});

const wss = new WebSocketServer({
  server, path: '/ws', maxPayload: 8192,
  perMessageDeflate: { threshold: 512, zlibDeflateOptions: { level: 3 } }, // ~4x menos banda no Wi-Fi/4G
});
wss.on('connection', (ws) => {
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', (data) => { ws.alive = true; onMessage(ws, data.toString()); });
  ws.on('close', () => { try { onClose(ws); } catch (e) { log('erro no close:', e.stack || e); } });
  ws.on('error', (e) => log('erro de socket:', e.message));
});
// Batimento: derruba conexões mortas (celular sem sinal, aba suspensa) para a IA assumir na hora
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    try { ws.ping(); } catch { /* ignora */ }
  }
}, HEARTBEAT_MS);
heartbeat.unref();

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`A porta ${PORT} já está em uso: provavelmente o servidor já está rodando em outra janela. Feche-o ou use PORT=3001.`);
    process.exit(1);
  }
  log('erro no servidor HTTP:', e.stack || e);
});
process.on('uncaughtException', (e) => log('exceção não tratada (servidor segue no ar):', e.stack || e));
process.on('unhandledRejection', (e) => log('promise rejeitada (servidor segue no ar):', e && (e.stack || e)));

export const _internals = { rooms, sessions }; // só para testes

export function startServer(port = PORT) {
  return new Promise((resolve) => server.listen(port, () => { log(`Raízes & Presas no ar: http://localhost:${server.address().port}`); resolve(server); }));
}
export function stopServer() {
  clearInterval(heartbeat);
  for (const r of rooms.values()) r.destroy();
  wss.close(); return new Promise((r) => server.close(r));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startServer();
