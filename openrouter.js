import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY || '',
  defaultHeaders: {
    'HTTP-Referer': process.env.RENDER_EXTERNAL_URL || 'https://render.com',
    'X-Title': 'Jarvis Telegram Bot',
  },
});

// Modelos em ordem de preferência. O bot mede o tempo de cada um
// e reordena automaticamente para sempre usar o mais rápido.
const MODELS = [
  process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-exp:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'meta-llama/llama-3.1-8b-instruct:free',
];

// Guarda a latência média de cada modelo (ms)
const latencyStats = new Map();

export async function askOpenRouter(messages, options = {}) {
  const { temperature = 0.7, maxTokens = 2000 } = options;

  // Ordena modelos: os que responderam mais rápido ficam na frente
  const sortedModels = [...MODELS].sort((a, b) => {
    const la = latencyStats.get(a) ?? 99999;
    const lb = latencyStats.get(b) ?? 99999;
    return la - lb;
  });

  let lastError = null;

  for (const model of sortedModels) {
    const start = Date.now();
    try {
      const completion = await openai.chat.completions.create({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
      });

      const reply = completion.choices?.[0]?.message?.content || '';
      if (!reply) continue;

      // Atualiza a latência média (média móvel)
      const elapsed = Date.now() - start;
      const current = latencyStats.get(model) ?? elapsed;
      latencyStats.set(model, Math.round((current + elapsed) / 2));

      return reply;
    } catch (error) {
      lastError = error;
      console.warn(`Modelo ${model} falhou: ${error?.message || error}`);
      // 429 = limite de requisições, tenta o próximo modelo
      if (error?.status === 429) continue;
    }
  }

  throw new Error(lastError?.message || 'Todos os modelos falharam');
}

export function getModelRanking() {
  return [...MODELS]
    .map((m) => ({ model: m, latency: latencyStats.get(m) ?? null }))
    .sort((a, b) => (a.latency ?? 99999) - (b.latency ?? 99999));
}
