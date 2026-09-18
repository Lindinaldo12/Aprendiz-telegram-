import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

async function main() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY ausente no .env");

  const ai = new GoogleGenAI({ apiKey });

  console.log("📋 Modelos disponíveis para sua conta:\n");

  try {
    const models = await ai.models.list({
      config: { pageSize: 50 },
    });

    for await (const model of models) {
      console.log("  •", model.name);
    }
  } catch (error: any) {
    console.error("❌ Erro ao listar modelos:", error?.message ?? error);
  }
}

main().catch((e) => {
  console.error("❌ Erro fatal:", e?.message ?? e);
  process.exit(1);
});
