const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('seleção de CPU e GPU preserva o painel e permite desfazer a GPU', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arauto-compose-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const scripts = path.join(dir, 'scripts');
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(scripts); fs.mkdirSync(bin);
  fs.copyFileSync(path.join(__dirname, '../scripts/arauto-compose.sh'), path.join(scripts, 'arauto-compose.sh'));
  const arquivos = ['base.yml', 'docker-compose.kokoro.yml', 'docker-compose.dashboard.yml', 'docker-compose.kokoro-gpu.yml'];
  for (const nome of arquivos) fs.writeFileSync(path.join(dir, nome), 'services: {}\n');
  fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/bash
if [[ "$1" == inspect ]]; then
  case "$3" in
    *project.config_files*) printf '%s\\n' "$AR_AUTO_TEST_FILES" ;;
    *project.working_dir*) printf '%s\\n' "$AR_AUTO_TEST_DIR" ;;
    *project*) printf '%s\\n' 'projeto' ;;
  esac
else
  printf 'ROOT=%s\\n' "$AR_AUTO_REPO_DIR"
  printf '%s\\n' "$@"
fi
`, { mode: 0o755 });
  const executar = (modo, lista) => execFileSync('bash', [path.join(scripts, 'arauto-compose.sh'), ...modo, 'config'], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, AR_AUTO_TEST_DIR: dir,
      AR_AUTO_TEST_FILES: lista.map(a => path.join(dir, a)).join(',') }, encoding: 'utf8',
  }).trim().split('\n');
  const cpu = ['base.yml', 'docker-compose.kokoro.yml', 'docker-compose.dashboard.yml'];
  const gpu = [...cpu, 'docker-compose.kokoro-gpu.yml'];
  const ativar = executar(['--kokoro-gpu'], cpu);
  assert.equal(ativar.filter(x => x === path.join(dir, 'docker-compose.kokoro-gpu.yml')).length, 1);
  assert.ok(ativar.includes(path.join(dir, 'docker-compose.dashboard.yml')));
  assert.ok(ativar.includes(`ROOT=${dir}`));
  const preservar = executar([], gpu);
  assert.ok(preservar.includes(path.join(dir, 'docker-compose.kokoro-gpu.yml')));
  const voltar = executar(['--kokoro-cpu'], gpu);
  assert.ok(!voltar.includes(path.join(dir, 'docker-compose.kokoro-gpu.yml')));
  assert.ok(voltar.includes(path.join(dir, 'docker-compose.dashboard.yml')));
  const ordem = executar(['--kokoro-gpu'], ['base.yml', 'docker-compose.kokoro-gpu.yml']);
  assert.ok(ordem.indexOf(path.join(dir, 'docker-compose.kokoro.yml')) < ordem.indexOf(path.join(dir, 'docker-compose.kokoro-gpu.yml')));
  const recuperacao = execFileSync('bash', [path.join(scripts, 'arauto-compose.sh'), '--kokoro-cpu', 'config'], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, AR_AUTO_FROZEN_PROJECT: 'projeto',
      AR_AUTO_FROZEN_WORKDIR: dir, AR_AUTO_FROZEN_FILES: gpu.map(a => path.join(dir, a)).join(',') }, encoding: 'utf8',
  });
  assert.ok(recuperacao.includes(path.join(dir, 'docker-compose.kokoro.yml')));
  assert.ok(!recuperacao.includes(path.join(dir, 'docker-compose.kokoro-gpu.yml')));
});

test('troca recupera CPU após falha e não derruba bot se monitor falhar', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arauto-troca-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const scripts = path.join(dir, 'scripts');
  const bin = path.join(dir, 'bin');
  const log = path.join(dir, 'log');
  fs.mkdirSync(scripts); fs.mkdirSync(bin);
  fs.copyFileSync(path.join(__dirname, '../scripts/arauto-kokoro.sh'), path.join(scripts, 'arauto-kokoro.sh'));
  fs.copyFileSync(path.join(__dirname, '../scripts/check-bot-ready.js'), path.join(scripts, 'check-bot-ready.js'));
  fs.writeFileSync(path.join(scripts, 'arauto-compose.sh'), `#!/bin/bash
