const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selecionarRota, normalizarTextoRecebido } = require('../src/routing');

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

test('aceita aviso Pensou por antes da saudação nas reflexões e aulas', () => {
  for (const aviso of ['Pensou por 57s\n', 'PENSOU POR 1 minuto e 3 segundos\n\n', 'Pensou por 2m 10s\r\n']) {
    assert.equal(selecionarRota(aviso + reflexao, origem, config).destino, config.TARGET_GROUP_ID);
    assert.equal(selecionarRota(aviso + aula, origem, config).destino, config.IA_TARGET_NUMBER);
  }
});

test('aviso Pensou por não dispensa saudação nem filtro de remetente', () => {
  assert.ok(selecionarRota('Pensou por 57s\nBom dia!', origem, config).ignorar);
  assert.ok(selecionarRota('Pensou por 57s\n' + reflexao, '550000000000@s.whatsapp.net', config).ignorar);
});


test('aceita aviso de pensamento antes dos outros gatilhos existentes', () => {
  for (const inicio of ['Amém, amado', 'Amem amado', 'Shalon, amado']) {
    assert.equal(selecionarRota(` \nPensou por 1h 2m 3s\n\n${inicio}! Uma reflexão.`, origem, config).destino, config.TARGET_GROUP_ID);
  }
});

test('preserva texto de pensamento que não é o aviso de abertura', () => {
  const corpo = 'Shalom, amado! Ele pensou por 57s antes de responder.';
  assert.equal(normalizarTextoRecebido(corpo), corpo);
  const semSaudacao = 'Pensou por 57s\nBom dia!';
  assert.equal(normalizarTextoRecebido(semSaudacao), semSaudacao);
});

test('reconhece nomes alternativos do curso com a saudação habitual', () => {
  for (const nome of ['Curso Progressivo de IA', 'curso de inteligência artificial', 'curso sobre IA']) {
    const texto = `Shalom, amado! Hoje vamos começar o ${nome}.`;
    assert.equal(selecionarRota(texto, origem, config).tipo, 'aula de IA', nome);
  }
});

test('reconhece título numerado de aula com tema técnico mesmo sem nome completo do curso', () => {
  for (const titulo of [
    '📘 AULA 67 — COMO CONSTRUIR UM PEQUENO AGENTE DE IA?',
    '**Aula nº 68: GPU e redes neurais**',
    'AULA 69 — INTRODUÇÃO\nTema: modelos de linguagem e Transformers',
    'AULA 1 — O TRANSISTOR',
    'AULA 2 — UMA REDE NEURAL',
    'AULA 3 — INTEGRAÇÃO COM APIS',
  ]) {
    assert.equal(selecionarRota('Shalom, amado!\n\n' + titulo, origem, config).tipo, 'aula de IA', titulo);
    assert.equal(selecionarRota(titulo, origem, config).tipo, 'aula de IA', titulo);
  }
});

test('marcador explícito permite encaminhar aula mesmo sem saudação ou palavras técnicas', () => {
  assert.equal(selecionarRota('[AULA IA]\nAula de hoje: introdução.', origem, config).tipo, 'aula de IA');
  assert.equal(selecionarRota('Shalom, amado! [AULA IA] Introdução.', origem, config).tipo, 'aula de IA');
});

test('reflexão que menciona aula ou IA incidentalmente continua no grupo original', () => {
  for (const texto of [
    'Shalom, amado! Nesta aula de fé, reflita sobre a inteligência artificial e a ética.',
    'Shalom, amado! Na aula 5 de domingo, falamos de sabedoria e oração.',
    'Shalom, amado! Deus é bom. Na aula 12, falamos da história.',
    'Bom dia! Estou assistindo ao curso de inteligência artificial.',
  ]) {
    const rota = selecionarRota(texto, origem, config);
    assert.notEqual(rota.tipo, 'aula de IA', texto);
  }
});

test('dois remetentes de aulas configurados são aceitos, outros continuam bloqueados', () => {
  const dupla = { ...config, IA_WATCH_NUMBER: '553188887777,5524999990000' };
  assert.equal(selecionarRota(aula, origem, dupla).tipo, 'aula de IA');
  assert.equal(selecionarRota(aula, '5524999990000@s.whatsapp.net', dupla).tipo, 'aula de IA');
  assert.ok(selecionarRota(aula, '5511000000000@s.whatsapp.net', dupla).ignorar);
});

test('prefixo de pensamento seguido por título de aula sem saudação é removido', () => {
  const texto = 'Pensou por 57s\n\n📘 AULA 67 — INTRODUÇÃO AOS AGENTES DE IA';
  assert.equal(normalizarTextoRecebido(texto), '📘 AULA 67 — INTRODUÇÃO AOS AGENTES DE IA');
  assert.equal(selecionarRota(texto, origem, config).tipo, 'aula de IA');
});


test('título de aula e marcador explícito continuam sujeitos aos filtros de origem e destino', () => {
  const titulo = '📘 AULA 67 — CONSTRUINDO UM AGENTE DE IA';
  for (const texto of [titulo, '[AULA IA]\nIntrodução']) {
    assert.ok(selecionarRota(texto, '5511000000000@s.whatsapp.net', config).ignorar);
    assert.ok(selecionarRota(texto, origem, { ...config, IA_TARGET_NUMBER: '' }).ignorar);
  }
  assert.ok(selecionarRota('[AULA IA]', origem, config).ignorar);
});


test('logs de filtro identificam remetente e configuração ausente para facilitar diagnóstico', () => {
  assert.match(selecionarRota(aula, '5511000000000@s.whatsapp.net', config).ignorar, /5511000000000/);
  const semOrigem = selecionarRota(aula, origem, { ...config, WATCH_NUMBER: '', IA_WATCH_NUMBER: '' });
  assert.equal(semOrigem.aviso, true);
  assert.match(semOrigem.ignorar, /IA_WATCH_NUMBER/);
});
