🤖 PM2 (gerenciar o bot)
pm2 status                       # ver se o bot está rodando
pm2 logs whatsapp-bot            # ver logs ao vivo (Ctrl+C sai, bot continua)
pm2 logs whatsapp-bot --lines 100  # ver últimas 100 linhas
pm2 restart whatsapp-bot         # reiniciar (USAR após editar código ou .env!)
pm2 stop whatsapp-bot            # parar o bot
pm2 start whatsapp-bot           # iniciar de novo (se parado)
pm2 delete whatsapp-bot          # remover do pm2 (pra recriar do zero)
pm2 start server.js --name whatsapp-bot   # criar de novo (na pasta do projeto)
pm2 save                         # salvar estado atual (após mudanças)
pm2 flush whatsapp-bot           # limpar logs antigos do pm2

🐳 Docker (Evolution API + bancos)
docker ps                        # containers rodando
docker ps -a                     # todos (incluindo parados)
docker start evolution_api       # ligar a Evolution
docker stop evolution_api        # desligar
docker restart evolution_api     # reiniciar (se travar/bugar)
docker logs evolution_api --tail 50       # últimas 50 linhas de log
docker logs evolution_api --follow --tail 0   # logs ao vivo (Ctrl+C sai)
docker start fintrack_postgres   # ligar o Postgres (a Evolution DEPENDE dele!)
docker start fintrack_redis      # ligar o Redis


📡 Evolution API (via curl)
# Status da instância (conectada ao WhatsApp?)
curl "http://localhost:8080/instance/connectionState/minha-instancia" -H "apikey: genesis-code-2026-xyz"

# Listar grupos (pegar IDs)
curl "http://localhost:8080/group/fetchAllGroups/minha-instancia?getParticipants=false" -H "apikey: genesis-code-2026-xyz"

# Ver configuração do webhook
curl "http://localhost:8080/webhook/find/minha-instancia" -H "apikey: genesis-code-2026-xyz"

# Testar envio de texto direto no grupo (sem passar pelo bot)
curl -X POST "http://localhost:8080/message/sendText/minha-instancia" -H "apikey: genesis-code-2026-xyz" -H "Content-Type: application/json" -d "{\"number\":\"120363425334527365@g.us\",\"text\":\"teste\"}"


🧪 Testes dos componentes
node scripts/test-ai.js          # testa só a IA (Gemini)
node scripts/test-speechma.js    # testa só o áudio (gera MP3 em audio_output/)
# Testa se o bot está de pé
curl http://localhost:3000/


🔍 Diagnóstico rápido ("não está funcionando!")
Roda nessa ordem e onde falhar é o problema:
docker ps                        # 1. infra de pé? (3 containers)
pm2 status                       # 2. bot online?
curl http://localhost:3000/      # 3. bot responde?
pm2 logs whatsapp-bot --lines 30 # 4. o que aconteceu por último?
docker logs evolution_api --tail 30   # 5. e do lado da Evolution?




🧹 Manutenção
# Limpar áudios antigos acumulados (Git Bash)
rm -f audio_output/*.mp3

# Ver espaço que a pasta ocupa
du -sh audio_output/