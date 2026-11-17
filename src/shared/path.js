// A* em grade 8-direções com custo por tile. costFn(x, y) => custo (Infinity = bloqueado).
class Heap {
  constructor() { this.a = []; }
  push(n) {
    const a = this.a; a.push(n); let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
  get size() { return this.a.length; }
}

const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];

export function findPath(W, H, costFn, sx, sy, tx, ty, maxNodes = 14000) {
  sx |= 0; sy |= 0; tx |= 0; ty |= 0;
  if (sx === tx && sy === ty) return [[tx, ty]];
  const N = W * H;
  const g = new Float32Array(N).fill(Infinity);
  const from = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const h = (x, y) => { const dx = Math.abs(x - tx), dy = Math.abs(y - ty); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
  const open = new Heap();
  const s = sy * W + sx; g[s] = 0; open.push({ i: s, f: h(sx, sy) });
  let best = s, bestH = h(sx, sy), expanded = 0;
  const goal = ty * W + tx;
  while (open.size) {
    const { i } = open.pop();
    if (closed[i]) continue; closed[i] = 1;
    if (i === goal) { best = i; break; }
    const x = i % W, y = (i / W) | 0;
    const hh = h(x, y); if (hh < bestH) { bestH = hh; best = i; }
    if (++expanded > maxNodes) break;
    for (const [dx, dy, dc] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx; if (closed[j]) continue;
      const c = costFn(nx, ny, j === goal); if (c === Infinity) continue;
      if (dx && dy) { // não corta quinas
        if (costFn(x + dx, y, false) > 1.5 || costFn(x, y + dy, false) > 1.5) continue;
      }
      const ng = g[i] + c * dc;
      if (ng < g[j]) { g[j] = ng; from[j] = i; open.push({ i: j, f: ng + h(nx, ny) }); }
    }
  }
  const path = []; let c = best;
  while (c !== -1 && c !== s) { path.push([c % W, (c / W) | 0]); c = from[c]; }
  path.reverse();
  return path;
}
