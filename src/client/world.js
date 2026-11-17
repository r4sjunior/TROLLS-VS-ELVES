// Estado do mundo do lado do cliente, reconstruído só a partir dos snapshots.
// Funciona igual com partida local ou online.
import { generateMap } from '../shared/mapgen.js';
import { BUILDINGS } from '../shared/defs.js';
import { buildingDims } from '../shared/sim.js';

export class ClientWorld {
  constructor(init) {
    this.map = generateMap(init.seed, init.mapPreset);
    this.W = this.map.w; this.H = this.map.h;
    this.tiles = this.map.tiles.slice();
    this.bgrid = new Int32Array(this.W * this.H);
    this.pid = init.pid;
    this.buildings = new Map();
    this.units = new Map();
    this.proj = [];
    this.players = new Map();
    this.me = null;
    this.pings = [];
    this.tick = 0; this.time = 0; this.phase = 1; this.prep = 60; this.duration = 600;
    this.event = null; this.over = null;
    this.listeners = { tile: [], fx: [] };
  }

  on(evt, fn) { this.listeners[evt].push(fn); }

  apply(s) {
    if (s.full) {
      for (const b of this.buildings.values()) this.clearGrid(b);
      this.buildings.clear();
    }
    this.tick = s.tick; this.time = s.time; this.phase = s.phase; this.prep = s.prep; this.duration = s.duration;
    this.event = s.event; this.over = s.over;
    for (const [i, t] of s.tiles) {
      if (this.tiles[i] === t) continue;
      this.tiles[i] = t;
      for (const fn of this.listeners.tile) fn(i, t);
    }
    for (const id of s.rm) {
      const b = this.buildings.get(id);
      if (b) { this.clearGrid(b); this.buildings.delete(id); }
    }
    for (const a of s.bld) {
      const [id, type, owner, x, y, rot, hp, maxHp, progress, flags] = a;
      let b = this.buildings.get(id);
      if (b && b.type !== type) { this.clearGrid(b); }
      const def = BUILDINGS[type];
      const { w, h } = buildingDims(def, rot);
      b = Object.assign(b || {}, { id, type, owner, x, y, rot, w, h, hp, maxHp, progress, trapReady: !!(flags & 1), revealed: !!(flags & 2), shielded: !!(flags & 4) });
      this.buildings.set(id, b);
      for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) this.bgrid[ty * this.W + tx] = id;
    }
    const seen = new Set();
    for (const a of s.units) {
      const [id, pid, team, cls, x, y, face, hp, maxHp, state, flags, level, skin] = a;
      seen.add(id);
      const u = this.units.get(id) || { id, rx: x, ry: y };
      Object.assign(u, { pid, team, cls, x, y, face, hp, maxHp, state, flags, level, skin });
      this.units.set(id, u);
    }
    for (const id of [...this.units.keys()]) if (!seen.has(id)) this.units.delete(id);
    this.proj = s.proj;
    if (s.me) this.me = s.me;
    this.players.clear();
    for (const [id, name, team, cls, alive, level, isBot, connected] of s.players) this.players.set(id, { id, name, team, cls, alive, level, isBot, connected });
    this.pings = s.pings;
    this.bounty = s.bounty || 0;
    if (s.chest) this.chest = s.chest;
    if (s.fx.length) for (const fn of this.listeners.fx) fn(s.fx);
  }

  clearGrid(b) {
    for (let ty = b.y; ty < b.y + b.h; ty++) for (let tx = b.x; tx < b.x + b.w; tx++) {
      const i = ty * this.W + tx; if (this.bgrid[i] === b.id) this.bgrid[i] = 0;
    }
  }

  myUnit() { return this.me ? this.units.get(this.me.uid) : null; }
  team() { return this.me ? this.me.team : 'E'; }
}
