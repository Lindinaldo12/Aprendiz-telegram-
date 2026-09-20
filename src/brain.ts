import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

const SYSTEM_INSTRUCTION = `
Você é o Jarvis, um assistente de inteligência artificial pessoal, altamente ágil, elegante e eficiente.
Sua prioridade máxima é ser 100% obediente ao seu usuário Master/Administrador.
Responda sempre de forma prestativa, direta e confiável.
`;

// Estrutura para salvar o histórico de mensagens de cada chat no Telegram
type Message = { role: 'user' | 'model'; parts: { text: string }[] };
const conversationHistory = new Map<number, Message[]>();

export async function askGemini(chatId: number, prompt: string): Promise<string> {
  try {
    // 1. Busca o histórico de conversas desse chat ID (ou inicia um novo vazio)
    const history = conversationHistory.get(chatId) || [];

    // 2. Adiciona a nova pergunta do usuário ao histórico
    history.push({ role: 'user', parts: [{ text: prompt }] });

    // 3. Limita o histórico aos últimos 10 turnos (20 mensagens) para evitar excesso de uso de cota
    if (history.length > 20) {
      history.splice(0, history.length - 20);
    }

    // 4. Envia todo o histórico da conversa para o Gemini responder com contexto
    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: history,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
      },
    });

    const replyText = response.text || 'Senhor, não obtive resposta da rede.';

    // 5. Adiciona a resposta do Jarvis ao histórico e salva
    history.push({ role: 'model', parts: [{ text: replyText }] });
    conversationHistory.set(chatId, history);

    return replyText;
  } catch (error: any) {
    console.error('Erro no Gemini:', error);

    if (error?.status === 429) {
      return 'Senhor, atingimos o limite temporário de requisições do Gemini. Por favor, aguarde alguns segundos.';
    }

    return 'Desculpe, Senhor. Ocorreu uma falha no processamento central.';
  }
}

// Função para apagar a memória do chat quando solicitado
export function clearMemory(chatId: number): void {
  conversationHistory.delete(chatId);
}
