import * as THREE from 'three';
import { TILE, BUILDINGS } from '../shared/defs.js';
import { makeElf, makeTroll, makeSpirit, makeBuilding, treeGeometries, GEO, mat } from './models.js';

export const QUALITY = {
  baixa: { dpr: 0.75, shadows: false, aa: false, particles: 250, fog: 0.032, fireflies: 0, lod: 0 },
  media: { dpr: 1.0, shadows: false, aa: false, particles: 500, fog: 0.024, fireflies: 40, lod: 1 },
  alta: { dpr: 1.75, shadows: true, aa: true, particles: 900, fog: 0.02, fireflies: 90, lod: 1 },
};

const TILE_COLOR = {
  [TILE.GRASS]: [0x52763f, 0x628a4a],
  [TILE.FOREST]: [0x30482a, 0x3a5530],
  [TILE.ROCK]: [0x50525c, 0x5d5f6a],
  [TILE.WATER]: [0x173852, 0x1b4060],
  [TILE.GOLD]: [0x6a5e3c, 0x786a44],
  [TILE.CRYSTAL]: [0x4e4670, 0x5a507e],
  [TILE.RUIN]: [0x8a846c, 0x9a937a],
  [TILE.CAVE]: [0x2e2238, 0x382a44],
  [TILE.SPAWN]: [0x6a352c, 0x7a4034],
};

const hash = (i) => { let x = (i * 2654435761) >>> 0; x ^= x >>> 13; x = Math.imul(x, 1274126177) >>> 0; return (x >>> 0) / 4294967296; };

function lerpColor(a, b, t) {
  const ca = new THREE.Color(a), cb = new THREE.Color(b);
  return ca.lerp(cb, t);
}

// Recurso em blocos (chunks) -> o frustum culling corta o que está fora da tela
class ChunkLayer {
  constructor(scene, parts, W, H, tilesOf, chunk = 16, extra = 24) {
    this.parts = parts; this.W = W; this.chunk = chunk;
    this.cw = Math.ceil(W / chunk);
    this.chunks = new Map();
    this.slot = new Map(); // tileIdx -> [chunkKey, slot]
    this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const counts = new Map();
    for (const i of tilesOf) { const k = this.key(i); counts.set(k, (counts.get(k) || 0) + 1); }
    for (let cy = 0; cy < Math.ceil(H / chunk); cy++) for (let cx = 0; cx < this.cw; cx++) {
      const k = cy * this.cw + cx;
      const cap = (counts.get(k) || 0) + extra;
      const meshes = parts.map(({ geo, mat: m, color }) => {
        const im = new THREE.InstancedMesh(geo, m, cap);
        for (let s = 0; s < cap; s++) im.setMatrixAt(s, this.zero);
        if (color) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
        im.castShadow = true; im.receiveShadow = false;
        scene.add(im);
        return im;
      });
      this.chunks.set(k, { meshes, free: [...Array(cap).keys()].reverse(), cx, cy });
    }
  }
  key(i) { const x = i % this.W, y = (i / this.W) | 0; return Math.floor(y / this.chunk) * this.cw + Math.floor(x / this.chunk); }
  add(i, matrices, colors) {
    const k = this.key(i), c = this.chunks.get(k);
    if (!c || !c.free.length || this.slot.has(i)) return;
    const s = c.free.pop();
    c.meshes.forEach((m, n) => {
      m.setMatrixAt(s, matrices[n]); m.instanceMatrix.needsUpdate = true;
      if (colors && colors[n] && m.instanceColor) { m.setColorAt(s, colors[n]); m.instanceColor.needsUpdate = true; }
    });
    this.slot.set(i, [k, s]);
    c.dirty = true;
  }
  remove(i) {
    const e = this.slot.get(i); if (!e) return;
    const c = this.chunks.get(e[0]);
    c.meshes.forEach((m) => { m.setMatrixAt(e[1], this.zero); m.instanceMatrix.needsUpdate = true; });
    c.free.push(e[1]); this.slot.delete(i);
    c.dirty = true;
  }
  finalize() {
    for (const c of this.chunks.values()) {
      if (!c.dirty && c.done) continue;
      for (const m of c.meshes) { m.computeBoundingSphere(); }
      c.dirty = false; c.done = true;
    }
  }
}

