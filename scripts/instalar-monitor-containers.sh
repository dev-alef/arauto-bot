#!/usr/bin/env bash
# Instala o monitor no host sem dar acesso ao Docker aos containers do bot.
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo 'Execute com sudo: sudo ./scripts/instalar-monitor-containers.sh' >&2
  exit 1
fi
if ! command -v systemctl >/dev/null || [[ ! -x /usr/bin/docker || ! -x /usr/bin/python3 || ! -S /var/run/docker.sock ]]; then
  echo 'É necessário um servidor com systemd e Docker local em execução.' >&2
  exit 1
fi
diretorio="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
install -d -o root -g root -m 0755 /usr/local/lib/arauto-containers /var/lib/arauto-containers
install -o root -g root -m 0644 "$diretorio/monitor-containers.py" /usr/local/lib/arauto-containers/monitor-containers.py
install -o root -g root -m 0644 "$diretorio/arauto-containers.service" /etc/systemd/system/arauto-containers.service
systemctl daemon-reload
systemctl enable arauto-containers.service
systemctl restart arauto-containers.service
if ! systemctl is-active --quiet arauto-containers.service; then
  echo 'O monitor não iniciou. Consulte: sudo systemctl status arauto-containers.service --no-pager' >&2
  exit 1
fi
echo 'Monitor de containers instalado e iniciado.'
