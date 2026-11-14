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
🎙️ Edge TTS ou Kokoro gera o áudio em voz PT-BR
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
| TTS | **msedge-tts** ou **Kokoro-FastAPI** | Voz Edge ou Kokoro local, configurável |
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
│   ├── kokoro.js          # Geração de áudio no serviço Kokoro local
│   ├── tts.js             # Escolha do gerador de áudio
│   ├── whatsapp.js        # Cliente da Evolution API (texto + áudio PTT)
│   └── logger.js          # Logs com timestamp em arquivo diário
├── scripts/
│   ├── test-ai.js         # Teste isolado da IA
│   ├── test-speechma.js   # Teste isolado do Edge TTS
│   ├── test-tts.js        # Testa o gerador configurado, sem enviar mensagem
│   └── arauto-compose.sh  # Usa o Compose existente com o complemento de TTS
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

## 🎙️ Kokoro com a voz pm_santa

Sem o complemento Docker, o bot usa o Edge quando `TTS_PROVIDER` está ausente ou vale `edge`/`msedge`. Para usar o Kokoro diretamente, configure `TTS_PROVIDER=kokoro`, `KOKORO_URL` com a URL do serviço e `KOKORO_VOICE=pm_santa`. Com `docker-compose.kokoro.yml`, use `AR_AUTO_TTS_PROVIDER` no `.env` do projeto Compose, como explicado abaixo. O mesmo provedor é usado para reflexões e aulas; os grupos, filtros, adaptação dos textos e fila não mudam. O Kokoro é executado no próprio computador/servidor, sem cobrança por áudio: por padrão usa CPU e pode usar GPU NVIDIA com o complemento opcional. A velocidade de processamento e o consumo de RAM dependem do hardware e do tamanho da mensagem.

O serviço [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI) divide o texto para geração e retorna um MP3 completo; o bot pede português brasileiro (`lang_code=p`) e aguarda a resposta inteira antes de enviar. O limite padrão é de 30 minutos por tentativa e pode ser ajustado em `KOKORO_TIMEOUT_MS`. A falha segue as quatro tentativas e o relatório descritos abaixo: não há troca automática de voz nem envio apenas do texto.

Para testar com um serviço já disponível, sem enviar mensagens no WhatsApp:

```bash
TTS_PROVIDER=kokoro KOKORO_URL=http://127.0.0.1:8880 KOKORO_VOICE=pm_santa npm run test:tts
```

O comando mostra o caminho do MP3 gerado em `audio_output/`. Se o bot e o Kokoro estiverem em containers diferentes, `127.0.0.1` aponta para o próprio container do bot, não para o Kokoro: use o nome do serviço na rede Docker, como na configuração abaixo.

### Velocidade da fala

`KOKORO_SPEED` controla o ritmo: o padrão escolhido para o bot é `0.65`; `1.0` corresponde ao ritmo normal do Kokoro, `0.85` é mais lento e `1.15` é mais rápido. São aceitos valores de `0.25` a `4.0`; valores extremos podem soar pouco naturais. O bot também aceita vírgula decimal. Sem essa variável, usa `0.65`.

No Compose abaixo, adicione ou altere `KOKORO_SPEED=0.85` no `.env` usado pelo projeto da Evolution e recrie o serviço do bot com o mesmo complemento, após a fila esvaziar. Confira a configuração efetiva antes de recriar; modificar um `.env` em outra pasta não altera o container. Depois que a versão do código com essa opção estiver instalada, mudar apenas o valor não exige reconstruir a imagem.

### Escolher entre Kokoro e Microsoft Edge no Docker

No `.env` usado pelo projeto Compose da Evolution, defina **uma** das opções:

```dotenv
AR_AUTO_TTS_PROVIDER=kokoro
# ou: AR_AUTO_TTS_PROVIDER=msedge
```

O padrão do complemento Docker é `kokoro`, com voz `pm_santa` e ritmo `0.65`; escolher `msedge` usa o gerador anterior e `SPEECHMA_VOICE`. O ritmo `KOKORO_SPEED` vale apenas para o Kokoro. Essa variável de escolha é específica do complemento: uma configuração antiga `TTS_PROVIDER=edge` no `.env` não troca o provedor do Compose sem que `AR_AUTO_TTS_PROVIDER` seja definido.

