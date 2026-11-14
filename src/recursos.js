/** Leituras locais de recursos, sem acesso ao socket do Docker. */
const os = require('os');
const { execFile } = require('child_process');
const http = require('http');
const https = require('https');

function lerGpuRemota(endereco) {
  return new Promise(resolve => {
    let pedido;
    let finalizado = false;
    let limite;
    const concluir = valor => {
      if (finalizado) return;
      finalizado = true;
      clearTimeout(limite);
      resolve(valor);
    };
    limite = setTimeout(() => { pedido?.destroy(); concluir(null); }, 1500);
    limite.unref();
    try {
      const url = new URL(endereco);
      const cliente = url.protocol === 'http:' ? http : url.protocol === 'https:' ? https : null;
      if (!cliente) return concluir(null);
      pedido = cliente.get(url, resposta => {
        if (resposta.statusCode !== 200) {
          resposta.resume();
          return concluir(null);
        }
        let texto = '';
        resposta.setEncoding('utf8');
        resposta.on('data', parte => {
          texto += parte;
          if (Buffer.byteLength(texto) > 4096) {
            pedido.destroy();
            concluir(null);
          }
        });
        resposta.on('end', () => concluir(texto));
        resposta.on('error', () => concluir(null));
      });
      pedido.on('error', () => concluir(null));
    } catch { concluir(null); }
  });
}

function criarLeitorRecursos({ listarCpus = os.cpus, executarNvidia = execFile, agora = Date.now,
  enderecoGpu = process.env.AR_AUTO_GPU_METRICS_URL || '' } = {}) {
  let anterior = null;
  let ultimoGpu = 0;
  let gpu = null;
  let consultaPendente = null;

  function cpu() {
    const totais = listarCpus().reduce((soma, item) => {
      const tempos = item.times;
      soma.total += tempos.user + tempos.nice + tempos.sys + tempos.idle + tempos.irq;
      soma.ocioso += tempos.idle;
      return soma;
    }, { total: 0, ocioso: 0 });
    const antes = anterior;
    anterior = totais;
    if (!antes || totais.total <= antes.total || totais.ocioso < antes.ocioso) return null;
    return Math.max(0, Math.min(100, Math.round(100 * (1 - (totais.ocioso - antes.ocioso) / (totais.total - antes.total)))));
  }

  async function gpuAtual() {
    if (consultaPendente) return consultaPendente;
    if (ultimoGpu && agora() - ultimoGpu < 15000) return gpu;
    consultaPendente = new Promise(resolve => {
      const argumentos = ['--query-gpu=utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'];
      const finalizar = (erro, saida = '') => {
        ultimoGpu = agora();
        const textos = String(saida).split('\n')[0].split(',').map(v => v.trim());
        const campos = textos.map(Number);
        gpu = !erro && campos.length === 3 && textos.every(Boolean) && campos.every(Number.isFinite) &&
          campos[0] >= 0 && campos[0] <= 100 && campos[1] >= 0 && campos[2] > 0 && campos[1] <= campos[2]
          ? { usoPercentual: campos[0], memoriaUsadaMiB: campos[1], memoriaTotalMiB: campos[2] }
          : null;
        resolve(gpu);
      };
      if (enderecoGpu) {
        lerGpuRemota(enderecoGpu).then(saida => finalizar(saida === null, saida || ''));
      } else {
        try { executarNvidia('nvidia-smi', argumentos, { timeout: 1500, maxBuffer: 4096 }, finalizar); }
        catch { finalizar(true); }
      }
    });
    try { return await consultaPendente; } finally { consultaPendente = null; }
  }

  async function consultar() {
    let usoCpu = null;
    try { usoCpu = cpu(); } catch {}
    return { cpuPercentual: usoCpu, gpu: await gpuAtual() };
  }

  return { consultar };
}

module.exports = { criarLeitorRecursos };
