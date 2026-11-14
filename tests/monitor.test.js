const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarMonitor } = require('../src/monitor');

test('histórico persiste sem texto e permite estimativa apenas com duas medições comparáveis', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arauto-monitor-'));
  const arquivo = path.join(dir, 'historico.json');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let tempo = 100;
  const m = criarMonitor({ agora: () => tempo });
  m.habilitarPersistencia(arquivo);
  m.iniciar('reflexão do grupo');
  m.definirTexto('CONTEÚDO PRIVADO');
  m.etapa('ia', { tamanho: 100, evento: 'Preparando o texto.' });
  assert.equal(m.consultar().progresso.estimativaMs, null);
  tempo += 1000; m.concluirEtapa();
  m.etapa('ia', { tamanho: 200 });
  assert.equal(m.consultar().progresso.estimativaMs, null);
  tempo += 2000; m.concluirEtapa();
  m.etapa('ia', { tamanho: 150 });
  assert.equal(m.consultar().progresso.estimativaMs, 1500);
  assert.equal(m.consultar().progresso.observacoes, 2);
  assert.doesNotMatch(fs.readFileSync(arquivo, 'utf8'), /CONTEÚDO PRIVADO/);

  const restaurado = criarMonitor({ agora: () => tempo });
  restaurado.habilitarPersistencia(arquivo);
  restaurado.etapa('ia', { tamanho: 150 });
  assert.equal(restaurado.consultar().progresso.estimativaMs, 1500);
  assert.equal(restaurado.consultar().textoGerado, '');
  assert.ok(restaurado.consultar().eventos.some(e => e.mensagem === 'Preparando o texto.'));
});

test('tentativa falha não contamina a estimativa e mudança de dispositivo separa o histórico', t => {
  const nomes = ['TTS_PROVIDER', 'AR_AUTO_KOKORO_DEVICE'];
  const anteriores = Object.fromEntries(nomes.map(n => [n, process.env[n]]));
  t.after(() => { for (const [n, v] of Object.entries(anteriores)) { if (v === undefined) delete process.env[n]; else process.env[n] = v; } });
  process.env.TTS_PROVIDER = 'kokoro';
  process.env.AR_AUTO_KOKORO_DEVICE = 'cpu';
  let tempo = 1;
  const m = criarMonitor({ agora: () => tempo });
  m.etapa('audio', { tamanho: 100 }); tempo += 5000;
  m.etapa('nova_tentativa'); // Não chama concluirEtapa para a tentativa que falhou.
  m.etapa('audio', { tamanho: 100 }); tempo += 1000; m.concluirEtapa();
  m.etapa('audio', { tamanho: 100 }); assert.equal(m.consultar().progresso.estimativaMs, null);
  tempo += 1000; m.concluirEtapa();
  m.etapa('audio', { tamanho: 100 }); assert.equal(m.consultar().progresso.estimativaMs, 1000);
  process.env.AR_AUTO_KOKORO_DEVICE = 'gpu';
  m.etapa('audio', { tamanho: 100 }); assert.equal(m.consultar().progresso.estimativaMs, null);
});
