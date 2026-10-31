/**
 * WhatsApp AI Bot - Orquestrador Principal
 * Fluxo: Recebe msg → Fila → Adapta com IA (2 versões) → Gera áudio → Envia ao destino da mensagem
 */

const { adaptTextWithAI } = require('./ai-adapter');
const { generateAudio } = require('./speechma');
const { sendToGroup, sendText } = require('./whatsapp');
const { log } = require('./logger');
const { checarVersaoNova } = require('./version-check');
const { selecionarRota } = require('./routing');

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const CONFIG = {
  AUDIO_ENABLED: (process.env.AUDIO_ENABLED || 'true') !== 'false',
  TARGET_GROUP_ID: process.env.TARGET_GROUP_ID || 'SEU_GRUPO_ID@g.us',
  WATCH_NUMBER: process.env.WATCH_NUMBER || '',
  IA_WATCH_NUMBER: process.env.IA_WATCH_NUMBER || '',
  IA_TARGET_NUMBER: process.env.IA_TARGET_NUMBER || '',
  AI_PROMPT: process.env.AI_PROMPT ||
    'Adapte esta mensagem para um tom mais formal e profissional, mantendo o conteúdo original. Retorne apenas o texto adaptado, sem explicações:',
};

// ─── FILA SEQUENCIAL ─────────────────────────────────────────────────────────
// Garante que as mensagens sejam processadas uma por vez, na ordem de chegada,
// evitando que textos e áudios de mensagens diferentes se misturem no grupo.
const fila = [];
let processando = false;

async function processarFila() {
  if (processando) return; // já tem alguém trabalhando na fila
  processando = true;

  while (fila.length > 0) {
    const message = fila.shift(); // pega a mais antiga
    try {
      await executarFluxo(message);
    } catch (error) {
      log(`❌ Erro ao processar mensagem da fila: ${error.message}`, 'error');
    }
  }

  processando = false;
}

/**
 * Entrada pública: adiciona a mensagem na fila e aciona o processamento
 */
async function processMessage(message) {
  fila.push(message);
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
  const { text, from, messageId } = message;

  const rota = selecionarRota(text, from, CONFIG);
  if (rota.ignorar) {
    log(`🔇 Ignorada (${rota.ignorar})`, rota.aviso ? 'warn' : 'info');
    return;
  }

  log(`📩 Mensagem recebida de ${from}: "${text.substring(0, 60)}..."`);
  log(`🎯 Rota: ${rota.tipo} → ${rota.destino}`);
  if (fila.length > 0) log(`📋 Fila: ${fila.length} mensagem(ns) aguardando`);

  try {
    // Consulta a cada reflexão válida e aguarda a atualização antes do áudio/envio.
    await checarVersaoNova();

    // ETAPA 1: Adaptar texto com IA (retorna versão escrita + versão narrada)
    log('🤖 Adaptando texto com IA...');
    const resultado = await adaptTextWithAI(text, rota.prompt);

    const textoEscrito = limpar(resultado.texto);      // com "2 Reis 4:12"
    const textoNarrado = limpar(resultado.narracao);   // com "Segundo Reis, capítulo quatro..."
    log(`✅ Texto adaptado: "${textoEscrito.substring(0, 60)}..."`);

    // ETAPA 2: Áudio (opcional)
    let audioPath = null;
    if (CONFIG.AUDIO_ENABLED) {
      log('🎙️ Gerando áudio...');
      try {
        audioPath = await generateAudio(textoNarrado, messageId);
        log(`✅ Áudio salvo em: ${audioPath}`);
      } catch (e) {
        log(`⚠️ Áudio indisponível, publicando só o texto: ${e.message}`, 'warn');
      }
    } else {
      log('🔕 Áudio desativado (AUDIO_ENABLED=false), publicando só o texto');
    }

    // ETAPA 3: Enviar ao grupo ou contato selecionado
    log(`📤 Enviando ${rota.tipo}...`);
    if (audioPath) {
      await sendToGroup(rota.destino, textoEscrito, audioPath);
    } else {
      await sendText(rota.destino, textoEscrito);
    }
    log(`✅ ${rota.tipo} enviada com sucesso!`);

  } catch (error) {
    log(`❌ Erro ao processar mensagem: ${error.message}`, 'error');
  }
}

module.exports = { processMessage, CONFIG };