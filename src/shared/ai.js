// Bots. Controlam a unidade escrevendo u.input (igual a um jogador) e chamando os mesmos
// métodos validados de comando — bots não têm atalhos que um humano não tenha.
import { TILE, WALKABLE, BUILDABLE, BUILDINGS, TROLL_UPGRADES, ELF_UPGRADES, ANCESTRAL_LEVEL } from './defs.js';
import { findPath } from './path.js';

const DIFF = {
  facil: { think: 0.7, skill: 0.45, ability: 0.25, react: 1.2, vuln: false, upgrades: false },
  normal: { think: 0.4, skill: 0.75, ability: 0.6, react: 0.6, vuln: true, upgrades: true },
  dificil: { think: 0.22, skill: 1, ability: 1, react: 0.2, vuln: true, upgrades: true },
};

const RES_TILE = { wood: TILE.FOREST, gold: TILE.GOLD, crystal: TILE.CRYSTAL };

export function createBrain(game, player) {
  return player.team === 'E' ? new ElfBrain(game, player) : new TrollBrain(game, player);
}

function shared(game) {
  if (!game.aiShared) game.aiShared = { bases: [], intel: [], sectors: null };
  return game.aiShared;
}

class Brain {
  constructor(game, p) {
    this.g = game; this.p = p;
    this.d = DIFF[p.difficulty] || DIFF.normal;
    this.timer = Math.random() * this.d.think;
    this.path = null; this.pathGoal = null; this.pathAt = -99;
    this.lastPos = null; this.stuckT = 0;
  }
  get u() { return this.g.unitOf(this.p); }

  think(dt) {
    const u = this.u;
    if (u.dead) { u.input = { mx: 0, my: 0, atk: false, int: false }; return; }
    this.timer -= dt;
    this.follow(dt);
    if (this.timer > 0) return;
    this.timer = this.d.think;
    this.decide();
  }

  // Move pelo caminho atual; o resto (atacar/coletar) vem de decide()
  follow(dt) {
    const u = this.u;
    if (!this.path || !this.path.length) { u.input.mx = 0; u.input.my = 0; return; }
    let [tx, ty] = this.path[0];
    let wx = tx + 0.5, wy = ty + 0.5;
    if (Math.hypot(wx - u.x, wy - u.y) < 0.4) {
      this.path.shift();
      if (!this.path.length) { u.input.mx = 0; u.input.my = 0; return; }
      [tx, ty] = this.path[0]; wx = tx + 0.5; wy = ty + 0.5;
    }
    // Próximo tile bloqueado (árvore/construção): o troll quebra, o elfo recalcula
    if (this.g.blockedFor(u, tx, ty) && Math.hypot(wx - u.x, wy - u.y) < u.r + 1.1) {
      u.input.mx = 0; u.input.my = 0;
      u.face = Math.atan2(wy - u.y, wx - u.x);
      this.onBlocked(tx, ty);
      return;
    }
    const dx = wx - u.x, dy = wy - u.y, d = Math.hypot(dx, dy) || 1;
    u.input.mx = dx / d; u.input.my = dy / d;
    // Detecção de travamento
    if (this.lastPos && Math.hypot(u.x - this.lastPos[0], u.y - this.lastPos[1]) < 0.02) this.stuckT += dt; else this.stuckT = 0;
    this.lastPos = [u.x, u.y];
    if (this.stuckT > 1.0) { this.stuckT = 0; this.path = null; this.onStuck(); }
  }
  onBlocked() { this.path = null; }
  onStuck() {}

  goTo(x, y, costFn, force = false) {
    const gx = Math.floor(x), gy = Math.floor(y);
    const same = this.pathGoal && this.pathGoal[0] === gx && this.pathGoal[1] === gy;
    if (!force && same && this.path && this.path.length && this.g.time - this.pathAt < 2.5) return;
    const u = this.u;
    this.path = findPath(this.g.W, this.g.H, costFn, Math.floor(u.x), Math.floor(u.y), gx, gy);
    this.pathGoal = [gx, gy]; this.pathAt = this.g.time;
  }
  stop() { this.path = null; const u = this.u; u.input.mx = 0; u.input.my = 0; }
  dist(x, y) { const u = this.u; return Math.hypot(u.x - x, u.y - y); }
}

