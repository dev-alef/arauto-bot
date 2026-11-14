#!/usr/bin/env bash
# Usa os arquivos do Compose que iniciaram o bot, adicionando o complemento TTS.
set -euo pipefail

modo="${1:-}"
if [[ "$modo" == '--kokoro-gpu' || "$modo" == '--kokoro-cpu' ]]; then
  shift
else
  modo='preservar'
fi

container="${AR_AUTO_BOT_CONTAINER:-evolution-api-bot-1}"
bot_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
complemento="$bot_dir/docker-compose.kokoro.yml"
complemento_gpu="$bot_dir/docker-compose.kokoro-gpu.yml"

if [[ ! -f "$complemento" ]]; then
  echo 'Complemento docker-compose.kokoro.yml não encontrado.' >&2
  exit 1
fi

if [[ -n "${AR_AUTO_FROZEN_PROJECT:-}${AR_AUTO_FROZEN_WORKDIR:-}${AR_AUTO_FROZEN_FILES:-}" ]]; then
  projeto="${AR_AUTO_FROZEN_PROJECT:-}"
  diretorio="${AR_AUTO_FROZEN_WORKDIR:-}"
  arquivos="${AR_AUTO_FROZEN_FILES:-}"
else
  projeto="$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$container")"
  diretorio="$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' "$container")"
  arquivos="$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project.config_files" }}' "$container")"
fi

if [[ -z "$projeto" || "$projeto" == '<no value>' || ! -d "$diretorio" || -z "$arquivos" || "$arquivos" == '<no value>' ]]; then
  echo 'Não foi possível identificar o projeto Compose do container do bot.' >&2
  exit 1
fi

IFS=',' read -r -a lista <<< "$arquivos"
argumentos=()
encontrou_complemento=false
encontrou_gpu=false
for arquivo in "${lista[@]}"; do
  if [[ "$arquivo" != /* ]]; then
    arquivo="$diretorio/$arquivo"
  fi
  if [[ "$arquivo" == "$complemento_gpu" || ( -f "$complemento_gpu" && "$arquivo" -ef "$complemento_gpu" ) ]]; then
    if [[ "$modo" == '--kokoro-cpu' ]]; then
      continue
    fi
    if [[ "$encontrou_complemento" == false ]]; then
      argumentos+=(-f "$complemento")
      encontrou_complemento=true
    fi
    encontrou_gpu=true
  fi
  if [[ ! -f "$arquivo" ]]; then
    echo "Arquivo Compose não encontrado: $arquivo" >&2
    exit 1
  fi
  if [[ "$arquivo" -ef "$complemento" ]]; then
    if [[ "$encontrou_complemento" == true ]]; then
      continue
    fi
    encontrou_complemento=true
  fi
  argumentos+=(-f "$arquivo")
done
if [[ "$encontrou_complemento" == false ]]; then
  argumentos+=(-f "$complemento")
fi
if [[ "$modo" == '--kokoro-gpu' && "$encontrou_gpu" == false ]]; then
  if [[ ! -f "$complemento_gpu" ]]; then
    echo 'Complemento docker-compose.kokoro-gpu.yml não encontrado.' >&2
    exit 1
  fi
  argumentos+=(-f "$complemento_gpu")
fi

cd -- "$diretorio"
export AR_AUTO_REPO_DIR="$bot_dir"
exec docker compose --project-directory "$diretorio" -p "$projeto" "${argumentos[@]}" "$@"
