// Supervisor: mantém o servidor no ar. Se o processo morrer por qualquer motivo, reinicia em 1 s.
// (Partidas em andamento se perdem num reinício; os jogadores voltam ao menu e podem criar outra sala.)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.js');
let restarts = 0, startedAt = 0;
function start() {
  startedAt = Date.now();
  const child = spawn(process.execPath, [entry], { stdio: 'inherit', env: process.env });
  child.on('exit', (code) => {
    if (code === 1 && Date.now() - startedAt < 3000) { console.error('Servidor não conseguiu iniciar (veja a mensagem acima). Encerrando supervisor.'); process.exit(1); }
    restarts++;
    console.error(`Servidor saiu (código ${code}). Reiniciando… (#${restarts})`);
    setTimeout(start, 1000);
  });
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { child.kill(); process.exit(0); });
}
start();
