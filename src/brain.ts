import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export async function askGemini(prompt: string): Promise<string> {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    return response.text || 'Sem resposta gerada.';
  } catch (error) {
    console.error('Erro no Gemini:', error);
    return 'Desculpe, ocorreu um erro ao consultar o Gemini.';
  }
}
