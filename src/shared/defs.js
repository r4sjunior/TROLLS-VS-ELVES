// Definições de dados do jogo. Tudo que é "número de balanceamento" mora aqui,
// para que servidor, cliente e testes usem exatamente os mesmos valores.

// Versão do protocolo/simulação: cliente e servidor precisam ser iguais (o mapa é gerado dos dois lados).
// Aumente sempre que mudar mapgen, regras ou o formato dos snapshots.
export const PROTOCOL = 5;

export const TICK_RATE = 20;
export const DT = 1 / TICK_RATE;

export const TILE = {
  GRASS: 0,   // campo aberto: anda e constrói
  FOREST: 1,  // árvore: bloqueia; elfo extrai madeira; troll pode derrubar
  ROCK: 2,    // montanha: bloqueia tudo
  WATER: 3,   // rio: bloqueia tudo
  GOLD: 4,    // veio de ouro: bloqueia; elfo minera
  CRYSTAL: 5, // cristal mágico: bloqueia; elfo extrai
  RUIN: 6,    // ruína antiga: anda e constrói
  CAVE: 7,    // caverna: anda e constrói; esconde quem está dentro
  SPAWN: 8,   // covil dos trolls: anda, não constrói
};

export const WALKABLE = new Set([TILE.GRASS, TILE.RUIN, TILE.CAVE, TILE.SPAWN]);
export const BUILDABLE = new Set([TILE.GRASS, TILE.RUIN, TILE.CAVE]);

export const RESOURCE_AMOUNT = {
  [TILE.FOREST]: 45,
  [TILE.GOLD]: 260,
  [TILE.CRYSTAL]: 36,
};

// Taxa base de coleta por segundo
export const HARVEST_RATE = { wood: 4.5, gold: 2.5, crystal: 0.55 };

export const MATCH_PRESETS = {
  curta:  { duration: 8 * 60,  prep: 60 },
  padrao: { duration: 12 * 60, prep: 80 },
  longa:  { duration: 18 * 60, prep: 100 },
};

// Fases como fração da partida (após a preparação)
export const PHASES = [
  { id: 1, name: 'Preparação' },
  { id: 2, name: 'Sobrevivência' },
  { id: 3, name: 'Caçada Intensa' },
  { id: 4, name: 'Confronto Final' },
];

export const BUILD_CATEGORIES = [
  { id: 'defesa', name: 'Defesa' },
  { id: 'torres', name: 'Torres' },
  { id: 'armadilhas', name: 'Armadilhas' },
  { id: 'economia', name: 'Economia' },
  { id: 'especiais', name: 'Especiais' },
];

