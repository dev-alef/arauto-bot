/**
 * Teste rápido do adaptador de IA
 * Execute: node scripts/test-ai.js
 */

require('dotenv').config();
const { adaptTextWithAI } = require('../src/ai-adapter');

const TEXT = 'oi gente tô mandando essa msg pq precisamos nos reunir amanhã de manha pra discutir o projeto ok?';
const PROMPT = 'Adapte esta mensagem para um tom mais formal e profissional. Retorne apenas o texto adaptado:';

async function main() {
  console.log('🧪 Testando adaptador de IA...\n');
  console.log('📝 Texto original:', TEXT);
  console.log('─'.repeat(60));

  try {
    const adapted = await adaptTextWithAI(TEXT, PROMPT);
    console.log('✅ Texto adaptado:', adapted);
  } catch (err) {
    console.error('❌ Erro:', err.message);
  }
}

main();
