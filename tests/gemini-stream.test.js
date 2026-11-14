const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate: proximoTurno } = require('node:timers/promises');
const monitor = require('../src/monitor');
const { adaptTextWithAI, extrairTextoParcial } = require('../src/ai-adapter');

function evento(texto, motivo) {
  const candidato = {};
  if (texto !== undefined) candidato.content = { parts: [{ text: texto }] };
  if (motivo) candidato.finishReason = motivo;
  return `data: ${JSON.stringify({ candidates: [candidato] })}\r\n\r\n`;
}

function preparar(t) {
  const fetchOriginal = global.fetch;
  const chaveAnterior = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'chave-de-teste';
  monitor.iniciar('reflexão do grupo');
  let controle, url;
  const stream = new ReadableStream({ start(c) { controle = c; } });
  global.fetch = async endereco => {
    url = endereco;
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  t.after(() => {
    global.fetch = fetchOriginal;
    if (chaveAnterior === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = chaveAnterior;
    monitor.finalizar();
  });
  return { controle, getUrl: () => url };
}

test('Gemini mostra o texto enquanto recebe partes e preserva a narração completa', async t => {
  const ctx = preparar(t);
  const chamada = adaptTextWithAI('mensagem original', 'adapte');
  await proximoTurno();
  const primeira = Buffer.from(evento('{"texto":"Shalom, irmã'));
  const acento = primeira.indexOf(Buffer.from('ã'));
  ctx.controle.enqueue(primeira.subarray(0, acento + 1));
  ctx.controle.enqueue(primeira.subarray(acento + 1));
  await proximoTurno();
  assert.equal(monitor.consultar().textoGerado, 'Shalom, irmã');
  assert.match(ctx.getUrl(), /:streamGenerateContent\?alt=sse/);
  ctx.controle.enqueue(Buffer.from(evento('os!\\n\\nPaz.","narracao":"Shalom, irmãos! Paz."}')));
  ctx.controle.enqueue(Buffer.from(evento(undefined, 'STOP')));
  ctx.controle.close();
  assert.deepEqual(await chamada, { texto: 'Shalom, irmãos!\n\nPaz.', narracao: 'Shalom, irmãos! Paz.' });
  assert.equal(monitor.consultar().textoGerado, 'Shalom, irmãos!\n\nPaz.');
  assert.doesNotMatch(JSON.stringify(monitor.consultar()), /chave-de-teste|mensagem original/);
});

test('resposta do Gemini interrompida não é aceita como texto completo', async t => {
  const ctx = preparar(t);
  const chamada = adaptTextWithAI('texto', 'adapte');
  await proximoTurno();
  ctx.controle.enqueue(Buffer.from(evento('{"texto":"texto parcial"')));
  ctx.controle.close();
  await assert.rejects(chamada, /antes de concluir/);
});

test('resposta limitada por tokens não é considerada completa', async t => {
  const ctx = preparar(t);
  const chamada = adaptTextWithAI('texto', 'adapte');
  await proximoTurno();
  ctx.controle.enqueue(Buffer.from(evento('{"texto":"parcial","narracao":"parcial"}', 'MAX_TOKENS')));
  ctx.controle.close();
  await assert.rejects(chamada, /antes de concluir/);
});

test('erro temporário dentro do stream repete a chamada e descarta a prévia anterior', async t => {
  const ctx = preparar(t);
  let chamadas = 0;
  const originalLog = console.log;
  console.log = () => {};
  t.after(() => { console.log = originalLog; });
  const primeiro = new Response(new ReadableStream({ start(c) { ctx.controle = c; } }), { status: 200 });
  const sucesso = evento('{"texto":"Texto final","narracao":"Texto narrado"}', 'STOP');
  global.fetch = async () => ++chamadas === 1 ? primeiro : new Response(sucesso, { status: 200 });
  const esperas = [];
  const chamada = adaptTextWithAI('texto', 'adapte', 1, { esperar: async ms => {
    esperas.push(ms);
    assert.equal(monitor.consultar().textoGerado, '');
  } });
  await proximoTurno();
  ctx.controle.enqueue(Buffer.from(evento('{"texto":"Trecho antigo')));
  await proximoTurno();
  assert.equal(monitor.consultar().textoGerado, 'Trecho antigo');
  ctx.controle.enqueue(Buffer.from('data: {"error":{"code":503,"status":"UNAVAILABLE"}}\n\n'));
  assert.deepEqual(await chamada, { texto: 'Texto final', narracao: 'Texto narrado' });
  assert.equal(chamadas, 2);
  assert.deepEqual(esperas, [5000]);
  assert.equal(monitor.consultar().textoGerado, 'Texto final');
});

test('erros temporários no stream respeitam o limite e os intervalos de tentativas', async t => {
  preparar(t);
  let chamadas = 0;
  const originalLog = console.log;
  console.log = () => {};
  t.after(() => { console.log = originalLog; });
  global.fetch = async () => {
    chamadas++;
    return new Response('data: {"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}\n\n', { status: 200 });
  };
  const esperas = [];
  await assert.rejects(adaptTextWithAI('texto', 'adapte', 1, { esperar: async ms => { esperas.push(ms); } }), /não conseguiu gerar/);
  assert.equal(chamadas, 4);
  assert.deepEqual(esperas, [5000, 10000, 15000]);
});

test('JSON estruturado incompleto não é publicado mesmo quando o Gemini informou STOP', async t => {
  const ctx = preparar(t);
  const chamada = adaptTextWithAI('texto', 'adapte');
  await proximoTurno();
  ctx.controle.enqueue(Buffer.from(evento('{"texto":"trecho incompleto', 'STOP')));
  ctx.controle.close();
  await assert.rejects(chamada, /JSON incompleto ou inválido/);
  assert.equal(monitor.consultar().textoCompleto, false);
});

test('prévia espera escapes e pares Unicode completos e não mostra a narração', () => {
  assert.equal(extrairTextoParcial('{"texto":"Olá \\u00'), 'Olá ');
  assert.equal(extrairTextoParcial('{"texto":"Olá \\u00e1 \\ud83d'), 'Olá á ');
  assert.equal(extrairTextoParcial('{"texto":"Olá \\u00e1 \\ud83d\\ude80","narracao":"OUTRA"}'), 'Olá á 🚀');
});