// w/h em tiles. rot = pode girar 90°. upgradeOnly = só existe via melhoria.
// req = exige Árvore Ancestral concluída em qualquer elfo da equipe.
export const BUILDINGS = {
  muro: { name: 'Muro de Madeira', cat: 'defesa', w: 1, h: 1, cost: { wood: 8 }, time: 1.5, hp: 300, armor: 1, upgrade: 'muro_pedra' },
  muro_pedra: { name: 'Muro de Pedra', cat: 'defesa', w: 1, h: 1, cost: { wood: 14, gold: 8 }, time: 2, hp: 800, armor: 3, upgradeOnly: true, upgrade: 'muro_cristal' },
  muro_cristal: { name: 'Muro de Cristal', cat: 'defesa', w: 1, h: 1, cost: { gold: 22, crystal: 3 }, time: 3, hp: 1900, armor: 5, upgradeOnly: true, req: 'arvore' },
  muralha: { name: 'Muralha Longa', cat: 'defesa', w: 3, h: 1, rot: true, cost: { wood: 22 }, time: 3, hp: 900, armor: 1, upgrade: 'muralha_pedra' },
  muralha_pedra: { name: 'Muralha de Pedra', cat: 'defesa', w: 3, h: 1, rot: true, cost: { wood: 36, gold: 20 }, time: 4, hp: 2300, armor: 3, upgradeOnly: true },
  portao: { name: 'Portão Élfico', cat: 'defesa', w: 1, h: 1, cost: { wood: 18, gold: 4 }, time: 2.5, hp: 450, armor: 2, gate: true, upgrade: 'portao_ferro' },
  portao_ferro: { name: 'Portão Reforçado', cat: 'defesa', w: 1, h: 1, cost: { wood: 20, gold: 18 }, time: 3, hp: 1200, armor: 4, gate: true, upgradeOnly: true },

  torre: { name: 'Torre Arqueira', cat: 'torres', w: 1, h: 1, cost: { wood: 30, gold: 12 }, time: 5, hp: 340, armor: 1, tower: { range: 6.5, dmg: 12, rate: 1.0 }, vision: 8, upgrade: 'torre_arcana' },
  torre_arcana: { name: 'Torre Arcana', cat: 'torres', w: 1, h: 1, cost: { gold: 35, crystal: 5 }, time: 6, hp: 650, armor: 2, tower: { range: 7.5, dmg: 26, rate: 1.1, slow: 0.35 }, vision: 9, upgradeOnly: true, req: 'arvore' },
  vigia: { name: 'Pedra Vigia', cat: 'torres', w: 1, h: 1, cost: { gold: 14, crystal: 1 }, time: 3, hp: 160, armor: 2, vision: 13, detect: true },

  espinhos: { name: 'Armadilha de Espinhos', cat: 'armadilhas', w: 1, h: 1, cost: { wood: 12, gold: 6 }, time: 2, hp: 120, armor: 0, trap: { dmg: 75, root: 0, rearm: 7 }, walkable: true, hidden: true },
  raizes: { name: 'Raízes Prendedoras', cat: 'armadilhas', w: 1, h: 1, cost: { wood: 16, gold: 10 }, time: 2.5, hp: 140, armor: 0, trap: { dmg: 25, root: 2.5, rearm: 10 }, walkable: true, hidden: true },
  runa: { name: 'Runa Explosiva', cat: 'armadilhas', w: 1, h: 1, cost: { gold: 24, crystal: 3 }, time: 3, hp: 100, armor: 0, trap: { dmg: 200, root: 0, aoe: 2.5, once: true }, walkable: true, hidden: true, req: 'arvore' },

  refugio: { name: 'Refúgio', cat: 'economia', w: 2, h: 2, cost: { wood: 30 }, time: 4, hp: 480, armor: 1, income: { gold: 0.8 }, heal: { radius: 3.2, rate: 5 } },
  deposito: { name: 'Depósito', cat: 'economia', w: 2, h: 2, cost: { wood: 40, gold: 10 }, time: 4, hp: 520, armor: 1, aura: { harvest: 0.6, radius: 9 } },
  serraria: { name: 'Serraria', cat: 'economia', w: 2, h: 2, cost: { wood: 35, gold: 25 }, time: 5, hp: 500, armor: 1, income: { wood: 1.5 } },
  extrator: { name: 'Extrator de Ouro', cat: 'economia', w: 2, h: 2, cost: { wood: 60, gold: 30 }, time: 6, hp: 560, armor: 2, income: { gold: 2.0 } },

  arvore: { name: 'Árvore Ancestral', cat: 'especiais', w: 2, h: 2, cost: { wood: 80, gold: 50, crystal: 3 }, time: 10, hp: 950, armor: 3, income: { crystal: 0.1 }, unlocks: true },
  ninho: { name: 'Ninho de Fadas', cat: 'economia', w: 2, h: 2, cost: { wood: 45, gold: 20 }, time: 5, hp: 420, armor: 1, gather: { radius: 4.5, rate: 1.4 } },
  oficina: { name: 'Oficina de Reparos', cat: 'economia', w: 2, h: 2, cost: { wood: 40, gold: 25 }, time: 5, hp: 520, armor: 2, autoRepair: { radius: 6.5, rate: 22 } },
  altar: { name: 'Altar de Renascimento', cat: 'especiais', w: 2, h: 2, cost: { gold: 70, crystal: 8 }, time: 8, hp: 750, armor: 3, revive: { delay: 20, cooldown: 45 }, req: 'arvore' },
};

export const BUILD_RANGE = 11; // distância máx. elfo → centro da obra
export const REPAIR_RATE = 40; // hp/s
export const REPAIR_WOOD_PER_HP = 1 / 18;
export const DEMOLISH_REFUND = 0.5;

