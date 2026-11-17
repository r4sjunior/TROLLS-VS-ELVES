// Modelos low-poly procedurais (sem assets externos). Todos olham para +Z.
import * as THREE from 'three';

const geo = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
  cylT: new THREE.CylinderGeometry(0.35, 0.5, 1, 8),
  cone: new THREE.ConeGeometry(0.5, 1, 8),
  cone4: new THREE.ConeGeometry(0.5, 1, 4),
  sph: new THREE.SphereGeometry(0.5, 10, 8),
  ico: new THREE.IcosahedronGeometry(0.5, 0),
  oct: new THREE.OctahedronGeometry(0.5, 0),
  dod: new THREE.DodecahedronGeometry(0.5, 0),
  torus: new THREE.TorusGeometry(0.4, 0.07, 6, 16),
};
export const GEO = geo;

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts }));
  return matCache.get(key);
}
const glow = (color, intensity = 1) => mat(color, { emissive: color, emissiveIntensity: intensity });

function part(g, m, sx, sy, sz, x = 0, y = 0, z = 0, parent) {
  const mesh = new THREE.Mesh(g, m);
  mesh.scale.set(sx, sy, sz); mesh.position.set(x, y, z);
  mesh.castShadow = true;
  if (parent) parent.add(mesh);
  return mesh;
}

export const ELF_SKINS = [
  { name: 'Guardião do Bosque', cloak: 0x2f6b4f, trim: 0xc8d9a0 },
  { name: 'Lua Prateada', cloak: 0x5b6fa8, trim: 0xe6eeff },
  { name: 'Folha de Outono', cloak: 0x9a4f2a, trim: 0xf2c46b },
  { name: 'Sombra Violeta', cloak: 0x4b2d6b, trim: 0xd7a6ff },
  { name: 'Aurora Boreal', cloak: 0x1f7d86, trim: 0x9ff7e4 },
  { name: 'Rubi Antigo', cloak: 0x7a1f35, trim: 0xffb3a7 },
];
export const TROLL_PAINTS = [0x000000, 0xb33a3a, 0xe0c060, 0x7fd4ff, 0xffffff];

export function makeElf(skinIdx = 0, ally = true) {
  const s = ELF_SKINS[skinIdx % ELF_SKINS.length];
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  const skin = mat(0xe9d2b6), cloak = mat(s.cloak), trim = mat(s.trim), dark = mat(0x2a2320);
  part(geo.cylT, cloak, 0.42, 0.6, 0.42, 0, 0.42, 0, body);          // túnica
  part(geo.box, trim, 0.44, 0.06, 0.44, 0, 0.5, 0, body);             // cinto
  part(geo.sph, skin, 0.3, 0.32, 0.3, 0, 0.92, 0, body);              // cabeça
  part(geo.cone, cloak, 0.38, 0.42, 0.38, 0, 1.12, -0.03, body);      // capuz
  part(geo.cone4, skin, 0.06, 0.22, 0.04, 0.17, 0.97, 0, body).rotation.z = -1.1; // orelhas
  part(geo.cone4, skin, 0.06, 0.22, 0.04, -0.17, 0.97, 0, body).rotation.z = 1.1;
  part(geo.sph, glow(0x9ff7e4, 0.8), 0.05, 0.05, 0.05, 0.07, 0.94, 0.14, body);
  part(geo.sph, glow(0x9ff7e4, 0.8), 0.05, 0.05, 0.05, -0.07, 0.94, 0.14, body);
  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.025, 4, 10, Math.PI), mat(0x6b4a2b));
  bow.position.set(0.26, 0.6, 0.08); bow.rotation.set(0, Math.PI / 2, Math.PI / 2); body.add(bow);
  const legL = part(geo.cyl, dark, 0.1, 0.24, 0.1, 0.09, 0.12, 0, g);
  const legR = part(geo.cyl, dark, 0.1, 0.24, 0.1, -0.09, 0.12, 0, g);
  g.scale.setScalar(1.3);
  g.userData = { body, legL, legR, kind: 'elf', height: 1.35 * 1.3 };
  return g;
}