No servidor, após instalar a versão que contém `scripts/arauto-compose.sh`, use o arquivo `.env` do projeto da Evolution (geralmente `~/dev/evolution-api/.env`). Edite-o preservando as demais linhas e deixe `AR_AUTO_TTS_PROVIDER` apenas uma vez. O script identifica o projeto e os arquivos do Compose pelo container `evolution-api-bot-1` e inclui o complemento sem duplicá-lo. Veja o provedor e a velocidade que serão aplicados sem exibir as chaves:

```bash
cd ~/dev/arauto-bot
sudo ./scripts/arauto-compose.sh config --format json | python3 -c 'import json,sys; e=json.load(sys.stdin)["services"]["bot"]["environment"]; print("TTS_PROVIDER:", e.get("TTS_PROVIDER")); print("KOKORO_SPEED:", e.get("KOKORO_SPEED"))'
```

Se escolher Kokoro e o serviço não estiver rodando, inicie-o antes de trocar o bot:

```bash
sudo ./scripts/arauto-compose.sh up -d --wait --wait-timeout 300 --no-deps kokoro
```

Espere a fila esvaziar e aplique a escolha recriando somente o bot:

```bash
sudo ./scripts/arauto-compose.sh up -d --no-deps bot
```

Na primeira atualização do código, use `up -d --build --no-deps bot`; mudanças posteriores apenas no `.env` não exigem `--build`. Reiniciar com `restart` não aplica novas variáveis de ambiente. Depois de mudar para o Edge e confirmar que não há áudio Kokoro em processamento, você pode executar `sudo ./scripts/arauto-compose.sh stop kokoro` para liberar os recursos do serviço. Para voltar ao Kokoro, inicie-o novamente antes de recriar o bot.

A escolha vale para os dois fluxos e não há mudança automática de serviço em caso de erro: as tentativas e o relatório de falha permanecem como antes.

### Kokoro opcional com GPU NVIDIA

O padrão continua sendo a imagem CPU. O complemento `docker-compose.kokoro-gpu.yml` substitui apenas o serviço Kokoro pela imagem `v0.10.0-cu126`, pede uma GPU NVIDIA e mantém a voz, a velocidade, os destinos e as demais opções. A variante cu126 foi escolhida por também contemplar placas Maxwell, como a GeForce 940MX. O driver NVIDIA e o NVIDIA Container Toolkit precisam funcionar no servidor e dentro do Docker antes da ativação. O complemento usa por padrão um limite de 2500 MiB de **RAM do container**, sem swap; isso não limita a memória de vídeo. Para ajustar, defina `AR_AUTO_KOKORO_GPU_MEM_LIMIT` no `.env` do projeto Compose.

O complemento inicia também `arauto-gpu-metrics`, um processo separado que consulta `nvidia-smi` e fornece apenas as métricas da placa para o painel pela rede interna do Compose. Ele não publica porta no servidor nem recebe o socket do Docker. O bot continua funcionando se o monitor de GPU estiver indisponível; o painel mostrará “Sem dados”. As medições de tempo CPU e GPU ficam separadas no histórico do painel.

Após atualizar o código, confirme que a fila e qualquer geração estejam vazias; a troca para GPU recria o Kokoro e o bot. Mensagens enviadas enquanto o bot estiver parado podem não ser processadas, conforme a configuração de entrega da Evolution. Com `AR_AUTO_TTS_PROVIDER=kokoro` configurado no Compose, use os comandos a partir da pasta do bot:

```bash
cd ~/dev/arauto-bot &&
git pull --ff-only origin main &&
sudo ./scripts/arauto-kokoro.sh gpu
```

O comando valida as configurações, verifica as imagens CPU e GPU e constrói a imagem do bot antes de pará-lo. Depois testa um MP3 sintético na GPU sem enviar mensagens, inicia o bot e verifica duas vezes sua rota local de saúde. Se a ativação ou o teste falhar, tenta restaurar automaticamente a CPU e informa o resultado. Se a restauração também falhar, confira os logs e tente novamente o comando de retorno à CPU; uma cópia local dos caminhos do Compose em `.arauto-state/` permite a recuperação mesmo se o container do bot tiver desaparecido. A cópia não inclui chaves ou conteúdo das mensagens.

O monitor de GPU é iniciado por último e sua falha não impede o bot de iniciar. Depois de ativado, `scripts/arauto-compose.sh` preserva o complemento GPU e o painel nas próximas chamadas. Verifique `sudo ./scripts/arauto-compose.sh logs --tail=100 bot kokoro arauto-gpu-metrics` e, se o painel estiver habilitado, confirme nele as métricas. Uma amostra sintética e métricas disponíveis não garantem desempenho ou memória suficientes para todo texto futuro.