// ---------------- Elfos ----------------
export const ELF = {
  hp: 170, speed: 4.4, radius: 0.32, vision: 9,
  atk: { range: 6.5, dmg: 9, rate: 0.85 },
  regen: 2.5,
  // Dano que elfos recebem de trolls (construções não são afetadas): dá tempo de fugir e reagir
  dmgTaken: 0.8,
};

export const ELF_ABILITIES = [
  { id: 'salto', name: 'Salto Élfico', cd: 8, level: 1, desc: 'Avança rápido na direção do movimento.' },
  { id: 'camuflagem', name: 'Camuflagem', cd: 26, level: 3, dur: 6, desc: 'Fica invisível para trolls por 6s.' },
];

export const ELF_UPGRADES = {
  coleta: { name: 'Mãos Ágeis', desc: '+30% coleta', max: 3, cost: (l) => ({ gold: 20 * (l + 1) }) },
  passos: { name: 'Passos Leves', desc: '+8% velocidade', max: 3, cost: (l) => ({ gold: 18 * (l + 1) }) },
  vigor: { name: 'Vigor Silvestre', desc: '+50 vida máxima', max: 3, cost: (l) => ({ gold: 25 * (l + 1) }) },
  arco: { name: 'Arco Lunar', desc: '+5 dano de flecha', max: 3, cost: (l) => ({ gold: 20 * (l + 1), crystal: l }) },
};

// ---------------- Trolls ----------------
export const TROLL_CLASSES = {
  cacador: {
    name: 'Caçador', desc: 'Rápido, rastreia elfos de longe.',
    hp: 900, speed: 4.6, radius: 0.48, vision: 12, armor: 2,
    atk: { range: 1.0, dmg: 30, rate: 0.9 }, bldMul: 1.0,
    abilities: [
      { id: 'faro', name: 'Faro', cd: 20, dur: 5, desc: 'Revela todos os elfos num raio de 50.' },
      { id: 'disparada', name: 'Disparada', cd: 12, dur: 3, desc: '+60% velocidade por 3s.' },
    ],
  },
  destruidor: {
    name: 'Destruidor', desc: 'Lento e resistente. Derruba fortalezas.',
    hp: 1500, speed: 3.6, radius: 0.6, vision: 9, armor: 4,
    atk: { range: 1.1, dmg: 26, rate: 1.1 }, bldMul: 2.6,
    abilities: [
      { id: 'esmagar', name: 'Esmagar', cd: 10, desc: 'Golpe em área: 160 de dano em construções.' },
      { id: 'furia', name: 'Fúria', cd: 18, dur: 5, desc: '+60% velocidade de ataque por 5s.' },
    ],
  },
  assassino: {
    name: 'Assassino', desc: 'Furtivo, golpes rápidos e letais.',
    hp: 760, speed: 4.3, radius: 0.42, vision: 10, armor: 1,
    atk: { range: 1.0, dmg: 42, rate: 0.6 }, bldMul: 0.7,
    abilities: [
      { id: 'sombra', name: 'Sombra', cd: 20, dur: 6, desc: 'Invisível por 6s; próximo golpe causa dano dobrado.' },
      { id: 'bote', name: 'Bote', cd: 9, desc: 'Salto de emboscada para a frente.' },
    ],
  },
  xama: {
    name: 'Xamã', desc: 'Magia de área à distância.',
    hp: 840, speed: 4.0, radius: 0.46, vision: 11, armor: 1,
    atk: { range: 5.0, dmg: 22, rate: 1.1, ranged: true }, bldMul: 1.3,
    abilities: [
      { id: 'relampago', name: 'Relâmpago', cd: 9, desc: 'Raio em área (r 2.5) no inimigo mais próximo.' },
      { id: 'ritual', name: 'Ritual', cd: 22, dur: 4, desc: 'Regenera 35% da vida em 4s.' },
    ],
  },
};

