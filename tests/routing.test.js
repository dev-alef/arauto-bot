const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selecionarRota } = require('../src/routing');

const config = {
  WATCH_NUMBER: '553188887777',
  TARGET_GROUP_ID: 'grupo-atual@g.us',
  AI_PROMPT: 'Instrução atual da reflexão',
  IA_WATCH_NUMBER: '553188887777',
  IA_TARGET_NUMBER: '5524999990000',
};
const origem = '5531988887777@s.whatsapp.net';
const reflexao = 'Shalom, amado! Que a paz esteja conosco. Hoje vamos refletir sobre a sabedoria.';
const aula = `Shalom, amado! Hoje chegamos à nossa Aula 66 do Curso Progressivo de Inteligência Artificial.
📘 AULA 66 — COMO FUNCIONAM OS AGENTES DE INTELIGÊNCIA ARTIFICIAL?
Tema: agentes de IA, autonomia, planejamento, GPUs e data centers.
5 × 200 = 1.000 joules.
📘 PRÓXIMA AULA — AULA 67`;

test('reflexão atual mantém o grupo e o prompt existentes', () => {
  assert.deepEqual(selecionarRota(reflexao, origem, config), {
    tipo: 'reflexão do grupo', destino: config.TARGET_GROUP_ID, prompt: config.AI_PROMPT,
  });
});

test('aula do mesmo remetente vai somente para o contato e usa instruções de narração técnica', () => {
  const rota = selecionarRota(aula, origem, config);
  assert.equal(rota.destino, config.IA_TARGET_NUMBER);
  assert.notEqual(rota.destino, config.TARGET_GROUP_ID);
  assert.equal(rota.tipo, 'aula de IA');
  assert.match(rota.prompt, /Não resuma/);
  assert.match(rota.prompt, /diagramas/);
  assert.match(rota.prompt, /GPU, CPU, QPU/);
});

test('reconhece o curso com caixa, acento e quebras de linha diferentes', () => {
  const texto = aula.replace('Curso Progressivo de Inteligência Artificial', 'CURSO PROGRESSIVO DE\nINTELIGENCIA ARTIFICIAL');
  assert.equal(selecionarRota(texto, origem, config).tipo, 'aula de IA');
});

test('mencionar IA em uma reflexão comum não troca o destino', () => {
  assert.equal(selecionarRota(reflexao + ' Pense na inteligência artificial.', origem, config).destino, config.TARGET_GROUP_ID);
});

test('preserva gatilhos anteriores e ignora texto sem gatilho', () => {
  for (const inicio of ['Amém, amado', 'Amem amado', 'Shalon, amado']) {
    assert.equal(selecionarRota(`${inicio}! Uma reflexão.`, origem, config).destino, config.TARGET_GROUP_ID);
  }
  assert.ok(selecionarRota('Olá! Curso Progressivo de Inteligência Artificial', origem, config).ignorar);
});

test('aula sem destino configurado ou com grupo como destino nunca cai no grupo atual', () => {
  for (const IA_TARGET_NUMBER of ['', '120363123456789@g.us', 'abc']) {
    const rota = selecionarRota(aula, origem, { ...config, IA_TARGET_NUMBER });
    assert.ok(rota.ignorar);
    assert.equal(rota.destino, undefined);
    assert.equal(rota.aviso, true);
  }
});

test('aceita o telefone de destino formatado e mantém o nono dígito', () => {
  const rota = selecionarRota(aula, origem, { ...config, IA_TARGET_NUMBER: '+55 (24) 99999-0000' });
  assert.equal(rota.destino, '5524999990000');
});

test('remetente incorreto não envia nem reflexão nem aula', () => {
  for (const texto of [reflexao, aula]) {
    assert.ok(selecionarRota(texto, '550000000000@s.whatsapp.net', config).ignorar);
  }
});

test('aulas usam WATCH_NUMBER quando não há remetente específico e exigem uma origem configurada', () => {
  assert.equal(selecionarRota(aula, origem, { ...config, IA_WATCH_NUMBER: '' }).destino, config.IA_TARGET_NUMBER);
  assert.ok(selecionarRota(aula, origem, { ...config, IA_WATCH_NUMBER: '', WATCH_NUMBER: '' }).ignorar);
});

test('origem da aula pode ser configurada sem mudar origem das reflexões', () => {
  const outro = { ...config, IA_WATCH_NUMBER: '5511988887777' };
  assert.equal(selecionarRota(aula, '5511988887777@s.whatsapp.net', outro).destino, config.IA_TARGET_NUMBER);
  assert.ok(selecionarRota(reflexao, '5511988887777@s.whatsapp.net', outro).ignorar);
});


test('grupo de IA tem prioridade sobre o número privado e preserva IDs com hífen', () => {
  for (const grupo of ['120363999999999@g.us', '5524999990000-1234567890@g.us']) {
    assert.equal(selecionarRota(aula, origem, { ...config, IA_TARGET_GROUP_ID: grupo }).destino, grupo);
  }
});

test('grupo de IA inválido bloqueia envio, sem recorrer ao contato antigo', () => {
  for (const grupo of ['abc@g.us', '120363999999999', '5524999990000@s.whatsapp.net']) {
    const rota = selecionarRota(aula, origem, { ...config, IA_TARGET_GROUP_ID: grupo });
    assert.ok(rota.ignorar);
    assert.equal(rota.destino, undefined);
  }
});
