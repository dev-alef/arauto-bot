/** Geração de áudio por um serviço Kokoro-FastAPI local. */
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { randomUUID } = require('crypto');

const AUDIO_DIR = path.join(__dirname, '..', 'audio_output');
const TIMEOUT_PADRAO_MS = 30 * 60 * 1000;

// O fetch nativo tem um limite de cabeçalhos independente de cinco minutos.
// Use HTTP diretamente para respeitar o AbortSignal por toda a geração.
function solicitarAudio(url, payload, signal) {
  return new Promise((resolve, reject) => {
    const endereco = new URL(url);
    const transporte = endereco.protocol === 'https:' ? https : endereco.protocol === 'http:' ? http : null;
    if (!transporte) {
      reject(new Error('KOKORO_URL deve usar HTTP ou HTTPS.'));
      return;
    }

    const corpo = JSON.stringify(payload);
    const request = transporte.request(endereco, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(corpo),
      },
      signal,
    }, response => {
      const partes = [];
      response.on('data', parte => partes.push(parte));
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode, corpo: Buffer.concat(partes) }));
      response.on('close', () => {
        if (!response.complete) reject(new Error('Conexão com o Kokoro encerrada antes do fim do áudio.'));
      });
    });
    request.on('error', reject);
    request.end(corpo);
  });
}

async function generateAudio(text, messageId = 'mensagem', { audioDir = AUDIO_DIR } = {}) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('O texto para o Kokoro está vazio.');
  }

  const baseUrl = (process.env.KOKORO_URL || 'http://127.0.0.1:8880').replace(/\/+$/, '');
  const voice = (process.env.KOKORO_VOICE || 'pm_santa').trim();
  const timeout = Number(process.env.KOKORO_TIMEOUT_MS || TIMEOUT_PADRAO_MS);
  const velocidadeConfigurada = (process.env.KOKORO_SPEED || '0.65').trim().replace(',', '.');
  const speed = Number(velocidadeConfigurada);
  if (!voice || !Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 2147483647) {
    throw new Error('Configuração inválida de KOKORO_VOICE ou KOKORO_TIMEOUT_MS.');
  }
  if (!velocidadeConfigurada || !Number.isFinite(speed) || speed < 0.25 || speed > 4) {
    throw new Error('KOKORO_SPEED inválida: use um número entre 0.25 e 4.');
  }

  const signal = AbortSignal.timeout(timeout);
  let audio;
  try {
    const response = await solicitarAudio(`${baseUrl}/v1/audio/speech`, {
      model: 'kokoro',
      input: text,
      voice,
      lang_code: 'p', // Português brasileiro
      response_format: 'mp3',
      speed,
      stream: false, // só responde após gerar todas as partes
    }, signal);

    if (response.status < 200 || response.status >= 300) {
      const detail = response.corpo.toString('utf8').replace(/[\r\n]+/g, ' ').slice(0, 300);
      throw new Error(`Kokoro retornou HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
    }

    audio = response.corpo;
  } catch (error) {
    if (signal.aborted) throw new Error(`Tempo limite de ${timeout} ms ao gerar áudio no Kokoro.`);
    throw error;
  }

  // Uma resposta JSON, vazia ou claramente inválida não pode ser enviada como MP3.
  const id3 = audio.subarray(0, 3).toString('ascii') === 'ID3';
  const frame = audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0;
  if (audio.length < 128 || (!id3 && !frame)) {
    throw new Error('Kokoro não retornou um áudio MP3 válido.');
  }

  const id = String(messageId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  const filepath = path.join(audioDir, `audio_${id}_${randomUUID()}.mp3`);
  await fs.promises.mkdir(audioDir, { recursive: true });
  try {
    await fs.promises.writeFile(filepath, audio, { flag: 'wx' });
    return filepath;
  } catch (error) {
    if (error.code !== 'EEXIST') {
      await fs.promises.rm(filepath, { force: true }).catch(() => {});
    }
    throw error;
  }
}

module.exports = { generateAudio };
