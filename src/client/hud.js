// HUD e controles (touch primeiro; teclado/mouse como apoio para testes no PC).
import { BUILDINGS, BUILD_CATEGORIES, ELF_UPGRADES, TROLL_UPGRADES, TROLL_CLASSES, ANCESTRAL_LEVEL, TILE, EVENTS, BUILD_RANGE } from '../shared/defs.js';
import { placementOk, buildingDims, canAfford } from '../shared/sim.js';
import { sfx } from './audio.js';

const ICON = {
  atk: '<svg viewBox="0 0 24 24"><path d="M14.5 3 21 3 21 9.5 10 20.5 7.5 18 5 20.5 3.5 19 6 16.5 3.5 14 14.5 3Z" fill="currentColor"/></svg>',
  int: '<svg viewBox="0 0 24 24"><path d="M4 20 13 11M13 11l2-6 5 5-6 2Z" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linejoin="round"/></svg>',
  build: '<svg viewBox="0 0 24 24"><path d="M3 21h18M5 21V11l7-6 7 6v10M9 21v-6h6v6" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/></svg>',
  rot: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-3-6.2M20 4v5h-5" stroke="currentColor" stroke-width="2.4" fill="none"/></svg>',
  ok: '<svg viewBox="0 0 24 24"><path d="M4 12.5 9.5 18 20 6.5" stroke="currentColor" stroke-width="3" fill="none"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M5 5l14 14M19 5 5 19" stroke="currentColor" stroke-width="3"/></svg>',
  menu: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2.4"/></svg>',
  bag: '<svg viewBox="0 0 24 24"><path d="M5 8h14l-1 12H6L5 8Zm4 0V6a3 3 0 0 1 6 0v2" stroke="currentColor" stroke-width="2" fill="none"/></svg>',
  wood: '<svg viewBox="0 0 24 24"><rect x="3" y="8" width="18" height="8" rx="4" fill="#9a6b3e"/><circle cx="19" cy="12" r="3.2" fill="#d9b07a"/></svg>',
  gold: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="#e8b830"/><circle cx="12" cy="12" r="5" fill="none" stroke="#a87a10" stroke-width="1.6"/></svg>',
  crystal: '<svg viewBox="0 0 24 24"><path d="M12 2 19 9 12 22 5 9Z" fill="#a98bff"/><path d="M12 2v20M5 9h14" stroke="#6a4fd0" stroke-width="1"/></svg>',
};
// Fator de escala do HUD (definido em main.js); coordenadas de tela precisam ser divididas por ele
export const hudZoom = () => parseFloat(document.documentElement.style.getPropertyValue('--hud-z')) || 1;
const RES_NAME = { wood: 'madeira', gold: 'ouro', crystal: 'cristal' };
const costHtml = (cost) => Object.entries(cost).map(([k, v]) => `<span class="cost">${ICON[k]}${v}</span>`).join('');
const fmtTime = (s) => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const MINI_COLOR = { [TILE.GRASS]: '#3b5732', [TILE.FOREST]: '#1c2b18', [TILE.ROCK]: '#5d5f6a', [TILE.WATER]: '#1f4a70', [TILE.GOLD]: '#c79a2a', [TILE.CRYSTAL]: '#8c6cff', [TILE.RUIN]: '#77705c', [TILE.CAVE]: '#2a1f36', [TILE.SPAWN]: '#6a2a24' };

export class Hud {
  constructor(root, { send, renderer, onMenu, profile }) {
    this.root = root; this.send = send; this.r = renderer; this.onMenu = onMenu; this.profile = profile;
    this.input = { mx: 0, my: 0, atk: false, int: false };
    this.keys = new Set();
    this.joy = null; this.pointers = new Map();
    this.build = null; // { type, x, y, rot, dragged }
    this.cat = 'defesa';
    this.selected = 0;
    this.toggles = { atk: false, int: false };
    this.floaters = [];
    this.lastMini = 0;
    this.spectate = 0;
    root.innerHTML = this.template();
    this.$ = (s) => root.querySelector(s);
    this.bind();
  }

