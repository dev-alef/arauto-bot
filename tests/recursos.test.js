const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
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
  for (const saida of ['N/A, 10, 100', '', ',, 2048', '20, 200, 100']) {
    const leitor = criarLeitorRecursos({ listarCpus: () => [], executarNvidia: (cmd, args, opts, cb) => cb(null, saida) });
    assert.equal((await leitor.consultar()).gpu, null);
  }
  const leitor = criarLeitorRecursos({ listarCpus: () => [], executarNvidia: (cmd, args, opts, cb) => cb(new Error('indisponível')) });
  assert.equal((await leitor.consultar()).gpu, null);
});

test('painel consulta o monitor de GPU pela rede interna e mantém o cache', async t => {
  let respostas = 0;
  let saida = '73, 1585, 2048\n';
  let agora = 1000;
  const servidor = http.createServer((req, res) => { respostas++; res.end(saida); });
  servidor.listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  t.after(() => { servidor.closeAllConnections(); servidor.close(); });
  const leitor = criarLeitorRecursos({ listarCpus: () => [], agora: () => agora,
    enderecoGpu: `http://127.0.0.1:${servidor.address().port}/metrics`,
    executarNvidia: () => { throw new Error('não deve depender do nvidia-smi no bot'); } });
  const [primeira, paralela] = await Promise.all([leitor.consultar(), leitor.consultar()]);
  assert.deepEqual(primeira.gpu, { usoPercentual: 73, memoriaUsadaMiB: 1585, memoriaTotalMiB: 2048 });
  assert.deepEqual(paralela.gpu, primeira.gpu);
  assert.equal(respostas, 1);
  saida = 'indisponível';
  agora += 16000;
  assert.equal((await leitor.consultar()).gpu, null);
  assert.equal(respostas, 2);
});

test('falha e resposta excessiva do monitor remoto não derrubam o painel', async t => {
  let excessiva = false;
  const servidor = http.createServer((req, res) => {
    if (excessiva) res.end('1'.repeat(5000));
    else { res.statusCode = 503; res.end(); }
  });
  servidor.listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  t.after(() => { servidor.closeAllConnections(); servidor.close(); });
  let agora = 1000;
  const leitor = criarLeitorRecursos({ listarCpus: () => [], agora: () => agora,
    enderecoGpu: `http://127.0.0.1:${servidor.address().port}/metrics` });
  assert.equal((await leitor.consultar()).gpu, null);
  excessiva = true;
  agora += 16000;
  assert.equal((await leitor.consultar()).gpu, null);
});

test('monitor remoto que não termina a resposta respeita o limite de tempo', async t => {
  const servidor = http.createServer((req, res) => { res.writeHead(200); res.write('10, '); });
  servidor.listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  t.after(() => { servidor.closeAllConnections(); servidor.close(); });
  const leitor = criarLeitorRecursos({ listarCpus: () => [],
    enderecoGpu: `http://127.0.0.1:${servidor.address().port}/metrics` });
  const inicio = Date.now();
  assert.equal((await leitor.consultar()).gpu, null);
  assert.ok(Date.now() - inicio < 4000);
});
