# Raízes & Presas — Documentação técnica

Jogo de sobrevivência assimétrica para Android: elfos constroem e resistem, trolls caçam.
Inspirado no *gênero* dos mapas customizados de construção/caçada; nomes, regras de balanceamento,
modelos, interface e mapas são originais (gerados proceduralmente, sem assets de terceiros).

## 1. Decisões de engine e stack

| Decisão | Escolha | Por quê |
|---|---|---|
| Render | **Three.js 0.170** (WebGL) | Leve em Android intermediário, sem custo de licença, iteração rápida, mesma base de outros projetos do autor. |
| Empacotamento Android | **Capacitor 6** | Gera um projeto Android nativo (WebView) a partir do build web; o mesmo código roda como site/PWA. |
| Servidor | **Node 24 + `ws`** | Reaproveita *exatamente* o código da simulação do cliente — uma única fonte de verdade. |
| Linguagem | JavaScript ES modules, sem framework de UI | Bundle pequeno (~170 kB gzip), DOM direto para HUD. |
| Modelos 3D | Procedurais (primitivas low-poly) | Identidade própria, zero download de assets, troca fácil por GLTF depois. |
| Áudio | WebAudio sintetizado | Zero arquivos; trocar por samples é só reimplementar `sfx()`. |

Godot/Unity foram descartados nesta etapa: nenhum dos dois estava instalado, e o requisito de um servidor
autoritativo que roda a mesma lógica do cliente sai de graça com JS compartilhado.

## 2. Estrutura de pastas

```
src/shared/         ← roda no servidor E no cliente (lógica pura, sem DOM)
  defs.js           todos os números de balanceamento (construções, classes, melhorias, fases, eventos)
  rng.js            RNG determinístico (mulberry32)
  mapgen.js         gerador de mapas por seed + preset (floresta, vale, ruínas)
  path.js           A* 8-direções com custo por tile
  sim.js            Game: simulação autoritativa, validação de comandos, visão, snapshots
  ai.js             bots (ElfBrain, TrollBrain) com 3 dificuldades
src/client/
  main.js           menus, loop, fluxo de partida, pausa, fim de jogo
  transport.js      LocalTransport (offline + bots) e NetTransport (WebSocket + reconexão)
  world.js          estado do cliente montado a partir dos snapshots
  render.js         cena Three.js, terreno, camadas instanciadas por chunk, FX, holograma
  models.js         modelos procedurais (elfos, trolls, construções, árvores)
  hud.js            HUD, joystick, botões, construção mobile, minimapa, painéis
  profile.js        perfil local: nível de conta, conquistas, skins, diárias, histórico
  audio.js          efeitos sonoros sintetizados
server/index.js     salas, equipes, bots, reconexão, ranking, serve o build estático
tests/              node:test — simulação e integração multiplayer
scripts/            simulate.js (balanceamento headless), shots*.js (capturas visuais)
android/            projeto nativo gerado pelo Capacitor (landscape travado no manifesto)
```

## 3. Arquitetura de rede (servidor autoritativo)

```
Cliente ──comandos──▶ Servidor (Game.handleCommand valida) ──step 20 Hz──▶ snapshot por jogador ──▶ Cliente
```

* O cliente **só envia intenções**: `input` (vetor de movimento + atacar/coletar), `build`, `upgrade`,
  `demolish`, `buy`, `ability`, `evolve`, `ping`. Toda regra (custo, alcance, terreno, cooldown, equipe,
  requisito de tecnologia) é checada em `sim.js`. Chaves vindas da rede são verificadas com `Object.hasOwn`.
* **Anti-trapaça por visão:** `Game.snapshot(pid)` só inclui inimigos que a equipe daquele jogador enxerga
  (raio de visão, cavernas, camuflagem, Pedra Vigia). Armadilhas não reveladas e construções não descobertas
  nunca chegam ao cliente troll.
* **Snapshots delta:** construções e tiles mudados desde o último tick enviado (`rev`/`tileLog`); unidades
  e projéteis vão inteiros (são poucos). Reconexão pede `since = 0` (estado completo).
* **Reconexão:** o cliente guarda um token. Ao cair, `Game.setConnected(pid, false)` faz a IA assumir o
  personagem; ao voltar com o mesmo token (até 120 s), o servidor reenvia `init` + snapshot completo.
* **Limite de taxa:** 80 mensagens/s por sessão, payload máx. 8 kB.
* O modo local usa **o mesmo caminho**: `LocalTransport` chama `Game` no próprio aparelho e entrega
  snapshots ao cliente, então qualquer bug de rede/visão aparece também offline.

### Protocolo

| Cliente → servidor | Servidor → cliente |
|---|---|
| `hello {name, token?}` | `welcome {token, resumed}` |
| `arena {team, cls}` (= `quick`) | `init {..., arena: true}` direto, sem lobby · `notice {msg}` (bot entrou/saiu) |
| `create {settings}` / `join {code}` | `lobby {room}` / `error {msg}` |
| `team {team: A/E/T, cls}` / `start` / `leave` | `init {seed, mapPreset, matchPreset, pid}` |
| `cmd {cmd}` | `snap {...}` (20/s) / `res {ok:false, err}` |