// =====================================================================================
class ElfBrain extends Brain {
  constructor(g, p) {
    super(g, p);
    this.base = null; this.plan = []; this.resTarget = -1;
    this.cost = (x, y, goal) => {
      const i = y * g.W + x;
      if (goal) return 1;
      const t = g.tiles[i];
      if (t === TILE.FOREST) return 9; // abre caminho cortando árvore
      if (!WALKABLE.has(t)) return Infinity;
      const bid = g.bgrid[i];
      if (bid) { const def = BUILDINGS[g.buildings.get(bid).type]; if (!(def.walkable || def.gate)) return Infinity; }
      return 1;
    };
  }

  onBlocked(tx, ty) {
    const g = this.g;
    if (g.tiles[ty * g.W + tx] === TILE.FOREST) this.u.input.int = true; // corta e segue
    else this.path = null;
  }

  pickBase() {
    const g = this.g, S = shared(g);
    // Bots normais/difíceis preferem se juntar a uma base existente (cooperação)
    const joinable = S.bases.filter((b) => b.members < 3 && this.dist(b.cx, b.cy) < 26);
    if (joinable.length && Math.random() < (this.d.skill > 0.6 ? 0.75 : 0.35)) {
      const b = joinable.sort((a, c) => this.dist(a.cx, a.cy) - this.dist(c.cx, c.cy))[0];
      b.members++; return b;
    }
    let best = null, bs = -Infinity;
    const u = this.u;
    for (let k = 0; k < 220; k++) {
      const cx = Math.floor(u.x + (Math.random() - 0.5) * 40), cy = Math.floor(u.y + (Math.random() - 0.5) * 40);
      if (cx < 6 || cy < 6 || cx > g.W - 7 || cy > g.H - 7) continue;
      const dSpawn = Math.hypot(cx - g.map.spawn.x, cy - g.map.spawn.y);
      if (dSpawn < 20) continue;
      if (S.bases.some((b) => Math.hypot(b.cx - cx, b.cy - cy) < 13)) continue;
      let buildable = 0, forest = 0, blocked = 0;
      for (let y = cy - 3; y <= cy + 3; y++) for (let x = cx - 3; x <= cx + 3; x++) {
        const t = g.tiles[y * g.W + x];
        if (BUILDABLE.has(t) && !g.bgrid[y * g.W + x]) buildable++; else if (t === TILE.FOREST) forest++; else blocked++;
      }
      if (blocked > 10 || !BUILDABLE.has(g.tiles[cy * g.W + cx])) continue;
      let wood = 0;
      for (let y = cy - 10; y <= cy + 10; y += 2) for (let x = cx - 10; x <= cx + 10; x += 2) {
        if (x > 0 && y > 0 && x < g.W && y < g.H && g.tiles[y * g.W + x] === TILE.FOREST) wood++;
      }
      const score = buildable * 1.2 + forest * 0.6 + Math.min(wood, 40) * 0.4 + dSpawn * 0.15 - this.dist(cx, cy) * 0.3;
      if (score > bs) { bs = score; best = { cx, cy, members: 1 }; }
    }
    if (!best) best = { cx: Math.floor(u.x), cy: Math.floor(u.y), members: 1 };
    S.bases.push(best);
    return best;
  }

