/**
 * Integração com Evolution API (WhatsApp)
 * Docs: https://doc.evolution-api.com
 *
 * Funções:
 * - Receber webhooks de mensagens
 * - Enviar texto para grupo
 * - Enviar áudio para grupo
 */

const fs = require('fs');
const path = require('path');


// ─── CONFIG DA EVOLUTION API ─────────────────────────────────────────────────
const EVOLUTION = {
  baseUrl: process.env.EVOLUTION_URL || 'http://localhost:8080',
  apiKey: process.env.EVOLUTION_API_KEY || 'SUA_API_KEY',
  instance: process.env.EVOLUTION_INSTANCE || 'minha-instancia',
};

function getHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': EVOLUTION.apiKey,
  };
}

/**
 * Envia mensagem de texto para um grupo/número
 * @param {string} groupId - ID do grupo (ex: 55219XXXXXXXX-XXXXXXXXX@g.us)
 * @param {string} text - Texto a enviar
 */
async function sendText(groupId, text) {
  const url = `${EVOLUTION.baseUrl}/message/sendText/${EVOLUTION.instance}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      number: groupId,
      text: text,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Erro ao enviar texto: ${err}`);
  }

  return response.json();
}

/**
 * Envia arquivo de áudio para um grupo/número
 * @param {string} groupId - ID do grupo
 * @param {string} audioPath - Caminho local do arquivo MP3
 * @param {string} caption - Legenda opcional (aparece junto ao áudio)
 */
async function sendAudio(groupId, audioPath, caption = '') {
  const url = `${EVOLUTION.baseUrl}/message/sendWhatsAppAudio/${EVOLUTION.instance}`;

  // Converte o arquivo para base64
  const audioBuffer = fs.readFileSync(audioPath);
  const base64Audio = audioBuffer.toString('base64');

  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      number: groupId,
      audio: base64Audio,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Erro ao enviar áudio: ${err}`);
  }

  return response.json();
}

/**
 * Envia texto adaptado + áudio para o grupo
 * @param {string} groupId - ID do grupo destino
 * @param {string} adaptedText - Texto já adaptado pela IA
 * @param {string} audioPath - Caminho do arquivo MP3 gerado
 */
async function sendToGroup(groupId, adaptedText, audioPath) {
  // Envia o texto primeiro
  await sendText(groupId, adaptedText);

  // Aguarda 1s entre envios
  await new Promise(r => setTimeout(r, 1000));

  // Envia o áudio
  await sendAudio(groupId, audioPath);
}

/**
 * Extrai dados relevantes do webhook da Evolution API
 * @param {object} webhookBody - Body do POST recebido
 * @returns {object|null} - { text, from, messageId } ou null se inválido
 */
function parseWebhookMessage(webhookBody) {
  try {
    // Estrutura da Evolution API v2
    const data = webhookBody?.data;
    if (!data) return null;

    const message = data.message;
    const from = data.key?.remoteJid;
    const messageId = data.key?.id;

    // Tenta extrair o texto (pode estar em tipos diferentes)
    const text =
      message?.conversation ||
      message?.extendedTextMessage?.text ||
      message?.imageMessage?.caption ||
      null;

    if (!text || !from) return null;

    return { text, from, messageId };
  } catch {
    return null;
  }
}

module.exports = { sendText, sendAudio, sendToGroup, parseWebhookMessage };
