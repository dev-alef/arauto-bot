/**
 * Adaptador de Texto com IA (Google Gemini — free tier)
 * Retorna DUAS versões do texto adaptado:
 *  - texto:    para leitura (referências bíblicas na notação padrão, ex: "2 Reis 4:12")
 *  - narracao: para o TTS ler em voz alta (ex: "Segundo Reis, capítulo quatro, versículo doze")
 */

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const monitor = require('./monitor');

// O Gemini devolve um JSON com duas versões. A prévia mostra apenas o campo
// escrito; espera por escapes completos antes de mostrá-los no painel.
function extrairTextoParcial(bruto) {
  const inicio = /"texto"\s*:\s*"/.exec(bruto);
  if (!inicio) return '';
  let resultado = '';
  for (let i = inicio.index + inicio[0].length; i < bruto.length; i++) {
    const letra = bruto[i];
    if (letra === '"') break;
    if (letra !== '\\') {
      const unidade = letra.charCodeAt(0);
      if (unidade >= 0xd800 && unidade <= 0xdbff) {
        const baixa = bruto.charCodeAt(i + 1);
        if (!(baixa >= 0xdc00 && baixa <= 0xdfff)) break;
        resultado += letra + bruto[++i];
        continue;
      }
      resultado += letra;
      continue;
    }
    if (i + 1 >= bruto.length) break;
    const escape = bruto[++i];
    const simples = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
    if (Object.hasOwn(simples, escape)) resultado += simples[escape];
    else if (escape === 'u') {
      const codigo = bruto.slice(i + 1, i + 5);
      if (codigo.length < 4) break;
      if (!/^[0-9a-f]{4}$/i.test(codigo)) break;
      const unidade = parseInt(codigo, 16);
      if (unidade >= 0xd800 && unidade <= 0xdbff) {
        const par = bruto.slice(i + 5, i + 11);
        if (par.length < 6 || !/^\\u[0-9a-f]{4}$/i.test(par)) break;
        const baixa = parseInt(par.slice(2), 16);
        if (baixa < 0xdc00 || baixa > 0xdfff) break;
        resultado += String.fromCharCode(unidade, baixa);
        i += 10;
      } else {
        resultado += String.fromCharCode(unidade);
        i += 4;
      }
    } else break;
  }
  return resultado.replace(/\\n/g, '\n');
}

async function lerRespostaEmPartes(response) {
  if (!response.body) throw new Error('Gemini não retornou uma resposta em partes.');
  const leitor = response.body.getReader();
  const decoder = new TextDecoder();
  let pendente = '', linhasDados = [], bruto = '', motivoFinal = '';

  function processarEvento() {
    if (!linhasDados.length) return;
    const dados = linhasDados.join('\n');
    linhasDados = [];
    if (dados === '[DONE]') return;
    let evento;
    try { evento = JSON.parse(dados); } catch { throw new Error('Gemini enviou uma resposta em partes inválida.'); }
    if (evento.error) {
      const erro = new Error('Gemini não conseguiu gerar a resposta.');
      const codigo = Number(evento.error.code);
      erro.status = [429, 503].includes(codigo) ? codigo :
        evento.error.status === 'RESOURCE_EXHAUSTED' ? 429 : evento.error.status === 'UNAVAILABLE' ? 503 : null;
      throw erro;
    }
    if (evento.promptFeedback?.blockReason) throw new Error('Gemini não conseguiu gerar a resposta.');
    const candidato = evento.candidates?.[0];
    for (const parte of candidato?.content?.parts || []) {
      if (typeof parte.text === 'string' && !parte.thought) bruto += parte.text;
    }
    if (candidato?.finishReason) motivoFinal = candidato.finishReason;
    monitor.definirTexto(extrairTextoParcial(bruto));
  }

  function processarLinhas(final = false) {
    let fim;
    while ((fim = pendente.indexOf('\n')) !== -1) {
      const linha = pendente.slice(0, fim).replace(/\r$/, '');
      pendente = pendente.slice(fim + 1);
      if (!linha) processarEvento();
      else if (linha.startsWith('data:')) linhasDados.push(linha.slice(5).replace(/^ /, ''));
    }
    if (final) {
      const linha = pendente.replace(/\r$/, '');
      if (linha.startsWith('data:')) linhasDados.push(linha.slice(5).replace(/^ /, ''));
      processarEvento();
      pendente = '';
    }
  }

  try {
    while (true) {
      const { done, value } = await leitor.read();
      if (done) break;
      pendente += decoder.decode(value, { stream: true });
      processarLinhas();
    }
    pendente += decoder.decode();
    processarLinhas(true);
  } catch (error) {
    await leitor.cancel().catch(() => {});
    throw error;
  } finally {
    leitor.releaseLock();
  }
  if (motivoFinal !== 'STOP') throw new Error('Gemini encerrou a resposta antes de concluir.');
  if (!bruto.trim()) throw new Error('IA não retornou resposta');
  return bruto.trim();
}