  buildPlan() {
    const { cx, cy } = this.base; const sk = this.d.skill;
    const plan = [];
    plan.push({ type: 'refugio', x: cx - 1, y: cy - 1 });
    const R = 3;
    for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++) {
      const edge = Math.abs(x - cx) === R || Math.abs(y - cy) === R;
      if (!edge) continue;
      plan.push({ type: x === cx && y === cy + R ? 'portao' : 'muro', x, y, ring: true });
    }
    plan.push({ type: 'torre', x: cx - 2, y: cy - 2 });
    plan.push({ type: 'espinhos', x: cx, y: cy + R + 1 });
    if (sk > 0.5) plan.push({ type: 'torre', x: cx + 2, y: cy + 2 });
    plan.push({ type: 'serraria', near: true });
    if (sk > 0.5) plan.push({ type: 'raizes', x: cx - 1, y: cy + R + 1 }, { type: 'espinhos', x: cx + 1, y: cy + R + 1 });
    plan.push({ type: 'extrator', near: true });
    if (sk > 0.5) plan.push({ type: 'torre', x: cx + 2, y: cy - 2 }, { type: 'torre', x: cx - 2, y: cy + 2 });
    if (sk > 0.7) plan.push({ type: 'deposito', near: true }, { type: 'arvore', near: true }, { type: 'vigia', x: cx + 1, y: cy - 2 }, { type: 'altar', near: true });
    return plan;
  }

  inRing(x, y) {
    if (!this.base) return false;
    return Math.abs(x - this.base.cx) <= 3 && Math.abs(y - this.base.cy) <= 3;
  }

  findNearSpot(type) {
    const g = this.g, { cx, cy } = this.base;
    for (let r = 4; r <= 9; r++) for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const x = Math.round(cx + Math.cos(a) * r) - 1, y = Math.round(cy + Math.sin(a) * r) - 1;
      let clear = true;
      for (let yy = y - 1; yy <= y + 2 && clear; yy++) for (let xx = x - 1; xx <= x + 2; xx++) if (this.inRing(xx, yy)) clear = false;
      if (!clear) continue;
      if (g.placementOkWrap(type, x, y, 0)) return [x, y];
    }
    return null;
  }

  decide() {
    const g = this.g, u = this.u, p = this.p;
    if (!this.base) { this.base = this.pickBase(); this.plan = this.buildPlan(); }
    const { cx, cy } = this.base;
    u.input.atk = false; u.input.int = false;

    // Perigo
    let threat = null, td = 10;
    for (const id of g.vis.E) { const e = g.units.get(id); const d = this.dist(e.x, e.y); if (d < td) { td = d; threat = e; } }
    const inside = this.inRing(Math.floor(u.x), Math.floor(u.y));
    const ringOk = this.plan.filter((s) => s.ring).every((s) => g.bgrid[s.y * g.W + s.x] || !BUILDABLE.has(g.tiles[s.y * g.W + s.x]));
    if (threat) {
      if (td < 3.2 && Math.random() < this.d.ability) {
        if (g.time >= u.cds[0]) { const a = Math.atan2(u.y - threat.y, u.x - threat.x); u.input.mx = Math.cos(a); u.input.my = Math.sin(a); g.cmdAbility(p, u, { i: 0 }); }
        else if (p.level >= 3 && g.time >= u.cds[1] && u.hp < u.maxHp * 0.6) g.cmdAbility(p, u, { i: 1 });
      }
      if (!(inside && ringOk)) {
        this.goTo(cx, cy, this.cost);
        if (td < 6.5) u.input.atk = true;
        return;
      }
      // Seguro dentro do anel: atira e repara
      this.stop();
      const dmg = this.damagedNear(3);
      if (dmg && Math.random() < 0.5) { this.goTo(dmg.x + dmg.w / 2, dmg.y + dmg.h / 2, this.cost, true); u.input.int = true; }
      else u.input.atk = td < 6.5;
      return;
    }

    if (this.d.upgrades) this.buyUpgrades();

    // Reparos
    const hurt = this.damagedNear(10, 0.75);
    if (hurt && p.res.wood > 3) {
      const d = this.g.rectDistTo(u, hurt);
      if (d < 1.5) { this.stop(); u.input.int = true; }
      else this.goTo(hurt.x + hurt.w / 2, hurt.y + hurt.h / 2, this.cost);
      return;
    }

    // Construção
    const next = this.nextBuild();
    if (next) {
      if (this.dist(next.x + 1, next.y + 1) <= 9) {
        const r = g.cmdBuild(p, u, { t: 'build', type: next.type, x: next.x, y: next.y, rot: 0 });
        if (r.ok) next.done = true; else if (r.err === 'Local bloqueado') next.skip = (next.skip || 0) + 1;
        else if (r.err === 'Tem alguém no local') { this.goTo(cx, cy, this.cost, true); return; }
      } else { this.goTo(next.x, next.y, this.cost); return; }
    }

    // Coleta
    this.gather();
  }

  damagedNear(radius, thresh = 0.9) {
    const g = this.g; const { cx, cy } = this.base; let best = null, bd = Infinity;
    for (const b of g.buildings.values()) {
      if (b.progress < 1 || b.hp > b.maxHp * thresh) continue;
      if (g.players.get(b.owner)?.team !== 'E') continue;
      const d = Math.hypot(b.x - cx, b.y - cy); if (d < radius && d < bd) { bd = d; best = b; }
    }
    return best;
  }

  nextBuild() {
    const g = this.g, p = this.p;
    // Reconstrução do anel (inclusive buracos abertos por trolls)
    for (const s of this.plan) {
      if (s.skip > 3) continue;
      if (s.ring || s.type === 'refugio' || s.type === 'torre') {
        const i = s.y * g.W + s.x;
        if (g.bgrid[i] || !BUILDABLE.has(g.tiles[i])) continue;
        const def = BUILDINGS[s.type];
        if ((def.cost.wood || 0) <= p.res.wood && (def.cost.gold || 0) <= p.res.gold) return s;
        return null; // espera juntar recursos para fechar a base primeiro
      }
    }
    // Melhorias de muro quando sobra ouro
    if (this.d.skill > 0.5 && p.res.gold > 40) {
      for (const b of g.buildings.values()) {
        if (b.owner !== p.id || b.progress < 1) continue;
        const def = BUILDINGS[b.type]; const to = BUILDINGS[def.upgrade];
        if (!to || (to.req && !g.teamUnlocked)) continue;
        if ((to.cost.wood || 0) <= p.res.wood && (to.cost.gold || 0) <= p.res.gold - 15 && (to.cost.crystal || 0) <= p.res.crystal) {
          if (g.cmdUpgrade(p, this.u, { bid: b.id }).ok) return null;
        }
      }
    }
    for (const s of this.plan) {
      if (s.done || s.skip > 3 || s.ring) continue;
      const def = BUILDINGS[s.type];
      if (def.req && !g.teamUnlocked) continue;
      if (s.type === 'arvore' && g.teamUnlocked) { s.done = true; continue; }
      if (s.near && s.x === undefined) { const spot = this.findNearSpot(s.type); if (!spot) { s.skip = 9; continue; } [s.x, s.y] = spot; }
      if (s.x !== undefined && g.bgrid[s.y * g.W + s.x] && s.type !== 'refugio') { s.done = true; continue; }
      let ok = true; for (const k in def.cost) if ((p.res[k] || 0) < def.cost[k]) ok = false;
      return ok ? s : null;
    }
    return null;
  }

  needKind() {
    const p = this.p, g = this.g;
    for (const s of this.plan) {
      if (s.done || s.skip > 3) continue;
      if (s.ring) { const i = s.y * g.W + s.x; if (g.bgrid[i] || !BUILDABLE.has(g.tiles[i])) continue; }
      const def = BUILDINGS[s.type];
      if (def.req && !g.teamUnlocked) continue;
      if ((def.cost.crystal || 0) > p.res.crystal) return 'crystal';
      if ((def.cost.gold || 0) > p.res.gold && (def.cost.wood || 0) <= p.res.wood) return 'gold';
      return 'wood';
    }
    return p.res.gold < 60 ? 'gold' : 'wood';
  }

  gather() {
    const g = this.g, u = this.u;
    const kind = this.needKind();
    const ti = this.resTarget;
    const valid = ti >= 0 && g.tiles[ti] === RES_TILE[this.resKind] && this.resKind === kind;
    if (!valid) {
      this.resTarget = this.findResource(kind) ?? this.findResource('wood') ?? -1;
      this.resKind = this.resTarget >= 0 ? RES_KIND_OF(g.tiles[this.resTarget]) : null;
    }
    if (this.resTarget < 0) { this.stop(); return; }
    const tx = this.resTarget % g.W, ty = (this.resTarget / g.W) | 0;
    if (g.rectDistTo(u, { x: tx, y: ty, w: 1, h: 1 }) < 0.95) { this.stop(); u.input.int = true; }
    else this.goTo(tx, ty, this.cost);
  }

  findResource(kind) {
    const g = this.g, u = this.u, tt = RES_TILE[kind];
    const maxR = kind === 'wood' ? 14 : 26;
    let best = null, bd = Infinity;
    const ux = Math.floor(u.x), uy = Math.floor(u.y);
    for (let y = Math.max(1, uy - maxR); y < Math.min(g.H - 1, uy + maxR); y++) for (let x = Math.max(1, ux - maxR); x < Math.min(g.W - 1, ux + maxR); x++) {
      const i = y * g.W + x; if (g.tiles[i] !== tt) continue;
      // não corta as árvores que fazem parte da muralha natural
      if (kind === 'wood' && this.base && Math.abs(x - this.base.cx) === 3 && Math.abs(y - this.base.cy) <= 3) continue;
      if (kind === 'wood' && this.base && Math.abs(y - this.base.cy) === 3 && Math.abs(x - this.base.cx) <= 3) continue;
      let open = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (this.cost(x + dx, y + dy, false) <= 1) open = true;
      if (!open) continue;
      const d = Math.hypot(x - u.x, y - u.y) + (this.base ? Math.hypot(x - this.base.cx, y - this.base.cy) * 0.6 : 0);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  buyUpgrades() {
    const p = this.p, u = this.u, g = this.g;
    if (p.res.gold < 70) return;
    for (const key of ['coleta', 'vigor', 'passos', 'arco']) {
      const lvl = p.upgrades[key] || 0; const up = ELF_UPGRADES[key];
      if (lvl < up.max && p.res.gold - (up.cost(lvl).gold || 0) > 40) { g.cmdBuy(p, u, { key }); return; }
    }
  }
}
const RES_KIND_OF = (t) => (t === TILE.FOREST ? 'wood' : t === TILE.GOLD ? 'gold' : t === TILE.CRYSTAL ? 'crystal' : null);

// =====================================================================================
class TrollBrain extends Brain {
  constructor(g, p) {
    super(g, p);
    this.target = null; this.retreat = false; this.reactAt = 0;
    this.cost = (x, y, goal) => {
      const i = y * g.W + x; const t = g.tiles[i];
      if (t === TILE.ROCK || t === TILE.WATER || t === TILE.GOLD || t === TILE.CRYSTAL) return Infinity;
      if (g.phase === 1 && t !== TILE.SPAWN) return Infinity;
      const bid = g.bgrid[i];
      if (bid) {
        const b = g.buildings.get(bid); const def = BUILDINGS[b.type];
        if (def.walkable) return def.hidden && !b.revealed ? 1 : 3;
        return 3 + b.hp / (this.u.dmg * this.u.bldMul) * 0.8;
      }
      if (t === TILE.FOREST) return 4;
      return 1;
    };
  }

  onBlocked() { this.u.input.atk = true; }
  onStuck() { this.u.input.atk = true; this.wanderGoal = null; }

  sectors() {
    const S = shared(this.g);
    if (!S.sectors) S.sectors = new Float32Array(64).fill(-999);
    return S.sectors;
  }

  decide() {
    const g = this.g, u = this.u, p = this.p, d = this.d;
    if (p.level >= ANCESTRAL_LEVEL && !p.ancestral) g.cmdEvolve(p, u);
    if (d.upgrades || Math.random() < 0.3) this.buyUpgrades();
    const S = shared(g);
    const sz = g.W / 8;
    const sec = this.sectors();
    sec[Math.min(7, Math.floor(u.y / sz)) * 8 + Math.min(7, Math.floor(u.x / sz))] = g.time;

    if (g.phase === 1) { this.wanderSpawn(); return; }

    // Inteligência compartilhada: últimas posições vistas de elfos
    for (const id of g.vis.T) { const e = g.units.get(id); if (e.team === 'E') S.intel.push({ x: e.x, y: e.y, t: g.time }); }
    S.intel = S.intel.filter((s) => g.time - s.t < 25).slice(-40);

    if (u.hp < u.maxHp * 0.22 && d.skill > 0.6) this.retreat = true;
    if (this.retreat) {
      if (u.hp > u.maxHp * 0.7) this.retreat = false;
      else { u.input.atk = false; this.goTo(g.map.spawn.x, g.map.spawn.y, this.cost); return; }
    }

    // 1) Elfo visível
    let elf = null, ed = 28;
    for (const id of g.vis.T) { const e = g.units.get(id); const dd = this.dist(e.x, e.y); if (dd < ed) { ed = dd; elf = e; } }
    if (elf && g.time < this.reactAt) elf = null; // reação mais lenta no fácil
    if (!elf && this.lastElf !== undefined) this.reactAt = g.time + d.react;
    this.lastElf = elf ? elf.id : undefined;

    this.useAbilities(elf, ed);

    if (elf) {
      u.input.atk = ed < u.atkRange + 1.4 + (u.ranged ? 0 : 0);
      this.goTo(elf.x, elf.y, this.cost, this.g.time - this.pathAt > 0.8);
      if (ed < u.atkRange + u.r + elf.r) { this.stop(); u.input.atk = true; u.face = Math.atan2(elf.y - u.y, elf.x - u.x); }
      return;
    }

    // 2) Construções descobertas
    const bld = this.pickBuilding();
    if (bld) {
      const dd = g.rectDistTo(u, bld);
      u.input.atk = dd < u.atkRange + 0.6 || this.stuckT > 0.5;
      if (dd < u.atkRange + u.r * 0.5) { this.stop(); u.input.atk = true; u.face = Math.atan2(bld.y + bld.h / 2 - u.y, bld.x + bld.w / 2 - u.x); }
      else this.goTo(bld.x + bld.w / 2, bld.y + bld.h / 2, this.cost);
      return;
    }

    // 3) Pista recente
    const clue = S.intel.length ? S.intel[S.intel.length - 1] : null;
    if (clue && this.dist(clue.x, clue.y) > 2) { u.input.atk = false; this.goTo(clue.x, clue.y, this.cost); return; }

    // 4) Exploração por setores menos visitados
    this.explore();
  }

  pickBuilding() {
    const g = this.g, u = this.u; let best = null, bs = Infinity;
    const values = { refugio: 0.55, arvore: 0.5, extrator: 0.6, serraria: 0.7, altar: 0.5, deposito: 0.75, torre: 0.8, torre_arcana: 0.8 };
    for (const b of g.buildings.values()) {
      if (!b.discovered) continue;
      const def = BUILDINGS[b.type]; if (def.hidden && !b.revealed) continue;
      const d = Math.hypot(b.x - u.x, b.y - u.y); if (d > 45) continue;
      let s = d * (values[b.type] || 1);
      if (this.d.vuln) s *= 0.5 + b.hp / b.maxHp * 0.7; // ponto vulnerável: muro mais fraco
      if (s < bs) { bs = s; best = b; }
    }
    if (best && this.d.vuln) {
      // Se o alvo está dentro de um anel, ataque o muro mais fraco desse anel
      let weak = null, wh = Infinity;
      for (const b of g.buildings.values()) {
        if (!b.discovered || b === best) continue;
        const def = BUILDINGS[b.type]; if (def.walkable) continue;
        if (Math.hypot(b.x - best.x, b.y - best.y) > 4.5) continue;
        if (Math.hypot(b.x - u.x, b.y - u.y) > Math.hypot(best.x - u.x, best.y - u.y)) continue;
        if (b.hp < wh) { wh = b.hp; weak = b; }
      }
      if (weak && weak.hp < best.hp) best = weak;
    }
    return best;
  }

  explore() {
    const g = this.g, u = this.u, sec = this.sectors(), sz = g.W / 8;
    if (!this.wanderGoal || this.dist(this.wanderGoal[0], this.wanderGoal[1]) < 3 || g.time - this.wanderAt > 18) {
      let best = 0, bs = -Infinity;
      for (let i = 0; i < 64; i++) {
        const x = (i % 8 + 0.5) * sz, y = (Math.floor(i / 8) + 0.5) * sz;
        const s = (g.time - sec[i]) - this.dist(x, y) * 0.8 + Math.random() * 10;
        if (s > bs) { bs = s; best = i; }
      }
      this.wanderGoal = [(best % 8 + 0.2 + Math.random() * 0.6) * sz, (Math.floor(best / 8) + 0.2 + Math.random() * 0.6) * sz];
      this.wanderAt = g.time;
    }
    u.input.atk = this.stuckT > 0.4;
    this.goTo(this.wanderGoal[0], this.wanderGoal[1], this.cost);
  }

  wanderSpawn() {
    const g = this.g, u = this.u;
    u.input.atk = false;
    if (!this.path || !this.path.length) {
      const x = g.map.spawn.x + (Math.random() - 0.5) * 10, y = g.map.spawn.y + (Math.random() - 0.5) * 10;
      this.goTo(x, y, this.cost, true);
    }
  }

  useAbilities(elf, ed) {
    const g = this.g, u = this.u, p = this.p;
    if (Math.random() > this.d.ability) return;
    const ready = (i) => g.time >= u.cds[i];
    const use = (i) => g.cmdAbility(p, u, { i });
    const nearB = () => { for (const b of g.buildings.values()) if (b.discovered && g.rectDistTo(u, b) < 2.2) return true; return false; };
    switch (p.cls) {
      case 'cacador':
        if (!elf && ready(0)) use(0);
        if (elf && ed > 4 && ready(1)) use(1);
        break;
      case 'destruidor':
        if (nearB() && ready(0)) use(0);
        if ((nearB() || (elf && ed < 3)) && ready(1)) use(1);
        break;
      case 'assassino':
        if (elf && ed < 12 && ed > 3 && ready(0)) use(0);
        if (elf && ed > 2.5 && ed < 6.5 && ready(1)) { u.input.mx = (elf.x - u.x) / ed; u.input.my = (elf.y - u.y) / ed; use(1); }
        break;
      case 'xama':
        if ((elf && ed < 9) || nearB()) { if (ready(0)) use(0); }
        if (u.hp < u.maxHp * 0.5 && ready(1)) use(1);
        break;
      default: break;
    }
    if (p.ancestral && elf && ed < 6 && ready(2)) use(2);
  }

  buyUpgrades() {
    const p = this.p, u = this.u, g = this.g;
    const order = p.cls === 'destruidor' ? ['garras', 'pele', 'forca', 'impeto'] : p.cls === 'cacador' ? ['impeto', 'forca', 'garras', 'pele'] : ['forca', 'pele', 'garras', 'impeto'];
    let best = null, bl = Infinity;
    for (const key of order) {
      const lvl = p.upgrades[key] || 0; if (lvl >= TROLL_UPGRADES[key].max) continue;
      if (lvl < bl) { bl = lvl; best = key; }
    }
    if (best) g.cmdBuy(p, u, { key: best });
  }
}
