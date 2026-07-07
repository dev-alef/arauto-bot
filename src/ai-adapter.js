/**
 * Adaptador de Texto com IA (Google Gemini — free tier)
 */

async function adaptTextWithAI(originalText, instruction, tentativa = 1) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY não configurada no .env');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: `${instruction}\n\nTexto original:\n${originalText}` }]
      }]
    }),
  });

  if (!response.ok) {
    // Retry para erros temporários (503 = sobrecarga, 429 = rate limit)
    if ((response.status === 503 || response.status === 429) && tentativa <= 3) {
      const espera = tentativa * 5000; // 5s, 10s, 15s
      console.log(`  ⏳ Gemini ocupado, tentando de novo em ${espera / 1000}s (tentativa ${tentativa}/3)...`);
      await new Promise(r => setTimeout(r, espera));
      return adaptTextWithAI(originalText, instruction, tentativa + 1);
    }
    const err = await response.text();
    throw new Error(`Gemini API erro: ${err}`);
  }

  const data = await response.json();
  const adapted = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!adapted) throw new Error('IA não retornou texto adaptado');

  return adapted;
}

module.exports = { adaptTextWithAI };