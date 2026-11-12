/** Gera um áudio local usando o mesmo provedor selecionado pelo bot. */
require('dotenv').config();
const { generateAudio } = require('../src/tts');

const text = process.argv.slice(2).join(' ') ||
  'Shalom, amado! Que a paz do Senhor Jesus Cristo esteja conosco. Este é um teste da voz do Arauto Bot.';

async function main() {
  console.log(`Gerando áudio de teste com ${process.env.TTS_PROVIDER || 'edge'}...`);
  try {
    const audioPath = await generateAudio(text, 'teste');
    console.log(`Áudio gerado: ${audioPath}`);
  } catch (error) {
    console.error(`Não foi possível gerar o áudio: ${error.message}`);
    process.exitCode = 1;
  }
}

main();
