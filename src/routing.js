/** Seleciona um único destino antes de adaptar ou gerar áudio. */
const GATILHO = /^(shalom|shalon|amém|amem),?\s*amado/i;
const CURSO_IA = /\bcurso\s+progressivo\s+de\s+intelig[eê]ncia\s+artificial\b/i;

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
  if (typeof text !== 'string' || !text.trim()) return { ignorar: 'mensagem sem texto' };
  if (!GATILHO.test(text.trim())) return { ignorar: 'não começa com Shalom/Shalon amado ou Amém amado' };

  // A aula tem prioridade sobre o fluxo genérico: nunca cai no grupo por engano.
  if (CURSO_IA.test(text)) {
    const origem = config.IA_WATCH_NUMBER || config.WATCH_NUMBER;
    if (!origem || !origemPermitida(from, origem)) {
      return { ignorar: 'remetente da aula de IA não autorizado ou não configurado' };
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

module.exports = { selecionarRota };
