#!/usr/bin/env bash
# Usa os arquivos do Compose que iniciaram o bot, adicionando o complemento TTS.
set -euo pipefail

container="${AR_AUTO_BOT_CONTAINER:-evolution-api-bot-1}"
bot_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
complemento="$bot_dir/docker-compose.kokoro.yml"

if [[ ! -f "$complemento" ]]; then
  echo 'Complemento docker-compose.kokoro.yml não encontrado.' >&2
  exit 1
fi

projeto="$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$container")"
diretorio="$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' "$container")"
arquivos="$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project.config_files" }}' "$container")"

if [[ -z "$projeto" || "$projeto" == '<no value>' || ! -d "$diretorio" || -z "$arquivos" || "$arquivos" == '<no value>' ]]; then
  echo 'Não foi possível identificar o projeto Compose do container do bot.' >&2
  exit 1
fi

IFS=',' read -r -a lista <<< "$arquivos"
argumentos=()
encontrou_complemento=false
for arquivo in "${lista[@]}"; do
  if [[ "$arquivo" != /* ]]; then
    arquivo="$diretorio/$arquivo"
  fi
  if [[ ! -f "$arquivo" ]]; then
    echo "Arquivo Compose não encontrado: $arquivo" >&2
    exit 1
  fi
  if [[ "$arquivo" -ef "$complemento" ]]; then
    encontrou_complemento=true
  fi
  argumentos+=(-f "$arquivo")
done
if [[ "$encontrou_complemento" == false ]]; then
  argumentos+=(-f "$complemento")
fi

cd -- "$diretorio"
exec docker compose --project-directory "$diretorio" -p "$projeto" "${argumentos[@]}" "$@"
