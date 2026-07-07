/**
 * Servidor Express — Recebe webhooks da Evolution API
 *
 * Como funciona:
 * 1. Evolution API chama POST /webhook toda vez que chega uma mensagem
 * 2. Este servidor extrai o texto e dispara o pipeline de IA + áudio + envio
 */

require('dotenv').config();

const express = require('express');
const { processMessage } = require('./src/bot');
const { parseWebhookMessage } = require('./src/whatsapp');
const { log } = require('./src/logger');

const app = express();
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3000;
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || '';

// ─── ROTA DE SAÚDE ───────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'online', timestamp: new Date().toISOString() });
});

// ─── WEBHOOK DA EVOLUTION API ─────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  // Verificação simples de segurança via token no header
  const token = req.headers['x-webhook-token'];
  if (WEBHOOK_TOKEN && token !== WEBHOOK_TOKEN) {
    log('⚠️ Webhook recebido com token inválido', 'warn');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Responde 200 imediatamente (Evolution API espera resposta rápida)
  res.status(200).json({ received: true });

  // Ignora eventos que não são mensagens
  const eventType = req.body?.event;
  if (eventType !== 'messages.upsert') return;

  const message = parseWebhookMessage(req.body);
  if (!message) return;

  // Ignora mensagens do próprio bot (evita loop infinito)
  if (req.body?.data?.key?.fromMe) {
    log('↩️ Mensagem própria ignorada');
    return;
  }

  // Processa de forma assíncrona
  processMessage(message).catch(err => {
    log(`Erro inesperado no processamento: ${err.message}`, 'error');
  });
});

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  log(`🚀 Bot iniciado na porta ${PORT}`);
  log(`📡 Webhook disponível em: http://localhost:${PORT}/webhook`);
  log(`🎯 Grupo destino: ${process.env.TARGET_GROUP_ID || 'não configurado'}`);
});
