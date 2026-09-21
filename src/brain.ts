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

// Guarda a memória do histórico de cada conversa no Telegram
const conversationHistory = new Map<number, ChatMessage[]>();

export async function askOpenRouter(chatId: number, prompt: string): Promise<string> {
  try {
    let history = conversationHistory.get(chatId);

    // Se a conversa for nova, inicia com a instrução do Jarvis
    if (!history) {
      history = [{ role: 'system', content: SYSTEM_INSTRUCTION }];
    }

    // Adiciona a nova mensagem do usuário
    history.push({ role: 'user', content: prompt });

    // Mantém no máximo 20 mensagens anteriores para otimizar velocidade
    if (history.length > 21) {
      const systemMsg = history[0];
      const recentMessages = history.slice(history.length - 20);
      history = [systemMsg, ...recentMessages];
    }

    // Chama o modelo Hermes grátis via OpenRouter
    const completion = await openai.chat.completions.create({
      model: process.env.OPENROUTER_MODEL || 'nousresearch/hermes-3-llama-3.8b:free',
      messages: history,
    });

    const replyText = completion.choices[0]?.message?.content || 'Senhor, não obtive resposta da rede.';

    // Salva a resposta no histórico da conversa
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
