/** Estado do painel e histórico limitado, sem gravar mensagens ou telefones. */
const fs = require('fs');
const path = require('path');

const LIMITE_EVENTOS = 100;
const LIMITE_AMOSTRAS = 100;
const LIMITE_TEXTO = 100000;

function criarMonitor({ agora = Date.now } = {}) {
  const estado = {
    iniciadoEm: agora(), etapa: 'aguardando', etapaDesde: agora(), tipo: null,
    tentativa: null, maxTentativas: null, proximaTentativaEm: null, pendentes: 0,
    eventos: [], textoGerado: '', textoCompleto: false, textoTruncado: false, progresso: null,
  };
  let amostras = [], arquivo = null, registroAtual = null, avisouErro = false;

  function salvar() {
    if (!arquivo) return;
    const temporario = `${arquivo}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(arquivo), { recursive: true });
      // Apenas eventos resumidos e métricas numéricas são persistidos.
      fs.writeFileSync(temporario, JSON.stringify({ eventos: estado.eventos, amostras }), { mode: 0o600 });
      fs.renameSync(temporario, arquivo);
      avisouErro = false;
    } catch {
      try { fs.rmSync(temporario, { force: true }); } catch {}
      if (!avisouErro) console.warn('⚠️ Não foi possível salvar o histórico do painel.');
      avisouErro = true;
    }
  }

  function habilitarPersistencia(caminho) {
    arquivo = caminho;
    try {
      const conteudo = fs.readFileSync(arquivo, 'utf8');
      if (conteudo.length > 1024 * 1024) return;
      const anterior = JSON.parse(conteudo);
      if (Array.isArray(anterior.eventos)) {
        estado.eventos = anterior.eventos.filter(e => e && typeof e.mensagem === 'string' &&
          e.mensagem.length <= 300 && ['info', 'warn', 'error', 'success'].includes(e.nivel) &&
          Number.isFinite(e.quando)).slice(0, LIMITE_EVENTOS);
      }
      if (Array.isArray(anterior.amostras)) {
        amostras = anterior.amostras.filter(a => a && typeof a.chave === 'string' &&
          a.chave.length <= 200 && Number.isFinite(a.tamanho) && a.tamanho > 0 &&
          Number.isFinite(a.duracaoMs) && a.duracaoMs > 0).slice(-LIMITE_AMOSTRAS);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('⚠️ Não foi possível carregar o histórico do painel.');
    }
  }

  function evento(mensagem, nivel = 'info') {
    estado.eventos.unshift({ mensagem: String(mensagem).slice(0, 300), nivel, quando: agora() });
    estado.eventos.length = Math.min(estado.eventos.length, LIMITE_EVENTOS);
    salvar();
  }

  function chavePara(nome) {
    if (nome === 'ia') return `ia:${(process.env.GEMINI_MODEL || 'gemini-2.5-flash').slice(0, 80)}`;
    const provedor = (process.env.TTS_PROVIDER || 'edge').trim().toLowerCase();
    if (provedor !== 'kokoro') return `audio:${provedor.slice(0, 30)}`;
    return ['audio', provedor, process.env.KOKORO_VOICE || 'pm_santa',
      process.env.KOKORO_SPEED || '0.65', process.env.AR_AUTO_KOKORO_DEVICE || 'desconhecido']
      .map(v => String(v).slice(0, 30)).join(':');
  }

  function etapa(nome, opcoes = {}) {
    estado.etapa = nome;
    estado.etapaDesde = agora();
    estado.tentativa = opcoes.tentativa ?? null;
    estado.maxTentativas = opcoes.maxTentativas ?? null;
    estado.proximaTentativaEm = opcoes.proximaTentativaEm ?? null;
    estado.progresso = null;
    registroAtual = null;
    if (['ia', 'audio'].includes(nome) && Number.isFinite(opcoes.tamanho) && opcoes.tamanho > 0) {
      const tamanho = opcoes.tamanho;
      const chave = chavePara(nome);
      const comparaveis = amostras.filter(a => a.chave === chave && a.tamanho >= tamanho / 2 && a.tamanho <= tamanho * 2).slice(-20);
      let estimativaMs = null;
      if (comparaveis.length >= 2) {
        const estimativas = comparaveis.map(a => a.duracaoMs * tamanho / a.tamanho).sort((a, b) => a - b);
        estimativaMs = Math.round(estimativas[Math.floor(estimativas.length / 2)]);
      }
      registroAtual = { chave, tamanho, inicio: estado.etapaDesde };
      estado.progresso = { estimativaMs, observacoes: comparaveis.length };
    }
    if (opcoes.evento) evento(opcoes.evento, opcoes.nivel);
  }

  function concluirEtapa() {
    if (!registroAtual) return;
    const duracaoMs = agora() - registroAtual.inicio;
    if (duracaoMs > 0) {
      amostras.push({ chave: registroAtual.chave, tamanho: registroAtual.tamanho, duracaoMs });
      amostras = amostras.slice(-LIMITE_AMOSTRAS);
      salvar();
    }
    registroAtual = null;
  }

  function definirTexto(texto, completo = false) {
    const valor = typeof texto === 'string' ? texto : '';
    estado.textoTruncado = valor.length > LIMITE_TEXTO;
    estado.textoGerado = valor.slice(0, LIMITE_TEXTO).replace(/[\uD800-\uDBFF]$/, '');
    estado.textoCompleto = Boolean(completo);
  }

  function iniciar(tipo) {
    estado.tipo = tipo === 'aula de IA' ? 'Aula de IA' : 'Reflexão';
    definirTexto('');
    etapa('preparando', { evento: `${estado.tipo} em processamento.` });
  }

  function finalizar() {
    estado.tipo = null;
    etapa('aguardando');
  }

  function atualizarFila(quantidade) { estado.pendentes = quantidade; }

  function consultar() {
    const provedor = (process.env.TTS_PROVIDER || 'edge').trim().toLowerCase();
    return {
      ...estado, agora: agora(), eventos: estado.eventos.map(item => ({ ...item })),
      progresso: estado.progresso ? { ...estado.progresso } : null,
      modelo: (process.env.GEMINI_MODEL || 'gemini-2.5-flash').slice(0, 100), provedor,
      voz: provedor === 'kokoro' ? (process.env.KOKORO_VOICE || 'pm_santa').slice(0, 100) : null,
      velocidade: provedor === 'kokoro' ? (process.env.KOKORO_SPEED || '0.65').slice(0, 20) : null,
      audioAtivo: (process.env.AUDIO_ENABLED || 'true') !== 'false',
    };
  }

  return { evento, etapa, iniciar, finalizar, atualizarFila, consultar, definirTexto, concluirEtapa, habilitarPersistencia };
}

module.exports = { ...criarMonitor(), criarMonitor };