Para voltar à CPU, espere a fila esvaziar e execute:

```bash
sudo ./scripts/arauto-kokoro.sh cpu
```

O retorno ignora o complemento GPU mesmo se ele estiver inválido, restaura primeiro os serviços CPU e depois tenta remover o monitor separado. Ele preserva os demais arquivos do Compose e não apaga as imagens, volumes, configurações da Evolution ou áudios. Durante o funcionamento normal, não há troca automática para CPU: falhas seguem as tentativas e o relatório já existentes.

### Testar e ativar no Compose existente

O arquivo `docker-compose.kokoro.yml` é um complemento ao Compose já usado pela Evolution. Ele adiciona um serviço Kokoro somente na rede Docker e, por padrão, configura o bot para usar `pm_santa`. A imagem está fixada na versão `v0.10.0`; a atualização automática do `msedge-tts` não atualiza a imagem do Kokoro. Após o primeiro download, o modelo já incluído na imagem pode ser usado sem internet.

Na instalação em que o container do bot se chama `evolution-api-bot-1`, execute no servidor:

```bash
cd ~/dev/arauto-bot
git pull --ff-only origin main

cd ~/dev/evolution-api
# Reutiliza os mesmos arquivos e nome de projeto do Compose que iniciou o bot.
AR_AUTO_COMPOSE_PATHS="$(sudo docker inspect --format '{{ index .Config.Labels "com.docker.compose.project.config_files" }}' evolution-api-bot-1)"
AR_AUTO_PROJECT="$(sudo docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' evolution-api-bot-1)"
AR_AUTO_COMPOSE_FILE="${AR_AUTO_COMPOSE_PATHS//,/:}"
case ":$AR_AUTO_COMPOSE_FILE:" in
  *":$HOME/dev/arauto-bot/docker-compose.kokoro.yml:"*) ;;
  *) AR_AUTO_COMPOSE_FILE="$AR_AUTO_COMPOSE_FILE:$HOME/dev/arauto-bot/docker-compose.kokoro.yml" ;;
esac

arauto_kokoro() {
  sudo env COMPOSE_FILE="$AR_AUTO_COMPOSE_FILE" docker compose -p "$AR_AUTO_PROJECT" "$@"
}

# Valida a configuração, baixa/inicia o Kokoro e constrói a nova imagem do bot.
arauto_kokoro config --quiet
arauto_kokoro up -d --wait --wait-timeout 300 --no-deps kokoro
arauto_kokoro build bot

# Executa apenas o gerador numa instância temporária: não envia mensagens.
arauto_kokoro run --rm --no-deps bot node scripts/test-tts.js
```

O teste informa o caminho do arquivo dentro de `/app/audio_output`, no volume de áudio. O bot que já estava em produção ainda não foi recriado. Se o teste funcionar, espere a fila esvaziar e ative o código e as variáveis no bot:

```bash
arauto_kokoro up -d --no-deps bot
arauto_kokoro logs -f --tail 50 bot
```

Para conferir as variáveis efetivas sem exibir as chaves, execute:

```bash
arauto_kokoro config --format json | python3 -c 'import json,sys; e=json.load(sys.stdin)["services"]["bot"]["environment"]; print("TTS_PROVIDER:", e.get("TTS_PROVIDER")); print("KOKORO_URL:", e.get("KOKORO_URL")); print("KOKORO_VOICE:", e.get("KOKORO_VOICE")); print("KOKORO_SPEED:", e.get("KOKORO_SPEED"))'
```

Se o nome do container ou os caminhos forem diferentes, adapte-os antes de executar. O complemento adiciona a rede padrão ao bot e ao Kokoro; instalações que usem `network_mode` ou redes especiais devem ser ajustadas conforme sua configuração. As futuras operações do Compose devem incluir o mesmo complemento enquanto essa configuração estiver ativa. Use a variável de escolha acima para voltar ao Edge e pare o serviço Kokoro se não precisar dele.

## Atualizar a configuração das aulas de IA no Ubuntu Server

Esta alteração não exige migração de banco nem recriação de PostgreSQL, Redis ou Evolution API. Se o bot já recebe e envia mensagens, mantenha as configurações atuais de conexão, instância, webhook e grupo.