async function adaptTextWithAI(originalText, instruction, tentativa = 1, { esperar = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY não configurada no .env');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent?alt=sse&key=${apiKey}`;

  const promptCompleto = `${instruction}

PRESERVE os parágrafos do texto: dentro das strings JSON, represente cada quebra de parágrafo com a sequência \\n\\n (barra invertida + n, duas vezes). Não elimine a estrutura de parágrafos do texto original.

Retorne SOMENTE um JSON válido, sem markdown, sem crases, neste formato exato:
{"texto": "...", "narracao": "..."}

Regras:
- "texto": a versão adaptada para LEITURA. Mantenha referências bíblicas na notação padrão escrita (ex: "2 Reis 4:12", "1 Coríntios 1:27").
- "narracao": a MESMA versão adaptada, mas preparada para ser LIDA EM VOZ ALTA por um leitor automático. Converta as referências bíblicas para a forma falada correta, usando ordinais para os livros numerados (ex: "Segundo Reis, capítulo quatro, versículo doze", "Primeira Coríntios, capítulo um, versículo vinte e sete"). Escreva números por extenso. Sem marcações de pausa ou anotações entre parênteses — apenas palavras faladas, com pontuação natural para o ritmo.
- O conteúdo das duas versões deve ser idêntico; apenas a representação para leitura ou fala muda. Quando a instrução solicitar, adapte também siglas, símbolos, tabelas e diagramas para narração, preservando todas as informações.

Texto original:
${originalText}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: promptCompleto }] }]
    }),
  });

  async function tentarNovamente() {
    const espera = tentativa * 5000; // 5s, 10s, 15s
    monitor.definirTexto(''); // Nunca misturar uma prévia interrompida com a tentativa seguinte.
    monitor.evento(`Gemini ocupado; nova tentativa em ${espera / 1000} segundos.`, 'warn');
    console.log(`  ⏳ Gemini ocupado, nova tentativa em ${espera / 1000}s (${tentativa}/3)...`);
    await esperar(espera);
    return adaptTextWithAI(originalText, instruction, tentativa + 1, { esperar });
  }

  if (!response.ok) {
    // Retry para erros temporários (503 = sobrecarga, 429 = rate limit).
    if ((response.status === 503 || response.status === 429) && tentativa <= 3) {
      await response.body?.cancel().catch(() => {});
      return tentarNovamente();
    }
    const err = await response.text();
    throw new Error(`Gemini API erro: ${err}`);
  }

  let bruto;
  try {
    bruto = await lerRespostaEmPartes(response);
  } catch (error) {
    if ([429, 503].includes(error.status) && tentativa <= 3) return tentarNovamente();
    throw error;
  }

  // Remove possíveis cercas de markdown e parseia o JSON
  const limpo = bruto.replace(/```json|```/g, '').trim();
  try {
    const { texto, narracao } = JSON.parse(limpo);
    if (!texto || !narracao) throw new Error('JSON incompleto');

    // Converte eventuais "\n" literais (escape duplicado pela IA) em quebras reais
    const desescapar = (t) => t.replace(/\\n/g, '\n').trim();

    const resultado = { texto: desescapar(texto), narracao: desescapar(narracao) };
    monitor.definirTexto(resultado.texto, true);
    return resultado;
  } catch {
    if (/^(?:\{|\[)/.test(limpo)) throw new Error('Gemini retornou um JSON incompleto ou inválido.');
    console.log('  ⚠️ IA não retornou JSON válido; usando versão única');
    monitor.definirTexto(limpo, true);
    return { texto: limpo, narracao: limpo };
  }
}

module.exports = { adaptTextWithAI, extrairTextoParcial };
