#!/usr/bin/env bash
# Troca o dispositivo após a fila esvaziar, com retorno à CPU se a GPU falhar.
set -euo pipefail

modo="${1:-}"
if [[ "$modo" != gpu && "$modo" != cpu ]]; then
  echo 'Uso: scripts/arauto-kokoro.sh gpu|cpu' >&2
  exit 2
fi
container="${AR_AUTO_BOT_CONTAINER:-evolution-api-bot-1}"
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
compose="$repo/scripts/arauto-compose.sh"
estado_dir="$repo/.arauto-state"
estado="$estado_dir/compose-snapshot"

# Guarda os labels antes de qualquer recriação, inclusive para recuperação posterior.
if projeto="$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$container" 2>/dev/null)" &&
   diretorio="$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' "$container" 2>/dev/null)" &&
   arquivos="$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project.config_files" }}' "$container" 2>/dev/null)" &&
   [[ -n "$projeto" && "$projeto" != '<no value>' && -d "$diretorio" && -n "$arquivos" && "$arquivos" != '<no value>' ]]; then
  mkdir -p "$estado_dir"
  chmod 700 "$estado_dir"
  temporario="$(mktemp "$estado_dir/snapshot.XXXXXX")"
  printf '%s\n' "$container" "$projeto" "$diretorio" "$arquivos" > "$temporario"
  mv -f "$temporario" "$estado"
elif [[ "$modo" == cpu && -r "$estado" ]]; then
  mapfile -t salvo < "$estado"
  if [[ "${#salvo[@]}" != 4 || "${salvo[0]}" != "$container" ]]; then
    echo 'O snapshot do Compose não corresponde ao container solicitado.' >&2
    exit 1
  fi
  projeto="${salvo[1]}"; diretorio="${salvo[2]}"; arquivos="${salvo[3]}"
  echo 'Usando snapshot local para recuperar a configuração CPU.'
else
  echo 'Não foi possível identificar o Compose do bot; nenhum serviço foi alterado.' >&2
  exit 1
fi
export AR_AUTO_FROZEN_PROJECT="$projeto" AR_AUTO_FROZEN_WORKDIR="$diretorio" AR_AUTO_FROZEN_FILES="$arquivos"

garantir_imagem() {
  local selecao="$1" imagem
  imagem="$("$compose" "$selecao" config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["kokoro"]["image"])')"
  if ! docker image inspect "$imagem" >/dev/null 2>&1; then
    "$compose" "$selecao" pull kokoro
  fi
}

aguardar_bot() {
  local selecao="$1" tentativa verificacao
  # Execute o código do checkout: a imagem CPU anterior pode não conter este arquivo.
  verificacao="$(cat "$repo/scripts/check-bot-ready.js")"
  for ((tentativa=0; tentativa<20; tentativa++)); do
    if "$compose" "$selecao" exec -T bot node -e "$verificacao" >/dev/null 2>&1; then
      sleep 3
      if "$compose" "$selecao" exec -T bot node -e "$verificacao" >/dev/null 2>&1; then
        return 0
      fi
    fi
    sleep 1
  done
  echo 'O bot não confirmou a rota de saúde após a recriação.' >&2
  return 1
}

limpar_monitor() {
  local ids id
  if ! ids="$(docker ps -aq --filter "label=com.docker.compose.project=$AR_AUTO_FROZEN_PROJECT" --filter 'label=com.docker.compose.service=arauto-gpu-metrics')"; then
    echo 'Aviso: não foi possível localizar o monitor GPU para removê-lo.' >&2
    return
  fi
  while IFS= read -r id; do
    [[ -z "$id" ]] && continue
    docker rm -f "$id" || echo 'Aviso: não foi possível remover o monitor GPU.' >&2
  done <<< "$ids"
}

restaurar_cpu() {
  if "$compose" --kokoro-cpu stop bot &&
     "$compose" --kokoro-cpu up -d --wait --wait-timeout 300 --no-deps kokoro &&
     "$compose" --kokoro-cpu up -d --no-deps bot &&
     aguardar_bot --kokoro-cpu; then
    limpar_monitor
    echo 'Kokoro e bot iniciados com a configuração CPU.'
    return 0
  fi
  echo 'Não foi possível restaurar a CPU automaticamente; confira os logs antes de continuar.' >&2
  return 1
}

"$compose" --kokoro-cpu config --quiet
garantir_imagem --kokoro-cpu
if [[ "$modo" == gpu ]]; then
  # Validar e construir antes de parar o bot reduz o tempo de indisponibilidade.
  "$compose" --kokoro-gpu config --quiet
  garantir_imagem --kokoro-gpu
  "$compose" --kokoro-gpu build bot
fi
if [[ "$modo" == cpu ]]; then
  restaurar_cpu
  exit
fi
"$compose" --kokoro-cpu stop bot

if "$compose" --kokoro-gpu up -d --wait --wait-timeout 300 --no-deps kokoro &&
   "$compose" --kokoro-gpu run --rm --no-deps -e TTS_PROVIDER=kokoro bot node scripts/test-tts.js &&
   "$compose" --kokoro-gpu up -d --no-deps bot &&
   aguardar_bot --kokoro-gpu; then
  echo 'Kokoro GPU pronto e bot iniciado com o provedor configurado.'
  if ! "$compose" --kokoro-gpu up -d --no-deps arauto-gpu-metrics; then
    echo 'Aviso: o monitor GPU não iniciou; o painel poderá exibir Sem dados.' >&2
  fi
  exit 0
fi

echo 'Falha ao ativar ou testar GPU. Tentando restaurar a CPU...' >&2
restaurar_cpu || true
exit 1
