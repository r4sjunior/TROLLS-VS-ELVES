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

## Hospedar o servidor

O servidor mantém salas em memória e precisa de um processo contínuo com WebSocket: Render, Railway, Fly.io,
uma VPS ou um PC na LAN. Funções serverless não servem para as salas. Variável `PORT` opcional.

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
