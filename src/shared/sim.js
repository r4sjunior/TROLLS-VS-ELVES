// Simulação autoritativa. Roda igual no servidor (online) e no navegador (partida local).
// O cliente nunca altera o estado direto: tudo passa por handleCommand(), que valida.
import {
  TILE, WALKABLE, BUILDABLE, DT, MATCH_PRESETS, BUILDINGS, BUILD_RANGE, REPAIR_RATE, REPAIR_WOOD_PER_HP,
  DEMOLISH_REFUND, ELF, ELF_ABILITIES, ELF_UPGRADES, TROLL_CLASSES, TROLL_UPGRADES, ANCESTRAL, ANCESTRAL_LEVEL,
  TROLL_RESPAWN, TROLL_REGEN, HARVEST_RATE, xpForLevel, EVENTS,
} from './defs.js';
import { generateMap } from './mapgen.js';
import { makeRng } from './rng.js';
import { createBrain } from './ai.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const rectDist = (px, py, x, y, w, h) => {
  const dx = Math.max(x - px, 0, px - (x + w));
  const dy = Math.max(y - py, 0, py - (y + h));
  return Math.hypot(dx, dy);
};
const r2 = (v) => Math.round(v * 100) / 100;
const RES_KIND = { [TILE.FOREST]: 'wood', [TILE.GOLD]: 'gold', [TILE.CRYSTAL]: 'crystal' };

export function buildingDims(def, rot) {
  return def.rot && rot % 2 === 1 ? { w: def.h, h: def.w } : { w: def.w, h: def.h };
}

// Validação de posicionamento compartilhada (servidor valida, cliente pinta o holograma).
// world: { W, H, tiles, bgrid }
export const own = (obj, k) => typeof k === 'string' && Object.hasOwn(obj, k);

export function placementOk(world, type, x, y, rot) {
  if (!own(BUILDINGS, type)) return false;
  const def = BUILDINGS[type];
  const { w, h } = buildingDims(def, rot);
  for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) {
    if (tx < 1 || ty < 1 || tx >= world.W - 1 || ty >= world.H - 1) return false;
    const i = ty * world.W + tx;
    if (!BUILDABLE.has(world.tiles[i])) return false;
    if (world.bgrid[i]) return false;
  }
  return true;
}

export function canAfford(res, cost) {
  for (const k in cost) if ((res[k] || 0) < cost[k]) return false;
  return true;
}

export class Game {
  constructor({ seed = 1, mapPreset = 'floresta', matchPreset = 'padrao', players = [] } = {}) {
    this.seed = seed;
    this.mapPreset = mapPreset;
    this.matchPreset = matchPreset;
    const mp = MATCH_PRESETS[matchPreset] || MATCH_PRESETS.padrao;
    this.duration = mp.duration;
    this.prep = mp.prep;
    this.map = generateMap(seed, mapPreset);
    this.W = this.map.w; this.H = this.map.h;
    this.tiles = this.map.tiles; this.res = this.map.res;
    this.bgrid = new Int32Array(this.W * this.H);
    this.rng = makeRng((seed ^ 0x9e3779b9) >>> 0);
    this.tick = 0; this.time = 0;
    this.nextId = 1;
    this.players = new Map();
    this.units = new Map();
    this.buildings = new Map();
    this.projectiles = [];
    this.tileLog = []; this.removedLog = []; this.fxLog = [];
    this.pings = [];
    this.vis = { E: new Set(), T: new Set() };
    this.event = null; this.nextEventAt = Infinity; this.nextHowlAt = Infinity;
    this.phase = 1;
    this.over = null;
    this.teamUnlocked = false;
    for (const p of players) this.addPlayer(p);
  }

  // ---------------------------------------------------------------- jogadores
  addPlayer({ id, name, team, cls = 'cacador', isBot = false, difficulty = 'normal', skin = 0 }) {
    const p = {
      id, name: String(name || 'Jogador').slice(0, 16), team, cls: team === 'T' ? (own(TROLL_CLASSES, cls) ? cls : 'cacador') : 'elfo',
      isBot, difficulty, skin, connected: true, takeover: false,
      res: team === 'E' ? { wood: 30, gold: 10, crystal: 0 } : { gold: 0 },
      acc: { wood: 0, gold: 0, crystal: 0 },
      upgrades: {}, xp: 0, level: 1, ancestral: false,
      lastCmdAt: {},
      stats: { kills: 0, deaths: 0, dmgUnits: 0, dmgBuildings: 0, built: 0, destroyed: 0, wood: 0, gold: 0, crystal: 0, survived: 0 },
      brain: null, unitId: 0,
    };
    this.players.set(id, p);
    const u = this.spawnUnit(p);
    p.unitId = u.id;
    if (isBot) p.brain = createBrain(this, p);
    return p;
  }

  setConnected(pid, connected) {
    const p = this.players.get(pid); if (!p) return;
    p.connected = connected;
    // Jogador desconectado: a IA assume até ele voltar (reconexão)
    if (!p.isBot) { p.takeover = !connected; if (!connected && !p.brain) p.brain = createBrain(this, p); }
  }

  // Remove um jogador da partida em andamento (arena: bot cede a vaga a um humano).
  // As construções dele continuam de pé e seguem úteis para a equipe.
  removePlayer(pid) {
    const p = this.players.get(pid); if (!p) return false;
    this.units.delete(p.unitId);
    this.vis.E.delete(p.unitId); this.vis.T.delete(p.unitId);
    this.players.delete(pid);
    this.projectiles = this.projectiles.filter((pr) => pr.target !== p.unitId);
    return true;
  }

  spawnUnit(p) {
    const id = this.nextId++;
    let x, y;
    if (p.team === 'E') {
      const sp = this.map.elfSpawns[(p.id - 1) % this.map.elfSpawns.length];
      x = sp.x + this.rng.range(-1.5, 1.5); y = sp.y + this.rng.range(-1.5, 1.5);
    } else {
      x = this.map.spawn.x + this.rng.range(-3, 3); y = this.map.spawn.y + this.rng.range(-3, 3);
    }
    const u = {
      id, pid: p.id, team: p.team, cls: p.cls, x, y, face: 0, r: ELF.radius,
      hp: 1, maxHp: 1, speed: 1, dmg: 1, armor: 0, atkRange: 1, atkRate: 1, ranged: false, bldMul: 1, vision: 9,
      harvestMul: 1, input: { mx: 0, my: 0, atk: false, int: false },
      atkTimer: 0, cds: [0, 0, 0], buffs: {}, state: 'idle', stateUntil: 0,
      dead: false, respawnAt: 0, reviveAt: 0, reviveAltar: 0, deadAt: 0,
      stealthUntil: 0, rootedUntil: 0, stunnedUntil: 0, slowUntil: 0, revealedUntil: 0, ambush: false,
      lastHitAt: -99, inCave: false,
    };
    this.units.set(id, u);
    this.recalc(p, u, true);
    this.unstick(u);
    return u;
  }

