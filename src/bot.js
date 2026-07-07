/**
 * WhatsApp AI Bot - Orquestrador Principal
 * Fluxo: Recebe msg → Fila → Adapta com IA → Gera áudio → Envia no grupo
 */

const { adaptTextWithAI } = require('./ai-adapter');
const { generateAudio } = require('./speechma');
const { sendToGroup } = require('./whatsapp');
const { log } = require('./logger');

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const CONFIG = {
  TARGET_GROUP_ID: process.env.TARGET_GROUP_ID || 'SEU_GRUPO_ID@g.us',
  WATCH_NUMBER: process.env.WATCH_NUMBER || '',
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

// ─── FLUXO DE PROCESSAMENTO ──────────────────────────────────────────────────
async function executarFluxo(message) {
  const { text, from, messageId } = message;

  // Filtra por número se configurado (tolerante ao nono dígito)
  if (CONFIG.WATCH_NUMBER) {
    const normalizar = (jid) => {
      const num = (jid || '').split('@')[0];
      // Remove o nono dígito de números BR (55 + DDD + 9 + 8 dígitos)
      return num.replace(/^55(\d{2})9(\d{8})$/, '55$1$2');
    };
    if (normalizar(from) !== normalizar(CONFIG.WATCH_NUMBER)) {
      log(`🔇 Ignorada (origem ${from} ≠ ${CONFIG.WATCH_NUMBER})`);
      return;
    }
  }

  // Ignora mensagens sem texto (áudios, fotos, documentos...)
  if (!text || text.trim().length === 0) return;

  // Filtra por gatilho: só processa mensagens que começam com "Shalom, amado" ou "Amém, amado"
  const GATILHO = /^(shalom|amém|amem),?\s*amado/i;
  if (!GATILHO.test(text.trim())) {
    log(`🔇 Ignorada (não começa com "Shalom amado" ou "Amém amado")`);
    return;
  }

  log(`📩 Mensagem recebida de ${from}: "${text.substring(0, 60)}..."`);
  if (fila.length > 0) log(`📋 Fila: ${fila.length} mensagem(ns) aguardando`);

  try {
    // ETAPA 1: Adaptar texto com IA
    log('🤖 Adaptando texto com IA...');
    const adaptedText = (await adaptTextWithAI(text, CONFIG.AI_PROMPT))
      // Remove rubricas comuns que TTS leria literalmente (deixa um espaço no lugar)
      .replace(/\((pausa|pausa longa|pausa breve|respira|suspiro|silêncio)\)/gi, ' ')
      .replace(/\[(pausa|música|som|vinheta)[^\]]*\]/gi, ' ')
      // Colapsa espaços/tabs repetidos SEM tocar nas quebras de linha
      .replace(/[ \t]{2,}/g, ' ')
      // Remove espaços soltos antes de pontuação (ex: "palavra ." → "palavra.")
      .replace(/ +([.,;!?])/g, '$1')
      // Limita quebras de linha excessivas (máx. 2 seguidas = 1 linha em branco)
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    log(`✅ Texto adaptado: "${adaptedText.substring(0, 60)}..."`);

    // ETAPA 2: Gerar áudio
    log('🎙️ Gerando áudio...');
    const audioPath = await generateAudio(adaptedText, messageId);
    log(`✅ Áudio salvo em: ${audioPath}`);

    // ETAPA 3: Enviar texto + áudio no grupo
    log('📤 Enviando para o grupo...');
    await sendToGroup(CONFIG.TARGET_GROUP_ID, adaptedText, audioPath);
    log('✅ Mensagem enviada no grupo com sucesso!');

  } catch (error) {
    log(`❌ Erro ao processar mensagem: ${error.message}`, 'error');
  }
}

module.exports = { processMessage, CONFIG };