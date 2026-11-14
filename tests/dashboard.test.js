const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { setImmediate: proximoTurno } = require('node:timers/promises');

test('painel exige senha e devolve somente estado resumido', async t => {
  const { criarPainel } = require('../src/dashboard');
  const app = criarPainel('senha-de-teste', { consultarSaude: async () => 'respondendo' });
  const servidor = app.listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  t.after(async () => {
    servidor.closeAllConnections();
    await new Promise(resolve => servidor.close(resolve));
  });
  const url = `http://127.0.0.1:${servidor.address().port}`;
  const auth = (senha) => ({ Authorization: 'Basic ' + Buffer.from('arauto:' + senha).toString('base64') });
  for (const rota of ['/', '/api/status']) {
    assert.equal((await fetch(url + rota)).status, 401);
    assert.equal((await fetch(url + rota, { headers: auth('incorreta') })).status, 401);
  }
  const pagina = await fetch(url + '/', { headers: auth('senha-de-teste') });
  assert.equal(pagina.status, 200);
  assert.match(await pagina.text(), /O que está acontecendo/);
  assert.equal(pagina.headers.get('cache-control'), 'no-store');
  const resposta = await fetch(url + '/api/status', { headers: auth('senha-de-teste') });
  const estado = await resposta.json();
  assert.equal(estado.kokoro, 'respondendo');
  assert.ok(Array.isArray(estado.eventos));
  assert.doesNotMatch(JSON.stringify(estado), /senha-de-teste/);
});

test('painel verifica a disponibilidade do Kokoro sem expor seu endereço', async t => {
  const variaveis = ['TTS_PROVIDER', 'KOKORO_URL'];
  const anteriores = Object.fromEntries(variaveis.map(k => [k, process.env[k]]));
  const kokoro = http.createServer((req, res) => {
    assert.equal(req.url, '/health');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"status":"ok"}');
  }).listen(0, '127.0.0.1');
  await once(kokoro, 'listening');
  process.env.TTS_PROVIDER = 'kokoro';
  process.env.KOKORO_URL = `http://127.0.0.1:${kokoro.address().port}`;
  const { criarPainel } = require('../src/dashboard');
  const servidor = criarPainel('senha').listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  t.after(async () => {
    servidor.closeAllConnections();
    await new Promise(resolve => servidor.close(resolve));
    for (const [nome, valor] of Object.entries(anteriores)) {
      if (valor === undefined) delete process.env[nome];
      else process.env[nome] = valor;
    }
  });
  const url = `http://127.0.0.1:${servidor.address().port}/api/status`;
  const headers = { Authorization: 'Basic ' + Buffer.from('arauto:senha').toString('base64') };
  let estado = await (await fetch(url, { headers })).json();
  assert.equal(estado.kokoro, 'respondendo');
  assert.doesNotMatch(JSON.stringify(estado), /127\.0\.0\.1/);
  kokoro.closeAllConnections();
  await new Promise(resolve => kokoro.close(resolve));
  estado = await (await fetch(url, { headers })).json();
  assert.equal(estado.kokoro, 'sem_resposta');
});

test('painel acompanha fila, IA e novas tentativas sem revelar conteúdo ou telefone', async t => {
  const originais = new Map();
  const ambiente = { WATCH_NUMBER: '5511999999999', TARGET_GROUP_ID: '5511888888888',
    AUDIO_ENABLED: 'true', IA_WATCH_NUMBER: '', IA_TARGET_NUMBER: '', IA_TARGET_GROUP_ID: '' };
  const anteriores = Object.fromEntries(Object.keys(ambiente).map(k => [k, process.env[k]]));
  Object.assign(process.env, ambiente);
  function simular(nome, exports) {
    const arquivo = require.resolve(`../src/${nome}`);
    originais.set(arquivo, require.cache[arquivo]);
    require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports };
  }
  let concluirIA, concluirEspera, concluirAudio;
  let agora = Date.now();
  let chamadasIA = 0, chamadasAudio = 0;
  simular('version-check', { checarVersaoNova: async () => {} });
  simular('logger', { log() {} });
  simular('tempo', {
    agora: () => agora, sortear: minimo => minimo,
    esperar: async ms => new Promise(resolve => { concluirEspera = () => { agora += ms; resolve(); }; }),
  });
  simular('ai-adapter', { adaptTextWithAI: async () => {
    chamadasIA++;
    if (chamadasIA === 1) await new Promise(resolve => { concluirIA = resolve; });
    return { texto: 'texto', narracao: 'narração' };
  } });
  simular('tts', { generateAudio: async () => {
    chamadasAudio++;
    if (chamadasAudio === 1) throw new Error('Kokoro retornou HTTP 503: TEXTO SENSÍVEL');
    if (chamadasAudio === 2) await new Promise(resolve => { concluirAudio = resolve; });
    return '/audio.mp3';
  } });
  simular('whatsapp', { sendToGroup: async () => {}, sendText: async () => {} });
  const botPath = require.resolve('../src/bot');
  delete require.cache[botPath];
  const bot = require(botPath);
  const monitor = require('../src/monitor');
  t.after(() => {
    delete require.cache[botPath];
    for (const [arquivo, original] of originais) {
      if (original) require.cache[arquivo] = original;
      else delete require.cache[arquivo];
    }
    for (const [nome, valor] of Object.entries(anteriores)) {
      if (valor === undefined) delete process.env[nome];
      else process.env[nome] = valor;
    }
  });
  const mensagem = { text: 'Shalom, amado. CONTEÚDO PRIVADO', from: '5511999999999@s.whatsapp.net', messageId: 'segredo' };
  await bot.processMessage(mensagem);
  await proximoTurno();
  await bot.processMessage({ ...mensagem, messageId: 'segredo2' });
  await proximoTurno();
  let estado = monitor.consultar();
  assert.equal(estado.etapa, 'ia');
  assert.equal(estado.pendentes, 1);
  assert.doesNotMatch(JSON.stringify(estado), /CONTEÚDO PRIVADO|5511999999999|5511888888888|segredo/);

  concluirIA();
  await proximoTurno();
  estado = monitor.consultar();
  assert.equal(estado.etapa, 'nova_tentativa');
  assert.equal(estado.tentativa, 1);
  assert.equal(estado.maxTentativas, 4);
  assert.ok(estado.proximaTentativaEm > Date.now());
  assert.ok(estado.eventos.some(e => e.mensagem.includes('Kokoro respondeu HTTP 503')));
  assert.doesNotMatch(JSON.stringify(estado), /TEXTO SENSÍVEL/);

  concluirEspera();
  await proximoTurno();
  estado = monitor.consultar();
  assert.equal(estado.etapa, 'audio');
  assert.equal(estado.tentativa, 2);
  concluirAudio();
  await proximoTurno();
  // Libera o intervalo entre as duas mensagens.
  if (concluirEspera) concluirEspera();
  await proximoTurno();
  assert.ok(monitor.consultar().eventos.some(e => e.mensagem === 'Envio aceito pela Evolution API.'));
});
