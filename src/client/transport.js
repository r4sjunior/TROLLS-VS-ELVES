// Duas formas de jogar com a MESMA interface:
//  - LocalTransport: roda a simulação no próprio aparelho, com bots (offline)
//  - NetTransport: conversa com o servidor autoritativo via WebSocket
import { Game } from '../shared/sim.js';
import { DT, PROTOCOL } from '../shared/defs.js';

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
    if (this.paused || (this.game.over && this.sentOver)) return;
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

// Conexão resiliente para celular: a aba pode ser suspensa, o Wi-Fi pode piscar, a tela pode apagar.
// Reconecta para sempre (com espera crescente), na hora em que a aba volta ou a rede retorna,
// e derruba conexões "zumbis" que pararam de receber dados.
export class NetTransport {
  constructor(url) {
    this.url = url;
    this.handlers = {};
    this.ws = null;
    this.token = null;
    try { this.token = localStorage.getItem('rp_token'); } catch { /* sem storage */ }
    this.closedByUser = false;
    this.retries = 0;
    this.lastMsgAt = 0;
    this.connected = false;
    this.reconnectTimer = null;
    this.onVisible = () => { if (document.visibilityState === 'visible') this.checkNow(); };
    this.onOnline = () => this.checkNow();
    document.addEventListener('visibilitychange', this.onVisible);
    window.addEventListener('online', this.onOnline);
    this.watchdog = setInterval(() => {
      // Em partida o servidor manda 20 snapshots/s; 6 s de silêncio = conexão morta
      if (this.connected && this.inGame && Date.now() - this.lastMsgAt > 6000) this.drop();
    }, 1000);
  }
  on(t, fn) { this.handlers[t] = fn; }
  emit(t, m) { this.handlers[t] && this.handlers[t](m); }

  connect(name) {
    this.name = name;
    clearTimeout(this.reconnectTimer);
    return new Promise((resolve, reject) => {
      let settled = false;
      let ws;
      try { ws = new WebSocket(this.url); } catch (e) { reject(new Error('Endereço de servidor inválido')); return; }
      this.ws = ws;
      const openTimeout = setTimeout(() => { if (ws.readyState !== 1) { try { ws.close(); } catch { /* ok */ } } }, 8000);
      ws.onopen = () => {
        clearTimeout(openTimeout);
        this.lastMsgAt = Date.now();
        ws.send(JSON.stringify({ t: 'hello', name, token: this.token }));
      };
      ws.onmessage = (ev) => {
        if (ws !== this.ws) return;
        this.lastMsgAt = Date.now();
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'welcome' && m.proto !== PROTOCOL) {
          // cliente e servidor geram o mapa cada um do seu lado: versões diferentes = mundos diferentes
          this.closedByUser = true; try { ws.close(); } catch { /* ok */ }
          if (!settled) { settled = true; resolve(m); }
          this.emit('outdated', { server: m.proto || 0 });
          return;
        }
        if (m.t === 'welcome') {
          const wasReconnect = this.everConnected;
          this.token = m.token; this.connected = true; this.everConnected = true; this.retries = 0;
          try { localStorage.setItem('rp_token', m.token); } catch { /* ignora */ }
          if (!settled) { settled = true; resolve(m); }
          if (wasReconnect) this.emit('reconnected', m);
        }
        if (m.t === 'init') this.inGame = true;
        this.emit(m.t, m);
      };
      ws.onerror = () => { if (!settled && !this.everConnected) { settled = true; reject(new Error('Não foi possível conectar ao servidor. Confira o endereço e se o servidor está ligado.')); } };
      ws.onclose = () => {
        clearTimeout(openTimeout);
        if (ws !== this.ws) return;
        const was = this.connected;
        this.connected = false;
        if (was) this.emit('disconnect', {});
        if (!this.closedByUser && this.everConnected) this.scheduleReconnect();
      };
    });
  }

  scheduleReconnect(delay) {
    clearTimeout(this.reconnectTimer);
    this.retries++;
    const wait = delay ?? Math.min(4000, 300 * this.retries);
    this.emit('reconnecting', { attempt: this.retries });
    this.reconnectTimer = setTimeout(() => this.connect(this.name).catch(() => this.scheduleReconnect()), wait);
  }
  drop() {
    const ws = this.ws; this.connected = false; this.ws = null;
    try { ws && ws.close(); } catch { /* ok */ }
    this.emit('disconnect', {});
    if (!this.closedByUser) this.scheduleReconnect(0);
  }
  checkNow() {
    if (this.closedByUser || !this.everConnected) return;
    if (!this.ws || this.ws.readyState > 1 || (this.inGame && Date.now() - this.lastMsgAt > 2500)) this.drop();
  }
  send(cmd) { this.raw({ t: 'cmd', cmd }); }
  raw(m) { if (this.ws && this.ws.readyState === 1) { try { this.ws.send(JSON.stringify(m)); } catch { /* reconecta sozinho */ } } }
  update() {}
  close() {
    this.closedByUser = true;
    clearTimeout(this.reconnectTimer); clearInterval(this.watchdog);
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('online', this.onOnline);
    try { this.ws && this.ws.close(); } catch { /* ignora */ }
  }
}
