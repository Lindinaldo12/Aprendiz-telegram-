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

// Histórico de conversa em memória por chat
const conversationHistory = new Map<number, ChatMessage[]>();

export async function askOpenRouter(chatId: number, prompt: string): Promise<string> {
  try {
    let history = conversationHistory.get(chatId);

    if (!history) {
      history = [{ role: 'system', content: SYSTEM_INSTRUCTION }];
    }

    history.push({ role: 'user', content: prompt });

    // Limita o histórico às últimas 20 mensagens para otimizar velocidade e contexto
    if (history.length > 21) {
      const systemMsg = history[0];
      const recentMessages = history.slice(history.length - 20);
      history = [systemMsg, ...recentMessages];
    }

    // Modelo gratuito e totalmente válido na OpenRouter
    const selectedModel = process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free';

    const completion = await openai.chat.completions.create({
      model: selectedModel,
      messages: history,
    });

    const replyText = completion.choices[0]?.message?.content || 'Senhor, não obtive resposta do sistema central.';

    history.push({ role: 'assistant', content: replyText });
    conversationHistory.set(chatId, history);

    return replyText;
  } catch (error: any) {
    console.error('Erro na OpenRouter:', error);

    if (error?.status === 429) {
      return 'Senhor, atingimos o limite temporário de requisições da OpenRouter. Por favor, aguarde alguns segundos.';
    }

    return 'Desculpe, Senhor. Ocorreu uma falha no meu sistema central.';
  }
}

export function clearMemory(chatId: number): void {
  conversationHistory.delete(chatId);
}