export class Renderer {
  constructor(canvas, qualityName = 'media') {
    this.q = QUALITY[qualityName] || QUALITY.media;
    this.canvas = canvas;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: this.q.aa, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(Math.min(2, (window.devicePixelRatio || 1) * this.q.dpr));
    this.gl.shadowMap.enabled = this.q.shadows;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.fogColor = new THREE.Color(0x15282c);
    this.scene.background = this.fogColor.clone();
    this.scene.fog = new THREE.FogExp2(this.fogColor.getHex(), this.q.fog);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 120);
    this.zoom = 0.85;
    this.focus = new THREE.Vector3(48, 0, 48);
    this.shake = 0;
    this.hemi = new THREE.HemisphereLight(0x9db8e0, 0x2a3a1c, 2.1);
    this.scene.add(new THREE.AmbientLight(0x404858, 0.9));
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xd6e2ff, 2.3);
    this.sun.position.set(-20, 40, 15);
    if (this.q.shadows) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(2048, 2048);
      const sc = this.sun.shadow.camera; sc.left = -24; sc.right = 24; sc.top = 24; sc.bottom = -24; sc.near = 1; sc.far = 90;
      this.sun.shadow.bias = -0.0015;
    }
    this.scene.add(this.sun); this.scene.add(this.sun.target);
    this.static = new THREE.Group(); this.scene.add(this.static);
    this.dyn = new THREE.Group(); this.scene.add(this.dyn);
    this.units = new Map(); this.blds = new Map(); this.projs = new Map();
    this.rings = []; this.beams = [];
    this.initParticles();
    this.raycaster = new THREE.Raycaster();
    this.ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.time = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- mapa
  setWorld(world) {
    this.world = world;
    this.static.clear(); this.dyn.clear();
    for (const k of ['trees', 'gold', 'crystal']) if (this[k]) for (const c of this[k].chunks.values()) c.meshes.forEach((m) => { this.scene.remove(m); m.dispose(); });
    this.units.clear(); this.blds.clear(); this.projs.clear();
    const { W, H } = world;
    // Terreno: textura de 1 texel por tile com filtro linear (transições suaves)
    const data = new Uint8Array(W * H * 4);
    this.terrainData = data;
    this.terrainTex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
    this.terrainTex.magFilter = THREE.LinearFilter; this.terrainTex.minFilter = THREE.LinearFilter;
    this.terrainTex.colorSpace = THREE.SRGBColorSpace;
    for (let i = 0; i < W * H; i++) this.paintTile(i, world.tiles[i], false);
    this.terrainTex.needsUpdate = true;
    const gGeo = new THREE.PlaneGeometry(W, H, 1, 1);
    gGeo.rotateX(-Math.PI / 2); gGeo.translate(W / 2, 0, H / 2);
    const ground = new THREE.Mesh(gGeo, new THREE.MeshLambertMaterial({ map: this.terrainTex }));
    ground.receiveShadow = true;
    this.static.add(ground);
    // Plano escuro além das bordas
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(W * 4, H * 4).rotateX(-Math.PI / 2).translate(W / 2, -0.05, H / 2), mat(0x10170f));
    this.static.add(outer);

    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3();
    const compose = (x, y, z, ry, sx, sy, sz) => { e.set(0, ry, 0); q.setFromEuler(e); return new THREE.Matrix4().compose(v.set(x, y, z), q, s.set(sx, sy, sz)); };

    // Rochas / montanhas
    const rockIdx = []; for (let i = 0; i < W * H; i++) if (world.tiles[i] === TILE.ROCK) rockIdx.push(i);
    const rocks = new THREE.InstancedMesh(GEO.dod, mat(0xffffff), rockIdx.length);
    rocks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(rockIdx.length * 3), 3);
    rockIdx.forEach((i, n) => {
      const x = i % W, y = (i / W) | 0, r = hash(i);
      const edge = x === 0 || y === 0 || x === W - 1 || y === H - 1;
      const hgt = edge ? 2.6 : 0.9 + r * 1.6;
      rocks.setMatrixAt(n, compose(x + 0.5, hgt * 0.35, y + 0.5, r * 6, 1.35, hgt, 1.35));
      rocks.setColorAt(n, lerpColor(0x4a4d58, 0x6c6f7c, hash(i + 7)));
    });
    rocks.castShadow = true; rocks.receiveShadow = true;
    this.static.add(rocks);

    // Água
    const wpos = [];
    for (let i = 0; i < W * H; i++) if (world.tiles[i] === TILE.WATER) {
      const x = i % W, y = (i / W) | 0;
      wpos.push(x, 0.04, y, x, 0.04, y + 1, x + 1, 0.04, y, x + 1, 0.04, y, x, 0.04, y + 1, x + 1, 0.04, y + 1);
    }
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3)); wg.computeVertexNormals();
    this.waterMat = new THREE.MeshPhongMaterial({ color: 0x2c6f9e, emissive: 0x0b2c47, shininess: 90, transparent: true, opacity: 0.86 });
    this.static.add(new THREE.Mesh(wg, this.waterMat));

    // Pontes
    if (world.map.bridges.length) {
      const br = new THREE.InstancedMesh(GEO.box, mat(0x6b4a2b), world.map.bridges.length);
      world.map.bridges.forEach((i, n) => br.setMatrixAt(n, compose((i % W) + 0.5, 0.08, ((i / W) | 0) + 0.5, 0, 1.0, 0.1, 0.9)));
      br.receiveShadow = true; this.static.add(br);
    }

    // Árvores (madeira), ouro e cristal: camadas instanciadas em blocos
    const tg = treeGeometries();
    const crownGeo = this.q.lod ? tg.crown : (() => { const c = new THREE.ConeGeometry(0.55, 1.5, 5); c.translate(0, 1.15, 0); return c; })();
    const forest = [], gold = [], crys = [];
    for (let i = 0; i < W * H; i++) { const t = world.tiles[i]; if (t === TILE.FOREST) forest.push(i); else if (t === TILE.GOLD) gold.push(i); else if (t === TILE.CRYSTAL) crys.push(i); }
    this.trees = new ChunkLayer(this.scene, [{ geo: tg.trunk, mat: mat(0x4a3424) }, { geo: crownGeo, mat: mat(0xffffff), color: true }], W, H, forest, 16, 40);
    this.gold = new ChunkLayer(this.scene, [{ geo: GEO.ico, mat: mat(0xd8a92a, { emissive: 0x4a3200, emissiveIntensity: 0.6 }) }], W, H, gold, 32, 4);
    this.crystal = new ChunkLayer(this.scene, [{ geo: GEO.oct, mat: mat(0x9b7bff, { emissive: 0x5a3dd8, emissiveIntensity: 1.1 }) }], W, H, crys, 32, 4);
    for (const i of forest) this.addTree(i);
    for (const i of gold) this.addGold(i);
    for (const i of crys) this.addCrystal(i);
    this.trees.finalize(); this.gold.finalize(); this.crystal.finalize();

    // Ruínas: colunas quebradas
    const pil = world.map.pillars;
    if (pil.length) {
      const pm = new THREE.InstancedMesh(GEO.cyl, mat(0x8c8676), pil.length);
      pil.forEach((i, n) => { const r = hash(i); pm.setMatrixAt(n, compose((i % W) + 0.5, 0.3 + r * 0.4, ((i / W) | 0) + 0.5, r * 3, 0.35, 0.6 + r * 0.9, 0.35)); });
      pm.castShadow = true; this.static.add(pm);
    }
    // Cavernas: cogumelos luminosos
    const mush = [];
    for (let i = 0; i < W * H; i++) if (world.tiles[i] === TILE.CAVE && hash(i + 3) < 0.22) mush.push(i);
    if (mush.length) {
      const mm = new THREE.InstancedMesh(GEO.sph, mat(0x63ffd1, { emissive: 0x2fe0b0, emissiveIntensity: 1.3 }), mush.length);
      mush.forEach((i, n) => { const r = hash(i + 11); mm.setMatrixAt(n, compose((i % W) + 0.2 + r * 0.6, 0.08, ((i / W) | 0) + 0.2 + hash(i + 5) * 0.6, 0, 0.18, 0.12, 0.18)); });
      this.static.add(mm);
    }
    // Jaula do covil (só na preparação)
    this.cage = new THREE.Group();
    const sp = world.map.spawn; const cx = Math.floor(sp.x), cy = Math.floor(sp.y);
    for (let y = cy - 7; y <= cy + 7; y++) for (let x = cx - 7; x <= cx + 7; x++) {
      if (Math.abs(x - cx) !== 7 && Math.abs(y - cy) !== 7) continue;
      if (world.tiles[y * W + x] === TILE.ROCK) continue;
      const bar = new THREE.Mesh(GEO.cone4, mat(0xff5a3c, { emissive: 0xff3a1c, emissiveIntensity: 1 }));
      bar.scale.set(0.25, 1.6, 0.25); bar.position.set(x + 0.5, 0.8, y + 0.5); this.cage.add(bar);
    }
    this.static.add(this.cage);

    // Vaga-lumes
    if (this.q.fireflies) {
      const n = this.q.fireflies;
      const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
      this.fireflies = new THREE.Points(fg, new THREE.PointsMaterial({ color: 0xd9ff8a, size: 0.12, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.fireflySeeds = Array.from({ length: n }, (_, k) => [hash(k) * 40 - 20, hash(k + 99) * 40 - 20, hash(k + 7) * 6.28]);
      this.static.add(this.fireflies);
    }
    this.scene.add(this.particles);
    world.on('tile', (i, t) => this.onTile(i, t));
    this.focus.set(world.W / 2, 0, world.H / 2);
  }

  paintTile(i, t, update = true) {
    const pal = TILE_COLOR[t] || TILE_COLOR[TILE.GRASS];
    const c = lerpColor(pal[0], pal[1], hash(i));
    const W = this.world.W, H = this.world.H;
    const x = i % W, y = (i / W) | 0;
    const o = ((H - 1 - y) * W + x) * 4;
    this.terrainData[o] = c.r * 255; this.terrainData[o + 1] = c.g * 255; this.terrainData[o + 2] = c.b * 255; this.terrainData[o + 3] = 255;
    if (update) this.terrainTex.needsUpdate = true;
  }

  addTree(i) {
    const W = this.world.W; const x = i % W, y = (i / W) | 0, r = hash(i), r2 = hash(i + 1);
    const sc = 0.85 + r * 0.5;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x + 0.5 + (r2 - 0.5) * 0.3, 0, y + 0.5 + (r - 0.5) * 0.3), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r * 6, 0)), new THREE.Vector3(sc, sc * (0.9 + r2 * 0.4), sc));
    const magic = hash(i + 42) < 0.06;
    const col = magic ? lerpColor(0x5a3d8a, 0x3fb6a8, r2) : lerpColor(0x1f4a2e, 0x3d6b35, r2);
    this.trees.add(i, [m, m], [null, col]);
  }
  addGold(i) {
    const W = this.world.W; const x = i % W, y = (i / W) | 0, r = hash(i);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x + 0.5, 0.35, y + 0.5), new THREE.Quaternion().setFromEuler(new THREE.Euler(r, r * 5, 0)), new THREE.Vector3(1.1, 0.8, 1.1));
    this.gold.add(i, [m]);
  }
  addCrystal(i) {
    const W = this.world.W; const x = i % W, y = (i / W) | 0, r = hash(i);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x + 0.5, 0.6, y + 0.5), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, r * 5, 0.1)), new THREE.Vector3(0.7, 1.4, 0.7));
    this.crystal.add(i, [m]);
  }

  onTile(i, t) {
    this.paintTile(i, t);
    this.trees.remove(i); this.gold.remove(i); this.crystal.remove(i);
    if (t === TILE.FOREST) this.addTree(i);
    this.trees.finalize(); this.gold.finalize(); this.crystal.finalize();
  }

  // ---------------------------------------------------------------- partículas
  initParticles() {
    const n = this.q.particles;
    this.pMax = n;
    const g = new THREE.BufferGeometry();
    this.pPos = new Float32Array(n * 3); this.pCol = new Float32Array(n * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.pData = Array.from({ length: n }, () => ({ life: 0, vx: 0, vy: 0, vz: 0, g: 0 }));
    for (let i = 0; i < n; i++) this.pPos[i * 3 + 1] = -100;
    this.particles = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.22, vertexColors: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.particles.frustumCulled = false;
    this.pNext = 0;
  }
  burst(x, y, z, count, color, speed = 3, up = 2, gravity = 6, life = 0.8) {
    const c = new THREE.Color(color);
    for (let k = 0; k < count; k++) {
      const i = this.pNext; this.pNext = (this.pNext + 1) % this.pMax;
      const d = this.pData[i]; const a = Math.random() * 6.28, sp = Math.random() * speed;
      d.vx = Math.cos(a) * sp; d.vz = Math.sin(a) * sp; d.vy = up * (0.5 + Math.random()); d.g = gravity; d.life = life * (0.6 + Math.random() * 0.6);
      this.pPos[i * 3] = x; this.pPos[i * 3 + 1] = z; this.pPos[i * 3 + 2] = y;
      this.pCol[i * 3] = c.r; this.pCol[i * 3 + 1] = c.g; this.pCol[i * 3 + 2] = c.b;
    }
  }
  updateParticles(dt) {
    for (let i = 0; i < this.pMax; i++) {
      const d = this.pData[i]; if (d.life <= 0) continue;
      d.life -= dt; d.vy -= d.g * dt;
      this.pPos[i * 3] += d.vx * dt; this.pPos[i * 3 + 1] += d.vy * dt; this.pPos[i * 3 + 2] += d.vz * dt;
      if (this.pPos[i * 3 + 1] < 0.02) { this.pPos[i * 3 + 1] = 0.02; d.vy *= -0.3; d.vx *= 0.6; d.vz *= 0.6; }
      if (d.life <= 0) this.pPos[i * 3 + 1] = -100;
    }
    this.particles.geometry.attributes.position.needsUpdate = true;
    this.particles.geometry.attributes.color.needsUpdate = true;
  }
  ring(x, y, color, maxR = 3, dur = 0.6, h = 0.08) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    m.position.set(x, h, y); this.dyn.add(m);
    this.rings.push({ m, t: 0, dur, maxR });
  }
  beam(x, y, color, dur = 0.35, r = 0.25) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 14, 8, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.set(x, 7, y); this.dyn.add(m);
    this.beams.push({ m, t: 0, dur });
  }

  fx(list, myPos) {
    for (const f of list) {
      const { x, y } = f;
      switch (f.k) {
        case 'hit': this.burst(x, y, 0.9, 6, f.team === 'E' ? 0xff6b6b : 0xffb347, 2.5, 1.5); break;
        case 'boom': this.burst(x, y, 0.6, 26, 0x9a7a4a, 4, 3); this.burst(x, y, 0.8, 10, 0xd0c8b0, 2, 2, 1, 1.2); this.addShake(x, y, myPos, 0.25); break;
        case 'chop': this.burst(x, y, 1.0, 5, 0x6fbf5a, 1.8, 1.5, 4); break;
        case 'deplete': this.burst(x, y, 0.8, 10, 0xa0d070, 2, 2); break;
        case 'built': this.burst(x, y, 0.4, 16, 0x9ff7e4, 1.2, 3, 0.5, 1.1); break;
        case 'death': this.burst(x, y, 0.8, 30, 0x9ff7e4, 2, 3, 1, 1.4); this.ring(x, y, 0xffffff, 2.5, 0.7); break;
        case 'level': this.ring(x, y, 0xffd23f, 2.2, 0.8); this.burst(x, y, 0.5, 20, 0xffd23f, 1, 4, 1, 1.2); break;
        case 'bolt': this.beam(x, y, 0xb388ff, 0.35, 0.18); this.burst(x, y, 0.2, 24, 0xd6c2ff, 4, 3); this.ring(x, y, 0xb388ff, 2.5, 0.4); this.addShake(x, y, myPos, 0.2); break;
        case 'smash': this.ring(x, y, 0xc8a070, 2.6, 0.45); this.burst(x, y, 0.3, 24, 0x9a7a4a, 5, 2.5); this.addShake(x, y, myPos, 0.35); break;
        case 'faro': this.ring(x, y, 0xff3b3b, 34, 1.4, 0.15); break;
        case 'roar': this.ring(x, y, 0xff8a1f, 7, 0.7); this.addShake(x, y, myPos, 0.6); break;
        case 'trap': this.burst(x, y, 0.3, 18, f.v === 'runa' ? 0xff6b3d : 0xbbbbbb, 3, 3); if (f.v === 'runa') this.ring(x, y, 0xff6b3d, 2.5, 0.5); break;
        case 'dash': this.burst(x, y, 0.3, 12, 0xffffff, 2, 1, 3, 0.4); break;
        case 'revive': this.beam(x, y, 0xfff2a8, 1.2, 0.6); this.burst(x, y, 0.3, 30, 0xfff2a8, 1, 5, 0.5, 1.5); break;
        case 'evolve': this.beam(x, y, 0xff5a1f, 1.5, 0.9); this.ring(x, y, 0xff5a1f, 5, 1); this.addShake(x, y, myPos, 0.6); break;
        default: break;
      }
    }
  }
  addShake(x, y, myPos, amt) {
    if (!myPos) return;
    const d = Math.hypot(myPos.x - x, myPos.y - y);
    if (d < 14) this.shake = Math.min(1, this.shake + amt * (1 - d / 14));
  }

  // ---------------------------------------------------------------- entidades
  syncBuildings(world) {
    const team = world.team();
    for (const [id, o] of this.blds) {
      const b = world.buildings.get(id);
      if (!b || b.type !== o.type) { this.dyn.remove(o.g); this.blds.delete(id); }
    }
    for (const b of world.buildings.values()) {
      let o = this.blds.get(b.id);
      if (!o) {
        const g = makeBuilding(b.type, b.w, b.h);
        g.position.set(b.x, 0, b.y);
        const def = BUILDINGS[b.type];
        g.traverse((m) => { if (m.isMesh) { m.castShadow = this.q.shadows && !def.walkable; m.receiveShadow = true; } });
        this.dyn.add(g);
        o = { g, type: b.type, bar: this.makeBar(), owner: b.owner };
        g.add(o.bar); o.bar.position.set(b.w / 2, g.userData.height + 0.4, b.h / 2);
        this.blds.set(b.id, o);
      }
      const inner = o.g.userData.inner;
      inner.scale.y = 0.15 + 0.85 * b.progress;
      const def = BUILDINGS[b.type];
      if (def.trap) inner.position.y = b.trapReady && b.progress >= 1 ? 0 : -0.06;
      const show = b.hp < b.maxHp - 1 || b.progress < 1;
      const barColor = b.progress < 1 ? 0x7fd4ff : team === 'E' ? 0x5fd46a : 0xff5a4f;
      this.setBar(o.bar, b.progress < 1 ? b.progress : b.hp / b.maxHp, barColor, show);
    }
  }

  makeBar() {
    const g = new THREE.Group();
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.12), new THREE.MeshBasicMaterial({ color: 0x111111, depthTest: false, transparent: true, opacity: 0.7 }));
    const fg = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.12), new THREE.MeshBasicMaterial({ color: 0x5fd46a, depthTest: false }));
    fg.position.z = 0.001;
    bg.renderOrder = 10; fg.renderOrder = 11;
    g.add(bg, fg); g.renderOrder = 10;
    return g;
  }
  setBar(bar, f, color, visible = true) {
    bar.visible = visible;
    if (!visible) return;
    f = Math.max(0, Math.min(1, f));
    const fg = bar.children[1];
    fg.scale.x = f; fg.position.x = -(1 - f) / 2;
    fg.material.color.setHex(color);
    bar.quaternion.copy(this.camera.quaternion);
    if (bar.parent) { const pq = new THREE.Quaternion(); bar.parent.getWorldQuaternion(pq); bar.quaternion.premultiply(pq.invert()); }
  }

  syncUnits(world, dt) {
    const team = world.team();
    const myId = world.me ? world.me.uid : -1;
    for (const [id, o] of this.units) if (!world.units.has(id)) { this.dyn.remove(o.g); this.units.delete(id); }
    for (const u of world.units.values()) {
      const dead = !!(u.flags & 16), anc = !!(u.flags & 8);
      const key = `${u.team}${u.cls}${anc}${dead}${u.skin}`;
      let o = this.units.get(u.id);
      if (!o || o.key !== key) {
        if (o) this.dyn.remove(o.g);
        const g = dead ? makeSpirit() : u.team === 'E' ? makeElf(u.skin || 0) : makeTroll(u.cls, anc);
        g.traverse((m) => { if (m.isMesh) { m.material = m.material.clone(); m.castShadow = this.q.shadows; } });
        const bar = this.makeBar(); bar.scale.set(1.1, 1.3, 1); g.add(bar);
        bar.position.y = (g.userData.height || 1.5) / g.scale.y + 0.35;
        this.dyn.add(g);
        o = { g, key, bar, rx: u.x, ry: u.y, rf: u.face, walk: 0, opacity: 1 };
        this.units.set(u.id, o);
      }
      const k = Math.min(1, dt * 14);
      if (Math.hypot(u.x - o.rx, u.y - o.ry) > 4) { o.rx = u.x; o.ry = u.y; }
      o.rx += (u.x - o.rx) * k; o.ry += (u.y - o.ry) * k;
      let df = u.face - o.rf; while (df > Math.PI) df -= Math.PI * 2; while (df < -Math.PI) df += Math.PI * 2;
      o.rf += df * Math.min(1, dt * 12);
      const g = o.g; const ud = g.userData;
      g.position.set(o.rx, 0, o.ry);
      g.rotation.y = Math.PI / 2 - o.rf;
      // Animação procedural
      if (ud.body) {
        const walking = u.state === 'walk';
        o.walk += dt * (walking ? 11 : 0);
        const sw = walking ? Math.sin(o.walk) : 0;
        ud.legL.rotation.x = sw * 0.7; ud.legR.rotation.x = -sw * 0.7;
        ud.body.position.y = walking ? Math.abs(Math.sin(o.walk)) * 0.06 : Math.sin(this.time * 2 + u.id) * 0.015;
        const atk = u.state === 'attack', work = u.state === 'harvest' || u.state === 'build';
        ud.body.rotation.x = atk ? 0.25 + Math.sin(this.time * 18) * 0.15 : work ? 0.2 + Math.sin(this.time * 9) * 0.12 : 0;
        if (ud.armR) {
          ud.armR.rotation.x = atk ? -1.2 + Math.sin(this.time * 16) * 1.0 : -sw * 0.5;
          ud.armL.rotation.x = atk ? -0.6 : sw * 0.5;
        }
        if (u.state === 'stun') ud.body.rotation.z = Math.sin(this.time * 10) * 0.2; else ud.body.rotation.z = 0;
      } else {
        g.position.y = 0.1 + Math.sin(this.time * 3) * 0.08;
      }
      // Furtividade: aliado vê translúcido
      const stealth = !!(u.flags & 1);
      const target = dead ? 0.7 : stealth ? 0.35 : 1;
      if (Math.abs(o.opacity - target) > 0.01) {
        o.opacity += (target - o.opacity) * Math.min(1, dt * 8);
        g.traverse((m) => { if (m.isMesh && m !== o.bar.children[0] && m !== o.bar.children[1]) { m.material.transparent = o.opacity < 0.99; m.material.opacity = o.opacity; } });
      }
      const color = u.id === myId ? 0xd8ff5a : u.team === team ? 0x5fd46a : 0xff5a4f;
      this.setBar(o.bar, u.hp / u.maxHp, color, !dead);
    }
  }

  syncProj(world) {
    const seen = new Set();
    for (const [id, x, y, kind] of world.proj) {
      seen.add(id);
      let o = this.projs.get(id);
      if (!o) {
        const m = kind === 'arrow'
          ? new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 4).rotateX(Math.PI / 2), mat(0xe8d9a8))
          : new THREE.Mesh(GEO.sph, new THREE.MeshBasicMaterial({ color: kind === 'arcane' ? 0xb388ff : 0x7dff8a }));
        if (kind !== 'arrow') m.scale.setScalar(0.3);
        m.position.set(x, 0.9, y);
        this.dyn.add(m); o = { m, x, y }; this.projs.set(id, o);
      }
      const dx = x - o.m.position.x, dz = y - o.m.position.z;
      if (Math.hypot(dx, dz) > 0.01) o.m.lookAt(x + dx, 0.9, y + dz);
      o.m.position.set(x, 0.9, y);
      if (kind !== 'arrow' && Math.random() < 0.5) this.burst(x, y, 0.9, 1, kind === 'arcane' ? 0xb388ff : 0x7dff8a, 0.3, 0.3, 0, 0.3);
    }
    for (const [id, o] of this.projs) if (!seen.has(id)) { this.dyn.remove(o.m); this.projs.delete(id); }
  }

  // ---------------------------------------------------------------- holograma de construção
  setGhost(type, x, y, w, h, valid, range = 0) {
    if (!type) { if (this.ghost) this.ghost.visible = false; return; }
    if (!this.ghost || this.ghostType !== `${type}${w}${h}`) {
      if (this.ghost) this.dyn.remove(this.ghost);
      const g = makeBuilding(type, w, h);
      this.ghostMat = new THREE.MeshBasicMaterial({ color: 0x5fffb0, transparent: true, opacity: 0.45, depthWrite: false });
      g.traverse((m) => { if (m.isMesh) { m.material = this.ghostMat; m.castShadow = false; } });
      const base = new THREE.Mesh(new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2).translate(w / 2, 0.03, h / 2), this.ghostMat);
      g.add(base);
      if (range) {
        const r = new THREE.Mesh(new THREE.RingGeometry(range - 0.06, range, 48).rotateX(-Math.PI / 2).translate(w / 2, 0.05, h / 2), this.ghostMat);
        g.add(r);
      }
      this.ghost = g; this.ghostType = `${type}${w}${h}`; this.dyn.add(g);
    }
    this.ghost.visible = true;
    this.ghost.position.set(x, 0, y);
    this.ghostMat.color.setHex(valid ? 0x5fffb0 : 0xff4a4a);
    this.ghostMat.opacity = 0.35 + Math.sin(this.time * 6) * 0.12;
  }

  pickGround(cx, cy) {
    const nd = new THREE.Vector2((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(nd, this.camera);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.ground, p)) return null;
    return { x: p.x, y: p.z };
  }

  setMood(world) {
    const ph = world.phase, ev = world.event && world.event.k;
    let sky = 0x9db8e0, sun = 0xd6e2ff, fog = 0x15282c, dens = this.q.fog;
    if (ph === 3) { sky = 0x9a96c8; fog = 0x1a1a34; }
    if (ph === 4) { sky = 0xb88090; sun = 0xffc0b0; fog = 0x2a141a; }
    if (ev === 'lua_sangue') { sky = 0xc05050; sun = 0xff7a6a; fog = 0x2a0c0c; }
    if (ev === 'nevoa') { fog = 0x3a4448; dens *= 2.2; }
    if (ev === 'tempestade') { sky = 0x6a6aa8; fog = 0x101028; }
    const k = 0.02;
    this.hemi.color.lerp(new THREE.Color(sky), k);
    this.sun.color.lerp(new THREE.Color(sun), k);
    this.fogColor.lerp(new THREE.Color(fog), k);
    this.scene.fog.color.copy(this.fogColor); this.scene.background.copy(this.fogColor);
    this.scene.fog.density += (dens - this.scene.fog.density) * k;
  }

  render(dt, world, focus) {
    this.time += dt;
    if (world) {
      this.syncBuildings(world);
      this.syncUnits(world, dt);
      this.syncProj(world);
      this.setMood(world);
      if (this.cage) this.cage.visible = world.phase === 1;
      for (const o of this.blds.values()) o.g.traverse((m) => { if (m.userData.spin) m.rotation.y += dt * 1.5; });
    }
    if (focus) this.focus.lerp(new THREE.Vector3(focus.x, 0, focus.y), Math.min(1, dt * 6));
    const z = this.zoom;
    const shx = (Math.random() - 0.5) * this.shake * 0.6, shz = (Math.random() - 0.5) * this.shake * 0.6;
    this.shake = Math.max(0, this.shake - dt * 2);
    this.camera.position.set(this.focus.x + shx, 13 * z, this.focus.z + 9 * z + shz);
    this.camera.lookAt(this.focus.x, 0, this.focus.z - 0.5);
    this.sun.position.set(this.focus.x - 18, 40, this.focus.z + 14);
    this.sun.target.position.copy(this.focus);
    if (this.waterMat) this.waterMat.emissiveIntensity = 0.8 + Math.sin(this.time * 1.5) * 0.25;
    if (this.fireflies) {
      const a = this.fireflies.geometry.attributes.position;
      this.fireflySeeds.forEach(([ox, oz, ph], k) => {
        a.setXYZ(k, this.focus.x + ox + Math.sin(this.time * 0.5 + ph) * 1.5, 0.8 + Math.sin(this.time * 1.3 + ph) * 0.5, this.focus.z + oz + Math.cos(this.time * 0.4 + ph) * 1.5);
      });
      a.needsUpdate = true;
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]; r.t += dt; const f = r.t / r.dur;
      r.m.scale.setScalar(0.2 + f * r.maxR); r.m.material.opacity = 0.9 * (1 - f);
      if (f >= 1) { this.dyn.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); this.rings.splice(i, 1); }
    }
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i]; b.t += dt; const f = b.t / b.dur;
      b.m.material.opacity = 0.9 * (1 - f); b.m.scale.x = b.m.scale.z = 1 - f * 0.7;
      if (f >= 1) { this.dyn.remove(b.m); b.m.geometry.dispose(); b.m.material.dispose(); this.beams.splice(i, 1); }
    }
    this.updateParticles(dt);
    this.gl.render(this.scene, this.camera);
  }

  project(x, y, h = 1.5) {
    const v = new THREE.Vector3(x, h, y).project(this.camera);
    return { x: (v.x + 1) / 2 * window.innerWidth, y: (1 - v.y) / 2 * window.innerHeight, vis: v.z < 1 };
  }

  dispose() { this.gl.dispose(); }
}
