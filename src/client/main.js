import './style.css';
import { Renderer } from './render.js';
import { ClientWorld } from './world.js';
import { LocalTransport, NetTransport } from './transport.js';
import { Hud } from './hud.js';
import { initAudio, resumeAudio, setVolume, sfx } from './audio.js';
import { loadProfile, saveProfile, recordMatch, claimDaily, dailyAvailable, ACHIEVEMENTS, SKIN_UNLOCK, accountXpFor } from './profile.js';
import { TROLL_CLASSES, MATCH_PRESETS } from '../shared/defs.js';
import { MAP_PRESETS } from '../shared/mapgen.js';
import { ELF_SKINS } from './models.js';

const profile = loadProfile();

// Responsividade: tudo é desenhado para um celular deitado de referência (915×412)
// e escalado para a tela real — de celulares pequenos a monitores 4K.
function applyScale() {
  const w = window.innerWidth, h = window.innerHeight;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const hud = clamp(Math.min(w / 915, h / 412), 0.72, 1.8);
  const uiz = clamp(Math.min(w / 860, h / 440), 0.8, 1.5);
  const root = document.documentElement.style;
  root.setProperty('--hud-z', hud.toFixed(3));
  root.setProperty('--ui-z', uiz.toFixed(3));
}
applyScale();
window.addEventListener('resize', applyScale);
window.addEventListener('orientationchange', () => setTimeout(applyScale, 200));
setVolume(profile.settings.volume);
const ui = document.getElementById('ui');
const hudRoot = document.getElementById('hud');
let renderer, menuWorld, world = null, hud = null, transport = null, inGame = false, paused = false;
let lastInput = '', lastInputAt = 0, endShown = false, lastLocalOpts = null, orbit = 0, arenaMode = false;
const arenaPref = { team: 'A', cls: 'cacador' };
try { Object.assign(arenaPref, JSON.parse(localStorage.getItem('rp_arena') || '{}')); } catch { /* sem storage */ }
const saveArenaPref = () => { try { localStorage.setItem('rp_arena', JSON.stringify(arenaPref)); } catch { /* ignora */ } };

const ELF_NAMES = ['Lirael', 'Thandor', 'Sylwen', 'Aerin', 'Faelar', 'Nimue', 'Elowen', 'Caelum', 'Ithil', 'Mirren', 'Galen', 'Yavanna'];
const TROLL_NAMES = ['Grokk', 'Zulmak', 'Rhaxa', 'Mograth', 'Vurk', 'Thrash'];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------- renderizador + cenário do menu
function makeRenderer() {
  const old = document.getElementById('game');
  const canvas = document.createElement('canvas'); canvas.id = 'game';
  if (old) { old.replaceWith(canvas); renderer && renderer.dispose(); } else document.body.prepend(canvas);
  renderer = new Renderer(canvas, profile.settings.quality);
  menuWorld = new ClientWorld({ seed: (Math.random() * 1e9) | 0, mapPreset: 'floresta', pid: 0 });
  renderer.setWorld(menuWorld);
  renderer.zoom = 1.25;
}

function serverUrl() {
  if (profile.settings.server) {
    let s = profile.settings.server.trim();
    if (!/^wss?:\/\//.test(s)) s = (s.startsWith('localhost') || /^\d/.test(s) ? 'ws://' : 'wss://') + s;
    return s.replace(/\/$/, '') + (s.endsWith('/ws') ? '' : '/ws');
  }
  // Site estático (ex.: Vercel) aponta para o servidor de jogo definido no build: VITE_SERVER_URL
  const env = import.meta.env.VITE_SERVER_URL;
  if (env) { const e = env.trim().replace(/\/$/, '').replace(/^http/, 'ws'); return e.endsWith('/ws') ? e : e + '/ws'; }
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}
// Servidores gratuitos (Render etc.) dormem sem uso: um GET acorda antes de conectar
const wakeServer = () => fetch(httpBase() + '/api/health', { cache: 'no-store' }).then((r) => r.ok).catch(() => false);
const httpBase = () => serverUrl().replace(/^ws/, 'http').replace(/\/ws$/, '');

// ---------------------------------------------------------------- telas
function screen(html, cls = '') {
  ui.className = `ui ${cls}`;
  ui.innerHTML = html;
  ui.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { sfx('click'); SCREENS[b.dataset.go](); }));
}

