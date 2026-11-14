/** Estado resumido do processamento, sem textos, números ou credenciais. */
const estado = {
  iniciadoEm: Date.now(),
  etapa: 'aguardando',
  etapaDesde: Date.now(),
  tipo: null,
  tentativa: null,
  maxTentativas: null,
  proximaTentativaEm: null,
  pendentes: 0,
  eventos: [],
};

function evento(mensagem, nivel = 'info') {
  estado.eventos.unshift({ mensagem, nivel, quando: Date.now() });
  estado.eventos.length = Math.min(estado.eventos.length, 40);
}

function etapa(nome, opcoes = {}) {
  estado.etapa = nome;
  estado.etapaDesde = Date.now();
  estado.tentativa = opcoes.tentativa ?? null;
  estado.maxTentativas = opcoes.maxTentativas ?? null;
  estado.proximaTentativaEm = opcoes.proximaTentativaEm ?? null;
  if (opcoes.evento) evento(opcoes.evento, opcoes.nivel);
}

function iniciar(tipo) {
  estado.tipo = tipo === 'aula de IA' ? 'Aula de IA' : 'Reflexão';
  etapa('preparando', { evento: `${estado.tipo} em processamento.` });
}

function finalizar() {
  estado.tipo = null;
  etapa('aguardando');
}

function atualizarFila(quantidade) {
  estado.pendentes = quantidade;
}

function consultar() {
  const provedor = (process.env.TTS_PROVIDER || 'edge').trim().toLowerCase();
  return {
    ...estado,
    agora: Date.now(),
    eventos: estado.eventos.map(item => ({ ...item })),
    modelo: (process.env.GEMINI_MODEL || 'gemini-2.5-flash').slice(0, 100),
    provedor,
    voz: provedor === 'kokoro' ? (process.env.KOKORO_VOICE || 'pm_santa').slice(0, 100) : null,
    velocidade: provedor === 'kokoro' ? (process.env.KOKORO_SPEED || '0.65').slice(0, 20) : null,
    audioAtivo: (process.env.AUDIO_ENABLED || 'true') !== 'false',
  };
}

module.exports = { evento, etapa, iniciar, finalizar, atualizarFila, consultar };