printf '%s\\n' "$*" >> "$AR_AUTO_TEST_LOG"
case "$AR_AUTO_TEST_FAIL:$*" in
  build:*'build bot'*) exit 1 ;;
  audio:*'run --rm'*) exit 1 ;;
  audio_e_cpu:*'run --rm'*) exit 1 ;;
  audio_e_cpu:--kokoro-cpu*'up -d --wait'*) exit 1 ;;
  bot_gpu:--kokoro-gpu*'exec -T bot'*) exit 1 ;;
  monitor:*'arauto-gpu-metrics'*) exit 1 ;;
  rejeitar_gpu:--kokoro-gpu*) exit 1 ;;
  imagem_antiga:*'node scripts/check-bot-ready.js'*) exit 1 ;;
esac
if [[ "$*" == *'config --format json'* ]]; then printf '%s\\n' '{"services":{"kokoro":{"image":"arauto/teste"}}}'; fi
exit 0
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/bash
if [[ "$1" == inspect ]]; then
  [[ "$AR_AUTO_TEST_NO_CONTAINER" == 1 ]] && exit 1
  case "$3" in
    *project.config_files*) printf '%s\\n' "$AR_AUTO_TEST_DIR/base.yml" ;;
    *project.working_dir*) printf '%s\\n' "$AR_AUTO_TEST_DIR" ;;
    *project*) printf '%s\\n' 'projeto' ;;
  esac
elif [[ "$1 $2" == 'image inspect' ]]; then
  [[ "$AR_AUTO_TEST_IMAGE_MISSING" == 1 ]] && exit 1
  exit 0
elif [[ "$1" == ps ]]; then printf '%s\\n' 'monitor123';
elif [[ "$1" == rm ]]; then printf 'docker %s\\n' "$*" >> "$AR_AUTO_TEST_LOG"; fi
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  function executar(modo, falha, extra = {}) {
    fs.writeFileSync(log, '');
    const resultado = require('node:child_process').spawnSync('bash', [path.join(scripts, 'arauto-kokoro.sh'), modo], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, AR_AUTO_TEST_DIR: dir,
        AR_AUTO_TEST_LOG: log, AR_AUTO_TEST_FAIL: falha, ...extra }, encoding: 'utf8',
    });
    return { ...resultado, chamadas: fs.readFileSync(log, 'utf8') };
  }
  const falhaAudio = executar('gpu', 'audio');
  assert.equal(falhaAudio.status, 1);
  assert.match(falhaAudio.chamadas, /--kokoro-cpu up -d --wait .* kokoro/);
  assert.match(falhaAudio.chamadas, /--kokoro-cpu up -d --no-deps bot/);
  const falhaMonitor = executar('gpu', 'monitor');
  assert.equal(falhaMonitor.status, 0);
  assert.match(falhaMonitor.chamadas, /--kokoro-gpu up -d --no-deps bot/);
  assert.doesNotMatch(falhaMonitor.chamadas, /--kokoro-cpu up -d --no-deps bot/);
  const botGpu = executar('gpu', 'bot_gpu');
  assert.equal(botGpu.status, 1);
  assert.match(botGpu.chamadas, /--kokoro-cpu up -d --no-deps bot/);
  assert.ok(botGpu.chamadas.lastIndexOf('--kokoro-cpu stop bot') > botGpu.chamadas.indexOf('--kokoro-gpu up -d --no-deps bot'));
  const build = executar('gpu', 'build');
  assert.equal(build.status, 1);
  assert.doesNotMatch(build.chamadas, /stop bot/);
  const cpu = executar('cpu', 'rejeitar_gpu');
  assert.equal(cpu.status, 0);
  assert.doesNotMatch(cpu.chamadas, /--kokoro-gpu/);
  assert.match(cpu.chamadas, /docker rm -f monitor123/);
  const imagemAntiga = executar('cpu', 'imagem_antiga');
  assert.equal(imagemAntiga.status, 0);
  assert.match(imagemAntiga.chamadas, /exec -T bot node -e/);
  assert.doesNotMatch(imagemAntiga.chamadas, /node scripts\/check-bot-ready.js/);
  const imagens = executar('gpu', '', { AR_AUTO_TEST_IMAGE_MISSING: '1' });
  assert.equal(imagens.status, 0);
  assert.ok(imagens.chamadas.indexOf('--kokoro-gpu pull kokoro') < imagens.chamadas.indexOf('--kokoro-cpu stop bot'));
  const falhaDupla = executar('gpu', 'audio_e_cpu');
  assert.equal(falhaDupla.status, 1);
  const posterior = executar('cpu', '', { AR_AUTO_TEST_NO_CONTAINER: '1' });
  assert.equal(posterior.status, 0);
  assert.match(posterior.stdout, /snapshot local/);
  assert.match(posterior.chamadas, /--kokoro-cpu up -d --no-deps bot/);
});
