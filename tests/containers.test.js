const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { criarLeitorContainers } = require('../src/containers');

test('resumo mostra estados atuais e omite informações extras', async t => {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'arauto-containers-'));
  t.after(() => fs.rm(pasta, { recursive: true, force: true }));
  const arquivo = path.join(pasta, 'status.json');
  const leitor = criarLeitorContainers({ arquivo, agora: () => 100000 });
  assert.equal((await leitor.consultar()).disponivel, false);
  await fs.writeFile(arquivo, JSON.stringify({ disponivel: true, atualizadoEm: 90000, containers: [
    { nome: 'bot', estado: 'running', status: 'Up 5 minutes', segredo: 'nao-exportar' },
    { nome: 'postgres', estado: 'exited', status: 'Exited (1) 1 minute ago' },
  ], limitado: false, senha: 'nao-exportar' }));
  assert.deepEqual(await leitor.consultar(), { disponivel: true, atualizadoEm: 90000, containers: [
    { nome: 'bot', estado: 'running', status: 'Up 5 minutes' },
    { nome: 'postgres', estado: 'exited', status: 'Exited (1) 1 minute ago' },
  ], limitado: false });
});

test('dados antigos, futuros, malformados ou excessivos não aparecem como atuais', async t => {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'arauto-containers-'));
  t.after(() => fs.rm(pasta, { recursive: true, force: true }));
  const arquivo = path.join(pasta, 'status.json');
  const leitor = criarLeitorContainers({ arquivo, agora: () => 100000 });
  const exemplos = [
    { disponivel: true, atualizadoEm: 54999, containers: [] },
    { disponivel: true, atualizadoEm: 110001, containers: [] },
    { disponivel: true, atualizadoEm: 100000, containers: [{ nome: '', estado: 'running', status: '' }] },
    { disponivel: true, atualizadoEm: 100000, containers: new Array(201).fill({}) },
  ];
  for (const exemplo of exemplos) {
    await fs.writeFile(arquivo, JSON.stringify(exemplo));
    assert.equal((await leitor.consultar()).disponivel, false);
  }
  await fs.writeFile(arquivo, 'x'.repeat(150001));
  assert.equal((await leitor.consultar()).disponivel, false);
  await fs.writeFile(arquivo, JSON.stringify({ disponivel: false, atualizadoEm: 100000 }));
  assert.deepEqual(await leitor.consultar(), { disponivel: false, motivo: 'docker_indisponivel' });
});

test('coletor publica apenas campos autorizados e sinaliza falha Docker', async t => {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'arauto-coletor-'));
  t.after(() => fs.rm(pasta, { recursive: true, force: true }));
  const codigo = `
import importlib.util, json, os, subprocess, sys
from unittest import mock
spec = importlib.util.spec_from_file_location('monitor', sys.argv[1]); monitor = importlib.util.module_from_spec(spec); spec.loader.exec_module(monitor)
saida = subprocess.CompletedProcess([], 0, stdout='["bot","running","Up 3 minutes (healthy)"]\\n["postgres","exited","Exited (1)"]\\n', stderr='')
with mock.patch.object(monitor.subprocess, 'run', return_value=saida) as executar:
    monitor.publicar(sys.argv[2])
    assert executar.call_args.args[0] == ['/usr/bin/docker', 'ps', '-a', '--format', monitor.FORMATO]
with open(os.path.join(sys.argv[2], 'status.json'), encoding='utf8') as f: bom = json.load(f)
with mock.patch.object(monitor.subprocess, 'run', side_effect=subprocess.TimeoutExpired('docker', 5)):
    monitor.publicar(sys.argv[2])
with open(os.path.join(sys.argv[2], 'status.json'), encoding='utf8') as f: erro = json.load(f)
print(json.dumps({'bom': bom, 'erro': erro, 'mode': oct(os.stat(os.path.join(sys.argv[2], 'status.json')).st_mode & 0o777)}))
`;
  const execucao = spawnSync('python3', ['-c', codigo, path.join(__dirname, '../scripts/monitor-containers.py'), pasta], { encoding: 'utf8' });
  assert.equal(execucao.status, 0, execucao.stderr);
  const { bom, erro, mode } = JSON.parse(execucao.stdout);
  assert.deepEqual(bom.containers, [
    { nome: 'bot', estado: 'running', status: 'Up 3 minutes (healthy)' },
    { nome: 'postgres', estado: 'exited', status: 'Exited (1)' },
  ]);
  assert.equal(bom.disponivel, true);
  assert.equal(erro.disponivel, false);
  assert.deepEqual(erro.containers, []);
  assert.equal(mode, '0o644');
});
