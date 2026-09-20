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
    if (error?.status === 429) {
      return 'Senhor, atingimos o limite de requisições por minuto. Por favor, aguarde alguns segundos e tente novamente.';
    }
    return 'Desculpe, Senhor. Ocorreu uma falha no processamento central.';
  }
}