const TROLL_COLORS = {
  cacador: { skin: 0x5f7d3a, gear: 0x6b4a2b, accent: 0xd8c27a },
  destruidor: { skin: 0x8a5a48, gear: 0x3a2a22, accent: 0xd0a070 },
  assassino: { skin: 0x4a3a5e, gear: 0x1e1a24, accent: 0xb44cff },
  xama: { skin: 0x2f7068, gear: 0xd9d0b5, accent: 0x6ff0d0 },
};

export function makeTroll(cls = 'cacador', ancestral = false) {
  const c = TROLL_COLORS[cls] || TROLL_COLORS.cacador;
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  const skin = mat(c.skin), gear = mat(c.gear), bone = mat(0xf0ead6), accent = mat(c.accent);
  const bulk = cls === 'destruidor' ? 1.25 : cls === 'assassino' ? 0.85 : 1;
  part(geo.sph, skin, 0.9 * bulk, 0.85, 0.75 * bulk, 0, 0.85, -0.05, body);   // tronco corcunda
  part(geo.box, gear, 0.85 * bulk, 0.18, 0.7 * bulk, 0, 0.55, 0, body);       // tanga/cinto
  const head = new THREE.Group(); head.position.set(0, 1.18, 0.32); body.add(head);
  part(geo.sph, skin, 0.42, 0.38, 0.45, 0, 0, 0, head);
  part(geo.cone, bone, 0.07, 0.24, 0.07, 0.12, -0.1, 0.18, head).rotation.x = -0.5;  // presas
  part(geo.cone, bone, 0.07, 0.24, 0.07, -0.12, -0.1, 0.18, head).rotation.x = -0.5;
  const eye = glow(ancestral ? 0xff5a1f : 0xffd23f, ancestral ? 1.6 : 0.9);
  part(geo.sph, eye, 0.07, 0.05, 0.05, 0.1, 0.06, 0.2, head);
  part(geo.sph, eye, 0.07, 0.05, 0.05, -0.1, 0.06, 0.2, head);
  part(geo.cone4, skin, 0.08, 0.32, 0.05, 0.24, 0.05, -0.02, head).rotation.z = -1.2; // orelhas
  part(geo.cone4, skin, 0.08, 0.32, 0.05, -0.24, 0.05, -0.02, head).rotation.z = 1.2;
  if (cls === 'xama') part(geo.ico, bone, 0.36, 0.3, 0.2, 0, 0.04, 0.16, head);       // máscara de osso
  if (ancestral) {
    part(geo.cone, bone, 0.1, 0.45, 0.1, 0.18, 0.28, -0.05, head).rotation.z = -0.4;   // chifres
    part(geo.cone, bone, 0.1, 0.45, 0.1, -0.18, 0.28, -0.05, head).rotation.z = 0.4;
  }
  const armL = new THREE.Group(); armL.position.set(0.45 * bulk, 1.05, 0.05); body.add(armL);
  const armR = new THREE.Group(); armR.position.set(-0.45 * bulk, 1.05, 0.05); body.add(armR);
  part(geo.cyl, skin, 0.2, 0.75, 0.2, 0, -0.35, 0, armL);
  part(geo.cyl, skin, 0.2, 0.75, 0.2, 0, -0.35, 0, armR);
  // arma por classe
  if (cls === 'destruidor') {
    part(geo.cyl, gear, 0.1, 0.8, 0.1, 0, -0.75, 0.25, armR).rotation.x = 1.2;
    part(geo.dod, mat(0x777777), 0.42, 0.42, 0.42, 0, -0.9, 0.62, armR);
  } else if (cls === 'assassino') {
    part(geo.cone4, accent, 0.06, 0.5, 0.04, 0, -0.8, 0.12, armR).rotation.x = 1.4;
    part(geo.cone4, accent, 0.06, 0.5, 0.04, 0, -0.8, 0.12, armL).rotation.x = 1.4;
  } else if (cls === 'xama') {
    part(geo.cyl, bone, 0.06, 1.5, 0.06, 0, -0.4, 0.15, armR);
    part(geo.oct, glow(c.accent, 1.2), 0.22, 0.3, 0.22, 0, 0.42, 0.15, armR);
  } else {
    part(geo.cyl, gear, 0.06, 1.6, 0.06, 0, -0.6, 0.3, armR).rotation.x = 1.3;
    part(geo.cone4, accent, 0.1, 0.3, 0.1, 0, -0.88, 1.08, armR).rotation.x = 1.3 + Math.PI / 2 - 0.1;
  }
  const legL = part(geo.cyl, skin, 0.26, 0.45, 0.26, 0.24 * bulk, 0.22, 0, g);
  const legR = part(geo.cyl, skin, 0.26, 0.45, 0.26, -0.24 * bulk, 0.22, 0, g);
  const scale = 1.2 * (cls === 'destruidor' ? 1.15 : cls === 'assassino' ? 0.92 : 1) * (ancestral ? 1.3 : 1);
  g.scale.setScalar(scale);
  g.userData = { body, legL, legR, armL, armR, head, kind: 'troll', height: 1.7 * scale };
  return g;
}

