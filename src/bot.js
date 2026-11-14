/**
 * WhatsApp AI Bot - Orquestrador Principal
 * Fluxo: Recebe msg → Fila → Adapta com IA (2 versões) → Gera áudio → Envia ao destino da mensagem
 */

const { adaptTextWithAI } = require('./ai-adapter');
const { generateAudio } = require('./tts');
const { sendToGroup, sendText } = require('./whatsapp');
const { log } = require('./logger');
const { checarVersaoNova } = require('./version-check');
const { selecionarRota, normalizarTextoRecebido, removerMarcadorAula } = require('./routing');
const tempo = require('./tempo');
const monitor = require('./monitor');

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const CONFIG = {
  AUDIO_ENABLED: (process.env.AUDIO_ENABLED || 'true') !== 'false',
  TARGET_GROUP_ID: process.env.TARGET_GROUP_ID || 'SEU_GRUPO_ID@g.us',
  WATCH_NUMBER: process.env.WATCH_NUMBER || '',
  IA_WATCH_NUMBER: process.env.IA_WATCH_NUMBER || '',
  IA_TARGET_NUMBER: process.env.IA_TARGET_NUMBER || '',
  IA_TARGET_GROUP_ID: process.env.IA_TARGET_GROUP_ID || '',
  ERROR_REPORT_NUMBER: process.env.ERROR_REPORT_NUMBER || '',
  AI_PROMPT: process.env.AI_PROMPT ||
    'Adapte esta mensagem para um tom mais formal e profissional, mantendo o conteúdo original. Retorne apenas o texto adaptado, sem explicações:',
};

// ─── FILA SEQUENCIAL ─────────────────────────────────────────────────────────
// Garante que as mensagens sejam processadas uma por vez, na ordem de chegada,
// evitando que textos e áudios de mensagens diferentes se misturem no grupo.
const fila = [];
let processando = false;
let proximoEnvioEm = 0;

const MINUTO = 60 * 1000;
const MAX_TENTATIVAS_AUDIO = 4; // tentativa inicial + três novas tentativas

// Expõe somente categorias conhecidas: erros brutos podem conter dados sensíveis.
function motivoFalhaAudio(error) {
  const mensagem = String(error?.message || '');
  const http = /^Kokoro retornou HTTP (\d{3})/.exec(mensagem);
  if (http) return `Kokoro respondeu HTTP ${http[1]}`;
  if (/tempo limite/i.test(mensagem)) return 'tempo de espera esgotado';
  if (/KOKORO_SPEED inválida|Configuração inválida/.test(mensagem)) return 'configuração de voz inválida';
  if (/não retornou um áudio MP3 válido/i.test(mensagem)) return 'resposta de áudio inválida';
  if (/encerrada antes do fim|socket hang up/i.test(mensagem) || error?.code === 'ECONNRESET') return 'conexão interrompida';
  if (error?.code === 'ECONNREFUSED') return 'serviço de áudio recusou a conexão';
  if (error?.code === 'ENOTFOUND' || error?.code === 'EAI_AGAIN') return 'serviço de áudio não encontrado';
  return 'consulte os logs para detalhes';
}

async function aguardarIntervalo() {
  let restante = proximoEnvioEm - tempo.agora();
  if (restante > 0) {
    monitor.etapa('intervalo', { evento: 'Aguardando o intervalo entre mensagens.' });
    log(`⏳ Aguardando ${Math.ceil(restante / 1000)}s antes da próxima reflexão.`);
    do {
      await tempo.esperar(restante);
      restante = proximoEnvioEm - tempo.agora();
    } while (restante > 0);
  }
}

async function reportarFalhaAudio(message, rota, erros) {
  const numero = CONFIG.ERROR_REPORT_NUMBER.replace(/[+().\s-]/g, '');
  if (!/^\d{8,15}$/.test(numero)) {
    log('❌ Falha de áudio sem notificação: configure ERROR_REPORT_NUMBER com DDI e DDD.', 'error');
    return;
  }

  const detalhes = erros.map((erro, indice) =>
    `${indice + 1}ª tentativa: ${String(erro?.message || erro).replace(/[\r\n]+/g, ' ').slice(0, 400)}`
  ).join('\n');
  const relatorio = [
    '⚠️ Arauto Bot: falha na geração de áudio',
    `Tipo: ${rota.tipo}`,
    `Destino: ${rota.destino}`,
    `ID da mensagem: ${message.messageId || 'não informado'}`,
    `Tentativas: ${erros.length}`,
    detalhes,
    'A reflexão não foi publicada. As próximas mensagens continuam na fila.',
  ].join('\n');

  try {
    await sendText(numero, relatorio, { signal: AbortSignal.timeout(15000) });
    log('📨 Relatório de falha de áudio enviado ao número de monitoramento.');
  } catch (error) {
    log(`❌ Não foi possível enviar o relatório de falha de áudio: ${error.message}`, 'error');
  }
}

