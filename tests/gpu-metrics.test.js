const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');

test('monitor publica métricas reais e informa indisponibilidade sem acessar o Docker', async t => {
  if (spawnSync('python3', ['--version']).error) return t.skip('python3 não disponível');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arauto-gpu-metrics-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const executavel = path.join(dir, 'nvidia-smi');
  fs.writeFileSync(executavel, '#!/bin/sh\nprintf "84, 1585, 2048\\n"\n', { mode: 0o755 });
  const filho = spawn('python3', [path.join(__dirname, '../scripts/gpu-metrics.py')], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, AR_AUTO_GPU_METRICS_PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => { filho.kill(); if (filho.exitCode === null) await once(filho, 'exit'); });
  const [primeira] = await once(filho.stdout, 'data');
  const porta = Number(String(primeira).match(/porta (\d+)/)?.[1]);
  assert.ok(porta > 0);
  let resposta = await fetch(`http://127.0.0.1:${porta}/metrics`);
  assert.equal(resposta.status, 200);
  assert.equal(await resposta.text(), '84, 1585, 2048\n');
  resposta = await fetch(`http://127.0.0.1:${porta}/outra`);
  assert.equal(resposta.status, 404);
  fs.writeFileSync(executavel, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  resposta = await fetch(`http://127.0.0.1:${porta}/metrics`);
  assert.equal(resposta.status, 503);
});
