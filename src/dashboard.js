/** Painel de leitura em porta separada, opcional e protegido por senha. */
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const monitor = require('./monitor');
const { log } = require('./logger');

function hash(valor) {
  return crypto.createHash('sha256').update(valor).digest();
}

async function saudeKokoro() {
  const provedor = (process.env.TTS_PROVIDER || 'edge').trim().toLowerCase();
  if (provedor !== 'kokoro') return 'nao_selecionado';
  const endereco = (process.env.KOKORO_URL || 'http://127.0.0.1:8880').replace(/\/+$/, '');
  try {
    const resposta = await fetch(`${endereco}/health`, { signal: AbortSignal.timeout(2000) });
    await resposta.body?.cancel();
    return resposta.ok ? 'respondendo' : 'sem_resposta';
  } catch {
    return 'sem_resposta';
  }
}

function criarPainel(senha, { consultarSaude = saudeKokoro } = {}) {
  if (!senha) throw new Error('Uma senha é necessária para iniciar o painel.');
  const esperado = hash(`arauto:${senha}`);
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const autorizacao = req.get('authorization') || '';
    const match = /^Basic ([A-Za-z0-9+/=]{1,2048})$/.exec(autorizacao);
    const recebido = match ? Buffer.from(match[1], 'base64').toString('utf8') : '';
    if (!match || !crypto.timingSafeEqual(hash(recebido), esperado)) {
      res.set('WWW-Authenticate', 'Basic realm="Painel Arauto", charset="UTF-8"');
      return res.status(401).send('Acesso ao painel requer usuário e senha.');
    }
    next();
  });

  app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'painel.html')));
  app.get('/api/status', async (req, res) => {
    try {
      const kokoro = await consultarSaude();
      res.json({ ...monitor.consultar(), kokoro });
    } catch {
      res.status(503).json({ erro: 'Não foi possível consultar o estado do painel.' });
    }
  });
  return app;
}

function iniciarPainel() {
  const senha = process.env.AR_AUTO_DASHBOARD_PASSWORD || '';
  if (!senha) return null;
  const porta = Number(process.env.AR_AUTO_DASHBOARD_INTERNAL_PORT || 3001);
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
    log('❌ Porta do painel inválida; o bot continua sem o painel.', 'error');
    return null;
  }
  const server = criarPainel(senha).listen(porta, '0.0.0.0', () => {
    log(`📊 Painel de monitoramento disponível na porta ${porta}.`);
  });
  server.on('error', () => log('❌ Não foi possível iniciar o painel; o bot continua funcionando.', 'error'));
  return server;
}

module.exports = { criarPainel, iniciarPainel };