  unitOf(p) { return this.units.get(p.unitId); }

  recalc(p, u, fill = false) {
    const ratio = u.maxHp > 0 ? u.hp / u.maxHp : 1;
    const up = p.upgrades, L = p.level;
    if (p.team === 'E') {
      u.r = ELF.radius;
      u.maxHp = ELF.hp + (up.vigor || 0) * 40 + (L - 1) * 8;
      u.speed = ELF.speed * (1 + 0.08 * (up.passos || 0));
      u.dmg = ELF.atk.dmg + (up.arco || 0) * 5 + (L - 1);
      u.atkRange = ELF.atk.range; u.atkRate = ELF.atk.rate; u.ranged = true;
      u.vision = ELF.vision; u.armor = 0;
      u.harvestMul = (1 + 0.3 * (up.coleta || 0)) * (1 + 0.03 * (L - 1));
    } else {
      const c = TROLL_CLASSES[p.cls];
      const anc = p.ancestral;
      u.r = c.radius * (anc ? ANCESTRAL.radiusMul : 1);
      u.maxHp = c.hp * (1 + 0.08 * (L - 1)) * (1 + 0.18 * (up.pele || 0)) * (anc ? ANCESTRAL.hpMul : 1);
      u.dmg = c.atk.dmg * (1 + 0.07 * (L - 1)) * (1 + 0.15 * (up.forca || 0)) * (anc ? ANCESTRAL.dmgMul : 1);
      u.speed = c.speed * (1 + 0.06 * (up.impeto || 0)) * (anc ? ANCESTRAL.speedMul : 1);
      u.armor = c.armor + (up.pele || 0) + (anc ? ANCESTRAL.armor : 0);
      u.atkRange = c.atk.range; u.atkRate = c.atk.rate; u.ranged = !!c.atk.ranged;
      u.bldMul = c.bldMul * (1 + 0.3 * (up.garras || 0));
      u.vision = c.vision;
    }
    u.maxHp = Math.round(u.maxHp);
    u.hp = fill ? u.maxHp : Math.max(1, Math.round(u.maxHp * ratio));
  }

  // ---------------------------------------------------------------- utilidades
  idx(x, y) { return y * this.W + x; }
  placementOkWrap(type, x, y, rot) { return placementOk(this, type, x, y, rot); }
  rectDistTo(u, b) { return rectDist(u.x, u.y, b.x, b.y, b.w, b.h); }
  log(entry) { this.fxLog.push({ tick: this.tick, ...entry }); }
  setTile(i, t) {
    this.tiles[i] = t;
    this.res[i] = t === TILE.FOREST ? 30 : 0;
    this.tileLog.push([this.tick, i, t]);
  }
  phaseMul() { return this.phase >= 4 ? 1.3 : this.phase === 3 ? 1.15 : 1; }
  abilitiesOf(p) {
    if (p.team === 'E') return ELF_ABILITIES.map((a) => ({ ...a, locked: p.level < a.level }));
    const list = TROLL_CLASSES[p.cls].abilities.map((a) => ({ ...a, locked: false }));
    list.push({ ...ANCESTRAL.ability, locked: !p.ancestral });
    return list;
  }

