/**
 * Teste rápido do gerador de áudio (Speechma)
 * Execute: node scripts/test-speechma.js
 */

require('dotenv').config();
const { generateAudio } = require('../src/speechma');
const path = require('path');

const TEXT = 'Olá, este é um teste de geração de áudio pelo Speechma. Funcionou com sucesso!';

async function main() {
  console.log('🧪 Testando Speechma...\n');
  console.log('📝 Texto:', TEXT);
  console.log('─'.repeat(60));

  try {
    const audioPath = await generateAudio(TEXT, 'test');
    console.log('✅ Áudio gerado:', audioPath);
    console.log(`📁 Verifique o arquivo em: ${path.resolve(audioPath)}`);
  } catch (err) {
    console.error('❌ Erro:', err.message);
    console.error('\n💡 Dica: A API do Speechma pode ter mudado. Verifique o endpoint em speechma.com');
  }
}

main();