1. Na pasta do bot, execute `git pull --ff-only origin main`.
2. Edite o `.env` existente e acrescente `IA_WATCH_NUMBER` e `IA_TARGET_GROUP_ID` com o remetente e o grupo corretos. Preserve as demais variáveis; não substitua o arquivo pelo `.env.example`.
3. Garanta que `AUDIO_ENABLED` esteja ausente (padrão `true`) ou definido como `true`.
4. Execute `npm test` e reinicie o processo. Com PM2: `pm2 restart arauto-bot --update-env`.
5. Acompanhe `pm2 logs arauto-bot --lines 50`. O log identifica “reflexão do grupo” ou “aula de IA” e o destino escolhido.

Nenhuma dependência nova é necessária para esta mudança. Se o próprio bot estiver dentro de um container, reconstrua/recrie somente o serviço do bot com o código novo e as variáveis carregadas pelo container. Editar um `.env` no host só funciona se o serviço realmente o repassar ou montar. Preserve as pastas persistentes do bot, especialmente `.tts-runtime/`. A Evolution API precisa permanecer conectada à conta do WhatsApp e acessível pelo bot; a mudança de sistema operacional não altera as rotas de envio usadas pelo código.

## 📊 Painel local de acompanhamento

O painel opcional é somente para leitura e **não usa senha**. Mostra a etapa atual, a fila, as tentativas, a saúde do Kokoro e o texto adaptado pelo Gemini enquanto é recebido. A prévia do texto permanece apenas na memória do bot e é limitada a 100 mil caracteres; isso não limita o texto processado ou enviado. O painel não exibe chaves, telefones ou o texto original.

Para Gemini e Kokoro, a barra mostra uma **estimativa**, não uma porcentagem real. A previsão usa os tempos de pelo menos duas execuções bem-sucedidas com tamanhos semelhantes; modelos, provedor, voz, ritmo e dispositivo CPU/GPU têm históricos separados. Sem dados suficientes, ou quando o tempo previsto é ultrapassado, a barra não informa uma porcentagem nem promete um prazo. Os últimos 100 eventos e medições numéricas ficam em `logs/painel-monitor.json`, preservados pelo volume de logs; o histórico do painel não grava mensagens. Os logs comuns do bot continuam seguindo sua configuração anterior.

O uso de CPU é uma leitura geral do servidor. Na execução direta, a GPU mostra uso e memória se `nvidia-smi` estiver disponível ao processo do bot. Com o complemento opcional NVIDIA, um monitor isolado consulta a placa e repassa as métricas pela rede interna; se não estiver disponível, o painel mostra “Sem dados”. Não é necessário conceder acesso ao socket Docker para o painel.

A página e o Kokoro funcionam na rede local após a instalação; o bot precisa de internet para o Gemini e das conexões habituais da Evolution para o WhatsApp. O painel local não precisa ser publicado na internet para mostrar o Gemini.

No servidor, após baixar esta versão, adicione no `.env` do projeto Compose da Evolution, preservando as demais configurações:

```env
# Padrão: 127.0.0.1, acessível apenas no servidor.
# Para acesso por outro computador da rede, substitua pelo IP local do servidor.
AR_AUTO_DASHBOARD_BIND=127.0.0.1
AR_AUTO_DASHBOARD_PORT=3001
```

Use `hostname -I` no servidor para identificar o IP local, por exemplo `192.168.1.20`, e coloque esse IP em `AR_AUTO_DASHBOARD_BIND` para permitir o acesso por outro computador na mesma rede. Após a fila esvaziar, habilite o complemento e reconstrua o bot:

```bash
cd ~/dev/arauto-bot
sudo ./scripts/arauto-compose.sh -f "$HOME/dev/arauto-bot/docker-compose.dashboard.yml" up -d --build --no-deps bot
```

Abra `http://IP_DO_SERVIDOR:3001/` no navegador. O complemento habilita o painel e passa a constar na configuração do container: comandos posteriores com `scripts/arauto-compose.sh` o preservam. Para acesso exclusivo no próprio servidor use `http://127.0.0.1:3001/`. Em execução direta, defina `AR_AUTO_DASHBOARD_ENABLED=true` para habilitar o painel; ele escuta apenas em `127.0.0.1` por padrão. Para permitir acesso direto pela rede local, configure explicitamente `AR_AUTO_DASHBOARD_INTERNAL_BIND` com o IP desejado.

