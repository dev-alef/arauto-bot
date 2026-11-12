/**
 * Geração de áudio TTS — Microsoft Edge TTS (gratuito)
 * Mesmas vozes neurais que o Speechma usa (pt-BR-AntonioNeural, etc.)
 */

const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { obterBiblioteca } = require('./version-check');

const AUDIO_DIR = path.join(__dirname, '..', 'audio_output');
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });

const DEFAULT_VOICE = process.env.SPEECHMA_VOICE || 'pt-BR-AntonioNeural';

/**
 * Gera arquivo de áudio MP3 a partir do texto
 * @param {string} text - Texto para converter em áudio
 * @param {string} messageId - ID único para nomear o arquivo
 * @returns {Promise<string>} - Caminho completo do arquivo MP3 gerado
 */
async function generateAudio(text, messageId = Date.now()) {
  const { MsEdgeTTS, OUTPUT_FORMAT } = obterBiblioteca();
  const tts = new MsEdgeTTS();
  await tts.setMetadata(DEFAULT_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

  const filename = `audio_${messageId}_${Date.now()}.mp3`;
  const filepath = path.join(AUDIO_DIR, filename);

  const { audioStream } = await tts.toStream(text);

  try {
    await pipeline(audioStream, fs.createWriteStream(filepath));
    return filepath;
  } catch (error) {
    // Um stream interrompido não pode deixar um MP3 incompleto disponível.
    await fs.promises.rm(filepath, { force: true }).catch(() => {});
    throw error;
  }
}

module.exports = { generateAudio };