  template() {
    return `
    <div class="hud-top-left">
      <div class="portrait" id="h-portrait"></div>
      <div class="bars">
        <div class="bar hp"><i id="h-hp"></i><span id="h-hpt"></span></div>
        <div class="bar xp"><i id="h-xp"></i><span id="h-lvl"></span></div>
        <div class="team-dots" id="h-team"></div>
      </div>
    </div>
    <div class="hud-top-center"><div class="phase" id="h-phase"></div><div class="timer" id="h-timer"></div><div class="event hidden" id="h-event"></div></div>
    <div class="hud-top-right">
      <div class="mini-wrap"><canvas id="h-mini" width="140" height="140"></canvas></div>
      <div class="hud-row"><div class="res" id="h-res"></div><button class="small" id="h-prog" title="Progressão (Tab)">${ICON.bag}</button><button class="small" id="h-menu" title="Menu (Esc)">${ICON.menu}</button></div>
    </div>
    <div class="toasts" id="h-toasts"></div>
    <div class="joy hidden" id="h-joy"><div class="knob" id="h-knob"></div></div>
    <div class="actions" id="h-actions">
      <button class="act big atk" id="b-atk">${ICON.atk}<b>Atacar</b></button>
      <button class="act int" id="b-int">${ICON.int}<b>Coletar</b></button>
      <button class="act bld" id="b-bld">${ICON.build}<b>Construir</b></button>
      <button class="act ab" id="b-ab0"><span class="cd"></span><b></b></button>
      <button class="act ab" id="b-ab1"><span class="cd"></span><b></b></button>
      <button class="act ab hidden" id="b-ab2"><span class="cd"></span><b></b></button>
      <button class="act evo hidden" id="b-evo"><b>Evoluir</b></button>
    </div>
    <div class="build-actions hidden" id="h-bact">
      <button class="act" id="b-rot">${ICON.rot}<b>Girar</b></button>
      <button class="act big ok" id="b-ok">${ICON.ok}<b>Construir</b></button>
      <button class="act no" id="b-no">${ICON.x}<b>Sair</b></button>
    </div>
    <div class="build-bar hidden" id="h-bbar"><div class="tabs" id="h-tabs"></div><div class="items" id="h-items"></div></div>
    <div class="panel hidden" id="h-ctx"></div>
    <div class="panel wide hidden" id="h-prog-panel"></div>
    <div class="dead hidden" id="h-dead"></div>
    <div class="floaters" id="h-float"></div>
    <div class="takeover hidden" id="h-take">Reconectando… a IA está controlando seu personagem.</div>`;
  }

