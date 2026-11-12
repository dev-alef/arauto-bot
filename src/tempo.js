/** Relógio e espera compartilhados pela fila e pelas tentativas de áudio. */
function agora() {
  return Date.now();
}

function sortear(minimo, maximo) {
  return minimo + Math.floor(Math.random() * (maximo - minimo + 1));
}

function esperar(milisegundos) {
  return new Promise(resolve => setTimeout(resolve, milisegundos));
}

module.exports = { agora, sortear, esperar };
