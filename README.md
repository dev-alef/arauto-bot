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

- **Fila sequencial (FIFO):** mensagens em rajada eram processadas em paralelo e os pares texto/áudio se embaralhavam no grupo (race condition). A fila garante processamento um-por-vez, na ordem de chegada.
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

## 🔄 Atualização automática do Microsoft Edge TTS

Antes de processar cada reflexão válida, o bot consulta a versão estável `latest` do pacote [msedge-tts](https://github.com/Migushthe2nd/MsEdgeTTS) no npm. Se houver uma versão superior à ativa, aguarda a instalação e passa a usá-la no áudio daquela reflexão, sem reiniciar o processo. A checagem também acontece quando `AUDIO_ENABLED=false`; mensagens descartadas pelos filtros não consultam o npm.

As versões são instaladas em `.tts-runtime/`, isoladas das dependências originais. A versão ativa é salva para os próximos reinícios. O bot valida a interface usada pelo gerador antes de ativar a atualização; isso não garante que futuras versões mantenham todo o comportamento do serviço. As atualizações seguem as versões estáveis publicadas no npm, incluindo versões principais, e não cada commit do GitHub.

A consulta tem limite de 10 segundos e a instalação de 2 minutos. Se a rede, a instalação ou a validação falhar, o bot registra um aviso, mantém a biblioteca disponível e tenta novamente na próxima reflexão. Falhas na geração do áudio continuam permitindo o envio somente do texto.

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
| `WATCH_NUMBER` | Número monitorado (vazio = todos) |
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