// Evolução: disponível a partir deste nível do troll
export const ANCESTRAL_LEVEL = 8;
export const ANCESTRAL = {
  name: 'Troll Ancestral', hpMul: 1.6, dmgMul: 1.35, speedMul: 1.08, radiusMul: 1.25, armor: 3,
  ability: { id: 'rugido', name: 'Rugido Ancestral', cd: 30, desc: 'Atordoa elfos próximos por 2s e revela todos por 5s.' },
};

// Loja do troll: cada nível custa o dobro do anterior
const doubling = (base) => (l) => ({ gold: base * 2 ** l });
export const TROLL_UPGRADES = {
  forca: { name: 'Lâmina Serrilhada', desc: '+15% dano', max: 6, cost: doubling(35) },
  pele: { name: 'Couraça de Pedra', desc: '+18% vida, +1 armadura', max: 6, cost: doubling(35) },
  emblema: { name: 'Emblema do Pântano', desc: '+0,6% vida/s de regeneração', max: 5, cost: doubling(30) },
  luvas: { name: 'Manoplas Ligeiras', desc: '+12% velocidade de ataque', max: 5, cost: doubling(40) },
  impeto: { name: 'Botas de Ímpeto', desc: '+6% velocidade', max: 4, cost: doubling(40) },
  garras: { name: 'Garras de Cerco', desc: '+30% dano em construções', max: 5, cost: doubling(45) },
};

// ---------------- Pós-morte: o elfo abatido escolhe um lado ----------------
// Espírito: continua com os elfos, atravessa construções, não pode ser atacado.
export const SPIRIT = {
  name: 'Espírito Guardião', hp: 200, speed: 5.2, radius: 0.3, vision: 11,
  repairRate: 26, // reparo grátis ao segurar Reparar
  abilities: [
    { id: 'bencao', name: 'Bênção', cd: 14, desc: 'Cura 35% da construção aliada mais próxima.' },
    { id: 'egide', name: 'Égide', cd: 30, dur: 6, desc: 'Construção mais próxima fica invulnerável por 6s.' },
    { id: 'geada', name: 'Geada', cd: 20, dur: 3, desc: 'Congela trolls num raio de 4: lentos e revelados por 3s.' },
  ],
};
// Lobo: passa para o lado dos trolls e caça junto com eles.
export const WOLF = {
  name: 'Lobo Sombrio', desc: 'Elfo que se rendeu à caçada.',
  hp: 520, speed: 5.0, radius: 0.42, vision: 11, armor: 1,
  atk: { range: 1.0, dmg: 18, rate: 0.75 }, bldMul: 0.8,
  abilities: [
    { id: 'uivo', name: 'Uivo', cd: 24, dur: 4, desc: 'Revela elfos num raio de 26 por 4s.' },
    { id: 'investida', name: 'Investida', cd: 9, desc: 'Salta para a frente.' },
  ],
};
export const AFTERLIFE_DELAY = 3;   // segundos até poder escolher
export const AFTERLIFE_TIMEOUT = 25; // sem escolha → vira Espírito

// ---------------- Baú do covil ----------------
// Valor cresce com o tempo. Trolls ganham o ouro de quem abatem + metade do baú;
// elfos corajosos podem saquear o baú dentro do covil.
export const BOUNTY = { start: 60, mul: 1.6, every: 120, stealCd: 90, stealRadius: 1.9 };
export const SUDDEN_DEATH_TEXT = 'Morte súbita: elfos sem Refúgio ficam visíveis para os trolls!';

export const TROLL_RESPAWN = 12;
export const TROLL_REGEN = 0.012; // fração da vida máx. por segundo fora de combate

export function xpForLevel(l) {
  return Math.round(40 * Math.pow(l, 1.45));
}

export const EVENTS = {
  lua_sangue: { name: 'Lua de Sangue', desc: 'Trolls +20% velocidade', dur: 35 },
  nevoa: { name: 'Névoa Antiga', desc: 'Visão de todos reduzida', dur: 35 },
  chuva_dourada: { name: 'Chuva Dourada', desc: 'Elfos vivos ganham ouro', dur: 1 },
  despertar: { name: 'Despertar da Floresta', desc: 'Árvores voltam a crescer', dur: 1 },
  tempestade: { name: 'Tempestade Arcana', desc: 'Raios atingem o mapa', dur: 25 },
};
