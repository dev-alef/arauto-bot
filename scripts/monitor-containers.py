"""Coleta estados Docker no host e publica somente os dados usados pelo painel."""

import json
import os
import subprocess
import tempfile
import time


PASTA = '/var/lib/arauto-containers'
INTERVALO = 10
LIMITE_CONTAINERS = 200
FORMATO = '[{{json .Names}},{{json .State}},{{json .Status}}]'


def consultar():
    """Não grava imagem, comandos, labels, variáveis, portas ou logs dos containers."""
    saida = subprocess.run(
        ['/usr/bin/docker', 'ps', '-a', '--format', FORMATO],
        check=True, capture_output=True, text=True, timeout=5,
    )
    linhas = saida.stdout.splitlines()
    containers = []
    for linha in linhas[:LIMITE_CONTAINERS]:
        nome, estado, status = json.loads(linha)
        if not all(isinstance(campo, str) for campo in (nome, estado, status)):
            raise ValueError('Resposta inválida do Docker')
        containers.append({'nome': nome[:255], 'estado': estado[:40], 'status': status[:200]})
    return {'disponivel': True, 'containers': containers, 'limitado': len(linhas) > LIMITE_CONTAINERS}


def publicar(pasta=PASTA):
    try:
        dados = consultar()
    except (OSError, ValueError, subprocess.SubprocessError):
        dados = {'disponivel': False, 'containers': [], 'limitado': False}
    dados['atualizadoEm'] = int(time.time() * 1000)
    fd, temporario = tempfile.mkstemp(prefix='.status-', dir=pasta)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as arquivo:
            json.dump(dados, arquivo, ensure_ascii=False)
            arquivo.flush()
        os.chmod(temporario, 0o644)
        os.replace(temporario, os.path.join(pasta, 'status.json'))
    finally:
        if os.path.exists(temporario):
            os.unlink(temporario)


if __name__ == '__main__':
    while True:
        publicar()
        time.sleep(INTERVALO)
