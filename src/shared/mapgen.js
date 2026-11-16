// Gerador de mapas. Mesma seed + preset => mesmo mapa (cliente reconstrói localmente).
import { makeRng } from './rng.js';
import { TILE, RESOURCE_AMOUNT, WALKABLE } from './defs.js';

export const MAP_PRESETS = {
  floresta: { name: 'Floresta Sombria', size: 96, forest: 0.47, rock: 0.8, rivers: 1, caves: 3, ruins: 3, gold: 9, secrets: 2 },
  vale: { name: 'Vale dos Rios', size: 96, forest: 0.55, rock: 0.72, rivers: 2, caves: 2, ruins: 4, gold: 8, secrets: 2 },
  ruinas: { name: 'Ruínas Esquecidas', size: 88, forest: 0.52, rock: 0.76, rivers: 1, caves: 4, ruins: 6, gold: 8, secrets: 3 },
};

function makeNoise(rng, cell) {
  const gw = 40, grid = new Float32Array(gw * gw);
  for (let i = 0; i < grid.length; i++) grid[i] = rng.next();
  const g = (x, y) => grid[((y % gw) + gw) % gw * gw + ((x % gw) + gw) % gw];
  const s = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x / cell, fy = y / cell;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = s(fx - ix), ty = s(fy - iy);
    const a = g(ix, iy) + (g(ix + 1, iy) - g(ix, iy)) * tx;
    const b = g(ix, iy + 1) + (g(ix + 1, iy + 1) - g(ix, iy + 1)) * tx;
    return a + (b - a) * ty;
  };
}