  bind() {
    const canvas = this.r.canvas;
    canvas.addEventListener('pointerdown', (e) => this.pDown(e));
    window.addEventListener('pointermove', this.onMove = (e) => this.pMove(e));
    window.addEventListener('pointerup', this.onUp = (e) => this.pUp(e));
    window.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('wheel', (e) => { this.r.zoom = Math.max(0.55, Math.min(1.7, this.r.zoom + e.deltaY * 0.001)); }, { passive: true });
    window.addEventListener('keydown', this.onKd = (e) => this.key(e, true));
    window.addEventListener('keyup', this.onKu = (e) => this.key(e, false));

    this.holdButton('#b-atk', 'atk');
    this.holdButton('#b-int', 'int');
    this.tap('#b-bld', () => this.toggleBuild());
    for (let i = 0; i < 3; i++) this.tap(`#b-ab${i}`, () => this.ability(i));
    this.tap('#b-evo', () => this.send({ t: 'evolve' }));
    this.tap('#b-rot', () => this.rotate());
    this.tap('#b-ok', () => this.confirmBuild());
    this.tap('#b-no', () => this.exitBuild());
    this.tap('#h-prog', () => this.toggleProg());
    this.tap('#h-menu', () => this.onMenu());
    const mini = this.$('#h-mini');
    mini.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (!this.world) return;
      const rc = mini.getBoundingClientRect();
      const x = (e.clientX - rc.left) / rc.width * this.world.W, y = (e.clientY - rc.top) / rc.height * this.world.H;
      this.send({ t: 'ping', x, y }); sfx('click');
    });
  }

  destroy() {
    window.removeEventListener('pointermove', this.onMove); window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    window.removeEventListener('keydown', this.onKd); window.removeEventListener('keyup', this.onKu);
    this.root.innerHTML = '';
  }

  tap(sel, fn) {
    const el = this.$(sel);
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); sfx('click'); fn(e); });
  }

  // Toque rápido = liga/desliga; segurar = ativo enquanto segura
  holdButton(sel, key) {
    const el = this.$(sel);
    let downAt = 0, prev = false;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation(); downAt = performance.now();
      prev = this.toggles[key];
      this.toggles.atk = false; this.toggles.int = false;
      this.toggles[key] = true;
      try { el.setPointerCapture(e.pointerId); } catch { /* ok */ }
    });
    const up = () => {
      if (!downAt) return;
      const held = performance.now() - downAt; downAt = 0;
      this.toggles[key] = held > 320 ? false : !prev;
    };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  }

  key(e, down) {
    if (e.target && e.target.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (down) this.keys.add(k); else this.keys.delete(k);
    if (!down) return;
    if (k === 'b') this.toggleBuild();
    else if (k === 'q') this.ability(0);
    else if (k === 'f') this.ability(1);
    else if (k === 'g') this.ability(2);
    else if (k === 'r' && this.build) this.rotate();
    else if (k === 'enter' && this.build) this.confirmBuild();
    else if (k === 'tab') { e.preventDefault(); this.toggleProg(); }
    else if (k === 'escape') { if (this.build) this.exitBuild(); else if (!this.$('#h-ctx').classList.contains('hidden')) this.closeCtx(); else this.onMenu(); }
    else if (k === 'v') this.send({ t: 'evolve' });
  }

  pDown(e) {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
    const leftZone = e.clientX < window.innerWidth * 0.42 && e.pointerType !== 'mouse';
    if (leftZone && !this.joy) {
      this.joy = { id: e.pointerId, x: e.clientX, y: e.clientY };
      const j = this.$('#h-joy'); j.classList.remove('hidden');
      const z = hudZoom();
      j.style.left = `${e.clientX / z}px`; j.style.top = `${e.clientY / z}px`;
      return;
    }
    if (this.build) this.moveGhost(e.clientX, e.clientY);
    const others = [...this.pointers.keys()].filter((id) => id !== (this.joy && this.joy.id));
    if (others.length === 2) {
      const [a, b] = others.map((id) => this.pointers.get(id));
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.r.zoom };
    }
  }

  pMove(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse' && this.build && e.target === this.r.canvas) this.moveGhost(e.clientX, e.clientY, true);
      return;
    }
    p.x = e.clientX; p.y = e.clientY;
    if (this.joy && this.joy.id === e.pointerId) {
      let dx = e.clientX - this.joy.x, dy = e.clientY - this.joy.y;
      const z = hudZoom();
      dx /= z; dy /= z;
      const m = Math.hypot(dx, dy), R = 56;
      if (m > R) { dx = dx / m * R; dy = dy / m * R; }
      this.$('#h-knob').style.transform = `translate(${dx}px, ${dy}px)`;
      this.joyVec = [dx / R, dy / R];
      return;
    }
    if (this.pinch) {
      const others = [...this.pointers.keys()].filter((id) => id !== (this.joy && this.joy.id)).map((id) => this.pointers.get(id));
      if (others.length >= 2) {
        const d = Math.hypot(others[0].x - others[1].x, others[0].y - others[1].y);
        this.r.zoom = Math.max(0.55, Math.min(1.7, this.pinch.z * this.pinch.d / d));
      }
      return;
    }
    if (this.build) this.moveGhost(e.clientX, e.clientY);
  }

  pUp(e) {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.joy && this.joy.id === e.pointerId) {
      this.joy = null; this.joyVec = null;
      this.$('#h-joy').classList.add('hidden'); this.$('#h-knob').style.transform = '';
      return;
    }
    if (this.pointers.size < 2) this.pinch = null;
    if (!p || e.target !== this.r.canvas) return;
    const tapped = Math.hypot(p.x - p.sx, p.y - p.sy) < 12 && performance.now() - p.t < 350;
    if (tapped && !this.build) this.selectAt(e.clientX, e.clientY);
  }

  // ---------------------------------------------------------------- construção
  toggleBuild() {
    if (!this.world || this.world.team() !== 'E' || this.world.me.dead) return;
    if (this.build) return this.exitBuild();
    this.closeCtx(); this.closeProg();
    this.build = { type: null, rot: 0, x: 0, y: 0, dragged: false };
    this.$('#h-bbar').classList.remove('hidden');
    this.$('#h-bact').classList.remove('hidden');
    this.$('#h-actions').classList.add('building');
    this.renderBuildBar();
  }
  exitBuild() {
    this.build = null;
    this.$('#h-bbar').classList.add('hidden'); this.$('#h-bact').classList.add('hidden');
    this.$('#h-actions').classList.remove('building');
    this.r.setGhost(null);
  }
  renderBuildBar() {
    const w = this.world, me = w.me;
    this.$('#h-tabs').innerHTML = BUILD_CATEGORIES.map((c) => `<button class="tab ${c.id === this.cat ? 'on' : ''}" data-cat="${c.id}">${c.name}</button>`).join('');
    this.$('#h-tabs').querySelectorAll('button').forEach((b) => b.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.cat = b.dataset.cat; sfx('click'); this.renderBuildBar(); }));
    const items = Object.entries(BUILDINGS).filter(([, d]) => d.cat === this.cat && !d.upgradeOnly);
    this.$('#h-items').innerHTML = items.map(([id, d]) => {
      const locked = d.req && !me.unlocked;
      const afford = canAfford(me.res, d.cost);
      return `<button class="item ${this.build && this.build.type === id ? 'on' : ''} ${locked ? 'locked' : ''} ${afford ? '' : 'poor'}" data-id="${id}">
        <span class="nm">${d.name}</span><span class="cs">${costHtml(d.cost)}</span>${locked ? '<span class="lk">Exige Árvore Ancestral</span>' : ''}</button>`;
    }).join('');
    this.$('#h-items').querySelectorAll('button').forEach((b) => b.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); sfx('click');
      const d = BUILDINGS[b.dataset.id];
      if (d.req && !this.world.me.unlocked) { this.toast('Construa uma Árvore Ancestral para liberar.', 'warn'); return; }
      this.build.type = b.dataset.id; this.build.dragged = false;
      this.renderBuildBar();
    }));
    this.lastBarRes = JSON.stringify(me.res) + me.unlocked;
  }
  rotate() { if (this.build) { this.build.rot = (this.build.rot + 1) & 3; } }
  moveGhost(cx, cy, hover = false) {
    if (!this.build || !this.build.type) return;
    const p = this.r.pickGround(cx, cy); if (!p) return;
    const { w, h } = buildingDims(BUILDINGS[this.build.type], this.build.rot);
    this.build.x = Math.round(p.x - w / 2); this.build.y = Math.round(p.y - h / 2);
    this.build.dragged = true; this.build.hover = hover;
  }
  ghostValid() {
    const b = this.build, w = this.world, u = w.myUnit();
    if (!b || !b.type || !u) return false;
    const def = BUILDINGS[b.type];
    const { w: bw, h: bh } = buildingDims(def, b.rot);
    if (Math.hypot(u.x - (b.x + bw / 2), u.y - (b.y + bh / 2)) > BUILD_RANGE) return false;
    if (!canAfford(w.me.res, def.cost)) return false;
    return placementOk(w, b.type, b.x, b.y, b.rot);
  }
  confirmBuild() {
    const b = this.build; if (!b || !b.type) { this.toast('Escolha uma estrutura na barra.', 'warn'); return; }
    if (!this.ghostValid()) { sfx('error'); this.toast('Local inválido, longe demais ou sem recursos.', 'warn'); return; }
    this.send({ t: 'build', type: b.type, x: b.x, y: b.y, rot: b.rot });
    sfx('build');
    // Muros seguem em sequência: desloca o holograma para o próximo encaixe
    const def = BUILDINGS[b.type];
    if (def.cat === 'defesa') {
      const { w, h } = buildingDims(def, b.rot);
      const u = this.world.myUnit();
      const horiz = Math.abs(Math.cos(u.face)) > Math.abs(Math.sin(u.face));
      if (horiz) b.y += h; else b.x += w;
    }
  }

  // ---------------------------------------------------------------- seleção de construção
  selectAt(cx, cy) {
    if (this.world && this.world.me && this.world.me.dead) { this.spectate++; return; }
    const p = this.r.pickGround(cx, cy); if (!p || !this.world) return;
    const i = Math.floor(p.y) * this.world.W + Math.floor(p.x);
    const bid = this.world.bgrid[i];
    if (!bid) { this.closeCtx(); return; }
    this.selected = bid; this.renderCtx();
  }
  closeCtx() { this.selected = 0; this.$('#h-ctx').classList.add('hidden'); }
  renderCtx() {
    const b = this.world.buildings.get(this.selected);
    const el = this.$('#h-ctx');
    if (!b) { this.closeCtx(); return; }
    const def = BUILDINGS[b.type], me = this.world.me;
    const owner = this.world.players.get(b.owner);
    const up = def.upgrade && BUILDINGS[def.upgrade];
    const mine = b.owner === me.pid;
    const isElf = me.team === 'E';
    let html = `<h3>${def.name}</h3><div class="sub">${owner ? owner.name : ''} · ${Math.ceil(b.hp)}/${b.maxHp} PV${b.progress < 1 ? ` · ${Math.round(b.progress * 100)}% construído` : ''}</div>`;
    const info = [];
    if (def.tower) info.push(`Dano ${def.tower.dmg} · alcance ${def.tower.range}`);
    if (def.trap) info.push(`Armadilha: ${def.trap.dmg} de dano${def.trap.root ? `, prende ${def.trap.root}s` : ''}${def.trap.once ? ' (uso único)' : ''}`);
    if (def.income) info.push('Renda: ' + Object.entries(def.income).map(([k, v]) => `+${v}/s ${RES_NAME[k]}`).join(', '));
    if (def.heal) info.push('Cura elfos próximos');
    if (def.aura) info.push('+60% coleta num raio de 9');
    if (def.revive) info.push('Revive aliados caídos');
    if (def.unlocks) info.push('Libera tecnologias avançadas');
    if (def.detect) info.push('Detecta trolls invisíveis');
    if (def.gate) info.push('Elfos atravessam; trolls não');
    html += `<div class="info">${info.join('<br>')}</div>`;
    if (isElf) {
      html += '<div class="row">';
      if (up && b.progress >= 1) {
        const locked = up.req && !me.unlocked;
        html += `<button class="btn" id="c-up" ${locked ? 'disabled' : ''}>Melhorar → ${up.name} ${costHtml(up.cost)}${locked ? ' (Árvore Ancestral)' : ''}</button>`;
      }
      if (mine) html += '<button class="btn danger" id="c-del">Demolir (50%)</button>';
      html += '</div><div class="hint">Para reparar: fique ao lado e use Coletar/Reparar.</div>';
    }
    html += '<button class="close" id="c-x">×</button>';
    el.innerHTML = html; el.classList.remove('hidden');
    el.querySelector('#c-x').addEventListener('pointerdown', (e) => { e.stopPropagation(); this.closeCtx(); });
    const upb = el.querySelector('#c-up'); if (upb) upb.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.send({ t: 'upgrade', bid: b.id }); sfx('build'); setTimeout(() => this.renderCtx(), 150); });
    const del = el.querySelector('#c-del'); if (del) del.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.send({ t: 'demolish', bid: b.id }); this.closeCtx(); });
    this.ctxStamp = `${b.hp}|${b.progress}|${b.type}|${JSON.stringify(me.res)}`;
  }

  // ---------------------------------------------------------------- progressão / inventário
  toggleProg() { if (this.$('#h-prog-panel').classList.contains('hidden')) this.renderProg(); else this.closeProg(); }
  closeProg() { this.$('#h-prog-panel').classList.add('hidden'); }
  renderProg() {
    const w = this.world; if (!w || !w.me) return;
    const me = w.me; const el = this.$('#h-prog-panel');
    const table = me.team === 'E' ? ELF_UPGRADES : TROLL_UPGRADES;
    const title = me.team === 'E' ? 'Progressão do Elfo' : `${me.ancestral ? 'Troll Ancestral' : TROLL_CLASSES[me.cls].name} — Evolução`;
    let html = `<h3>${title}</h3><div class="sub">Nível ${me.level} · ${me.xp}/${me.xpNext} XP</div><div class="ups">`;
    for (const [key, up] of Object.entries(table)) {
      const lvl = me.upgrades[key] || 0; const max = lvl >= up.max; const cost = max ? null : up.cost(lvl);
      const ok = cost && canAfford(me.res, cost);
      html += `<div class="up"><div><b>${up.name}</b> <span class="lv">${'●'.repeat(lvl)}${'○'.repeat(up.max - lvl)}</span><div class="d">${up.desc}</div></div>
        <button class="btn ${ok ? '' : 'off'}" data-k="${key}" ${max ? 'disabled' : ''}>${max ? 'Máx.' : costHtml(cost)}</button></div>`;
    }
    html += '</div><h4>Habilidades</h4><div class="abl">';
    for (const [id, name, locked, cd] of me.abilities) {
      const desc = this.abilityDesc(me, id);
      html += `<div class="${locked ? 'locked' : ''}"><b>${name}</b> <small>(${cd}s)</small> — ${desc}${locked ? ' <i>(bloqueada)</i>' : ''}</div>`;
    }
    html += '</div>';
    if (me.team === 'T' && !me.ancestral) html += `<div class="hint">Ao chegar no nível ${ANCESTRAL_LEVEL}, você pode evoluir para Troll Ancestral.</div>`;
    html += `<h4>Estatísticas</h4><div class="stats">Abates ${me.stats.kills} · Construções ${me.stats.built} · Destruídas ${me.stats.destroyed} · Madeira ${me.stats.wood} · Ouro ${me.stats.gold}</div>`;
    html += '<button class="close" id="p-x">×</button>';
    el.innerHTML = html; el.classList.remove('hidden');
    el.querySelector('#p-x').addEventListener('pointerdown', (e) => { e.stopPropagation(); this.closeProg(); });
    el.querySelectorAll('button[data-k]').forEach((b) => b.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); this.send({ t: 'buy', key: b.dataset.k }); sfx('coin'); setTimeout(() => this.renderProg(), 120);
    }));
    this.progStamp = JSON.stringify(me.res) + me.level;
  }
  abilityDesc(me, id) {
    if (me.team === 'E') return { salto: 'Avança rápido na direção do movimento.', camuflagem: 'Fica invisível para trolls por 6s (nível 3).' }[id] || '';
    const all = [...Object.values(TROLL_CLASSES).flatMap((c) => c.abilities), { id: 'rugido', desc: 'Atordoa elfos próximos e revela todos (Ancestral).' }];
    return (all.find((a) => a.id === id) || {}).desc || '';
  }

  ability(i) {
    if (!this.world || !this.world.me) return;
    const a = this.world.me.abilities[i]; if (!a) return;
    if (a[2]) { this.toast(`${a[1]} ainda está bloqueada.`, 'warn'); sfx('error'); return; }
    if (this.world.me.cds[i] > 0) { sfx('error'); return; }
    this.send({ t: 'ability', i });
  }

  // ---------------------------------------------------------------- mensagens e números flutuantes
  toast(text, kind = '') {
    const box = this.$('#h-toasts');
    const el = document.createElement('div'); el.className = `toast ${kind}`; el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => el.classList.add('out'), 3200);
    setTimeout(() => el.remove(), 3800);
  }
  banner(text, sub = '') {
    const el = document.createElement('div'); el.className = 'banner';
    el.innerHTML = `<b>${text}</b>${sub ? `<span>${sub}</span>` : ''}`;
    this.root.appendChild(el);
    setTimeout(() => el.remove(), 3600);
  }

  onFx(list) {
    const w = this.world; const myU = w && w.myUnit();
    for (const f of list) {
      const near = myU && f.x !== undefined ? Math.hypot(myU.x - f.x, myU.y - f.y) < 16 : false;
      switch (f.k) {
        case 'msg': this.toast(f.text); break;
        case 'phase': sfx('horn'); this.banner(['', 'Preparação', 'Sobrevivência', 'Caçada Intensa', 'Confronto Final'][f.v], f.text); break;
        case 'event': sfx('horn'); this.banner(EVENTS[f.v].name, EVENTS[f.v].desc); break;
        case 'hit': if (near) { sfx('hit'); this.floater(f.x, f.y, f.v, f.team === w.team() ? 'bad' : 'good'); } break;
        case 'boom': if (near) sfx('boom'); break;
        case 'chop': if (near) sfx('chop', 0.12); break;
        case 'built': if (near) sfx('build', 0.1); break;
        case 'level': if (f.pid === w.me.pid) { sfx('level'); this.toast(`Nível ${f.v}!`, 'good'); } break;
        case 'death': sfx('death'); break;
        case 'bolt': if (near) sfx('bolt'); break;
        case 'trap': if (near) sfx('trap'); break;
        case 'roar': case 'smash': if (near) sfx('roar'); break;
        default: break;
      }
    }
  }
  floater(x, y, v, kind) {
    if (this.floaters.length > 24) return;
    const el = document.createElement('div'); el.className = `floater ${kind}`; el.textContent = v;
    this.$('#h-float').appendChild(el);
    this.floaters.push({ el, x: x + (Math.random() - 0.5) * 0.4, y, t: 0 });
  }

  // ---------------------------------------------------------------- minimapa
  initMini(world) {
    const c = document.createElement('canvas'); c.width = world.W; c.height = world.H;
    const g = c.getContext('2d');
    for (let i = 0; i < world.W * world.H; i++) { g.fillStyle = MINI_COLOR[world.tiles[i]] || '#000'; g.fillRect(i % world.W, (i / world.W) | 0, 1, 1); }
    this.miniBase = c; this.miniG = g;
    world.on('tile', (i, t) => { g.fillStyle = MINI_COLOR[t]; g.fillRect(i % world.W, (i / world.W) | 0, 1, 1); });
  }
  drawMini(world) {
    const cv = this.$('#h-mini'); const g = cv.getContext('2d');
    const s = cv.width / world.W;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.miniBase, 0, 0, cv.width, cv.height);
    const team = world.team();
    for (const b of world.buildings.values()) {
      g.fillStyle = team === 'E' ? '#9ff7e4' : '#ff9a6a';
      g.fillRect(b.x * s, b.y * s, Math.max(2, b.w * s), Math.max(2, b.h * s));
    }
    for (const u of world.units.values()) {
      if (u.flags & 16) continue;
      const me = world.me && u.id === world.me.uid;
      g.fillStyle = me ? '#ffffff' : u.team === team ? '#5fd46a' : '#ff3b3b';
      g.beginPath(); g.arc(u.x * s, u.y * s, me ? 3.4 : 2.6, 0, 7); g.fill();
    }
    const t = performance.now() / 1000;
    for (const [x, y] of world.pings) {
      g.strokeStyle = '#ffd23f'; g.lineWidth = 2;
      g.beginPath(); g.arc(x * s, y * s, 4 + (t * 8) % 8, 0, 7); g.stroke();
    }
    const sp = world.map.spawn; g.strokeStyle = '#ff5a3c'; g.lineWidth = 1; g.strokeRect((sp.x - 7) * s, (sp.y - 7) * s, 14 * s, 14 * s);
    const f = this.r.focus; g.strokeStyle = 'rgba(255,255,255,.5)'; g.strokeRect((f.x - 12) * s, (f.z - 9) * s, 24 * s, 16 * s);
  }

  // ---------------------------------------------------------------- por frame
  setWorld(world) { this.world = world; this.initMini(world); }

  getInput() {
    let mx = 0, my = 0;
    if (this.joyVec) [mx, my] = this.joyVec;
    const k = this.keys;
    if (k.has('a') || k.has('arrowleft')) mx -= 1;
    if (k.has('d') || k.has('arrowright')) mx += 1;
    if (k.has('w') || k.has('arrowup')) my -= 1;
    if (k.has('s') || k.has('arrowdown')) my += 1;
    const m = Math.hypot(mx, my); if (m > 1) { mx /= m; my /= m; }
    const atk = this.toggles.atk || k.has(' ');
    const int = this.toggles.int || k.has('e');
    return { mx: Math.round(mx * 100) / 100, my: Math.round(my * 100) / 100, atk, int };
  }

  update(dt) {
    const w = this.world; if (!w || !w.me) return;
    const me = w.me, isElf = me.team === 'E';
    const u = w.myUnit();
    // Barras
    if (u) {
      this.$('#h-hp').style.width = `${(u.hp / u.maxHp) * 100}%`;
      this.$('#h-hpt').textContent = `${u.hp}/${u.maxHp}`;
    }
    this.$('#h-xp').style.width = `${(me.xp / me.xpNext) * 100}%`;
    this.$('#h-lvl').textContent = `Nv ${me.level}`;
    const portrait = isElf ? 'Elfo' : me.ancestral ? 'Ancestral' : TROLL_CLASSES[me.cls].name;
    if (this.$('#h-portrait').textContent !== portrait) { this.$('#h-portrait').textContent = portrait; this.$('#h-portrait').className = `portrait ${me.team}`; }
    // Time
    const dots = [...w.players.values()].filter((p) => p.team === me.team).map((p) => `<i class="${p.alive ? 'on' : ''} ${p.id === me.pid ? 'me' : ''}" title="${p.name}"></i>`).join('');
    if (dots !== this.lastDots) { this.$('#h-team').innerHTML = dots; this.lastDots = dots; }
    // Fase / tempo
    const phaseNames = ['', 'Preparação', 'Sobrevivência', 'Caçada Intensa', 'Confronto Final'];
    this.$('#h-phase').textContent = `Fase ${w.phase} · ${phaseNames[w.phase]}`;
    this.$('#h-timer').textContent = w.phase === 1 ? `Trolls livres em ${fmtTime(w.prep - w.time)}` : `Amanhecer em ${fmtTime(w.duration - w.time)}`;
    const ev = this.$('#h-event');
    if (w.event && EVENTS[w.event.k].dur > 1) { ev.classList.remove('hidden'); ev.textContent = `${EVENTS[w.event.k].name} · ${Math.ceil(w.event.left)}s`; } else ev.classList.add('hidden');
    // Recursos
    const res = isElf ? ['wood', 'gold', 'crystal'] : ['gold'];
    const rh = res.map((k) => `<span>${ICON[k]}${me.res[k]}</span>`).join('');
    if (rh !== this.lastRes) { this.$('#h-res').innerHTML = rh; this.lastRes = rh; }
    // Botões
    this.$('#b-int').classList.toggle('hidden', !isElf);
    this.$('#b-bld').classList.toggle('hidden', !isElf);
    this.$('#b-int').querySelector('b').textContent = 'Coletar';
    this.$('#b-atk').classList.toggle('on', this.toggles.atk);
    this.$('#b-int').classList.toggle('on', this.toggles.int);
    me.abilities.forEach(([id, name, locked], i) => {
      const b = this.$(`#b-ab${i}`); if (!b) return;
      b.classList.toggle('hidden', i === 2 && locked);
      b.classList.toggle('locked', !!locked);
      b.querySelector('b').textContent = name.split(' ')[0];
      const cd = me.cds[i] || 0; const total = me.abilities[i][3];
      b.querySelector('.cd').style.background = cd > 0 ? `conic-gradient(rgba(0,0,0,.6) ${(cd / total) * 360}deg, transparent 0)` : 'none';
      b.querySelector('.cd').textContent = cd > 0 ? Math.ceil(cd) : '';
    });
    this.$('#b-evo').classList.toggle('hidden', !(me.team === 'T' && !me.ancestral && me.level >= ANCESTRAL_LEVEL));
    this.$('#h-take').classList.toggle('hidden', !me.takeover);
    this.$('#h-actions').classList.toggle('dead', !!me.dead);
    if (me.dead) { this.toggles.atk = false; this.toggles.int = false; }
    // Morte
    const dead = this.$('#h-dead');
    if (me.dead) {
      dead.classList.remove('hidden');
      dead.innerHTML = me.team === 'T' ? `<b>Você caiu</b><span>Renasce no covil em ${Math.ceil(me.respawnIn)}s</span>`
        : me.reviveIn ? `<b>Você foi abatido</b><span>Renascendo no Altar em ${Math.ceil(me.reviveIn)}s</span>`
          : '<b>Você foi abatido</b><span>Assistindo aliados · toque na tela para trocar · um Altar de Renascimento pode trazer você de volta</span>';
      if (this.build) this.exitBuild();
    } else dead.classList.add('hidden');
    // Construção
    if (this.build) {
      const b = this.build;
      if (b.type) {
        if (!b.dragged && u) {
          const { w: bw, h: bh } = buildingDims(BUILDINGS[b.type], b.rot);
          b.x = Math.round(u.x + Math.cos(u.face) * 2.2 - bw / 2); b.y = Math.round(u.y + Math.sin(u.face) * 2.2 - bh / 2);
        }
        const def = BUILDINGS[b.type];
        const { w: bw, h: bh } = buildingDims(def, b.rot);
        this.r.setGhost(b.type, b.x, b.y, bw, bh, this.ghostValid(), def.tower ? def.tower.range : 0);
      } else this.r.setGhost(null);
      const stamp = JSON.stringify(me.res) + me.unlocked;
      if (stamp !== this.lastBarRes) this.renderBuildBar();
    }
    // Painéis abertos se atualizam quando algo muda
    if (this.selected) {
      const b = w.buildings.get(this.selected);
      if (!b) this.closeCtx();
      else if (`${b.hp}|${b.progress}|${b.type}|${JSON.stringify(me.res)}` !== this.ctxStamp) this.renderCtx();
    }
    if (!this.$('#h-prog-panel').classList.contains('hidden') && JSON.stringify(me.res) + me.level !== this.progStamp) this.renderProg();
    // Minimapa (10x/s)
    const now = performance.now();
    if (now - this.lastMini > 100) { this.lastMini = now; this.drawMini(w); }
    // Números flutuantes
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i]; f.t += dt;
      const p = this.r.project(f.x, f.y, 1.6 + f.t * 1.4);
      const z = hudZoom();
      f.el.style.transform = `translate(${p.x / z}px, ${p.y / z}px)`; f.el.style.opacity = String(1 - f.t / 0.9);
      if (f.t > 0.9) { f.el.remove(); this.floaters.splice(i, 1); }
    }
  }
}
