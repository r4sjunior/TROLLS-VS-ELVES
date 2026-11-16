// Perfil do jogador salvo no aparelho: nível de conta, conquistas, skins, estatísticas e recompensa diária.
// Tudo é cosmético — nenhuma vantagem competitiva é desbloqueada ou vendida.
const KEY = 'rp_profile_v1';

export const ACHIEVEMENTS = [
  { id: 'primeira', name: 'Primeiros Passos', desc: 'Termine uma partida.' },
  { id: 'sobrevivente', name: 'Sobrevivente', desc: 'Vença como elfo.' },
  { id: 'cacada', name: 'Caçada Completa', desc: 'Vença como troll.' },
  { id: 'arquiteto', name: 'Arquiteto', desc: 'Construa 40 estruturas em uma partida.' },
  { id: 'lenhador', name: 'Lenhador', desc: 'Colete 500 de madeira em uma partida.' },
  { id: 'demolidor', name: 'Demolidor', desc: 'Destrua 30 construções em uma partida.' },
  { id: 'predador', name: 'Predador', desc: 'Abata 3 elfos em uma partida.' },
  { id: 'ancestral', name: 'Sangue Ancestral', desc: 'Evolua para Troll Ancestral.' },
  { id: 'intocavel', name: 'Intocável', desc: 'Vença como elfo sem morrer.' },
  { id: 'veterano', name: 'Veterano', desc: 'Jogue 10 partidas.' },
  { id: 'cacatroll', name: 'Caça-Trolls', desc: 'Abata um troll como elfo.' },
  { id: 'fiel', name: 'Fiel à Floresta', desc: 'Resgate 5 recompensas diárias.' },
];

// Skins por nível de conta (só visual)
export const SKIN_UNLOCK = [1, 2, 4, 6, 9, 12];

const DEFAULT = {
  name: '', level: 1, xp: 0, skin: 0,
  totals: { matches: 0, winsE: 0, winsT: 0, kills: 0, built: 0, destroyed: 0, survived: 0, deaths: 0 },
  achievements: {}, daily: { last: '', streak: 0, claimed: 0 }, history: [],
  settings: { quality: 'media', volume: 0.6, server: '', leftHanded: false },
};

export function loadProfile() {
  let p = null;
  try { p = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { p = null; }
  const base = structuredClone(DEFAULT);
  if (!p) return base;
  return { ...base, ...p, totals: { ...base.totals, ...p.totals }, settings: { ...base.settings, ...p.settings }, daily: { ...base.daily, ...p.daily } };
}

export function saveProfile(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* armazenamento indisponível: segue sem salvar */ }
}

export const accountXpFor = (l) => 100 + l * 60;

export function addAccountXp(p, xp) {
  p.xp += xp; let ups = 0;
  while (p.xp >= accountXpFor(p.level)) { p.xp -= accountXpFor(p.level); p.level++; ups++; }
  return ups;
}

const today = () => new Date().toISOString().slice(0, 10);
export function dailyAvailable(p) { return p.daily.last !== today(); }
export function claimDaily(p) {
  if (!dailyAvailable(p)) return 0;
  const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  p.daily.streak = p.daily.last === y ? p.daily.streak + 1 : 1;
  p.daily.last = today(); p.daily.claimed++;
  const xp = 60 + Math.min(7, p.daily.streak) * 20;
  addAccountXp(p, xp);
  if (p.daily.claimed >= 5) p.achievements.fiel = p.achievements.fiel || Date.now();
  saveProfile(p);
  return xp;
}

// Aplica o resultado da partida ao perfil e devolve o resumo das recompensas
export function recordMatch(p, over, myPid) {
  const me = over.players.find((x) => x.id === myPid);
  if (!me) return { xp: 0, unlocked: [] };
  const won = me.team === over.winner;
  const s = me.stats;
  p.totals.matches++;
  if (won && me.team === 'E') p.totals.winsE++;
  if (won && me.team === 'T') p.totals.winsT++;
  p.totals.kills += s.kills; p.totals.built += s.built; p.totals.destroyed += s.destroyed; p.totals.deaths += s.deaths;
  p.totals.survived += me.team === 'E' ? s.survived : 0;
  const xp = 40 + (won ? 80 : 0) + s.kills * 15 + Math.floor(s.built * 1.5) + s.destroyed * 2 + Math.floor((me.team === 'E' ? s.survived : 0) / 10);
  const before = p.level;
  addAccountXp(p, xp);
  const check = {
    primeira: true,
    sobrevivente: won && me.team === 'E',
    cacada: won && me.team === 'T',
    arquiteto: s.built >= 40,
    lenhador: s.wood >= 500,
    demolidor: s.destroyed >= 30,
    predador: me.team === 'T' && s.kills >= 3,
    ancestral: me.ancestral,
    intocavel: won && me.team === 'E' && s.deaths === 0,
    veterano: p.totals.matches >= 10,
    cacatroll: me.team === 'E' && s.kills >= 1,
  };
  const unlocked = [];
  for (const [id, ok] of Object.entries(check)) if (ok && !p.achievements[id]) { p.achievements[id] = Date.now(); unlocked.push(id); }
  p.history.unshift({ at: Date.now(), team: me.team, won, time: over.time, kills: s.kills, built: s.built, destroyed: s.destroyed });
  p.history = p.history.slice(0, 30);
  saveProfile(p);
  return { xp, unlocked, levelUp: p.level > before, won };
}