export function makeSpirit() {
  const g = new THREE.Group();
  part(geo.sph, mat(0x9ff7e4, { emissive: 0x4fd6c0, emissiveIntensity: 1, transparent: true, opacity: 0.55 }), 0.4, 0.55, 0.4, 0, 0.6, 0, g);
  part(geo.box, mat(0x55606a), 0.45, 0.6, 0.12, 0, 0.3, -0.4, g);
  g.userData = { kind: 'spirit', height: 1.2 };
  return g;
}

// ---------------------------------------------------------------- construções
const TIER = {
  wood: { c: 0x7a5534, top: 0x5c3d22 },
  stone: { c: 0x8a8f99, top: 0x6b707a },
  crystal: { c: 0x7fe0ff, top: 0xb9f2ff },
};

function wallTier(type) {
  if (type.includes('cristal')) return 'crystal';
  if (type.includes('pedra') || type.includes('ferro')) return 'stone';
  return 'wood';
}

export function makeBuilding(type, w, h) {
  const g = new THREE.Group();
  const inner = new THREE.Group(); g.add(inner);
  const cx = w / 2, cz = h / 2;
  inner.position.set(cx, 0, cz);
  const t = TIER[wallTier(type)];
  const tierMat = wallTier(type) === 'crystal' ? mat(t.c, { emissive: 0x2a8fb0, emissiveIntensity: 0.5 }) : mat(t.c);
  const silver = mat(0xc9d3d6), leaf = mat(0x2f6b4f), wood = mat(0x7a5534), stone = mat(0x8a8f99), dark = mat(0x3a3530);
  switch (type) {
    case 'muro': case 'muro_pedra': case 'muro_cristal':
      part(geo.box, tierMat, 0.96, 0.95, 0.96, 0, 0.475, 0, inner);
      part(geo.box, mat(t.top), 1.0, 0.12, 1.0, 0, 0.98, 0, inner);
      if (type === 'muro') for (let i = -1; i <= 1; i++) part(geo.cone, mat(t.top), 0.18, 0.3, 0.18, i * 0.3, 1.18, 0, inner);
      break;
    case 'muralha': case 'muralha_pedra': {
      part(geo.box, tierMat, w - 0.04, 1.1, h - 0.04, 0, 0.55, 0, inner);
      const n = 3;
      for (let i = 0; i < n; i++) {
        const o = (i - 1) * (Math.max(w, h) / 3);
        part(geo.box, mat(t.top), 0.5, 0.3, 0.5, w > h ? o : 0, 1.25, w > h ? 0 : o, inner);
      }
      break;
    }
    case 'portao': case 'portao_ferro':
      part(geo.box, tierMat, 0.22, 1.3, 0.9, 0.38, 0.65, 0, inner);
      part(geo.box, tierMat, 0.22, 1.3, 0.9, -0.38, 0.65, 0, inner);
      part(geo.box, mat(type === 'portao' ? 0x3f8f7a : 0x4a4f58), 0.56, 0.95, 0.12, 0, 0.48, 0, inner);
      part(geo.torus, silver, 1, 1, 1, 0, 1.3, 0, inner);
      break;
    case 'torre': case 'torre_arcana': {
      const arc = type === 'torre_arcana';
      part(geo.cylT, arc ? mat(0x6c5a9e) : silver, 0.8, 1.9, 0.8, 0, 0.95, 0, inner);
      part(geo.cyl, wood, 1.0, 0.15, 1.0, 0, 1.95, 0, inner);
      part(geo.cone, arc ? mat(0x3b2a6b) : leaf, 1.05, 0.9, 1.05, 0, 2.5, 0, inner);
      if (arc) part(geo.oct, glow(0xb388ff, 1.4), 0.35, 0.5, 0.35, 0, 3.15, 0, inner);
      else part(geo.sph, glow(0x9ff7e4, 1), 0.12, 0.12, 0.12, 0, 3.0, 0, inner);
      break;
    }
    case 'vigia':
      part(geo.cone4, stone, 0.5, 1.8, 0.5, 0, 0.9, 0, inner);
      part(geo.box, glow(0x7fffd4, 1.2), 0.08, 0.5, 0.26, 0.0, 0.9, 0.12, inner);
      break;
    case 'espinhos':
      part(geo.box, dark, 0.9, 0.06, 0.9, 0, 0.03, 0, inner);
      for (let i = 0; i < 9; i++) part(geo.cone4, mat(0xb0b0b0), 0.12, 0.3, 0.12, (i % 3 - 1) * 0.28, 0.16, (Math.floor(i / 3) - 1) * 0.28, inner);
      break;
    case 'raizes':
      part(geo.box, mat(0x3b2a1a), 0.9, 0.05, 0.9, 0, 0.03, 0, inner);
      for (let i = 0; i < 3; i++) { const r = part(geo.torus, mat(0x6b4a2b), 0.9, 0.9, 0.9, 0, 0.08, 0, inner); r.rotation.set(Math.PI / 2, 0, i); }
      break;
    case 'runa':
      part(geo.cyl, mat(0x2a2240), 0.9, 0.04, 0.9, 0, 0.02, 0, inner);
      part(geo.torus, glow(0xff6b3d, 1.4), 1.0, 1.0, 1.0, 0, 0.06, 0, inner).rotation.x = Math.PI / 2;
      break;
    case 'refugio':
      part(geo.cyl, mat(0x4f3a28), 1.7, 0.12, 1.7, 0, 0.06, 0, inner);
      part(geo.cone, mat(0x3f7f5f), 1.9, 1.7, 1.9, 0, 0.95, 0, inner);
      part(geo.cone, mat(0xc8d9a0), 0.5, 0.5, 0.5, 0, 1.95, 0, inner);
      part(geo.box, dark, 0.5, 0.7, 0.1, 0, 0.35, 0.85, inner);
      break;
    case 'deposito':
      part(geo.box, wood, 1.8, 0.9, 1.6, 0, 0.45, 0, inner);
      part(geo.cone4, mat(0x5c3d22), 1.9, 0.8, 1.9, 0, 1.3, 0, inner).rotation.y = Math.PI / 4;
      part(geo.box, mat(0x9a7a4a), 0.5, 0.5, 0.5, 0.75, 0.25, 0.85, inner);
      part(geo.box, mat(0x9a7a4a), 0.4, 0.4, 0.4, -0.7, 0.2, 0.9, inner);
      break;
    case 'serraria': {
      part(geo.box, wood, 1.7, 1.0, 1.4, 0, 0.5, -0.1, inner);
      part(geo.cone4, leaf, 1.8, 0.7, 1.8, 0, 1.35, -0.1, inner).rotation.y = Math.PI / 4;
      const saw = part(new THREE.CylinderGeometry(0.45, 0.45, 0.06, 12), silver, 1, 1, 1, 0.7, 0.6, 0.75, inner);
      saw.rotation.z = Math.PI / 2; saw.userData.spin = true;
      break;
    }
    case 'extrator':
      part(geo.cylT, stone, 1.8, 0.8, 1.8, 0, 0.4, 0, inner);
      part(geo.ico, glow(0xffc93c, 0.8), 0.7, 0.7, 0.7, 0, 1.1, 0, inner).userData.spin = true;
      part(geo.box, wood, 0.15, 1.6, 0.15, 0.7, 0.8, 0.7, inner);
      part(geo.box, wood, 0.15, 1.6, 0.15, -0.7, 0.8, -0.7, inner);
      break;
    case 'arvore':
      part(geo.cylT, mat(0x5b4636), 0.6, 2.2, 0.6, 0, 1.1, 0, inner);
      part(geo.sph, glow(0x4fd6c0, 0.45), 1.9, 1.3, 1.9, 0, 2.6, 0, inner);
      part(geo.sph, glow(0x7fffd4, 0.6), 1.2, 0.9, 1.2, 0.2, 3.3, 0.1, inner);
      for (let i = 0; i < 5; i++) part(geo.oct, glow(0xb388ff, 1.3), 0.14, 0.2, 0.14, Math.cos(i * 1.3) * 0.9, 0.2, Math.sin(i * 1.3) * 0.9, inner);
      break;
    case 'altar':
      part(geo.cylT, stone, 1.8, 0.4, 1.8, 0, 0.2, 0, inner);
      for (let i = 0; i < 4; i++) part(geo.box, stone, 0.25, 1.1, 0.25, Math.cos(i * Math.PI / 2 + 0.78) * 0.75, 0.75, Math.sin(i * Math.PI / 2 + 0.78) * 0.75, inner);
      part(geo.oct, glow(0xfff2a8, 1.4), 0.45, 0.65, 0.45, 0, 1.6, 0, inner).userData.spin = true;
      break;
    default:
      part(geo.box, mat(0xff00ff), w, 1, h, 0, 0.5, 0, inner);
  }
  g.userData = { inner, height: { torre: 3.2, torre_arcana: 3.4, arvore: 3.8 }[type] || 1.6 };
  return g;
}

// ---------------------------------------------------------------- recursos e cenário (geometrias para InstancedMesh)
export function treeGeometries() {
  const trunk = new THREE.CylinderGeometry(0.07, 0.13, 0.8, 6); trunk.translate(0, 0.4, 0);
  // Pinheiro em 3 camadas, cada uma girada para quebrar a simetria
  const c1 = new THREE.ConeGeometry(0.6, 0.95, 7); c1.rotateY(0.3); c1.translate(0, 0.95, 0);
  const c2 = new THREE.ConeGeometry(0.47, 0.85, 7); c2.rotateY(0.9); c2.translate(0.02, 1.42, -0.02);
  const c3 = new THREE.ConeGeometry(0.31, 0.7, 7); c3.rotateY(1.7); c3.translate(-0.02, 1.85, 0.01);
  const crown = mergeSimple([c1, c2, c3]);
  return { trunk, crown };
}

export function mergeSimple(geos) {
  const pos = [], norm = [];
  for (const g0 of geos) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    pos.push(...g.attributes.position.array); norm.push(...g.attributes.normal.array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  return out;
}