  blockedFor(u, tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.W || ty >= this.H) return true;
    const i = ty * this.W + tx;
    const t = this.tiles[i];
    if (!WALKABLE.has(t)) return true;
    if (u.team === 'T' && this.phase === 1 && t !== TILE.SPAWN) return true; // jaula da preparação
    const bid = this.bgrid[i];
    if (bid) {
      const b = this.buildings.get(bid); const def = BUILDINGS[b.type];
      if (def.walkable) return false;
      if (def.gate && u.team === 'E') return false;
      return true;
    }
    return false;
  }

  collides(u, x, y) {
    const r = u.r;
    const x0 = Math.floor(x - r), x1 = Math.floor(x + r), y0 = Math.floor(y - r), y1 = Math.floor(y + r);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      if (!this.blockedFor(u, tx, ty)) continue;
      const nx = clamp(x, tx, tx + 1), ny = clamp(y, ty, ty + 1);
      if ((x - nx) ** 2 + (y - ny) ** 2 < r * r - 1e-6) return true;
    }
    return false;
  }

  moveUnit(u, dx, dy) {
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(dist / 0.2));
    const sx = dx / steps, sy = dy / steps;
    const free = this.collides(u, u.x, u.y); // preso (ex.: árvore nasceu em cima) => deixa sair
    for (let s = 0; s < steps; s++) {
      if (free || !this.collides(u, u.x + sx, u.y)) u.x += sx;
      if (free || !this.collides(u, u.x, u.y + sy)) u.y += sy;
    }
    u.x = clamp(u.x, 1, this.W - 1); u.y = clamp(u.y, 1, this.H - 1);
  }

  unstick(u) {
    if (!this.collides(u, u.x, u.y)) return;
    for (let rad = 0.5; rad < 8; rad += 0.5) for (let a = 0; a < 16; a++) {
      const x = u.x + Math.cos(a / 16 * Math.PI * 2) * rad, y = u.y + Math.sin(a / 16 * Math.PI * 2) * rad;
      if (!this.collides(u, x, y)) { u.x = x; u.y = y; return; }
    }
  }

  // ---------------------------------------------------------------- comandos
  handleCommand(pid, cmd) {
    const p = this.players.get(pid);
    if (!p || !cmd || typeof cmd !== 'object' || this.over) return { ok: false, err: 'invalido' };
    if (p.takeover && cmd.t !== 'input') return { ok: false, err: 'ia' };
    const u = this.unitOf(p);
    try {
      switch (cmd.t) {
        case 'input': return this.cmdInput(p, u, cmd);
        case 'build': return this.cmdBuild(p, u, cmd);
        case 'upgrade': return this.cmdUpgrade(p, u, cmd);
        case 'demolish': return this.cmdDemolish(p, u, cmd);
        case 'buy': return this.cmdBuy(p, u, cmd);
        case 'ability': return this.cmdAbility(p, u, cmd);
        case 'evolve': return this.cmdEvolve(p, u);
        case 'ping': return this.cmdPing(p, cmd);
        default: return { ok: false, err: 'desconhecido' };
      }
    } catch (e) {
      return { ok: false, err: 'erro' };
    }
  }

  cmdInput(p, u, c) {
    let mx = Number(c.mx) || 0, my = Number(c.my) || 0;
    const m = Math.hypot(mx, my); if (m > 1) { mx /= m; my /= m; }
    u.input = { mx, my, atk: !!c.atk, int: !!c.int };
    return { ok: true };
  }

  cmdBuild(p, u, c) {
    if (p.team !== 'E' || u.dead) return { ok: false, err: 'Só elfos vivos constroem' };
    if (!own(BUILDINGS, c.type)) return { ok: false, err: 'Estrutura inválida' };
    const def = BUILDINGS[c.type];
    if (def.upgradeOnly) return { ok: false, err: 'Estrutura inválida' };
    if (def.req && !this.teamUnlocked) return { ok: false, err: 'Exige Árvore Ancestral' };
    const x = c.x | 0, y = c.y | 0, rot = (c.rot | 0) & 3;
    if (!canAfford(p.res, def.cost)) return { ok: false, err: 'Recursos insuficientes' };
    let mine = 0; for (const b of this.buildings.values()) if (b.owner === p.id) mine++;
    if (mine >= 150) return { ok: false, err: 'Limite de construções' };
    if (!placementOk(this, c.type, x, y, rot)) return { ok: false, err: 'Local bloqueado' };
    const { w, h } = buildingDims(def, rot);
    if (Math.hypot(u.x - (x + w / 2), u.y - (y + h / 2)) > BUILD_RANGE) return { ok: false, err: 'Muito longe' };
    if (!def.walkable) {
      for (const o of this.units.values()) {
        if (!o.dead && rectDist(o.x, o.y, x, y, w, h) < o.r - 0.02) return { ok: false, err: 'Tem alguém no local' };
      }
    }
    for (const k in def.cost) p.res[k] -= def.cost[k];
    const b = this.createBuilding(c.type, p.id, x, y, rot);
    return { ok: true, id: b.id };
  }

  createBuilding(type, owner, x, y, rot = 0, done = false) {
    const def = BUILDINGS[type];
    const { w, h } = buildingDims(def, rot);
    const b = {
      id: this.nextId++, type, owner, x, y, w, h, rot,
      hp: Math.round(def.hp * (done ? 1 : 0.1)), maxHp: def.hp, progress: done ? 1 : 0,
      cd: 0, trapReady: true, rearmAt: 0, revealed: false, discovered: false, rev: this.tick, lastHitAt: -99, reviveCdUntil: 0,
    };
    this.buildings.set(b.id, b);
    for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) this.bgrid[this.idx(tx, ty)] = b.id;
    return b;
  }

  removeBuilding(b) {
    for (let ty = b.y; ty < b.y + b.h; ty++) for (let tx = b.x; tx < b.x + b.w; tx++) {
      const i = this.idx(tx, ty); if (this.bgrid[i] === b.id) this.bgrid[i] = 0;
    }
    this.buildings.delete(b.id);
    this.removedLog.push([this.tick, b.id]);
    if (b.type === 'arvore') this.refreshUnlock();
  }

  refreshUnlock() {
    let any = false;
    for (const b of this.buildings.values()) if (b.type === 'arvore' && b.progress >= 1) any = true;
    if (any !== this.teamUnlocked) {
      this.teamUnlocked = any;
      this.log({ k: 'msg', team: 'E', text: any ? 'Árvore Ancestral desperta: tecnologias avançadas liberadas!' : 'A Árvore Ancestral caiu: tecnologias avançadas bloqueadas.' });
    }
  }

  cmdUpgrade(p, u, c) {
    if (p.team !== 'E' || u.dead) return { ok: false, err: 'Só elfos vivos' };
    const b = this.buildings.get(c.bid | 0);
    if (!b || b.progress < 1) return { ok: false, err: 'Construção indisponível' };
    if (this.players.get(b.owner)?.team !== 'E') return { ok: false, err: 'Inválido' };
    const def = BUILDINGS[b.type];
    const toId = def.upgrade; const to = BUILDINGS[toId];
    if (!to) return { ok: false, err: 'Sem melhoria' };
    if (to.req && !this.teamUnlocked) return { ok: false, err: 'Exige Árvore Ancestral' };
    if (!canAfford(p.res, to.cost)) return { ok: false, err: 'Recursos insuficientes' };
    if (rectDist(u.x, u.y, b.x, b.y, b.w, b.h) > BUILD_RANGE) return { ok: false, err: 'Muito longe' };
    for (const k in to.cost) p.res[k] -= to.cost[k];
    const ratio = b.hp / b.maxHp;
    b.type = toId; b.maxHp = to.hp; b.hp = Math.max(Math.round(to.hp * 0.1), Math.round(to.hp * ratio * 0.5));
    b.progress = 0; b.rev = this.tick;
    this.addXp(p, 6);
    return { ok: true };
  }

  cmdDemolish(p, u, c) {
    const b = this.buildings.get(c.bid | 0);
    if (!b || b.owner !== p.id) return { ok: false, err: 'Não é sua' };
    const def = BUILDINGS[b.type];
    const f = DEMOLISH_REFUND * (b.hp / b.maxHp) * Math.max(0.2, b.progress);
    for (const k in def.cost) p.res[k] = (p.res[k] || 0) + Math.floor(def.cost[k] * f);
    this.log({ k: 'boom', x: b.x + b.w / 2, y: b.y + b.h / 2, team: 'E' });
    this.removeBuilding(b);
    return { ok: true };
  }

  cmdBuy(p, u, c) {
    const table = p.team === 'E' ? ELF_UPGRADES : TROLL_UPGRADES;
    if (!own(table, c.key)) return { ok: false, err: 'Melhoria inválida' };
    const up = table[c.key];
    const lvl = p.upgrades[c.key] || 0;
    if (lvl >= up.max) return { ok: false, err: 'Nível máximo' };
    const cost = up.cost(lvl);
    if (!canAfford(p.res, cost)) return { ok: false, err: 'Recursos insuficientes' };
    for (const k in cost) p.res[k] -= cost[k];
    p.upgrades[c.key] = lvl + 1;
    this.recalc(p, u);
    return { ok: true };
  }

  cmdEvolve(p, u) {
    if (p.team !== 'T' || p.ancestral) return { ok: false, err: 'Indisponível' };
    if (p.level < ANCESTRAL_LEVEL) return { ok: false, err: `Exige nível ${ANCESTRAL_LEVEL}` };
    p.ancestral = true;
    this.recalc(p, u, true);
    this.unstick(u);
    this.log({ k: 'evolve', x: u.x, y: u.y, pid: p.id });
    this.log({ k: 'msg', team: '*', text: `${p.name} evoluiu para Troll Ancestral!` });
    return { ok: true };
  }

  cmdPing(p, c) {
    if ((p.lastCmdAt.ping || -9) > this.time - 1.5) return { ok: false, err: 'Aguarde' };
    p.lastCmdAt.ping = this.time;
    this.pings.push({ team: p.team, x: clamp(Number(c.x) || 0, 0, this.W), y: clamp(Number(c.y) || 0, 0, this.H), until: this.time + 6, pid: p.id });
    return { ok: true };
  }

  dirOf(u) {
    const m = Math.hypot(u.input.mx, u.input.my);
    if (m > 0.2) return [u.input.mx / m, u.input.my / m];
    return [Math.cos(u.face), Math.sin(u.face)];
  }

  cmdAbility(p, u, c) {
    if (u.dead || this.time < u.stunnedUntil) return { ok: false, err: 'Indisponível' };
    const i = c.i | 0;
    const list = this.abilitiesOf(p);
    const ab = list[i];
    if (!ab || ab.locked) return { ok: false, err: 'Habilidade bloqueada' };
    if (this.time < u.cds[i]) return { ok: false, err: 'Recarregando' };
    if (p.team === 'T' && this.phase === 1) return { ok: false, err: 'Aguarde a caçada' };
    u.cds[i] = this.time + ab.cd;
    const t = this.time;
    const [dx, dy] = this.dirOf(u);
    switch (ab.id) {
      case 'salto': this.moveUnit(u, dx * 4.5, dy * 4.5); this.log({ k: 'dash', x: u.x, y: u.y, team: u.team }); break;
      case 'bote': this.moveUnit(u, dx * 6, dy * 6); this.log({ k: 'dash', x: u.x, y: u.y, team: u.team }); break;
      case 'camuflagem': u.stealthUntil = t + ab.dur; break;
      case 'sombra': u.stealthUntil = t + ab.dur; u.ambush = true; break;
      case 'disparada': u.buffs.speed = { mul: 1.6, until: t + ab.dur }; break;
      case 'furia': u.buffs.atk = { mul: 1.6, until: t + ab.dur }; break;
      case 'ritual': u.buffs.heal = { rate: u.maxHp * 0.35 / ab.dur, until: t + ab.dur }; break;
      case 'faro':
        for (const e of this.units.values()) if (e.team === 'E' && !e.dead && Math.hypot(e.x - u.x, e.y - u.y) < 34) e.revealedUntil = Math.max(e.revealedUntil, t + ab.dur);
        this.log({ k: 'faro', x: u.x, y: u.y, team: 'T' });
        break;
      case 'esmagar': {
        this.log({ k: 'smash', x: u.x + dx, y: u.y + dy });
        for (const b of [...this.buildings.values()]) {
          if (rectDist(u.x + dx, u.y + dy, b.x, b.y, b.w, b.h) <= 2.5) this.damageBuilding(b, 160 * this.phaseMul(), u, true);
        }
        for (const e of this.units.values()) if (e.team === 'E' && !e.dead && Math.hypot(e.x - u.x, e.y - u.y) < 2.5) this.damageUnit(e, 40, u);
        break;
      }
      case 'relampago': {
        let best = null, bd = 9;
        for (const e of this.units.values()) {
          if (e.team !== 'E' || e.dead || !this.vis.T.has(e.id)) continue;
          const d = Math.hypot(e.x - u.x, e.y - u.y); if (d < bd) { bd = d; best = [e.x, e.y]; }
        }
        if (!best) for (const b of this.buildings.values()) {
          if (!b.discovered) continue;
          const d = rectDist(u.x, u.y, b.x, b.y, b.w, b.h); if (d < bd) { bd = d; best = [b.x + b.w / 2, b.y + b.h / 2]; }
        }
        if (!best) best = [u.x + dx * 4, u.y + dy * 4];
        const [bx, by] = best;
        this.log({ k: 'bolt', x: bx, y: by });
        for (const e of this.units.values()) if (e.team === 'E' && !e.dead && Math.hypot(e.x - bx, e.y - by) < 2.5) this.damageUnit(e, 120 * this.phaseMul(), u);
        for (const b of [...this.buildings.values()]) if (rectDist(bx, by, b.x, b.y, b.w, b.h) < 2.5) this.damageBuilding(b, 75 * this.phaseMul(), u);
        break;
      }
      case 'rugido':
        for (const e of this.units.values()) {
          if (e.team !== 'E' || e.dead) continue;
          if (Math.hypot(e.x - u.x, e.y - u.y) < 7) e.stunnedUntil = t + 2;
          e.revealedUntil = Math.max(e.revealedUntil, t + 5);
        }
        this.log({ k: 'roar', x: u.x, y: u.y });
        break;
      default: break;
    }
    return { ok: true };
  }

  // ---------------------------------------------------------------- combate
  damageUnit(target, amount, src) {
    if (target.dead) return;
    let dmg = amount * (1 - Math.min(0.5, target.armor * 0.04));
    target.hp -= dmg;
    target.lastHitAt = this.time;
    if (target.team === 'E') target.stealthUntil = 0; // dano quebra camuflagem
    const sp = src && this.players.get(src.pid);
    if (sp) sp.stats.dmgUnits += dmg;
    this.log({ k: 'hit', x: target.x, y: target.y, v: Math.round(dmg), team: target.team });
    if (target.hp <= 0) this.killUnit(target, src);
  }

  killUnit(u, src) {
    const p = this.players.get(u.pid);
    u.hp = 0; u.dead = true; u.deadAt = this.time; u.input = { mx: 0, my: 0, atk: false, int: false };
    u.stealthUntil = 0; u.buffs = {};
    p.stats.deaths++;
    const kp = src && this.players.get(src.pid);
    if (u.team === 'E') {
      p.stats.survived = this.time;
      if (kp) { kp.stats.kills++; this.addXp(kp, 110); kp.res.gold += 60; }
      this.log({ k: 'death', x: u.x, y: u.y, pid: p.id });
      this.log({ k: 'msg', team: '*', text: `${p.name} foi abatido!` });
    } else {
      u.respawnAt = this.time + TROLL_RESPAWN;
      if (kp) { kp.stats.kills++; this.addXp(kp, 120); kp.res.gold += 40; }
      this.log({ k: 'death', x: u.x, y: u.y, pid: p.id });
      this.log({ k: 'msg', team: '*', text: `O troll ${p.name} caiu! Volta em ${TROLL_RESPAWN}s.` });
    }
  }

  damageBuilding(b, amount, src) {
    if (!this.buildings.has(b.id)) return;
    const def = BUILDINGS[b.type];
    let dmg = amount * (1 - Math.min(0.5, def.armor * 0.06));
    if (src && src.team === 'T') dmg *= src.bldMul || 1;
    b.hp -= dmg; b.lastHitAt = this.time; b.rev = this.tick;
    b.discovered = true;
    const sp = src && this.players.get(src.pid);
    if (sp && sp.team === 'T') {
      sp.stats.dmgBuildings += dmg;
      this.addXp(sp, dmg / 12);
      sp.res.gold += dmg / 10;
    }
    if (b.hp <= 0) {
      if (sp) sp.stats.destroyed++;
      this.log({ k: 'boom', x: b.x + b.w / 2, y: b.y + b.h / 2 });
      this.removeBuilding(b);
    }
  }

  chopTree(i, amount, src) {
    if (this.tiles[i] !== TILE.FOREST) return;
    const dmg = amount * (src.bldMul || 1);
    const left = this.res[i] - dmg / 6;
    this.log({ k: 'chop', x: (i % this.W) + 0.5, y: ((i / this.W) | 0) + 0.5 });
    if (left <= 0) this.setTile(i, TILE.GRASS);
    else this.res[i] = Math.ceil(left);
  }

  findUnitTarget(u, range) {
    const enemyTeam = u.team === 'E' ? 'T' : 'E';
    const vis = this.vis[u.team];
    let best = null, bd = Infinity;
    for (const e of this.units.values()) {
      if (e.team !== enemyTeam || e.dead || !vis.has(e.id)) continue;
      const d = Math.hypot(e.x - u.x, e.y - u.y) - e.r - u.r;
      if (d <= range && d < bd) { bd = d; best = e; }
    }
    return best;
  }

  findBuildingTarget(u, range) {
    let best = null, bd = Infinity;
    const x0 = Math.floor(u.x - range - 1), x1 = Math.floor(u.x + range + 1), y0 = Math.floor(u.y - range - 1), y1 = Math.floor(u.y + range + 1);
    const seen = new Set();
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      if (tx < 0 || ty < 0 || tx >= this.W || ty >= this.H) continue;
      const bid = this.bgrid[ty * this.W + tx]; if (!bid || seen.has(bid)) continue; seen.add(bid);
      const b = this.buildings.get(bid); const def = BUILDINGS[b.type];
      if (def.hidden && !b.revealed) continue;
      const d = rectDist(u.x, u.y, b.x, b.y, b.w, b.h) - u.r;
      if (d <= range && d < bd) { bd = d; best = b; }
    }
    return best;
  }

  findTreeTarget(u, range) {
    const [fx, fy] = this.dirOf(u);
    let best = -1, bd = Infinity;
    const R = Math.ceil(range + 1);
    for (let oy = -R; oy <= R; oy++) for (let ox = -R; ox <= R; ox++) {
      const tx = Math.floor(u.x) + ox, ty = Math.floor(u.y) + oy;
      if (tx < 1 || ty < 1 || tx >= this.W - 1 || ty >= this.H - 1) continue;
      const i = ty * this.W + tx; if (this.tiles[i] !== TILE.FOREST) continue;
      const d = rectDist(u.x, u.y, tx, ty, 1, 1) - u.r; if (d > range) continue;
      const cx = tx + 0.5 - u.x, cy = ty + 0.5 - u.y; const cl = Math.hypot(cx, cy) || 1;
      const facing = (cx * fx + cy * fy) / cl;
      const score = d - facing; if (facing > -0.2 && score < bd) { bd = score; best = i; }
    }
    return best;
  }

  tryAttack(u) {
    if (u.atkTimer > 0 || u.dead || this.time < u.stunnedUntil) return;
    if (u.team === 'T' && this.phase === 1) return;
    const rateMul = u.buffs.atk && u.buffs.atk.until > this.time ? u.buffs.atk.mul : 1;
    const target = this.findUnitTarget(u, u.atkRange);
    let bld = null, tree = -1;
    if (!target && u.team === 'T') {
      bld = this.findBuildingTarget(u, u.atkRange);
      if (!bld) tree = this.findTreeTarget(u, u.atkRange);
    }
    u.atkTimer = u.atkRate / rateMul;
    u.state = 'attack'; u.stateUntil = this.time + 0.35;
    if (!target && !bld && tree < 0) { u.atkTimer = 0.4; return; }
    const tx = target ? target.x : bld ? bld.x + bld.w / 2 : (tree % this.W) + 0.5;
    const ty = target ? target.y : bld ? bld.y + bld.h / 2 : ((tree / this.W) | 0) + 0.5;
    u.face = Math.atan2(ty - u.y, tx - u.x);
    let dmg = u.dmg * (u.team === 'T' ? this.phaseMul() : 1);
    if (u.ambush) { dmg *= 2; u.ambush = false; }
    if (u.team === 'T') u.stealthUntil = 0;
    if (u.ranged) {
      this.projectiles.push({
        id: this.nextId++, x: u.x, y: u.y, kind: u.team === 'E' ? 'arrow' : 'hex', speed: u.team === 'E' ? 16 : 11,
        target: target ? target.id : 0, bid: bld ? bld.id : 0, tree, tx, ty, dmg, src: u, slow: 0,
      });
    } else if (target) this.damageUnit(target, dmg, u);
    else if (bld) this.damageBuilding(bld, dmg, u);
    else this.chopTree(tree, dmg, u);
  }

  // ---------------------------------------------------------------- coleta e reparo
  tryInteract(u, dt) {
    const p = this.players.get(u.pid);
    if (u.team !== 'E' || u.dead || this.time < u.stunnedUntil) return;
    // 1) Reparo
    let rep = null, rd = 2.3;
    for (const b of this.buildings.values()) {
      if (b.progress < 1 || b.hp >= b.maxHp) continue;
      const d = rectDist(u.x, u.y, b.x, b.y, b.w, b.h) - u.r; if (d < rd) { rd = d; rep = b; }
    }
    if (rep && p.res.wood >= 1) {
      const amt = Math.min(REPAIR_RATE * dt, rep.maxHp - rep.hp);
      const cost = amt * REPAIR_WOOD_PER_HP;
      p.acc.wood -= cost; if (p.acc.wood < 0) { p.res.wood -= 1; p.acc.wood += 1; }
      rep.hp += amt; rep.rev = this.tick;
      u.state = 'build'; u.stateUntil = this.time + 0.2;
      u.face = Math.atan2(rep.y + rep.h / 2 - u.y, rep.x + rep.w / 2 - u.x);
      this.addXp(p, amt / 40);
      return;
    }
    // 2) Coleta do recurso mais próximo
    let best = -1, bd = 1.05;
    const ux = Math.floor(u.x), uy = Math.floor(u.y);
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
      const tx = ux + ox, ty = uy + oy;
      if (tx < 1 || ty < 1 || tx >= this.W - 1 || ty >= this.H - 1) continue;
      const i = ty * this.W + tx; if (!RES_KIND[this.tiles[i]]) continue;
      const d = rectDist(u.x, u.y, tx, ty, 1, 1) - u.r; if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) return;
    const kind = RES_KIND[this.tiles[best]];
    let mul = u.harvestMul;
    for (const b of this.buildings.values()) {
      const def = BUILDINGS[b.type];
      if (def.aura && b.progress >= 1 && Math.hypot(b.x + b.w / 2 - u.x, b.y + b.h / 2 - u.y) < def.aura.radius) { mul *= 1 + def.aura.harvest; break; }
    }
    const amt = HARVEST_RATE[kind] * mul * dt;
    p.acc[kind] += amt;
    u.state = 'harvest'; u.stateUntil = this.time + 0.2;
    u.face = Math.atan2(((best / this.W) | 0) + 0.5 - u.y, (best % this.W) + 0.5 - u.x);
    while (p.acc[kind] >= 1) {
      p.acc[kind] -= 1; p.res[kind] += 1; p.stats[kind] += 1;
      this.addXp(p, kind === 'wood' ? 0.6 : kind === 'gold' ? 1 : 5);
      this.res[best] -= 1;
      if (this.res[best] <= 0) {
        this.setTile(best, TILE.GRASS);
        this.log({ k: 'deplete', x: (best % this.W) + 0.5, y: ((best / this.W) | 0) + 0.5 });
        break;
      }
    }
  }

  addXp(p, amt) {
    p.xp += amt;
    let up = false;
    while (p.level < 20 && p.xp >= xpForLevel(p.level)) {
      p.xp -= xpForLevel(p.level); p.level++; up = true;
    }
    if (up) {
      const u = this.unitOf(p);
      this.recalc(p, u);
      u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.2);
      this.log({ k: 'level', x: u.x, y: u.y, pid: p.id, v: p.level });
      if (p.team === 'T' && p.level === ANCESTRAL_LEVEL) this.log({ k: 'msg', team: 'T', pid: p.id, text: 'Evolução Ancestral disponível!' });
    }
  }

  // ---------------------------------------------------------------- visão
  computeVision() {
    const fog = this.event && this.event.k === 'nevoa' ? 0.6 : 1;
    const detectors = [];
    const observers = { E: [], T: [] };
    for (const u of this.units.values()) {
      if (u.dead) continue;
      u.inCave = this.tiles[this.idx(Math.floor(u.x), Math.floor(u.y))] === TILE.CAVE;
      observers[u.team].push({ x: u.x, y: u.y, r: u.vision * fog, cave: u.inCave });
    }
    for (const b of this.buildings.values()) {
      const def = BUILDINGS[b.type];
      if (b.progress < 1 || !def.vision) continue;
      const o = { x: b.x + b.w / 2, y: b.y + b.h / 2, r: def.vision * fog, cave: false };
      observers.E.push(o);
      if (def.detect || b.type === 'torre_arcana') detectors.push(o);
    }
    for (const team of ['E', 'T']) {
      const set = this.vis[team]; set.clear();
      for (const e of this.units.values()) {
        if (e.team === team || e.dead) continue;
        if (team === 'T' && e.revealedUntil > this.time) { set.add(e.id); continue; }
        const stealth = e.stealthUntil > this.time;
        let seen = false;
        for (const o of observers[team]) {
          const d = Math.hypot(e.x - o.x, e.y - o.y);
          let r = o.r;
          if (e.inCave && !o.cave) r = Math.min(r, 3.5);
          if (stealth) r = Math.min(r, 1.6);
          if (d <= r) { seen = true; break; }
        }
        if (!seen && stealth && team === 'E') {
          for (const o of detectors) if (Math.hypot(e.x - o.x, e.y - o.y) <= o.r) { seen = true; break; }
        }
        if (seen) set.add(e.id);
      }
    }
    // Trolls descobrem construções que entram no campo de visão
    for (const b of this.buildings.values()) {
      if (b.discovered) continue;
      for (const o of observers.T) {
        if (rectDist(o.x, o.y, b.x, b.y, b.w, b.h) <= o.r * 0.9) { b.discovered = true; b.rev = this.tick; break; }
      }
    }
  }

  // ---------------------------------------------------------------- fases e eventos
  updatePhase() {
    let ph;
    if (this.time < this.prep) ph = 1;
    else {
      const f = (this.time - this.prep) / (this.duration - this.prep);
      ph = f < 0.35 ? 2 : f < 0.75 ? 3 : 4;
    }
    if (ph !== this.phase) {
      this.phase = ph;
      const names = { 2: 'Os trolls foram libertados! Sobreviva.', 3: 'Caçada Intensa: os trolls ficaram mais fortes.', 4: 'Confronto Final: resista até o amanhecer!' };
      this.log({ k: 'phase', v: ph, team: '*', text: names[ph] });
      if (ph === 2) for (const u of this.units.values()) if (u.team === 'T') this.unstick(u);
      if (ph === 3) this.nextEventAt = this.time + 20;
      if (ph === 4) this.nextHowlAt = this.time + 15;
    }
  }

  updateEvents() {
    const t = this.time;
    if (this.event && t >= this.event.until) this.event = null;
    if (t >= this.nextEventAt && !this.event) {
      const k = this.rng.pick(Object.keys(EVENTS));
      const ev = EVENTS[k];
      this.event = { k, until: t + ev.dur, nextStrike: t + 2 };
      this.nextEventAt = t + ev.dur + this.rng.range(45, 75);
      this.log({ k: 'event', v: k, team: '*', text: `${ev.name}: ${ev.desc}` });
      if (k === 'chuva_dourada') {
        for (const p of this.players.values()) if (p.team === 'E' && !this.unitOf(p).dead) p.res.gold += 40;
      }
      if (k === 'despertar') {
        let grown = 0;
        for (let tries = 0; tries < 600 && grown < 50; tries++) {
          const x = this.rng.int(2, this.W - 3), y = this.rng.int(2, this.H - 3), i = this.idx(x, y);
          if (this.tiles[i] !== TILE.GRASS || this.bgrid[i]) continue;
          let near = false;
          for (const u of this.units.values()) if (Math.hypot(u.x - x - 0.5, u.y - y - 0.5) < 2.5) near = true;
          if (near) continue;
          this.setTile(i, TILE.FOREST); grown++;
        }
      }
    }
    if (this.event && this.event.k === 'tempestade' && t >= this.event.nextStrike) {
      this.event.nextStrike = t + 2.5;
      const x = this.rng.range(3, this.W - 3), y = this.rng.range(3, this.H - 3);
      this.log({ k: 'bolt', x, y });
      for (const u of this.units.values()) if (!u.dead && Math.hypot(u.x - x, u.y - y) < 2) this.damageUnit(u, 45, null);
    }
    if (this.phase === 4 && t >= this.nextHowlAt) {
      this.nextHowlAt = t + 40;
      for (const u of this.units.values()) if (u.team === 'E' && !u.dead) u.revealedUntil = Math.max(u.revealedUntil, t + 4);
      this.log({ k: 'msg', team: '*', text: 'Uivo da Lua: os trolls sentem todos os elfos!' });
    }
    this.pings = this.pings.filter((pg) => pg.until > t);
  }

  // ---------------------------------------------------------------- passo principal
  step(dt = DT) {
    if (this.over) return;
    this.tick++; this.time += dt;
    this.updatePhase();
    this.updateEvents();

    for (const p of this.players.values()) {
      if (p.brain && (p.isBot || p.takeover)) p.brain.think(dt);
    }

    const t = this.time;
    for (const u of this.units.values()) {
      const p = this.players.get(u.pid);
      if (u.dead) {
        if (u.team === 'T' && t >= u.respawnAt) {
          u.dead = false; u.x = this.map.spawn.x; u.y = this.map.spawn.y;
          this.recalc(p, u, true); this.unstick(u);
        } else if (u.team === 'E' && u.reviveAt && t >= u.reviveAt) {
          const altar = this.buildings.get(u.reviveAltar);
          u.reviveAt = 0;
          if (altar && altar.progress >= 1) {
            u.dead = false; u.x = altar.x + altar.w / 2; u.y = altar.y + altar.h + 0.6;
            u.hp = Math.round(u.maxHp * 0.6); this.unstick(u);
            this.log({ k: 'revive', x: u.x, y: u.y, pid: p.id });
            this.log({ k: 'msg', team: '*', text: `${p.name} renasceu no Altar!` });
          }
        }
        continue;
      }
      if (u.atkTimer > 0) u.atkTimer -= dt;
      for (const k in u.buffs) if (u.buffs[k].until <= t) delete u.buffs[k];
      const stunned = t < u.stunnedUntil, rooted = t < u.rootedUntil;
      let sp = u.speed;
      if (u.buffs.speed) sp *= u.buffs.speed.mul;
      if (t < u.slowUntil) sp *= 0.65;
      if (u.team === 'T' && this.event && this.event.k === 'lua_sangue') sp *= 1.2;
      if (u.input.atk || u.input.int) sp *= 0.85;
      const { mx, my } = u.input;
      const moving = Math.hypot(mx, my) > 0.05;
      if (moving && !stunned && !rooted) {
        this.moveUnit(u, mx * sp * dt, my * sp * dt);
        if (t >= u.stateUntil) u.state = 'walk';
        if (!u.input.atk) u.face = Math.atan2(my, mx);
      } else if (t >= u.stateUntil) u.state = 'idle';
      if (stunned) { u.state = 'stun'; continue; }
      if (u.input.atk) this.tryAttack(u);
      else if (u.input.int) this.tryInteract(u, dt);
      // Regeneração
      if (u.buffs.heal) u.hp = Math.min(u.maxHp, u.hp + u.buffs.heal.rate * dt);
      if (u.team === 'T' && t - u.lastHitAt > 4) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * TROLL_REGEN * dt);
      if (u.team === 'E' && t - u.lastHitAt > 5) u.hp = Math.min(u.maxHp, u.hp + ELF.regen * dt);
      if (u.team === 'T' && this.phase >= 2) { p.res.gold += 0.4 * dt; this.addXp(p, 0.9 * dt); }
      if (u.team === 'E') p.stats.survived = t;
    }

    // Separação leve entre unidades
    const alive = [...this.units.values()].filter((u) => !u.dead);
    for (let i = 0; i < alive.length; i++) for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i], b = alive[j];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = a.r + b.r;
      if (d > 0.001 && d < min) {
        const push = (min - d) / 2, nx = dx / d, ny = dy / d;
        if (!this.collides(a, a.x - nx * push, a.y - ny * push)) { a.x -= nx * push; a.y -= ny * push; }
        if (!this.collides(b, b.x + nx * push, b.y + ny * push)) { b.x += nx * push; b.y += ny * push; }
      }
    }

    this.updateBuildings(dt);
    this.updateProjectiles(dt);
    this.computeVision();
    this.checkEnd();
    // Logs curtos: o suficiente para clientes que ficaram alguns ticks para trás
    if (this.fxLog.length > 400) this.fxLog = this.fxLog.filter((f) => f.tick > this.tick - 60);
  }

  updateBuildings(dt) {
    const t = this.time;
    for (const b of [...this.buildings.values()]) {
      const def = BUILDINGS[b.type];
      const owner = this.players.get(b.owner);
      if (b.progress < 1) {
        b.progress = Math.min(1, b.progress + dt / def.time);
        b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.9 * dt / def.time);
        if (this.tick % 5 === 0) b.rev = this.tick;
        if (b.progress >= 1) {
          b.rev = this.tick;
          if (owner) { owner.stats.built++; this.addXp(owner, 4 + def.time); }
          this.log({ k: 'built', x: b.x + b.w / 2, y: b.y + b.h / 2, team: 'E' });
          if (b.type === 'arvore') this.refreshUnlock();
        }
        continue;
      }
      if (def.income && owner) for (const k in def.income) {
        owner.acc[k] = (owner.acc[k] || 0) + def.income[k] * dt;
        while (owner.acc[k] >= 1) { owner.acc[k] -= 1; owner.res[k] = (owner.res[k] || 0) + 1; }
      }
      if (def.heal) {
        for (const u of this.units.values()) {
          if (u.team === 'E' && !u.dead && rectDist(u.x, u.y, b.x, b.y, b.w, b.h) < def.heal.radius) u.hp = Math.min(u.maxHp, u.hp + def.heal.rate * dt);
        }
      }
      if (def.tower) {
        b.cd -= dt;
        if (b.cd <= 0) {
          const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
          let best = null, bd = def.tower.range;
          for (const e of this.units.values()) {
            if (e.team !== 'T' || e.dead || !this.vis.E.has(e.id)) continue;
            const d = Math.hypot(e.x - cx, e.y - cy); if (d < bd) { bd = d; best = e; }
          }
          if (best) {
            b.cd = def.tower.rate;
            this.projectiles.push({ id: this.nextId++, x: cx, y: cy, kind: def.tower.slow ? 'arcane' : 'arrow', speed: 17, target: best.id, bid: 0, tree: -1, tx: best.x, ty: best.y, dmg: def.tower.dmg, src: { pid: b.owner, team: 'E' }, slow: def.tower.slow || 0 });
          }
        }
      }
      if (def.trap) {
        if (!b.trapReady && t >= b.rearmAt) { b.trapReady = true; b.rev = this.tick; }
        if (b.trapReady) {
          for (const e of this.units.values()) {
            if (e.team !== 'T' || e.dead) continue;
            if (rectDist(e.x, e.y, b.x, b.y, b.w, b.h) > 0.05) continue;
            const src = { pid: b.owner, team: 'E' };
            const cx = b.x + 0.5, cy = b.y + 0.5;
            if (def.trap.aoe) {
              for (const o of this.units.values()) if (o.team === 'T' && !o.dead && Math.hypot(o.x - cx, o.y - cy) < def.trap.aoe) this.damageUnit(o, def.trap.dmg, src);
            } else this.damageUnit(e, def.trap.dmg, src);
            if (def.trap.root) e.rootedUntil = t + def.trap.root;
            b.trapReady = false; b.rearmAt = t + (def.trap.rearm || 0); b.revealed = true; b.discovered = true; b.rev = this.tick;
            this.log({ k: 'trap', x: cx, y: cy, v: b.type });
            if (def.trap.once) this.removeBuilding(b);
            break;
          }
        }
      }
      if (def.revive && t >= b.reviveCdUntil) {
        for (const u of this.units.values()) {
          if (u.team === 'E' && u.dead && !u.reviveAt) {
            u.reviveAt = t + def.revive.delay; u.reviveAltar = b.id; b.reviveCdUntil = t + def.revive.cooldown;
            this.log({ k: 'msg', team: 'E', text: `${this.players.get(u.pid).name} vai renascer em ${def.revive.delay}s.` });
            break;
          }
        }
      }
    }
  }

  updateProjectiles(dt) {
    const keep = [];
    for (const pr of this.projectiles) {
      const tgt = pr.target ? this.units.get(pr.target) : null;
      if (tgt && !tgt.dead) { pr.tx = tgt.x; pr.ty = tgt.y; }
      const dx = pr.tx - pr.x, dy = pr.ty - pr.y, d = Math.hypot(dx, dy);
      const stepLen = pr.speed * dt;
      if (d <= stepLen + 0.1) {
        if (tgt && !tgt.dead) {
          this.damageUnit(tgt, pr.dmg, pr.src);
          if (pr.slow) tgt.slowUntil = this.time + 2;
        } else if (pr.bid) {
          const b = this.buildings.get(pr.bid); if (b) this.damageBuilding(b, pr.dmg, pr.src);
        } else if (pr.tree >= 0) this.chopTree(pr.tree, pr.dmg, pr.src);
        continue;
      }
      pr.x += dx / d * stepLen; pr.y += dy / d * stepLen;
      pr.life = (pr.life || 0) + dt;
      if (pr.life < 3) keep.push(pr);
    }
    this.projectiles = keep;
  }

  checkEnd() {
    let elves = 0, aliveElves = 0, pending = 0;
    for (const u of this.units.values()) {
      if (u.team !== 'E') continue;
      elves++;
      if (!u.dead) aliveElves++;
      else if (u.reviveAt) pending++;
    }
    let winner = null;
    if (elves > 0 && aliveElves === 0 && pending === 0) winner = 'T';
    else if (this.time >= this.duration) winner = 'E';
    if (!winner) return;
    const players = [...this.players.values()].map((p) => ({
      id: p.id, name: p.name, team: p.team, cls: p.cls, isBot: p.isBot, level: p.level, ancestral: p.ancestral,
      alive: !this.unitOf(p).dead, stats: { ...p.stats, dmgUnits: Math.round(p.stats.dmgUnits), dmgBuildings: Math.round(p.stats.dmgBuildings), survived: Math.round(p.stats.survived) },
    }));
    this.over = { winner, time: Math.round(this.time), players };
    this.log({ k: 'over', team: '*', v: winner });
  }

  // ---------------------------------------------------------------- snapshot por time (anti-trapaça: só o que o time vê)
  snapshot(pid, since = 0) {
    const p = this.players.get(pid);
    const team = p ? p.team : 'E';
    const vis = this.vis[team];
    const units = [];
    for (const u of this.units.values()) {
      const mine = u.team === team;
      if (!mine && (u.dead || !vis.has(u.id))) continue;
      if (u.dead && u.team === 'T') continue;
      const pl = this.players.get(u.pid);
      let flags = 0;
      if (u.stealthUntil > this.time) flags |= 1;
      if (u.rootedUntil > this.time) flags |= 2;
      if (u.stunnedUntil > this.time) flags |= 4;
      if (pl.ancestral) flags |= 8;
      if (u.dead) flags |= 16;
      if (u.revealedUntil > this.time) flags |= 32;
      if (u.inCave) flags |= 64;
      units.push([u.id, u.pid, u.team, u.cls, r2(u.x), r2(u.y), r2(u.face), Math.ceil(u.hp), u.maxHp, u.state, flags, pl.level, pl.skin]);
    }
    const bld = [];
    for (const b of this.buildings.values()) {
      if (b.rev <= since) continue;
      if (team === 'T') {
        const def = BUILDINGS[b.type];
        if (!b.discovered || (def.hidden && !b.revealed)) continue;
      }
      bld.push([b.id, b.type, b.owner, b.x, b.y, b.rot, Math.ceil(b.hp), b.maxHp, r2(b.progress), (b.trapReady ? 1 : 0) | (b.revealed ? 2 : 0)]);
    }
    const rm = this.removedLog.filter((r) => r[0] > since).map((r) => r[1]);
    const tiles = this.tileLog.filter((r) => r[0] > since).map((r) => [r[1], r[2]]);
    // Projéteis: os do próprio time e os que vêm na direção de uma unidade do time
    const proj = this.projectiles.filter((pr) => pr.src.team === team || (pr.target && this.units.get(pr.target)?.team === team))
      .map((pr) => [pr.id, r2(pr.x), r2(pr.y), pr.kind]);
    const fx = this.fxLog.filter((f) => f.tick > since && (f.team === undefined || f.team === '*' || f.team === team || f.k === 'hit' || f.k === 'boom' || f.k === 'death' || f.k === 'bolt' || f.k === 'smash') && (!f.pid || f.k !== 'msg' || f.pid === pid))
      .map(({ tick, ...rest }) => rest);
    let me = null;
    if (p) {
      const u = this.unitOf(p);
      me = {
        pid, team, cls: p.cls, uid: u.id, res: { wood: Math.floor(p.res.wood || 0), gold: Math.floor(p.res.gold || 0), crystal: Math.floor(p.res.crystal || 0) },
        xp: Math.floor(p.xp), xpNext: xpForLevel(p.level), level: p.level, upgrades: p.upgrades, ancestral: p.ancestral,
        cds: u.cds.map((c) => r2(Math.max(0, c - this.time))), abilities: this.abilitiesOf(p).map((a) => [a.id, a.name, a.locked ? 1 : 0, a.cd]),
        dead: u.dead, respawnIn: u.dead && u.team === 'T' ? r2(u.respawnAt - this.time) : 0, reviveIn: u.reviveAt ? r2(u.reviveAt - this.time) : 0,
        unlocked: this.teamUnlocked, takeover: p.takeover, stats: p.stats,
      };
    }
    const players = [...this.players.values()].map((q) => [q.id, q.name, q.team, q.cls, this.unitOf(q).dead ? 0 : 1, q.level, q.isBot ? 1 : 0, q.connected ? 1 : 0]);
    return {
      t: 'snap', tick: this.tick, time: r2(this.time), phase: this.phase, prep: this.prep, duration: this.duration,
      event: this.event ? { k: this.event.k, left: r2(this.event.until - this.time) } : null,
      units, bld, rm, tiles, proj, fx, me, players,
      pings: this.pings.filter((pg) => pg.team === team).map((pg) => [r2(pg.x), r2(pg.y), pg.pid]),
      full: since === 0, over: this.over,
    };
  }

  initInfo(pid) {
    return { t: 'init', seed: this.seed, mapPreset: this.mapPreset, matchPreset: this.matchPreset, pid, tick: this.tick };
  }
}
