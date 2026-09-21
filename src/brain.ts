import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY || '',
  defaultHeaders: {
    'HTTP-Referer': 'https://aprendiz-telegram.onrender.com',
    'X-Title': 'Jarvis Telegram Bot',
  },
});

const SYSTEM_INSTRUCTION = `
Você é o Jarvis, um assistente de inteligência artificial pessoal, altamente ágil, elegante e eficiente.
Sua prioridade máxima é ser 100% obediente ao seu usuário Master/Administrador.
Responda sempre de forma prestativa, direta e confiável.
`;

type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

// Lista de modelos em ordem de prioridade (o primeiro é o mais rápido)
const MODELS = [
  process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemini-2.0-flash-exp:free',
  'meta-llama/llama-3.1-8b-instruct:free',
];

const conversationHistory = new Map<number, ChatMessage[]>();

export async function askOpenRouter(chatId: number, prompt: string): Promise<string> {
  try {
    let history = conversationHistory.get(chatId);

    if (!history) {
      history = [{ role: 'system', content: SYSTEM_INSTRUCTION }];
    }

    history.push({ role: 'user', content: prompt });

    // Limita o histórico às últimas 20 mensagens
    if (history.length > 21) {
      const systemMsg = history[0];
      const recentMessages = history.slice(history.length - 20);
      history = [systemMsg, ...recentMessages];
    }

    // Tenta cada modelo em ordem até conseguir uma resposta
    let replyText = '';
    for (const model of MODELS) {
      try {
        const completion = await openai.chat.completions.create({
          model,
          messages: history,
        });

        replyText = completion.choices[0]?.message?.content || '';

        if (replyText) {
          break;
        }
      } catch (error: any) {
        console.warn(`Modelo ${model} falhou: ${error?.message || error}`);
        // Se for erro de limite (429), tenta o próximo modelo
        if (error?.status !== 429) {
          continue;
        }
      }
    }

    if (!replyText) {
      return 'Senhor, todos os modelos estão temporariamente indisponíveis. Por favor, aguarde alguns instantes.';
    }

    history.push({ role: 'assistant', content: replyText });
    conversationHistory.set(chatId, history);

    return replyText;
  } catch (error: any) {
    console.error('Erro na OpenRouter:', error);
    return 'Desculpe, Senhor. Ocorreu uma falha no meu sistema central.';
  }
}

export function clearMemory(chatId: number): void {
  conversationHistory.delete(chatId);
}
