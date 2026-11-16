# Raízes & Presas

Sobrevivência assimétrica para Android (landscape). **Elfos** coletam madeira, ouro e cristal, erguem
fortalezas com muros, portões, torres e armadilhas, e precisam ver o amanhecer. **Trolls** saem do covil
após a preparação, rastreiam, derrubam florestas e muralhas e evoluem até virar Troll Ancestral.

Documentação técnica: [docs/ARQUITETURA.md](docs/ARQUITETURA.md)

## Rodar

```bash
npm install
npm run dev        # cliente com hot reload em http://localhost:5173 (modo contra bots)
npm run server     # servidor multiplayer em http://localhost:3000 (rode "npm run build" antes)
npm start          # build + servidor: jogo e multiplayer no mesmo endereço
npm test           # testes da simulação e do multiplayer (11 testes)
node scripts/simulate.js 4 dificil curta   # partidas headless só com bots, para balanceamento
```

Para jogar no celular na mesma rede Wi-Fi: `npm start` e abra `http://IP-DO-PC:3000` no navegador do celular
(ou "Adicionar à tela inicial", pois é um PWA em tela cheia).

## Gerar o APK

Requer **JDK 17** e **Android SDK** (o jeito mais simples é instalar o Android Studio).

```bash
npm run cap:sync                       # build web + copia para android/
cd android && gradlew.bat assembleDebug
# APK em android/app/build/outputs/apk/debug/app-debug.apk
```

Ou `npx cap open android` e use *Build > Build APK(s)* no Android Studio. A orientação já está travada em
landscape no `AndroidManifest.xml`. No APK, o multiplayer pede o endereço do servidor em *Configurações*
(ex.: `192.168.0.10:3000`).

## Arena (multiplayer público)

"Entrar na arena" coloca o jogador numa partida contínua:

1. O primeiro humano que entra inicia a partida na hora (ainda na preparação).
2. A cada **1 minuto** entra **um** bot, um por vez, até completar 10 vagas (2 trolls e 8 elfos).
3. Quando entra mais um humano, **um bot sai** para dar a vaga a ele, de preferência da equipe dele, e a contagem de 1 min recomeça.
4. Quem sai da partida vira bot, e a partida segue.
5. Quando a partida acaba, uma **nova arena abre sozinha** em 15 s e quem continua conectado é levado para ela.

Os tempos podem ser ajustados pelas variáveis `ARENA_BOT_MS` (padrão 60000) e `ARENA_NEXT_MS` (padrão 15000).
As salas privadas com código continuam funcionando como antes.

## Hospedar o servidor (o site na Vercel precisa dele)

A Vercel serve só o site estático. O servidor de jogo mantém as partidas na memória e roda a 20 ticks/s
com WebSocket, por isso precisa de um processo contínuo, como Render, Railway, Fly.io ou uma VPS.

**Render (plano gratuito), com o `render.yaml` incluso:**
1. Suba o projeto para o GitHub.
2. Em render.com: **New → Blueprint** → escolha o repositório → **Apply**.
3. Anote o endereço gerado, por exemplo `https://trolls-vs-elves-server.onrender.com`. Ele também serve o jogo completo.
4. Na Vercel: **Settings → Environment Variables**, crie `VITE_SERVER_URL` com o valor `wss://trolls-vs-elves-server.onrender.com` e faça **Redeploy**.

No plano gratuito, o Render "dorme" depois de 15 min sem uso. O primeiro acesso leva cerca de 1 min e o jogo
mostra "Acordando o servidor…" e tenta de novo sozinho. O ranking fica no disco temporário e zera a cada deploy.

## Controles

| Celular | PC |
|---|---|
| Metade esquerda da tela: joystick | WASD / setas |
| Atacar / Coletar: toque liga e desliga, segurar mantém ativo | Espaço / E |
| Construir → categoria → estrutura → arraste o holograma → Construir | B, mouse, R gira, Enter confirma |
| Habilidades | Q / F / G |
| Bolsa: progressão e melhorias · Evoluir (troll nível 8) | Tab · V |
| Toque numa construção: melhorar, demolir, ver detalhes | clique |
| Toque no minimapa: marca um ponto para o time · pinça: zoom | roda do mouse |
