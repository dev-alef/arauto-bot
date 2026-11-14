const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');

test('verificação exige resposta HTTP de saúde do próprio bot', async t => {
  let saudavel = true;
  const servidor = http.createServer((req, res) => {
    res.end(JSON.stringify({ status: saudavel ? 'online' : 'erro' }));
  });
  servidor.listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  t.after(() => { servidor.closeAllConnections(); servidor.close(); });
  const verificar = async () => {
    const processo = spawn(process.execPath, [path.join(__dirname, '../scripts/check-bot-ready.js')], {
      env: { ...process.env, PORT: String(servidor.address().port) }, stdio: 'ignore',
    });
    const [codigo] = await once(processo, 'exit');
    return codigo;
  };
  assert.equal(await verificar(), 0);
  saudavel = false;
  assert.equal(await verificar(), 1);
});
