/** Seleciona o gerador de áudio sem alterar o fluxo da fila. */
async function generateAudio(text, messageId) {
  const provider = (process.env.TTS_PROVIDER || 'edge').trim().toLowerCase();

  if (provider === 'edge') {
    return require('./speechma').generateAudio(text, messageId);
  }
  if (provider === 'kokoro') {
    return require('./kokoro').generateAudio(text, messageId);
  }

  throw new Error(`TTS_PROVIDER inválido: ${provider}. Use edge ou kokoro.`);
}

module.exports = { generateAudio };
