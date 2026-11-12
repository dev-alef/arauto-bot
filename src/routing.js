/** Seleciona um único destino antes de adaptar ou gerar áudio. */
const GATILHO = /^(shalom|shalon|amém|amem),?\s*amado/i;
const CURSO_IA = /\bcurso\s+(?:progressivo\s+)?(?:de|sobre)\s+(?:intelig[eê]ncia\s+artificial|ia)\b/i;
const MARCADOR_AULA = /\[aula[ \t]+ia\]/i;
const CABECALHO_AULA = /^[ \t]*[^\p{L}\p{N}\r\n]*aula[ \t]*(?:n(?:[º°o.]|[uú]mero)?[ \t]*)?[#:]?[ \t]*\d+\b/imu;
const TEMAS_IA = /\b(?:intelig[eê]ncia\s+artificial|aprendizado\s+de\s+m[aá]quina|machine\s+learning|deep\s+learning|modelos?\s+de\s+linguagem|redes?\s+neur(?:al|ais)|transformers?|chatgpt|gpus?|cpus?|qpus?|llms?|tokens?|data[ -]+centers?|programa[cç][aã]o|algoritmos?|transistor(?:es)?|computadores?|processadores?|bits?|qubits?|tool\s+calling|prompt\s+injection|apis?|webhooks?|python|hardware|software|computa[cç][aã]o\s+(?:qu[aâ]ntica|em\s+nuvem)|agentes?\s+de\s+ia)\b/i;

function identificarAulaIA(texto) {
  if (CURSO_IA.test(texto) || MARCADOR_AULA.test(texto)) return true;
  const cabecalho = CABECALHO_AULA.exec(texto);
  if (!cabecalho) return false;
  // Título e duas linhas seguintes descrevem o tema; uma menção distante não muda a rota.
  const contexto = texto.slice(cabecalho.index).split(/\r?\n/).filter(linha => linha.trim()).slice(0, 3).join('\n');
  return TEMAS_IA.test(contexto) || /\bIA\b/.test(contexto);
}

function iniciaComoAulaIA(texto) {
  const inicio = texto.trimStart();
  const cabecalho = CABECALHO_AULA.exec(inicio);
  return identificarAulaIA(inicio) &&
    (MARCADOR_AULA.test(inicio.slice(0, inicio.indexOf('\n') === -1 ? undefined : inicio.indexOf('\n'))) ||
      (cabecalho && cabecalho.index === 0));
}

function removerMarcadorAula(texto) {
  return texto.replace(/\[aula[ \t]+ia\]/gi, '').trimStart();
}
// Aviso gerado por ferramentas de IA: uma linha inteira antes da saudação.
const DURACAO_PENSAMENTO = String.raw`\d+(?:[.,]\d+)?[ \t]*(?:h(?:oras?)?|m(?:in(?:utos?)?)?|s(?:eg(?:undos?)?)?)`;
const AVISO_PENSOU = new RegExp(
  String.raw`^\s*pensou[ \t]+por[ \t]+${DURACAO_PENSAMENTO}(?:[ \t]*(?:e[ \t]*)?${DURACAO_PENSAMENTO})*[ \t]*[.!:]?[ \t]*\r?\n(?:[ \t]*\r?\n)*[ \t]*`,
  'i',
);

function normalizarTextoRecebido(texto) {
  if (typeof texto !== 'string') return texto;
  const aviso = texto.match(AVISO_PENSOU);
  if (!aviso) return texto;
  const semAviso = texto.slice(aviso[0].length);
  // Só remove a linha se ela vier imediatamente antes de uma saudação válida.
  return (GATILHO.test(semAviso.trim()) || iniciaComoAulaIA(semAviso)) ? semAviso : texto;
}

const IA_PROMPT = `Prepare esta aula do Curso Progressivo de Inteligência Artificial para leitura e narração em português brasileiro.
Preserve integralmente o conteúdo, a ordem das seções, os exemplos, as perguntas e respostas, os dados e a próxima aula. Não resuma, não acrescente explicações e não transforme o conteúdo em uma reflexão religiosa.
Na versão "texto", preserve os títulos, a numeração, as siglas, as fórmulas e a organização visual úteis para leitura.
Na versão "narracao", escreva números, datas, operações matemáticas e unidades por extenso. Adapte siglas e termos técnicos para uma pronúncia natural e compreensível em português: GPU, CPU, QPU, IA, API, KV Cache, Transformer e Tool Calling. Quando necessário, use o nome completo em português sem mudar o significado.
Transforme tabelas e diagramas em frases que transmitam as mesmas relações; não leia barras, setas, emojis ou separadores gráficos. Preserve o significado das operações e dos exemplos. Use apenas palavras faladas e pontuação natural, sem rubricas ou instruções de interpretação.`;

function normalizarNumero(valor) {
  const numero = (valor || '').split('@')[0].replace(/[+().\s-]/g, '');
  // Aceita números brasileiros com ou sem o nono dígito.
  return numero.replace(/^55(\d{2})9(\d{8})$/, '55$1$2');
}

function origemPermitida(from, lista) {
  return !lista || lista.split(',').some(numero => normalizarNumero(numero) === normalizarNumero(from));
}

function selecionarRota(text, from, config) {
  text = normalizarTextoRecebido(text);
  if (typeof text !== 'string' || !text.trim()) return { ignorar: 'mensagem sem texto' };
  const aulaIA = identificarAulaIA(text);
  if (aulaIA && !removerMarcadorAula(text).trim()) {
    return { ignorar: 'marcador de aula sem conteúdo' };
  }
  if (!GATILHO.test(text.trim()) && !iniciaComoAulaIA(text)) {
    return { ignorar: 'não começa com saudação ou identificação de aula de IA' };
  }

  // A aula tem prioridade sobre o fluxo genérico: nunca cai no grupo por engano.
  if (aulaIA) {
    const origem = config.IA_WATCH_NUMBER || config.WATCH_NUMBER;
    if (!origem) {
      return { ignorar: 'remetente de aula não configurado; verifique IA_WATCH_NUMBER ou WATCH_NUMBER', aviso: true };
    }
    if (!origemPermitida(from, origem)) {
      const identificador = String(from || 'não informado').replace(/[\r\n]/g, ' ').slice(0, 100);
      return { ignorar: `remetente da aula não autorizado: ${identificador}` };
    }
    const grupo = (config.IA_TARGET_GROUP_ID || '').trim();
    const telefone = (config.IA_TARGET_NUMBER || '').replace(/[+().\s-]/g, '');
    const destino = grupo || telefone;
    // Grupo tem prioridade; um grupo inválido não redireciona a aula ao contato antigo.
    if (grupo ? !/^\d+(?:-\d+)?@g\.us$/.test(grupo) : !/^\d{8,15}$/.test(telefone)) {
      return { ignorar: 'destino das aulas de IA ausente ou inválido; aula não será enviada', aviso: true };
    }
    return { tipo: 'aula de IA', destino, prompt: IA_PROMPT };
  }

  if (!origemPermitida(from, config.WATCH_NUMBER)) {
    return { ignorar: 'origem não está na lista de monitorados' };
  }
  return { tipo: 'reflexão do grupo', destino: config.TARGET_GROUP_ID, prompt: config.AI_PROMPT };
}

module.exports = { selecionarRota, normalizarTextoRecebido, removerMarcadorAula };
