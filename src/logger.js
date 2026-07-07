/**
 * Logger simples com timestamp e gravação em arquivo
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function getTimestamp() {
  return new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function log(message, level = 'info') {
  const icons = { info: 'ℹ️', error: '❌', success: '✅', warn: '⚠️' };
  const icon = icons[level] || '';
  const entry = `[${getTimestamp()}] ${icon} ${message}`;

  console.log(entry);

  // Salva em arquivo de log diário
  const date = new Date().toISOString().split('T')[0];
  const logFile = path.join(LOG_DIR, `bot-${date}.log`);
  fs.appendFileSync(logFile, entry + '\n');
}

module.exports = { log };
