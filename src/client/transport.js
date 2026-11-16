// Duas formas de jogar com a MESMA interface:
//  - LocalTransport: roda a simulação no próprio aparelho, com bots (offline)
//  - NetTransport: conversa com o servidor autoritativo via WebSocket
import { Game } from '../shared/sim.js';
import { DT } from '../shared/defs.js';

export class LocalTransport {
  constructor({ seed, mapPreset, matchPreset, players, pid }) {
    this.game = new Game({ seed, mapPreset, matchPreset, players });
    this.pid = pid;
    this.lastTick = 0;
    this.acc = 0;
    this.paused = false;
    this.handlers = {};
  }
  on(t, fn) { this.handlers[t] = fn; }
  emit(t, m) { this.handlers[t] && this.handlers[t](m); }
  start() {
    this.emit('init', this.game.initInfo(this.pid));
    this.pushSnap();
  }
  update(dt) {
    if (this.paused || this.game.over && this.sentOver) return;
    this.acc += Math.min(dt, 0.25);
    let stepped = false;
    while (this.acc >= DT) { this.acc -= DT; this.game.step(DT); stepped = true; }
    if (stepped) this.pushSnap();
  }
  pushSnap() {
    const s = this.game.snapshot(this.pid, this.lastTick);
    this.lastTick = this.game.tick;
    if (s.over) this.sentOver = true;
    this.emit('snap', s);
  }
  send(cmd) {
    const r = this.game.handleCommand(this.pid, cmd);
    if (!r.ok && cmd.t !== 'input') this.emit('res', { t: 'res', ok: false, err: r.err, cmd: cmd.t });
  }
  close() {}
}

export class NetTransport {
  constructor(url) {
    this.url = url;
    this.handlers = {};
    this.ws = null;
    this.token = null;
    try { this.token = localStorage.getItem('rp_token'); } catch { /* sem storage */ }
    this.closedByUser = false;
    this.retries = 0;
  }
  on(t, fn) { this.handlers[t] = fn; }
  emit(t, m) { this.handlers[t] && this.handlers[t](m); }
  connect(name) {
    this.name = name;
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => { this.retries = 0; ws.send(JSON.stringify({ t: 'hello', name, token: this.token })); };
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'welcome') {
          this.token = m.token;
          try { localStorage.setItem('rp_token', m.token); } catch { /* ignore */ }
          if (!settled) { settled = true; resolve(m); }
        }
        this.emit(m.t, m);
      };
      ws.onerror = () => { if (!settled) { settled = true; reject(new Error('Não foi possível conectar ao servidor')); } };
      ws.onclose = () => {
        this.emit('disconnect', {});
        // Reconexão automática: o servidor guarda o lugar do jogador (a IA assume enquanto isso)
        if (!this.closedByUser && settled && this.retries < 20) {
          this.retries++;
          setTimeout(() => this.connect(this.name).catch(() => {}), Math.min(5000, 500 * this.retries));
        }
      };
    });
  }
  send(cmd) { this.raw({ t: 'cmd', cmd }); }
  raw(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  update() {}
  close() { this.closedByUser = true; try { this.ws.close(); } catch { /* ignore */ } }
}