export function generateMap(seed, presetId = 'floresta') {
  const P = Object.hasOwn(MAP_PRESETS, presetId) ? MAP_PRESETS[presetId] : MAP_PRESETS.floresta;
  const rng = makeRng(seed);
  const W = P.size, H = P.size;
  const tiles = new Uint8Array(W * H);
  const idx = (x, y) => y * W + x;
  const inb = (x, y) => x > 0 && y > 0 && x < W - 1 && y < H - 1;
  const set = (x, y, t) => { if (inb(x, y)) tiles[idx(x, y)] = t; };
  const cx = W >> 1, cy = H >> 1;
  const distC = (x, y) => Math.hypot(x - cx, y - cy);

  const n1 = makeNoise(rng, 9), n2 = makeNoise(rng, 4), n3 = makeNoise(rng, 11), n4 = makeNoise(rng, 3.5);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const e = n1(x, y) * 0.75 + n2(x, y) * 0.25;
    const f = n3(x, y) * 0.65 + n4(x, y) * 0.35;
    let t = TILE.GRASS;
    if (e > P.rock) t = TILE.ROCK;
    else if (f > P.forest) t = TILE.FOREST;
    tiles[idx(x, y)] = t;
  }

  // Rios com pontes (lacunas)
  const bridges = [];
  for (let r = 0; r < P.rivers; r++) {
    const horizontal = (r % 2 === 0) === rng.chance(0.5);
    let px = horizontal ? 1 : rng.int(W * 0.2, W * 0.8);
    let py = horizontal ? rng.int(H * 0.2, H * 0.8) : 1;
    let dir = 0, step = 0, nextBridge = rng.int(10, 18);
    while (px > 0 && py > 0 && px < W - 1 && py < H - 1) {
      dir += rng.range(-0.35, 0.35);
      dir = Math.max(-0.9, Math.min(0.9, dir));
      if (horizontal) { px += 1; py += Math.round(dir); } else { py += 1; px += Math.round(dir); }
      step++;
      const bridge = step >= nextBridge && step < nextBridge + 3;
      if (step >= nextBridge + 3) nextBridge = step + rng.int(16, 24);
      for (let o = -1; o <= 1; o++) {
        const tx = horizontal ? px : px + o, ty = horizontal ? py + o : py;
        if (!inb(tx, ty) || distC(tx, ty) < 12) continue;
        if (bridge) { set(tx, ty, TILE.GRASS); bridges.push(idx(tx, ty)); } else set(tx, ty, TILE.WATER);
      }
    }
  }

  // Covil dos trolls no centro
  for (let y = cy - 7; y <= cy + 7; y++) for (let x = cx - 7; x <= cx + 7; x++) {
    const edge = Math.abs(x - cx) === 7 || Math.abs(y - cy) === 7;
    set(x, y, edge ? TILE.ROCK : TILE.SPAWN);
  }
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (let k = 7; k <= 13; k++) for (let o = -1; o <= 1; o++) {
      const x = cx + dx * k + (dy ? o : 0), y = cy + dy * k + (dx ? o : 0);
      set(x, y, TILE.GRASS);
    }
  }

  const farFromSpawn = (x, y, m = 16) => distC(x, y) > m;
  const randPos = (margin, minC) => {
    for (let i = 0; i < 200; i++) {
      const x = rng.int(margin, W - 1 - margin), y = rng.int(margin, H - 1 - margin);
      if (farFromSpawn(x, y, minC)) return [x, y];
    }
    return [margin, margin];
  };

  // Cavernas: bolsões escuros cercados de rocha
  const caves = [];
  for (let c = 0; c < P.caves; c++) {
    const [x0, y0] = randPos(8, 20);
    const rad = rng.int(3, 4);
    for (let y = y0 - rad - 2; y <= y0 + rad + 2; y++) for (let x = x0 - rad - 2; x <= x0 + rad + 2; x++) {
      const d = Math.hypot(x - x0, y - y0);
      if (d <= rad) set(x, y, TILE.CAVE);
      else if (d <= rad + 1.6) set(x, y, TILE.ROCK);
    }
    const ang = rng.int(0, 3);
    const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]][ang];
    for (let k = rad; k <= rad + 4; k++) { set(x0 + dx * k, y0 + dy * k, TILE.CAVE); }
    set(x0 + rng.int(-1, 1), y0 + rng.int(-1, 1), TILE.CRYSTAL);
    if (rng.chance(0.6)) set(x0 + rng.int(-2, 2), y0 + rng.int(-2, 2), TILE.CRYSTAL);
    caves.push({ x: x0, y: y0, r: rad });
  }

  // Ruínas antigas com cristais
  const ruins = [], pillars = [];
  for (let r = 0; r < P.ruins; r++) {
    const [x0, y0] = randPos(7, 18);
    const s = rng.int(3, 4);
    for (let y = y0 - s; y <= y0 + s; y++) for (let x = x0 - s; x <= x0 + s; x++) {
      if (!inb(x, y)) continue;
      if (tiles[idx(x, y)] === TILE.WATER || tiles[idx(x, y)] === TILE.SPAWN) continue;
      set(x, y, TILE.RUIN);
      const border = Math.abs(x - x0) === s || Math.abs(y - y0) === s;
      if (border && rng.chance(0.3)) pillars.push(idx(x, y));
    }
    for (let k = 0; k < 2; k++) set(x0 + rng.int(-s + 1, s - 1), y0 + rng.int(-s + 1, s - 1), TILE.CRYSTAL);
    ruins.push({ x: x0, y: y0, s });
  }

  // Veios de ouro
  for (let g = 0; g < P.gold; g++) {
    const [x0, y0] = randPos(4, 14);
    const n = rng.int(2, 3);
    for (let k = 0; k < n; k++) set(x0 + rng.int(-1, 1), y0 + rng.int(-1, 1), TILE.GOLD);
  }

  // Áreas secretas: clareira rica, cercada por floresta densa
  const secrets = [];
  for (let s = 0; s < P.secrets; s++) {
    const [x0, y0] = randPos(9, 24);
    for (let y = y0 - 6; y <= y0 + 6; y++) for (let x = x0 - 6; x <= x0 + 6; x++) {
      const d = Math.hypot(x - x0, y - y0);
      if (d <= 2.6) set(x, y, TILE.GRASS);
      else if (d <= 6) { if (tiles[idx(x, y)] !== TILE.WATER) set(x, y, TILE.FOREST); }
    }
    set(x0 + 1, y0, TILE.GOLD); set(x0 - 1, y0 + 1, TILE.CRYSTAL); set(x0, y0 - 1, TILE.CRYSTAL);
    secrets.push({ x: x0, y: y0 });
  }

  // Clareiras de início dos elfos
  const elfSpawns = [];
  const baseAng = rng.range(0, Math.PI * 2);
  const ringR = W * 0.33;
  for (let i = 0; i < 4; i++) {
    const a = baseAng + i * Math.PI / 2 + rng.range(-0.3, 0.3);
    const x0 = Math.round(cx + Math.cos(a) * ringR), y0 = Math.round(cy + Math.sin(a) * ringR);
    for (let y = y0 - 3; y <= y0 + 3; y++) for (let x = x0 - 3; x <= x0 + 3; x++) {
      if (Math.hypot(x - x0, y - y0) <= 3.2) set(x, y, TILE.GRASS);
    }
    elfSpawns.push({ x: x0 + 0.5, y: y0 + 0.5 });
  }

  // Bordas
  for (let x = 0; x < W; x++) { tiles[idx(x, 0)] = TILE.ROCK; tiles[idx(x, H - 1)] = TILE.ROCK; }
  for (let y = 0; y < H; y++) { tiles[idx(0, y)] = TILE.ROCK; tiles[idx(W - 1, y)] = TILE.ROCK; }

  // Conectividade: tudo que é pisável tem que ser alcançável a partir do covil
  // (atravessando floresta, que pode ser cortada). Bolsões isolados viram rocha.
  const seen = new Uint8Array(W * H);
  const q = [idx(cx, cy)]; seen[q[0]] = 1;
  const passable = (t) => WALKABLE.has(t) || t === TILE.FOREST || t === TILE.GOLD || t === TILE.CRYSTAL;
  while (q.length) {
    const i = q.pop(); const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const j = idx(x + dx, y + dy);
      if (!seen[j] && inb(x + dx, y + dy) && passable(tiles[j])) { seen[j] = 1; q.push(j); }
    }
  }
  for (let i = 0; i < W * H; i++) if (!seen[i] && passable(tiles[i])) tiles[i] = TILE.ROCK;

  const res = new Uint16Array(W * H);
  for (let i = 0; i < W * H; i++) res[i] = RESOURCE_AMOUNT[tiles[i]] || 0;

  return {
    seed, preset: presetId, name: P.name, w: W, h: H, tiles, res,
    spawn: { x: cx + 0.5, y: cy + 0.5 }, elfSpawns, bridges, caves, ruins, pillars, secrets,
  };
}