async function gerarAudioComTentativas(textoNarrado, message, rota) {
  const erros = [];
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_AUDIO; tentativa++) {
    try {
      monitor.etapa('audio', { tentativa, maxTentativas: MAX_TENTATIVAS_AUDIO, tamanho: textoNarrado.length, evento: `Gerando áudio: tentativa ${tentativa}/${MAX_TENTATIVAS_AUDIO}.` });
      log(`🎙️ Gerando áudio (tentativa ${tentativa}/${MAX_TENTATIVAS_AUDIO})...`);
      const audio = await generateAudio(textoNarrado, message.messageId);
      monitor.concluirEtapa();
      return audio;
    } catch (error) {
      erros.push(error);
      monitor.evento(`Falha na tentativa ${tentativa}/${MAX_TENTATIVAS_AUDIO}: ${motivoFalhaAudio(error)}.`, 'warn');
      log(`⚠️ Falha na tentativa ${tentativa}/${MAX_TENTATIVAS_AUDIO}: ${error.message}`, 'warn');
      if (tentativa < MAX_TENTATIVAS_AUDIO) {
        const espera = tempo.sortear(3 * MINUTO, 5 * MINUTO);
        monitor.etapa('nova_tentativa', {
          tentativa, maxTentativas: MAX_TENTATIVAS_AUDIO,
          proximaTentativaEm: Date.now() + espera,
          evento: 'Aguardando para tentar gerar o áudio novamente.', nivel: 'warn',
        });
        log(`⏳ Nova tentativa de áudio em ${Math.ceil(espera / 1000)}s.`);
        await tempo.esperar(espera);
      }
    }
  }
  monitor.etapa('falha', { evento: 'Todas as tentativas de áudio falharam.', nivel: 'error' });
  await reportarFalhaAudio(message, rota, erros);
  return null;
}

async function processarFila() {
  if (processando) return; // já tem alguém trabalhando na fila
  processando = true;

  while (fila.length > 0) {
    const message = fila.shift(); // pega a mais antiga
    monitor.atualizarFila(fila.length);
    try {
      await executarFluxo(message);
    } catch (error) {
      monitor.evento('Falha ao processar uma mensagem. Consulte os logs.', 'error');
      log(`❌ Erro ao processar mensagem da fila: ${error.message}`, 'error');
    } finally {
      monitor.finalizar();
    }
  }

  processando = false;
}

/**
 * Entrada pública: adiciona a mensagem na fila e aciona o processamento
 */
async function processMessage(message) {
  fila.push(message);
  monitor.atualizarFila(fila.length);
  processarFila(); // sem await de propósito — o webhook responde rápido
}

// ─── LIMPEZA DE TEXTO ────────────────────────────────────────────────────────
// Remove rubricas que o TTS leria literalmente e normaliza espaçamento
function limpar(t) {
  return t
    .replace(/\((pausa|pausa longa|pausa breve|respira|suspiro|silêncio)\)/gi, ' ')
    .replace(/\[(pausa|música|som|vinheta)[^\]]*\]/gi, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([.,;!?])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── FLUXO DE PROCESSAMENTO ──────────────────────────────────────────────────
async function executarFluxo(message) {
  const { from } = message;
  const text = normalizarTextoRecebido(message.text);

  const rota = selecionarRota(text, from, CONFIG);
  if (rota.ignorar) {
    log(`🔇 Ignorada (${rota.ignorar})`, rota.aviso ? 'warn' : 'info');
    return;
  }

  monitor.iniciar(rota.tipo);
  log(`📩 Mensagem recebida de ${from}: "${text.substring(0, 60)}..."`);
  log(`🎯 Rota: ${rota.tipo} → ${rota.destino}`);
  if (fila.length > 0) log(`📋 Fila: ${fila.length} mensagem(ns) aguardando`);

  try {
    // A espera também se aplica quando a fila ficou vazia entre mensagens.
    await aguardarIntervalo();

    // Consulta a cada reflexão válida e aguarda a atualização antes do áudio/envio.
    monitor.etapa('atualizacao', { evento: 'Verificando o serviço de voz.' });
    await checarVersaoNova();

    // ETAPA 1: Adaptar texto com IA (retorna versão escrita + versão narrada)
    const textoParaAdaptar = rota.tipo === 'aula de IA' ? removerMarcadorAula(text) : text;
    monitor.etapa('ia', { tamanho: textoParaAdaptar.length, evento: 'Preparando o texto com o Gemini.' });
    log('🤖 Adaptando texto com IA...');
    const resultado = await adaptTextWithAI(textoParaAdaptar, rota.prompt);
    monitor.concluirEtapa();

    const textoEscrito = limpar(resultado.texto);      // com "2 Reis 4:12"
    const textoNarrado = limpar(resultado.narracao);   // com "Segundo Reis, capítulo quatro..."
    log(`✅ Texto adaptado: "${textoEscrito.substring(0, 60)}..."`);

    // ETAPA 2: Áudio (opcional)
    let audioPath = null;
    if (CONFIG.AUDIO_ENABLED) {
      audioPath = await gerarAudioComTentativas(textoNarrado, message, rota);
      if (!audioPath) return;
      log(`✅ Áudio salvo em: ${audioPath}`);
    } else {
      log('🔕 Áudio desativado (AUDIO_ENABLED=false), publicando só o texto');
    }

    // ETAPA 3: Enviar ao grupo ou contato selecionado
    monitor.etapa('envio', { evento: 'Enviando mensagem pela Evolution API.' });
    log(`📤 Enviando ${rota.tipo}...`);
    try {
      if (audioPath) {
        await sendToGroup(rota.destino, textoEscrito, audioPath);
      } else {
        await sendText(rota.destino, textoEscrito);
      }
    } finally {
      // Mesmo se o envio falhar, a Evolution pode ter recebido parte da mensagem.
      proximoEnvioEm = tempo.agora() + tempo.sortear(MINUTO, 3 * MINUTO);
    }
    monitor.etapa('concluido', { evento: 'Envio aceito pela Evolution API.', nivel: 'success' });
    log(`✅ ${rota.tipo} enviada com sucesso!`);

  } catch (error) {
    monitor.etapa('falha', { evento: 'Falha ao processar a mensagem. Consulte os logs.', nivel: 'error' });
    log(`❌ Erro ao processar mensagem: ${error.message}`, 'error');
  }
}

module.exports = { processMessage, CONFIG };