O mapa não trafega: o cliente o regenera a partir de `seed` + `mapPreset` (determinístico) e aplica só
as mudanças de tiles.

### Arena

`Arena` (subclasse de `Room` em `server/index.js`) é uma partida pública contínua. O primeiro humano
cria o `Game` vazio e entra na hora. A cada `ARENA_BOT_MS` entra um bot (`addBot`), que vira troll se faltar
caçador (`wantTrolls(n)`: 0 com 1 jogador, 1 até 5 jogadores, 2 a partir de 6). Um humano novo remove um bot
(`Game.removePlayer`) e reinicia a contagem. Quem sai vira bot. No fim, `onEnded` abre outra arena e move os
conectados. Arena sem humanos é fechada para não gastar CPU.

## 4. Sistemas

* **Movimento/colisão:** círculo vs. grade, deslizamento por eixos, sub-passos para dashes, separação leve
  entre unidades. Portões bloqueiam só trolls; armadilhas são pisáveis.
* **Economia dos elfos:** madeira (árvores), ouro (veios), cristal (cristais em ruínas, cavernas e áreas
  secretas). Renda passiva: Refúgio, Serraria, Extrator, Árvore Ancestral. Depósito dá +60% de coleta.
* **Construções:** custo, tempo, PV, armadura, melhorias (madeira → pedra → cristal), demolição com
  reembolso, reparo gastando madeira. A Árvore Ancestral libera o tier 2 para **toda a equipe**.
* **Trolls:** 4 classes + evolução Ancestral (nível 8), habilidades por classe, ouro e XP por dano em
  construções e abates, loja de melhorias, regeneração fora de combate, respawn em 12 s.
* **Fases:** preparação (trolls na jaula) → sobrevivência → caçada intensa (+15% dano, eventos aleatórios)
  → confronto final (+30%, Uivo da Lua revela elfos a cada 40 s). Vitória élfica no amanhecer; vitória troll
  quando não sobra elfo vivo nem renascimento pendente.
* **Eventos:** Lua de Sangue, Névoa Antiga, Chuva Dourada, Despertar da Floresta, Tempestade Arcana.
* **IA:** elfos escolhem sítio (espaço livre + madeira + distância do covil), cooperam em bases comuns,
  constroem anel de muros com portão, torres, armadilhas na entrada, economia e tier 2, reparam e
  fogem/se abrigam. Trolls compartilham pistas, exploram setores menos visitados, escolhem o muro mais
  fraco do anel (ponto vulnerável), recuam para regenerar e usam habilidades conforme a classe.
  Dificuldade altera tempo de reação, frequência de habilidades, qualidade do plano e uso de melhorias.

## 5. Desempenho

* Simulação: 0,03–0,15 ms por tick com 10 jogadores e ~150 construções (medido em `scripts/simulate.js`).
* Render: florestas/ouro/cristal em `InstancedMesh` divididos em **chunks 16×16** com bounding sphere
  própria → frustum culling corta o que está fora da tela. Terreno = 1 plano + textura 1 texel/tile.
* Qualidade **Baixa / Média / Alta**: resolução interna (0,75× / 1× / 1,75×), sombras (só alta),
  antisserrilhado, quantidade de partículas, vaga-lumes e LOD da copa das árvores (5 vs. 12 faces).

## 6. Como expandir

* **Nova construção:** adicione em `BUILDINGS` (`defs.js`) e um `case` em `makeBuilding` (`models.js`).
  Comportamentos (`tower`, `trap`, `income`, `heal`, `aura`, `revive`, `vision`, `detect`, `gate`) já são
  genéricos.
* **Nova classe de troll:** entrada em `TROLL_CLASSES`, `case` de habilidade em `Game.cmdAbility`, cores em
  `TROLL_COLORS` e uso no `TrollBrain.useAbilities`.
* **Novo mapa:** preset em `MAP_PRESETS` (`mapgen.js`).
* **Modelos de artista:** substitua as funções de `models.js` por loaders GLTF mantendo `userData.body/legL/legR`.

## 7. Limitações conhecidas (honestas)

* Sem **predição no cliente**: online o próprio personagem segue o snapshot de 20 Hz com suavização. Em LAN e
  ping baixo fica bom; acima de ~150 ms o atraso é perceptível. Próximo passo: prever o movimento local com
  `Game.moveUnit` e reconciliar.
* **Ranking por nome**, sem contas: serve para grupo de amigos, não para competição aberta.
* Uma informação ainda vaza para todos os clientes: tiles de árvore derrubada (o troll pode inferir onde há
  elfos cortando madeira longe da visão).
* Modelos e animações são procedurais: funcionais e coerentes, mas não substituem um artista 3D.
* Ainda não testado em aparelho Android real (ver README para gerar o APK).
