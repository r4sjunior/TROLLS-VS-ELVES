// Efeitos sonoros sintetizados com WebAudio (nenhum arquivo de áudio necessário).
let ctx = null, master = null, volume = 0.6;
const last = {};

export function initAudio() {
  if (ctx) return;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = volume; master.connect(ctx.destination);
  } catch { ctx = null; }
}
export function setVolume(v) { volume = v; if (master) master.gain.value = v; }
export function resumeAudio() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

function tone(freq, dur, type = 'sine', vol = 0.3, slide = 0, delay = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol = 0.3, freq = 1200, delay = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate); const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = ctx.createBufferSource(); s.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
  const g = ctx.createGain(); g.gain.value = vol;
  s.connect(f); f.connect(g); g.connect(master); s.start(t);
}

const SFX = {
  hit: () => { noise(0.08, 0.25, 900); tone(140, 0.08, 'square', 0.08, -60); },
  arrow: () => { noise(0.06, 0.12, 3000); },
  chop: () => { tone(220, 0.05, 'triangle', 0.15, -80); noise(0.04, 0.12, 1800); },
  build: () => { tone(520, 0.12, 'triangle', 0.15, 200); tone(780, 0.15, 'triangle', 0.1, 0, 0.08); },
  boom: () => { noise(0.5, 0.45, 500); tone(70, 0.4, 'sine', 0.3, -40); },
  level: () => { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.18, 'triangle', 0.15, 0, i * 0.08)); },
  death: () => { tone(330, 0.6, 'sawtooth', 0.12, -250); },
  horn: () => { tone(110, 1.2, 'sawtooth', 0.14, 10); tone(165, 1.2, 'sawtooth', 0.08, 10); },
  bolt: () => { noise(0.35, 0.4, 4000); tone(900, 0.2, 'square', 0.06, -700); },
  click: () => { tone(880, 0.04, 'square', 0.06); },
  error: () => { tone(200, 0.15, 'square', 0.08, -50); },
  trap: () => { noise(0.15, 0.3, 2400); tone(300, 0.12, 'square', 0.1, -150); },
  roar: () => { noise(0.8, 0.35, 400); tone(90, 0.8, 'sawtooth', 0.2, -30); },
  coin: () => { tone(1320, 0.06, 'square', 0.05); tone(1760, 0.08, 'square', 0.05, 0, 0.05); },
};

export function sfx(name, minGap = 0.05) {
  if (!ctx || !SFX[name]) return;
  const now = ctx.currentTime;
  if (last[name] && now - last[name] < minGap) return;
  last[name] = now;
  SFX[name]();
}
