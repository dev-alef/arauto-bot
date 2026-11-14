const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarLeitorRecursos } = require('../src/recursos');

test('uso de CPU vem da diferença entre leituras e GPU mostra métricas reais', async () => {
  let agora = 1000, chamadas = 0, tempos = { user: 100, nice: 0, sys: 0, idle: 100, irq: 0 };
  const leitor = criarLeitorRecursos({ agora: () => agora, listarCpus: () => [{ times: tempos }],
    executarNvidia: (cmd, args, opts, callback) => { chamadas++; callback(null, '25, 300, 2048\n'); } });
  assert.deepEqual(await leitor.consultar(), { cpuPercentual: null, gpu: { usoPercentual: 25, memoriaUsadaMiB: 300, memoriaTotalMiB: 2048 } });
  tempos = { user: 160, nice: 0, sys: 0, idle: 140, irq: 0 };
  agora += 1000;
  assert.equal((await leitor.consultar()).cpuPercentual, 60);
  assert.equal(chamadas, 1);
});

test('GPU indisponível ou saída inválida não é mostrada como uso zero', async () => {
  for (const saida of ['N/A, 10, 100', '', '20, 200, 100']) {
    const leitor = criarLeitorRecursos({ listarCpus: () => [], executarNvidia: (cmd, args, opts, cb) => cb(null, saida) });
    assert.equal((await leitor.consultar()).gpu, null);
  }
  const leitor = criarLeitorRecursos({ listarCpus: () => [], executarNvidia: (cmd, args, opts, cb) => cb(new Error('indisponível')) });
  assert.equal((await leitor.consultar()).gpu, null);
});