const SCREENS = {
  menu() {
    const daily = dailyAvailable(profile);
    screen(`
      <div class="title"><h1>Raízes <span>&amp;</span> Presas</h1><p>Construa. Sobreviva. Ou cace.</p></div>
      <div class="menu">
        <button class="btn hero" data-go="local">Jogar contra bots</button>
        <button class="btn" data-go="online">Multiplayer online</button>
        <button class="btn" data-go="profile">Perfil e conquistas ${daily ? '<i class="dot"></i>' : ''}</button>
        <button class="btn" data-go="settings">Configurações</button>
        <button class="btn ghost" data-go="howto">Como jogar</button>
      </div>
      <div class="foot">Nível ${profile.level} · ${esc(profile.name || 'Sem nome')}</div>`, 'menu-screen');
    if (!profile.name) SCREENS.name();
  },

  name() {
    screen(`<div class="card"><h2>Como devemos te chamar?</h2>
      <input id="nm" maxlength="16" placeholder="Seu nome" value="${esc(profile.name)}">
      <button class="btn hero" id="ok">Entrar na floresta</button></div>`);
    const go = () => { const v = ui.querySelector('#nm').value.trim(); if (!v) return; profile.name = v.slice(0, 16); saveProfile(profile); SCREENS.menu(); };
    ui.querySelector('#ok').addEventListener('click', go);
    ui.querySelector('#nm').addEventListener('keydown', (e) => e.key === 'Enter' && go());
  },

  local() {
    const o = lastLocalOpts || { team: 'E', cls: 'cacador', difficulty: 'normal', map: 'floresta', match: 'padrao', count: 10 };
    const opt = (name, val, label, cur) => `<button class="chip ${cur === val ? 'on' : ''}" data-k="${name}" data-v="${val}">${label}</button>`;
    const render = () => {
      screen(`<div class="card wide"><h2>Partida contra bots</h2>
        <label>Equipe</label><div class="chips">${opt('team', 'E', 'Elfos', o.team)}${opt('team', 'T', 'Trolls', o.team)}${opt('team', 'R', 'Aleatória', o.team)}</div>
        <label>Classe de troll</label><div class="chips">${Object.entries(TROLL_CLASSES).map(([k, c]) => opt('cls', k, c.name, o.cls)).join('')}</div>
        <div class="desc">${TROLL_CLASSES[o.cls].desc}</div>
        <label>Dificuldade dos bots</label><div class="chips">${opt('difficulty', 'facil', 'Fácil', o.difficulty)}${opt('difficulty', 'normal', 'Normal', o.difficulty)}${opt('difficulty', 'dificil', 'Difícil', o.difficulty)}</div>
        <label>Mapa</label><div class="chips">${Object.entries(MAP_PRESETS).map(([k, m]) => opt('map', k, m.name, o.map)).join('')}</div>
        <label>Duração</label><div class="chips">${Object.entries(MATCH_PRESETS).map(([k, m]) => opt('match', k, `${k === 'curta' ? 'Curta' : k === 'padrao' ? 'Padrão' : 'Longa'} (${m.duration / 60} min)`, o.match)).join('')}</div>
        <label>Jogadores</label><div class="chips">${[6, 8, 10].map((n) => opt('count', n, `${n} (${n >= 8 ? 2 : 1} troll${n >= 8 ? 's' : ''})`, o.count)).join('')}</div>
        <div class="row"><button class="btn ghost" data-go="menu">Voltar</button><button class="btn hero" id="go">Começar</button></div></div>`);
      ui.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
        sfx('click'); const v = b.dataset.v; o[b.dataset.k] = b.dataset.k === 'count' ? Number(v) : v; render();
      }));
      ui.querySelector('#go').addEventListener('click', () => { lastLocalOpts = o; startLocal(o); });
    };
    render();
  },

  online() {
    screen(`<div class="card wide"><h2>Multiplayer online</h2>
      <div class="desc"><b>Arena:</b> entre e a partida começa na hora. A cada 1 min entra um bot até fechar 10 vagas; quando chega outro humano, um bot sai para dar lugar. Ao terminar, a próxima partida abre sozinha. Se você cair, a IA segura seu personagem até você voltar.</div>
      <label>Equipe preferida</label><div class="chips">${['A', 'E', 'T'].map((t) => `<button class="chip ${arenaPref.team === t ? 'on' : ''}" data-team="${t}">${{ A: 'Automática', E: 'Elfos', T: 'Trolls' }[t]}</button>`).join('')}</div>
      ${arenaPref.team === 'T' ? `<div class="chips">${Object.entries(TROLL_CLASSES).map(([k, c]) => `<button class="chip ${arenaPref.cls === k ? 'on' : ''}" data-cls="${k}">${c.name}</button>`).join('')}</div>` : ''}
      <div class="row"><button class="btn hero" id="quick">Entrar na arena</button><button class="btn" id="create">Criar sala privada</button></div>
      <label>Servidor</label><input id="srv" placeholder="${import.meta.env.VITE_SERVER_URL ? 'padrão do site' : 'mesmo endereço do site (ex.: 192.168.0.10:3000)'}" value="${esc(profile.settings.server)}">
      <label>Entrar com código</label><div class="row"><input id="code" maxlength="5" placeholder="ABCDE" style="text-transform:uppercase"><button class="btn" id="join">Entrar</button></div>
      <div class="status" id="st"></div>
      <div class="row"><button class="btn ghost" data-go="menu">Voltar</button><button class="btn ghost" data-go="ranking">Ranking</button></div></div>`);
    const st = ui.querySelector('#st');
    ui.querySelectorAll('[data-team]').forEach((b) => b.addEventListener('click', () => { sfx('click'); arenaPref.team = b.dataset.team; saveArenaPref(); SCREENS.online(); }));
    ui.querySelectorAll('[data-cls]').forEach((b) => b.addEventListener('click', () => { sfx('click'); arenaPref.cls = b.dataset.cls; saveArenaPref(); SCREENS.online(); }));
    wakeServer();
    let busy = false;
    const act = async (msg) => {
      if (busy) return; busy = true;
      profile.settings.server = ui.querySelector('#srv').value.trim(); saveProfile(profile);
      const until = Date.now() + 90000;
      for (let n = 1; ; n++) {
        st.textContent = n === 1 ? 'Conectando…' : `Acordando o servidor… pode levar até 1 min (tentativa ${n})`;
        try {
          await connectNet();
          transport.raw(msg);
          st.textContent = 'Conectado. Entrando…';
          break;
        } catch (e) {
          if (transport instanceof NetTransport && !transport.everConnected) { transport.close(); transport = null; }
          const noServer = !import.meta.env.VITE_SERVER_URL && !profile.settings.server && /vercel\.app$|netlify\.app$|github\.io$/.test(location.hostname);
          if (noServer) { st.textContent = 'Este site não tem servidor de jogo configurado. Preencha o campo Servidor (ex.: meu-servidor.onrender.com) ou jogue Contra bots.'; break; }
          if (Date.now() > until || !document.body.contains(st)) { st.textContent = e.message; break; }
          wakeServer();
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
      busy = false;
    };
    ui.querySelector('#quick').addEventListener('click', () => act({ t: 'arena', team: arenaPref.team, cls: arenaPref.cls }));
    ui.querySelector('#create').addEventListener('click', () => act({ t: 'create', settings: { map: 'floresta', match: 'padrao', difficulty: 'normal' } }));
    ui.querySelector('#join').addEventListener('click', () => { const c = ui.querySelector('#code').value.trim().toUpperCase(); if (c) act({ t: 'join', code: c }); });
  },

  async ranking() {
    screen(`<div class="card wide"><h2>Ranking</h2><div id="rk">Carregando…</div>
      <h3>Suas últimas partidas</h3><div class="hist">${profile.history.slice(0, 8).map((h) => `<div>${new Date(h.at).toLocaleDateString('pt-BR')} · ${h.team === 'E' ? 'Elfo' : 'Troll'} · <b class="${h.won ? 'win' : 'loss'}">${h.won ? 'Vitória' : 'Derrota'}</b> · ${Math.round(h.time / 60)} min · ${h.kills} abates · ${h.built} construções</div>`).join('') || 'Nenhuma ainda.'}</div>
      <div class="row"><button class="btn ghost" data-go="online">Voltar</button></div></div>`);
    try {
      const r = await fetch(`${httpBase()}/api/ranking`);
      const list = await r.json();
      ui.querySelector('#rk').innerHTML = list.length ? `<table><tr><th>#</th><th>Jogador</th><th>Vitórias</th><th>Partidas</th><th>Abates</th></tr>${list.slice(0, 20).map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.name)}</td><td>${p.wins}</td><td>${p.matches}</td><td>${p.kills}</td></tr>`).join('')}</table>` : 'Ninguém no ranking ainda.';
    } catch { const el = ui.querySelector('#rk'); if (el) el.textContent = 'Ranking global indisponível (servidor offline).'; }
  },

  profile() {
    const p = profile;
    const daily = dailyAvailable(p);
    screen(`<div class="card wide"><h2>${esc(p.name)} <small>Nível ${p.level}</small></h2>
      <div class="bar xp big"><i style="width:${(p.xp / accountXpFor(p.level)) * 100}%"></i><span>${p.xp}/${accountXpFor(p.level)} XP</span></div>
      <div class="row"><button class="btn ${daily ? 'hero' : ''}" id="daily" ${daily ? '' : 'disabled'}>${daily ? 'Resgatar recompensa diária' : `Recompensa resgatada · sequência ${p.daily.streak} dia(s)`}</button><button class="btn ghost" id="rn">Trocar nome</button></div>
      <h3>Visual do elfo <small>(cosmético)</small></h3><div class="skins">${ELF_SKINS.map((s, i) => {
        const lock = p.level < SKIN_UNLOCK[i];
        return `<button class="skin ${p.skin === i ? 'on' : ''} ${lock ? 'locked' : ''}" data-i="${i}" ${lock ? 'disabled' : ''} style="--c:#${s.cloak.toString(16).padStart(6, '0')};--t:#${s.trim.toString(16).padStart(6, '0')}"><i></i>${s.name}${lock ? `<small>Nível ${SKIN_UNLOCK[i]}</small>` : ''}</button>`;
      }).join('')}</div>
      <h3>Conquistas (${Object.keys(p.achievements).length}/${ACHIEVEMENTS.length})</h3>
      <div class="ach">${ACHIEVEMENTS.map((a) => `<div class="${p.achievements[a.id] ? 'got' : ''}"><b>${a.name}</b><span>${a.desc}</span></div>`).join('')}</div>
      <h3>Estatísticas</h3><div class="stats">Partidas ${p.totals.matches} · Vitórias como elfo ${p.totals.winsE} · Vitórias como troll ${p.totals.winsT} · Abates ${p.totals.kills} · Construções ${p.totals.built} · Destruídas ${p.totals.destroyed} · Tempo sobrevivido ${Math.round(p.totals.survived / 60)} min</div>
      <div class="row"><button class="btn ghost" data-go="menu">Voltar</button></div></div>`);
    ui.querySelector('#daily').addEventListener('click', () => { const xp = claimDaily(profile); if (xp) { sfx('level'); SCREENS.profile(); } });
    ui.querySelector('#rn').addEventListener('click', () => SCREENS.name());
    ui.querySelectorAll('.skin').forEach((b) => b.addEventListener('click', () => { profile.skin = Number(b.dataset.i); saveProfile(profile); sfx('click'); SCREENS.profile(); }));
  },

  settings() {
    const s = profile.settings;
    screen(`<div class="card wide"><h2>Configurações</h2>
      <label>Qualidade gráfica</label><div class="chips">${['baixa', 'media', 'alta'].map((q) => `<button class="chip ${s.quality === q ? 'on' : ''}" data-q="${q}">${{ baixa: 'Baixa', media: 'Média', alta: 'Alta' }[q]}</button>`).join('')}</div>
      <div class="desc">Baixa: resolução reduzida, sem sombras e árvores simplificadas. Alta: sombras e antisserrilhado.</div>
      <label>Volume</label><input type="range" id="vol" min="0" max="1" step="0.05" value="${s.volume}">
      <label>Servidor multiplayer</label><input id="srv" value="${esc(s.server)}" placeholder="vazio = mesmo endereço do site">
      <div class="row"><button class="btn ghost" data-go="menu">Voltar</button></div></div>`);
    ui.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => {
      s.quality = b.dataset.q; saveProfile(profile); makeRenderer(); SCREENS.settings();
    }));
    ui.querySelector('#vol').addEventListener('input', (e) => { s.volume = Number(e.target.value); setVolume(s.volume); saveProfile(profile); });
    ui.querySelector('#srv').addEventListener('change', (e) => { s.server = e.target.value.trim(); saveProfile(profile); });
  },

  howto() {
    screen(`<div class="card wide howto"><h2>Como jogar</h2>
      <h3>Elfos: sobrevivam até o amanhecer</h3>
      <p>Use <b>Coletar</b> perto de árvores (madeira), veios dourados (ouro) e cristais roxos. Toque em <b>Construir</b>, escolha a estrutura, arraste o holograma e confirme. Feche sua base com muros e um <b>Portão</b> (só elfos passam). Torres atiram sozinhas, armadilhas ficam invisíveis para os trolls, e a <b>Árvore Ancestral</b> libera muros de cristal, torres arcanas, runas e o <b>Altar de Renascimento</b>. Para reparar, fique ao lado e use Coletar. Toque numa construção para melhorar ou demolir.</p>
      <h3>Trolls: cacem todos os elfos</h3>
      <p>Na preparação vocês ficam presos no covil central. Depois, explorem, derrubem árvores e muros com <b>Atacar</b>, ganhem ouro e XP destruindo construções e comprem força, pele, ímpeto e garras em <b>Progressão</b> (ícone de bolsa). No nível 8 dá para <b>Evoluir</b> para Troll Ancestral.</p>
      <h3>Fases</h3>
      <p>1 Preparação → 2 Sobrevivência → 3 Caçada Intensa (trolls +15% de dano, eventos aleatórios) → 4 Confronto Final (+30%, e o Uivo da Lua revela os elfos). Cavernas escondem quem está dentro.</p>
      <h3>Controles</h3>
      <p>Celular: toque na metade esquerda para o joystick. Toque nos botões para ligar/desligar Atacar e Coletar, ou segure. Pinça para zoom. Toque no minimapa para marcar um ponto para o time.<br>PC: WASD, Espaço atacar, E coletar, B construir, R girar, Enter confirmar, Q/F/G habilidades, Tab progressão.</p>
      <div class="row"><button class="btn ghost" data-go="menu">Voltar</button></div></div>`);
  },
};

// ---------------------------------------------------------------- partida
function startLocal(o) {
  const n = o.count, trolls = n >= 8 ? 2 : 1;
  const team = o.team === 'R' ? (Math.random() < trolls / n ? 'T' : 'E') : o.team;
  const players = [{ id: 1, name: profile.name || 'Você', team, cls: o.cls, isBot: false, skin: profile.skin }];
  let e = team === 'E' ? 1 : 0, t = team === 'T' ? 1 : 0, id = 2;
  const clsList = Object.keys(TROLL_CLASSES).filter((c) => c !== o.cls);
  while (t < trolls) { players.push({ id: id++, name: TROLL_NAMES[t], team: 'T', cls: clsList[(t + id) % clsList.length], isBot: true, difficulty: o.difficulty }); t++; }
  while (e < n - trolls) { players.push({ id: id++, name: ELF_NAMES[e], team: 'E', isBot: true, difficulty: o.difficulty, skin: e % 6 }); e++; }
  const seed = (Math.random() * 1e9) | 0;
  const tr = new LocalTransport({ seed, mapPreset: o.map, matchPreset: o.match, players, pid: 1 });
  beginGame(tr);
  tr.start();
}

async function connectNet() {
  if (transport instanceof NetTransport && transport.ws && transport.ws.readyState === 1) return;
  const tr = new NetTransport(serverUrl());
  beginGame(tr, false);
  tr.on('lobby', (m) => renderLobby(m.room));
  tr.on('notice', (m) => { if (hud) hud.toast(m.msg); });
  tr.on('error', (m) => { if (hud) hud.toast(m.msg, 'warn'); else { const st = ui.querySelector('#st'); if (st) st.textContent = m.msg; } });
  tr.on('disconnect', () => setNet(true));
  tr.on('reconnecting', (m) => setNet(true, m.attempt));
  tr.on('reconnected', (m) => {
    setNet(false);
    // O servidor reiniciou e a partida antiga não existe mais
    if (inGame && !m.resumed) {
      leaveGame();
      screen('<div class="card"><h2>A partida foi encerrada</h2><p class="desc">O servidor reiniciou e a sala anterior não existe mais.</p><button class="btn hero" data-go="online">Voltar ao multiplayer</button></div>');
    }
  });
  await tr.connect(profile.name || 'Jogador');
}

function renderLobby(room) {
  if (inGame) return;
  const me = room.players.find((p) => p.you);
  const isHost = me && me.host;
  screen(`<div class="card wide"><h2>${room.isPrivate ? `Sala privada <span class="code">${room.code}</span>` : 'Partida pública'}</h2>
    <div class="desc">${room.isPrivate ? 'Passe o código para seus amigos.' : `Começa automaticamente${room.startsIn ? ` em ${room.startsIn}s` : ' quando houver jogadores'}. Vagas livres viram bots.`}</div>
    <div class="lobby">${room.players.map((p) => `<div class="${p.you ? 'you' : ''}"><b>${esc(p.name)}</b>${p.host ? ' <small>anfitrião</small>' : ''}<span class="tm ${p.team}">${p.team === 'E' ? 'Elfos' : p.team === 'T' ? `Trolls · ${TROLL_CLASSES[p.cls]?.name || ''}` : 'Automático'}</span></div>`).join('')}
    ${Array.from({ length: Math.max(0, room.max - room.players.length) }, () => '<div class="empty">vaga livre · bot</div>').join('')}</div>
    <label>Sua equipe</label><div class="chips">${['A', 'E', 'T'].map((t) => `<button class="chip ${me && me.team === t ? 'on' : ''}" data-team="${t}">${{ A: 'Automática', E: 'Elfos', T: 'Trolls' }[t]}</button>`).join('')}</div>
    <div class="chips">${Object.entries(TROLL_CLASSES).map(([k, c]) => `<button class="chip ${me && me.cls === k ? 'on' : ''}" data-cls="${k}">${c.name}</button>`).join('')}</div>
    <div class="row"><button class="btn ghost" id="leave">Sair</button>${isHost || !room.isPrivate ? '<button class="btn hero" id="start">Começar agora</button>' : '<span class="desc">Aguardando o anfitrião…</span>'}</div></div>`);
  ui.querySelectorAll('[data-team]').forEach((b) => b.addEventListener('click', () => transport.raw({ t: 'team', team: b.dataset.team, cls: me.cls })));
  ui.querySelectorAll('[data-cls]').forEach((b) => b.addEventListener('click', () => transport.raw({ t: 'team', team: me.team, cls: b.dataset.cls })));
  ui.querySelector('#leave').addEventListener('click', () => { transport.raw({ t: 'leave' }); transport.close(); transport = null; SCREENS.online(); });
  const st = ui.querySelector('#start'); if (st) st.addEventListener('click', () => transport.raw({ t: 'start' }));
}

// Aviso persistente de conexão (some sozinho quando os dados voltam)
function setNet(down, attempt = 0) {
  let el = document.getElementById('net');
  if (!el) { el = document.createElement('div'); el.id = 'net'; document.body.appendChild(el); }
  el.className = down ? 'on' : '';
  el.textContent = attempt > 3 ? `Sem conexão com o servidor… tentativa ${attempt}` : 'Reconectando…';
}

// Mantém a tela acesa durante a partida (evita o celular suspender a aba e derrubar a conexão)
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && document.visibilityState === 'visible' && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { wakeLock = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && inGame) keepAwake(true);
  // partida local pausa sozinha quando o app vai para segundo plano
  if (document.visibilityState === 'hidden' && inGame && transport instanceof LocalTransport && !paused) openPause();
});

function beginGame(tr, local = true) {
  transport = tr;
  endShown = false;
  tr.on('init', (m) => {
    if (hud) { hud.destroy(); hud = null; }
    endShown = false; arenaMode = !!m.arena;
    world = new ClientWorld(m);
    renderer.setWorld(world);
    renderer.zoom = 0.85;
    hud = new Hud(hudRoot, { send: (c) => transport.send(c), renderer, onMenu: openPause, profile });
    hud.setWorld(world);
    world.on('fx', (list) => { const u = world.myUnit(); renderer.fx(list, u); hud.onFx(list); });
    inGame = true; paused = false;
    ui.className = 'ui hidden'; ui.innerHTML = '';
    setNet(false);
    keepAwake(true);
    tryLandscape();
  });
  tr.on('snap', (s) => {
    if (!world) return;
    if (document.getElementById('net')?.className === 'on') setNet(false);
    world.apply(s);
    if (s.over && !endShown) { endShown = true; setTimeout(() => showEnd(s.over), 1200); }
  });
  tr.on('res', (m) => { if (hud && m.err) { hud.toast(m.err, 'warn'); sfx('error'); } });
  tr.local = local;
}

function openPause() {
  if (!inGame) return;
  const local = transport instanceof LocalTransport;
  if (local) transport.paused = true;
  paused = true;
  screen(`<div class="card"><h2>${local ? 'Pausado' : 'Menu'}</h2>
    <button class="btn hero" id="res">Continuar</button>
    <label>Volume</label><input type="range" id="vol" min="0" max="1" step="0.05" value="${profile.settings.volume}">
    <button class="btn danger" id="quit">Sair da partida</button></div>`, 'overlay');
  ui.querySelector('#res').addEventListener('click', closePause);
  ui.querySelector('#vol').addEventListener('input', (e) => { profile.settings.volume = Number(e.target.value); setVolume(profile.settings.volume); saveProfile(profile); });
  ui.querySelector('#quit').addEventListener('click', () => { leaveGame(); SCREENS.menu(); });
}
function closePause() {
  if (transport instanceof LocalTransport) transport.paused = false;
  paused = false; ui.className = 'ui hidden'; ui.innerHTML = '';
}

function leaveGame() {
  if (transport) { if (!(transport instanceof LocalTransport)) transport.raw({ t: 'leave' }); transport.close(); }
  transport = null;
  if (hud) { hud.destroy(); hud = null; }
  world = null; inGame = false; paused = false;
  setNet(false); keepAwake(false);
  renderer.setWorld(menuWorld); renderer.zoom = 1.25;
}

function showEnd(over) {
  if (!world) return;
  const pid = world.pid;
  const me = over.players.find((p) => p.id === pid);
  const rw = recordMatch(profile, over, pid);
  const won = me && me.team === over.winner;
  sfx(won ? 'level' : 'death');
  const rows = over.players.slice().sort((a, b) => (a.team > b.team ? 1 : -1)).map((p) => `<tr class="${p.id === pid ? 'you' : ''}"><td>${esc(p.name)}${p.isBot ? ' <small>bot</small>' : ''}</td><td>${p.team === 'E' ? 'Elfo' : (p.ancestral ? 'Ancestral' : TROLL_CLASSES[p.cls].name)}</td><td>${p.level}</td><td>${p.team === 'E' ? (p.alive ? 'Vivo' : 'Caiu') : ''}</td><td>${p.stats.kills}</td><td>${p.stats.built}</td><td>${p.stats.destroyed}</td></tr>`).join('');
  screen(`<div class="card wide end ${won ? 'won' : 'lost'}"><h1>${over.winner === 'E' ? 'Os elfos viram o amanhecer' : 'Os trolls dominaram a floresta'}</h1>
    <h2>${won ? 'Vitória!' : 'Derrota'}</h2>
    <div class="rewards">+${rw.xp} XP de conta${rw.levelUp ? ` · Nível ${profile.level}!` : ''}${rw.unlocked.length ? `<br>Conquistas: ${rw.unlocked.map((id) => ACHIEVEMENTS.find((a) => a.id === id).name).join(', ')}` : ''}</div>
    <table><tr><th>Jogador</th><th>Classe</th><th>Nv</th><th></th><th>Abates</th><th>Constr.</th><th>Destr.</th></tr>${rows}</table>
    ${arenaMode ? '<div class="desc">A próxima partida da arena começa sozinha em instantes…</div>' : ''}
    <div class="row"><button class="btn ghost" id="menu">${arenaMode ? 'Sair da arena' : 'Menu'}</button>${transport instanceof LocalTransport ? '<button class="btn hero" id="again">Jogar de novo</button>' : ''}</div></div>`, 'overlay');
  ui.querySelector('#menu').addEventListener('click', () => { leaveGame(); SCREENS.menu(); });
  const ag = ui.querySelector('#again'); if (ag) ag.addEventListener('click', () => { leaveGame(); startLocal(lastLocalOpts); });
}

function tryLandscape() {
  try {
    if (matchMedia('(pointer: coarse)').matches && document.documentElement.requestFullscreen && !document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => window.screen.orientation && window.screen.orientation.lock && window.screen.orientation.lock('landscape').catch(() => {})).catch(() => {});
    }
  } catch { /* ignora */ }
}

// ---------------------------------------------------------------- loop
let last = performance.now();
function frame(t) {
  const dt = Math.min(0.1, (t - last) / 1000); last = t;
  try {
    if (inGame && world && transport) {
      transport.update(dt);
      if (hud && !paused) {
        const inp = hud.getInput();
        const key = JSON.stringify(inp);
        if (key !== lastInput || t - lastInputAt > 250) { transport.send({ t: 'input', ...inp }); lastInput = key; lastInputAt = t; }
        hud.update(dt);
      }
      let focus = world.myUnit();
      if (!focus || (focus.flags & 16)) {
        const allies = [...world.units.values()].filter((u) => u.team === world.team() && !(u.flags & 16));
        if (allies.length) focus = allies[(hud ? hud.spectate : 0) % allies.length];
      }
      renderer.render(dt, world, focus);
    } else {
      orbit += dt * 0.05;
      const c = menuWorld.W / 2;
      renderer.render(dt, null, { x: c + Math.cos(orbit) * 22, y: c + Math.sin(orbit) * 22 });
    }
  } catch (err) {
    console.error(err);
  }
  requestAnimationFrame(frame);
}

document.addEventListener('pointerdown', () => { initAudio(); resumeAudio(); }, { once: false });
makeRenderer();
SCREENS.menu();
requestAnimationFrame(frame);
window.__rp = { get world() { return world; }, get transport() { return transport; }, startLocal };