O painel usa HTTP **sem autenticação**, e o texto gerado fica visível a qualquer pessoa que consiga acessá-lo. Use-o somente em uma rede local confiável e não publique a porta na internet; para acesso remoto, use uma conexão privada, como VPN ou túnel SSH. A antiga variável `AR_AUTO_DASHBOARD_PASSWORD`, se ainda existir no `.env`, não é utilizada. Se o IP do servidor mudar, atualize o `.env` e recrie o bot após a fila esvaziar.

## ⏱️ Fila e relatório de falhas de áudio

Depois de cada tentativa de publicação, o bot sorteia uma pausa de 1 a 3 minutos antes de processar a próxima reflexão válida. O intervalo também é respeitado quando a fila fica vazia e chega outra mensagem logo depois. Texto e áudio da mesma reflexão continuam sendo enviados juntos; a pausa longa é entre reflexões.

Se a **geração** do áudio falhar, inclusive se o stream encerrar antes de `turn.end`, o bot aguarda de 3 a 5 minutos entre tentativas e tenta até quatro vezes no total. Durante as tentativas, as mensagens seguintes permanecem na fila. Caso nenhuma funcione, a reflexão não é publicada; o bot envia ao número em `ERROR_REPORT_NUMBER` um relatório com o destino, ID da mensagem e os erros das tentativas. Em seguida, continua a fila. Quando o áudio é desativado por `AUDIO_ENABLED=false`, o envio somente de texto continua sendo intencional.

Configure `ERROR_REPORT_NUMBER` no `.env` com DDI e DDD e apenas dígitos. Pode ser o número conectado à Evolution API, mas verifique que o envio para si mesmo funciona nessa instalação. Se o número não estiver configurado ou o envio do relatório falhar, o erro fica no log e o processamento segue. O envio do relatório tem limite de 15 segundos.

A fila e as esperas ficam na memória: reiniciar o bot durante o processamento pode descartar a mensagem em andamento e as mensagens que aguardam. Além disso, texto e áudio são chamadas separadas à Evolution: se ela aceitar o texto e falhar depois no envio do áudio, não há como desfazer automaticamente o texto já enviado. As novas tentativas acima tratam falhas de geração do áudio antes da publicação.

## 🔄 Atualização automática do Microsoft Edge TTS

Antes de processar cada reflexão válida, o bot consulta a versão estável `latest` do pacote [msedge-tts](https://github.com/Migushthe2nd/MsEdgeTTS) no npm. Se houver uma versão superior à ativa, aguarda a instalação e passa a usá-la no áudio daquela reflexão quando o provedor é `edge`, sem reiniciar o processo. A checagem também acontece com Kokoro e quando `AUDIO_ENABLED=false`; mensagens descartadas pelos filtros não consultam o npm. O Kokoro é uma imagem separada e não é atualizado por essa checagem.

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
| `TTS_PROVIDER` | Provedor para execução direta: `edge`/`msedge` (padrão) ou `kokoro` |
| `AR_AUTO_TTS_PROVIDER` | Provedor no complemento Docker: `kokoro` (padrão) ou `msedge` |
| `KOKORO_URL` | Endereço do Kokoro-FastAPI; no Compose: `http://kokoro:8880` |
| `KOKORO_VOICE` | Voz Kokoro (padrão: `pm_santa`) |
| `KOKORO_SPEED` | Ritmo da fala de `0.25` a `4.0` (padrão do bot: `0.65`; normal no Kokoro: `1.0`) |
| `KOKORO_TIMEOUT_MS` | Limite por tentativa em milissegundos (padrão: `1800000`) |
| `SPEECHMA_VOICE` | Voz neural do Edge (padrão: `pt-BR-AntonioNeural`) |
| `WEBHOOK_TOKEN` | Token de segurança do webhook |
| `AI_PROMPT` | Instrução de adaptação do texto |

## ⚠️ Avisos

- A Evolution API usa a biblioteca **Baileys** (cliente não-oficial do WhatsApp). Isso contraria os Termos de Uso da Meta e pode resultar em banimento do número. Use um número secundário e volume moderado. Para uso comercial em escala, considere a [WhatsApp Business Platform](https://business.whatsapp.com/products/business-platform) oficial.
- Nunca versione o arquivo `.env` — mantenha segredos fora do repositório.

## 📜 Licença

MIT — use, estude e adapte à vontade.

---

**Desenvolvido por [Alerson dos Santos Ferreira](https://github.com/dev-alef) · Genesis Code** 🌲
