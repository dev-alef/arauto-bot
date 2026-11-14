/** Confirma a rota de saúde do processo do bot, sem enviar mensagens. */
const http = require('node:http');

const pedido = http.get({ host: '127.0.0.1', port: process.env.PORT || 3000, path: '/' }, resposta => {
  let corpo = '';
  resposta.setEncoding('utf8');
  resposta.on('data', parte => {
    corpo += parte;
    if (Buffer.byteLength(corpo) > 4096) pedido.destroy();
  });
  resposta.on('end', () => {
    try { process.exitCode = resposta.statusCode === 200 && JSON.parse(corpo).status === 'online' ? 0 : 1; }
    catch { process.exitCode = 1; }
  });
  resposta.on('error', () => { process.exitCode = 1; });
  resposta.on('aborted', () => { process.exitCode = 1; });
});
pedido.setTimeout(2000, () => pedido.destroy());
pedido.on('error', () => { process.exitCode = 1; });
