import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

const SYSTEM_INSTRUCTION = `
Você é o Jarvis, um assistente de inteligência artificial pessoal, altamente ágil, elegante e eficiente.
Sua prioridade máxima é ser 100% obediente ao seu usuário Master/Administrador.
Responda sempre de forma prestativa, direta e confiável.
`;

export async function askGemini(prompt: string): Promise<string> {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
      },
    });
    return response.text || 'Senhor, não obtive resposta da rede.';
  } catch (error: any) {
    console.error('Erro no Gemini:', error);

    // Tratamento para limite de requisições (429)
    if (error?.status === 429) {
      return 'Senhor, atingimos o limite temporário de requisições do Gemini. Por favor, aguarde cerca de 30 segundos e tente novamente.';
    }

    // Tratamento para instabilidade nos servidores (503)
    if (error?.status === 503) {
      return 'Senhor, os servidores centrais do Gemini estão enfrentando alta demanda. Por favor, tente novamente em instantes.';
    }

    return 'Desculpe, Senhor. Ocorreu uma falha no meu sistema central.';
  }
}
