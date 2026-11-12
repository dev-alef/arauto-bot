const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

const { generateAudio } = require('../src/kokoro');

async function prepararServidor(t, responder) {
  const server = http.createServer(responder);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const audioDir = await fs.mkdtemp(path.join(os.tmpdir(), 'arauto-kokoro-'));
  const anteriores = {};
  const variaveis = {
    KOKORO_URL: `http://127.0.0.1:${server.address().port}/`,
    KOKORO_VOICE: 'pm_santa',
    KOKORO_TIMEOUT_MS: '5000',
  };
  for (const [nome, valor] of Object.entries(variaveis)) {
    anteriores[nome] = process.env[nome];
    process.env[nome] = valor;
  }
  t.after(async () => {
    for (const [nome, valor] of Object.entries(anteriores)) {
      if (valor === undefined) delete process.env[nome];
      else process.env[nome] = valor;
    }
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(audioDir, { recursive: true, force: true });
  });
  return audioDir;
}

test('Kokoro recebe todo o texto em português, com pm_santa e resposta completa em MP3', async t => {
  let pedido;
  const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(512, 1)]);
  const audioDir = await prepararServidor(t, async (req, res) => {
    let corpo = '';
    for await (const parte of req) corpo += parte;
    pedido = { method: req.method, url: req.url, body: JSON.parse(corpo) };
    res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
    res.end(mp3);
  });
  const texto = 'Primeira parte.\n\nSegunda parte, com sinais e acentuação: João, José e ciência.';
  const arquivo = await generateAudio(texto, '../mensagem', { audioDir });
  assert.deepEqual(pedido, {
    method: 'POST', url: '/v1/audio/speech',
    body: { model: 'kokoro', input: texto, voice: 'pm_santa', lang_code: 'p', response_format: 'mp3', stream: false },
  });
  assert.equal(path.dirname(arquivo), audioDir);
  assert.deepEqual(await fs.readFile(arquivo), mp3);
});

test('erro HTTP do Kokoro é propagado sem criar arquivo de áudio', async t => {
  const audioDir = await prepararServidor(t, (req, res) => {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end('{"detail":"modelo indisponível"}');
  });
  await assert.rejects(generateAudio('Teste.', '1', { audioDir }), /HTTP 503.*modelo indisponível/);
  assert.deepEqual(await fs.readdir(audioDir), []);
});

test('resposta inválida não é salva nem aceita como áudio', async t => {
  const audioDir = await prepararServidor(t, (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ erro: 'não foi possível gerar' }));
  });
  await assert.rejects(generateAudio('Teste.', '1', { audioDir }), /não retornou um áudio MP3 válido/);
  assert.deepEqual(await fs.readdir(audioDir), []);
});

test('conexão interrompida durante o áudio falha sem deixar arquivo incompleto', async t => {
  const audioDir = await prepararServidor(t, (req, res) => {
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': '5000' });
    res.write(Buffer.concat([Buffer.from('ID3'), Buffer.alloc(512, 1)]));
    setImmediate(() => res.destroy());
  });
  await assert.rejects(generateAudio('Teste.', '1', { audioDir }));
  assert.deepEqual(await fs.readdir(audioDir), []);
});

test('uma geração que não responde respeita o tempo limite', async t => {
  const audioDir = await prepararServidor(t, () => {});
  process.env.KOKORO_TIMEOUT_MS = '50';
  await assert.rejects(generateAudio('Teste.', '1', { audioDir }), /Tempo limite de 50 ms/);
  assert.deepEqual(await fs.readdir(audioDir), []);
});

test('seleciona Edge por padrão, Kokoro quando configurado e rejeita provedor desconhecido', async t => {
  const { generateAudio: gerar } = require('../src/tts');
  const originalProvider = process.env.TTS_PROVIDER;
  const nomes = ['speechma', 'kokoro'];
  const originais = new Map();
  for (const nome of nomes) {
    const arquivo = require.resolve(`../src/${nome}`);
    originais.set(arquivo, require.cache[arquivo]);
    require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports: {
      generateAudio: async (texto, id) => `${nome}:${texto}:${id}`,
    } };
  }
  t.after(() => {
    if (originalProvider === undefined) delete process.env.TTS_PROVIDER;
    else process.env.TTS_PROVIDER = originalProvider;
    for (const [arquivo, original] of originais) {
      if (original) require.cache[arquivo] = original;
      else delete require.cache[arquivo];
    }
  });

  delete process.env.TTS_PROVIDER;
  assert.equal(await gerar('texto', '1'), 'speechma:texto:1');
  process.env.TTS_PROVIDER = 'kokoro';
  assert.equal(await gerar('texto', '2'), 'kokoro:texto:2');
  process.env.TTS_PROVIDER = 'outro';
  await assert.rejects(gerar('texto', '3'), /TTS_PROVIDER inválido/);
});
