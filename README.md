# 📯 Arauto Bot — Automação de Mensagens com IA e Voz para WhatsApp

> Pipeline automatizado que recebe mensagens no WhatsApp, adapta o texto com IA generativa, converte em áudio com voz neural e publica texto + áudio em um grupo — de ponta a ponta, sem intervenção manual.

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Evolution%20API-2496ED?logo=docker&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-4169E1?logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white)
![Gemini](https://img.shields.io/badge/Google-Gemini%202.5-4285F4?logo=google&logoColor=white)

---

## 📖 O problema

Mensagens reflexivas recebidas no WhatsApp precisavam ser: reescritas em um tom adequado, convertidas em áudio narrado e publicadas (texto + voz) em um grupo — um processo manual de copiar, colar, gerar, baixar e reenviar, repetido várias vezes ao dia.

**Este projeto automatiza 100% desse fluxo.**

## ⚙️ Como funciona

```
📱 Mensagem chega no WhatsApp (com gatilho "Shalom, amado" / "Amém, amado")
        │
        ▼
🐳 Evolution API (Docker) detecta e dispara webhook
        │
        ▼
📡 Servidor Express recebe o evento (porta 3000)
        │
        ▼
📋 Fila sequencial (FIFO) — garante ordem mesmo em rajadas de mensagens
        │
        ▼
🤖 Google Gemini adapta o texto (com sanitização anti-rubricas de TTS)
        │
        ▼
🎙️ Microsoft Edge TTS gera o áudio em voz neural PT-BR
        │
        ▼
📤 Texto adaptado + mensagem de voz são publicados no grupo
```

## 🧰 Stack e decisões técnicas

| Camada | Tecnologia | Papel |
|---|---|---|
| Runtime | **Node.js 18+** (fetch nativo) | Execução do bot |
| Servidor | **Express** | Endpoint de webhook |
| WhatsApp | **Evolution API v2** (Baileys) | Conexão, recepção e envio |
| IA | **Google Gemini 2.5 Flash** | Adaptação do texto (com retry/backoff) |
| TTS | **msedge-tts** | Voz neural (pt-BR-AntonioNeural) |
| Banco | **PostgreSQL 15** | Persistência da sessão/instância |
| Cache | **Redis 7** | Cache da Evolution API |
| Infra | **Docker** | Containers com restart automático |
| Processo | **pm2** | Bot em background + boot com o sistema |

### Destaques de engenharia

- **Fila sequencial (FIFO):** mensagens em rajada eram processadas em paralelo e os pares texto/áudio se embaralhavam no grupo (race condition). A fila garante processamento um-por-vez, na ordem de chegada, com pausa aleatória de 1 a 3 minutos entre reflexões.
- **Retry com backoff progressivo:** falhas temporárias da IA (HTTP 503/429) são reprocessadas automaticamente em 5s → 10s → 15s.
- **Normalização do nono dígito (BR):** o WhatsApp entrega números ora com, ora sem o nono dígito; o filtro de origem normaliza ambos os formatos antes de comparar.
- **Sanitização anti-rubrica:** remove marcações como `(pausa)` que a IA eventualmente gera e que o TTS leria literalmente.
- **Gatilho por regex tolerante:** `/^(shalom|amém|amem),?\s*amado/i` — aceita variações de pontuação, acentuação e caixa.
- **Segurança em camadas:** apikey na Evolution + token secreto no webhook (header customizado) + filtros de origem e conteúdo.

## 📁 Estrutura do projeto

```
arauto-bot/
├── server.js              # Servidor Express — recebe os webhooks
├── src/
│   ├── bot.js             # Orquestrador: fila, filtros e fluxo
│   ├── routing.js         # Reflexões no grupo; aulas de IA em outro grupo ou contato
│   ├── ai-adapter.js      # Integração com Google Gemini (com retry)
│   ├── speechma.js        # Geração de áudio (msedge-tts)
│   ├── whatsapp.js        # Cliente da Evolution API (texto + áudio PTT)
│   └── logger.js          # Logs com timestamp em arquivo diário
├── scripts/
│   ├── test-ai.js         # Teste isolado da IA
│   └── test-speechma.js   # Teste isolado do TTS
├── audio_output/          # MP3s gerados
├── logs/                  # Logs diários
└── .env.example           # Template de configuração
```

## 🚀 Instalação

### Pré-requisitos

- Node.js 18+
- Docker
- Chave de API do [Google AI Studio](https://aistudio.google.com/apikey) (free tier)

### 1. Suba a infraestrutura (Docker)

```bash
# PostgreSQL (crie um banco chamado "evolution")
docker run -d --name evolution_postgres -p 5432:5432 \
  -e POSTGRES_USER=evolution -e POSTGRES_PASSWORD=SUA_SENHA \
  -e POSTGRES_DB=evolution postgres:15-alpine

# Redis
docker run -d --name evolution_redis -p 6379:6379 redis:7-alpine

# Evolution API
docker run -d --name evolution_api -p 8080:8080 \
  -e AUTHENTICATION_API_KEY=SUA_CHAVE_FORTE \
  -e DATABASE_ENABLED=true \
  -e DATABASE_PROVIDER=postgresql \
  -e "DATABASE_CONNECTION_URI=postgresql://evolution:SUA_SENHA@host.docker.internal:5432/evolution" \
  -e DATABASE_SAVE_DATA_INSTANCE=true \
  -e CACHE_REDIS_ENABLED=true \
  -e "CACHE_REDIS_URI=redis://host.docker.internal:6379/1" \
  -v evolution_instances:/evolution/instances \
  evoapicloud/evolution-api:latest

# Restart automático junto com o Docker
docker update --restart unless-stopped evolution_api evolution_postgres evolution_redis
```

### 2. Conecte o WhatsApp

1. Acesse `http://localhost:8080/manager` (login = sua API key)
2. Crie uma instância e escaneie o QR Code pelo celular
3. Descubra o ID do grupo destino:

```bash
curl "http://localhost:8080/group/fetchAllGroups/SUA_INSTANCIA?getParticipants=false" \
  -H "apikey: SUA_CHAVE_FORTE"
```

### 3. Configure e rode o bot

```bash
npm install
cp .env.example .env
# preencha o .env com suas chaves e IDs

# Testes isolados
node scripts/test-ai.js
node scripts/test-speechma.js

# Registre o webhook (com token de segurança)
curl -X POST "http://localhost:8080/webhook/set/SUA_INSTANCIA" \
  -H "apikey: SUA_CHAVE_FORTE" -H "Content-Type: application/json" \
  -d '{"webhook":{"enabled":true,"url":"http://host.docker.internal:3000/webhook","events":["MESSAGES_UPSERT"],"headers":{"x-webhook-token":"SEU_TOKEN"}}}'

# Produção com pm2
npm install -g pm2 pm2-windows-startup
pm2 start server.js --name arauto-bot
pm2 save && pm2-startup install
```

## 📘 Aulas de IA em outro grupo ou contato

O bot mantém dois fluxos na mesma fila:

| Conteúdo recebido | Destino | Adaptação |
|---|---|---|
| Reflexões com o gatilho atual | `TARGET_GROUP_ID` | Instrução atual de `AI_PROMPT` |
| Aulas reconhecidas pelos critérios abaixo | `IA_TARGET_GROUP_ID` ou `IA_TARGET_NUMBER` | Aula completa para leitura e narração técnica |

O bot identifica uma aula de IA quando a mensagem autorizada contém o nome do curso (como “Curso Progressivo de Inteligência Artificial”, “curso de IA” ou “curso sobre inteligência artificial”); quando tem um título numerado de aula com um tema técnico no título ou nas duas linhas seguintes; ou quando contém o marcador explícito `[AULA IA]`. Exemplos de temas aceitos incluem IA, inteligência artificial, agentes de IA, ChatGPT, Transformers, GPUs, redes neurais, programação, algoritmos e transistores.

As reflexões comuns precisam começar com “Shalom/Shalon, amado” ou “Amém, amado”. Uma aula também pode começar diretamente com um título numerado reconhecido, como `📘 AULA 67 — AGENTES DE IA`, ou com `[AULA IA]`. O marcador explícito é removido antes da adaptação. Uma linha como “Pensou por 57s” imediatamente antes da saudação ou da abertura reconhecida de aula é removida antes da adaptação e da geração de áudio.

Mencionar IA ou aula incidentalmente não basta para trocar a rota. A identificação é feita por regras de texto e pode falhar se a mensagem não contiver nenhum dos sinais acima; use `[AULA IA]` no início para identificar explicitamente uma aula sem um desses sinais. Mensagens enviadas pela própria conta da Evolution continuam ignoradas para evitar ciclos.

Configure no `.env` o remetente autorizado e o ID do grupo exclusivo das aulas. O WhatsApp conectado à Evolution API precisa participar desse grupo e ter permissão para enviar mensagens. Exemplo:

```dotenv
IA_WATCH_NUMBER=5511988887777
IA_TARGET_GROUP_ID=120363999999999@g.us
IA_TARGET_NUMBER=
```

Para descobrir o grupo, consulte `GET /group/fetchAllGroups/{instance}?getParticipants=false` com o header `apikey` da Evolution. Na resposta, `subject` é o nome e `id` é o identificador completo do grupo.

Se preferir um contato privado, deixe `IA_TARGET_GROUP_ID` vazio e configure `IA_TARGET_NUMBER` somente com os dígitos do telefone. Se ambos estiverem preenchidos, apenas o grupo de IA recebe a aula.

Se `IA_WATCH_NUMBER` estiver vazio, as aulas usam a lista existente em `WATCH_NUMBER`. Se ambos estiverem vazios, as aulas são ignoradas. A comparação de remetentes aceita o número brasileiro com ou sem o nono dígito. `WATCH_NUMBER` e `TARGET_GROUP_ID` continuam controlando as reflexões normais.

A aula tem prioridade sobre o fluxo do grupo e recebe um único destino. Sem destino válido, a aula é ignorada com aviso no log. Se `IA_TARGET_GROUP_ID` estiver preenchido, mas inválido, não há envio ao número privado antigo nem ao grupo das reflexões. As instruções de narração pedem ao Gemini que preserve o conteúdo completo e adapte números, siglas, unidades, cálculos, tabelas e diagramas para fala natural. Essa adaptação é gerada por IA e pode precisar de ajustes após ouvir as primeiras aulas.

Com `AUDIO_ENABLED=true`, ambos os fluxos geram áudio antes de publicar texto e áudio. Se a geração do áudio falhar, o bot faz até três novas tentativas, com intervalo aleatório de 3 a 5 minutos. Se todas falharem, a reflexão não é publicada e um relatório é enviado ao número em `ERROR_REPORT_NUMBER`. A atualização automática do TTS é verificada nos dois fluxos.

### Atualizar uma instalação existente no Ubuntu Server

Esta alteração não exige migração de banco nem recriação de PostgreSQL, Redis ou Evolution API. Se o bot já recebe e envia mensagens, mantenha as configurações atuais de conexão, instância, webhook e grupo.

1. Na pasta do bot, execute `git pull --ff-only origin main`.
2. Edite o `.env` existente e acrescente `IA_WATCH_NUMBER` e `IA_TARGET_GROUP_ID` com o remetente e o grupo corretos. Preserve as demais variáveis; não substitua o arquivo pelo `.env.example`.
3. Garanta que `AUDIO_ENABLED` esteja ausente (padrão `true`) ou definido como `true`.
4. Execute `npm test` e reinicie o processo. Com PM2: `pm2 restart arauto-bot --update-env`.
5. Acompanhe `pm2 logs arauto-bot --lines 50`. O log identifica “reflexão do grupo” ou “aula de IA” e o destino escolhido.

Nenhuma dependência nova é necessária para esta mudança. Se o próprio bot estiver dentro de um container, reconstrua/recrie somente o serviço do bot com o código novo e as variáveis carregadas pelo container. Editar um `.env` no host só funciona se o serviço realmente o repassar ou montar. Preserve as pastas persistentes do bot, especialmente `.tts-runtime/`. A Evolution API precisa permanecer conectada à conta do WhatsApp e acessível pelo bot; a mudança de sistema operacional não altera as rotas de envio usadas pelo código.

## ⏱️ Fila e relatório de falhas de áudio

Depois de cada tentativa de publicação, o bot sorteia uma pausa de 1 a 3 minutos antes de processar a próxima reflexão válida. O intervalo também é respeitado quando a fila fica vazia e chega outra mensagem logo depois. Texto e áudio da mesma reflexão continuam sendo enviados juntos; a pausa longa é entre reflexões.

Se a **geração** do áudio falhar, inclusive se o stream encerrar antes de `turn.end`, o bot aguarda de 3 a 5 minutos entre tentativas e tenta até quatro vezes no total. Durante as tentativas, as mensagens seguintes permanecem na fila. Caso nenhuma funcione, a reflexão não é publicada; o bot envia ao número em `ERROR_REPORT_NUMBER` um relatório com o destino, ID da mensagem e os erros das tentativas. Em seguida, continua a fila. Quando o áudio é desativado por `AUDIO_ENABLED=false`, o envio somente de texto continua sendo intencional.

Configure `ERROR_REPORT_NUMBER` no `.env` com DDI e DDD e apenas dígitos. Pode ser o número conectado à Evolution API, mas verifique que o envio para si mesmo funciona nessa instalação. Se o número não estiver configurado ou o envio do relatório falhar, o erro fica no log e o processamento segue. O envio do relatório tem limite de 15 segundos.

A fila e as esperas ficam na memória: reiniciar o bot durante o processamento pode descartar a mensagem em andamento e as mensagens que aguardam. Além disso, texto e áudio são chamadas separadas à Evolution: se ela aceitar o texto e falhar depois no envio do áudio, não há como desfazer automaticamente o texto já enviado. As novas tentativas acima tratam falhas de geração do áudio antes da publicação.

## 🔄 Atualização automática do Microsoft Edge TTS

Antes de processar cada reflexão válida, o bot consulta a versão estável `latest` do pacote [msedge-tts](https://github.com/Migushthe2nd/MsEdgeTTS) no npm. Se houver uma versão superior à ativa, aguarda a instalação e passa a usá-la no áudio daquela reflexão, sem reiniciar o processo. A checagem também acontece quando `AUDIO_ENABLED=false`; mensagens descartadas pelos filtros não consultam o npm.

As versões são instaladas em `.tts-runtime/`, isoladas das dependências originais. A versão ativa é salva para os próximos reinícios. O bot valida a interface usada pelo gerador antes de ativar a atualização; isso não garante que futuras versões mantenham todo o comportamento do serviço. As atualizações seguem as versões estáveis publicadas no npm, incluindo versões principais, e não cada commit do GitHub.

A consulta tem limite de 10 segundos e a instalação de 2 minutos. Se a rede, a instalação ou a validação falhar, o bot registra um aviso, mantém a biblioteca disponível e tenta novamente na próxima reflexão.

O processo precisa ter Node.js e npm disponíveis, acesso ao registry npm e permissão de escrita na pasta do projeto. Scripts de instalação dos pacotes ficam desativados. `package.json` e `package-lock.json` originais não são alterados pelas atualizações em execução. Preserve `.tts-runtime/` entre deploys se quiser manter a versão selecionada.

Para executar os testes automatizados sem enviar mensagens ou chamar a IA:

```bash
npm test
```

## 🔑 Variáveis de ambiente

| Variável | Descrição |
|---|---|
| `GEMINI_API_KEY` | Chave do Google AI Studio |
| `EVOLUTION_URL` | URL da Evolution API (ex: http://localhost:8080) |
| `EVOLUTION_API_KEY` | Chave definida na criação do container |
| `EVOLUTION_INSTANCE` | Nome da instância conectada |
| `TARGET_GROUP_ID` | ID do grupo destino (`...@g.us`) |
| `WATCH_NUMBER` | Remetentes das reflexões (vazio = todos); padrão para origem das aulas |
| `IA_WATCH_NUMBER` | Remetente(s) autorizado(s) das aulas de IA; vazio usa `WATCH_NUMBER` |
| `IA_TARGET_GROUP_ID` | Grupo exclusivo das aulas de IA, com `@g.us`; tem prioridade sobre o contato privado |
| `IA_TARGET_NUMBER` | Telefone privado para aulas de IA, com DDI e DDD; sem ID de grupo |
| `AUDIO_ENABLED` | `true` para texto + áudio nos dois fluxos (padrão); `false` para somente texto |
| `ERROR_REPORT_NUMBER` | WhatsApp que recebe os relatórios de falha de áudio, com DDI e DDD, apenas dígitos |
| `SPEECHMA_VOICE` | Voz neural (padrão: `pt-BR-AntonioNeural`) |
| `WEBHOOK_TOKEN` | Token de segurança do webhook |
| `AI_PROMPT` | Instrução de adaptação do texto |

## ⚠️ Avisos

- A Evolution API usa a biblioteca **Baileys** (cliente não-oficial do WhatsApp). Isso contraria os Termos de Uso da Meta e pode resultar em banimento do número. Use um número secundário e volume moderado. Para uso comercial em escala, considere a [WhatsApp Business Platform](https://business.whatsapp.com/products/business-platform) oficial.
- Nunca versione o arquivo `.env` — mantenha segredos fora do repositório.

## 📜 Licença

MIT — use, estude e adapte à vontade.

---

**Desenvolvido por [Alerson dos Santos Ferreira](https://github.com/dev-alef) · Genesis Code** 🌲
