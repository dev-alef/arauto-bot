/**
 * Adaptador de Texto com IA (Google Gemini — free tier)
 * Retorna DUAS versões do texto adaptado:
 *  - texto:    para leitura (referências bíblicas na notação padrão, ex: "2 Reis 4:12")
 *  - narracao: para o TTS ler em voz alta (ex: "Segundo Reis, capítulo quatro, versículo doze")
 */

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

async function adaptTextWithAI(originalText, instruction, tentativa = 1) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY não configurada no .env');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

  const promptCompleto = `${instruction}

PRESERVE os parágrafos do texto: dentro das strings JSON, represente cada quebra de parágrafo com a sequência \\n\\n (barra invertida + n, duas vezes). Não elimine a estrutura de parágrafos do texto original.

Retorne SOMENTE um JSON válido, sem markdown, sem crases, neste formato exato:
{"texto": "...", "narracao": "..."}

Regras:
- "texto": a versão adaptada para LEITURA. Mantenha referências bíblicas na notação padrão escrita (ex: "2 Reis 4:12", "1 Coríntios 1:27").
- "narracao": a MESMA versão adaptada, mas preparada para ser LIDA EM VOZ ALTA por um leitor automático. Converta as referências bíblicas para a forma falada correta, usando ordinais para os livros numerados (ex: "Segundo Reis, capítulo quatro, versículo doze", "Primeira Coríntios, capítulo um, versículo vinte e sete"). Escreva números por extenso. Sem marcações de pausa ou anotações entre parênteses — apenas palavras faladas, com pontuação natural para o ritmo.
- O conteúdo das duas versões deve ser idêntico; apenas a grafia das referências e números muda.

Texto original:
${originalText}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: promptCompleto }] }]
    }),
  });

  if (!response.ok) {
    // Retry para erros temporários (503 = sobrecarga, 429 = rate limit)
    if ((response.status === 503 || response.status === 429) && tentativa <= 3) {
      const espera = tentativa * 5000; // 5s, 10s, 15s
      console.log(`  ⏳ Gemini ocupado, nova tentativa em ${espera / 1000}s (${tentativa}/3)...`);
      await new Promise(r => setTimeout(r, espera));
      return adaptTextWithAI(originalText, instruction, tentativa + 1);
    }
    const err = await response.text();
    throw new Error(`Gemini API erro: ${err}`);
  }

  const data = await response.json();
  const bruto = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!bruto) throw new Error('IA não retornou resposta');

  // Remove possíveis cercas de markdown e parseia o JSON
  const limpo = bruto.replace(/```json|```/g, '').trim();
  try {
    const { texto, narracao } = JSON.parse(limpo);
    if (!texto || !narracao) throw new Error('JSON incompleto');

    // Converte eventuais "\n" literais (escape duplicado pela IA) em quebras reais
    const desescapar = (t) => t.replace(/\\n/g, '\n').trim();

    return { texto: desescapar(texto), narracao: desescapar(narracao) };
  } catch {
    console.log('  ⚠️ IA não retornou JSON válido; usando versão única');
    return { texto: limpo, narracao: limpo };
  }
}

module.exports = { adaptTextWithAI };