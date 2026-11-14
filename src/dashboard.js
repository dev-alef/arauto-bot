/** Painel opcional, de leitura, em porta separada. */
const path = require('path');
const express = require('express');
const monitor = require('./monitor');
const { criarLeitorRecursos } = require('./recursos');
const { log } = require('./logger');
const leitorRecursos = criarLeitorRecursos();

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

function criarPainel({ consultarSaude = saudeKokoro, consultarRecursos = leitorRecursos.consultar } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'painel.html')));
  app.get('/api/status', async (req, res) => {
    try {
      const [kokoro, recursos] = await Promise.all([consultarSaude(), consultarRecursos()]);
      res.json({ ...monitor.consultar(), kokoro, recursos });
    } catch {
      res.status(503).json({ erro: 'Não foi possível consultar o estado do painel.' });
    }
  });
  return app;
}

function iniciarPainel() {
  if (process.env.AR_AUTO_DASHBOARD_ENABLED !== 'true') return null;
  const porta = Number(process.env.AR_AUTO_DASHBOARD_INTERNAL_PORT || 3001);
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
    log('❌ Porta do painel inválida; o bot continua sem o painel.', 'error');
    return null;
  }
  monitor.habilitarPersistencia(path.join(__dirname, '..', 'logs', 'painel-monitor.json'));
  const endereco = process.env.AR_AUTO_DASHBOARD_INTERNAL_BIND || '127.0.0.1';
  const server = criarPainel().listen(porta, endereco, () => {
    log(`📊 Painel de monitoramento disponível na porta ${porta}.`);
  });
  server.on('error', () => log('❌ Não foi possível iniciar o painel; o bot continua funcionando.', 'error'));
  return server;
}

module.exports = { criarPainel, iniciarPainel };
