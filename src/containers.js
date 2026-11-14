/** Lê somente o resumo publicado pelo monitor do host, sem acessar o Docker. */
const fs = require('node:fs/promises');

const LIMITE_BYTES = 150000;
const MAX_IDADE_MS = 45000;
const INDISPONIVEL = Object.freeze({ disponivel: false, motivo: 'monitor_indisponivel' });

function criarLeitorContainers({ arquivo = process.env.AR_AUTO_CONTAINERS_STATUS_FILE || '', agora = Date.now } = {}) {
  async function consultar() {
    if (!arquivo) return INDISPONIVEL;
    let handle;
    try {
      handle = await fs.open(arquivo, 'r');
      const info = await handle.stat();
      if (!info.isFile() || info.size > LIMITE_BYTES) return INDISPONIVEL;
      const dados = JSON.parse(await handle.readFile('utf8'));
      const idade = agora() - dados.atualizadoEm;
      if (!Number.isFinite(dados.atualizadoEm) || idade > MAX_IDADE_MS || idade < -10000) return INDISPONIVEL;
      if (dados.disponivel === false) return { disponivel: false, motivo: 'docker_indisponivel' };
      if (dados.disponivel !== true || !Array.isArray(dados.containers) || dados.containers.length > 200) return INDISPONIVEL;
      const containers = dados.containers.map(item => {
        if (!item || typeof item.nome !== 'string' || !item.nome || item.nome.length > 255 ||
            typeof item.estado !== 'string' || item.estado.length > 40 ||
            typeof item.status !== 'string' || item.status.length > 200) throw new Error('Dados inválidos');
        return { nome: item.nome, estado: item.estado, status: item.status };
      });
      return { disponivel: true, atualizadoEm: dados.atualizadoEm, containers, limitado: dados.limitado === true };
    } catch {
      return INDISPONIVEL;
    } finally {
      if (handle) await handle.close().catch(() => {});
    }
  }
  return { consultar };
}

module.exports = { criarLeitorContainers };
