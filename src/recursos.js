/** Leituras locais de recursos, sem acesso ao socket do Docker. */
const os = require('os');
const { execFile } = require('child_process');

function criarLeitorRecursos({ listarCpus = os.cpus, executarNvidia = execFile, agora = Date.now } = {}) {
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
        const campos = String(saida).split('\n')[0].split(',').map(v => Number(v.trim()));
        gpu = !erro && campos.length === 3 && campos.every(Number.isFinite) &&
          campos[0] >= 0 && campos[0] <= 100 && campos[1] >= 0 && campos[2] > 0 && campos[1] <= campos[2]
          ? { usoPercentual: campos[0], memoriaUsadaMiB: campos[1], memoriaTotalMiB: campos[2] }
          : null;
        resolve(gpu);
      };
      try { executarNvidia('nvidia-smi', argumentos, { timeout: 1500, maxBuffer: 4096 }, finalizar); }
      catch { finalizar(true); }
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
