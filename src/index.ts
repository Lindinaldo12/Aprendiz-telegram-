 import { Bot, webhookCallback, GrammyError, HttpError } from "grammy";
import express from "express";
import { GoogleGenAI } from "@google/genai";
import { JARVIS_BRAIN } from "./brain";

// 1. Validação de Variáveis de Ambiente
const BOT_TOKEN = process.env.BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SECRET_TOKEN = process.env.TELEGRAM_SECRET_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const PORT = Number(process.env.PORT) || 10000;

if (!BOT_TOKEN) throw new Error("⚠️ BOT_TOKEN não foi configurado!");
if (!GEMINI_API_KEY) throw new Error("⚠️ GEMINI_API_KEY não foi configurada!");

// 2. Inicialização dos Clientes
const bot = new Bot(BOT_TOKEN);
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// 3. Função com Retentativa Automática para Erros 429 (Cota) e 503 (Indisponível)
async function askGeminiWithBrain(userPrompt: string, retries = 3, delayMs = 3000): Promise<string> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash", // Modelo recomendado para a cota gratuita
        contents: userPrompt,
        config: {
          systemInstruction: JARVIS_BRAIN,
        },
      });

      return response.text || "Irmão, não consegui gerar uma resposta no momento.";
    } catch (error: any) {
      const status = error?.status || error?.code;
      const isRateLimit = status === 429 || error?.message?.includes("RESOURCE_EXHAUSTED");
      const isUnavailable = status === 503 || error?.message?.includes("UNAVAILABLE");

      if ((isRateLimit || isUnavailable) && attempt < retries) {
        // Se a API enviou o tempo de espera ideal no erro, usamos ele; senão usaremos o tempo padrão
        const waitTime = isRateLimit ? 35000 : delayMs * attempt;
        console.warn(`⚠️ [Gemini ${status}] Cota/Demanda atingida. Tentativa ${attempt} de ${retries}. Aguardando ${waitTime / 1000}s...`);
        
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      } else {
        throw error;
      }
    }
  }
  throw new Error("Não foi possível conectar com o Gemini após várias tentativas.");
}

// 4. Handler de Mensagens do Telegram
bot.command("start", (ctx) => {
  return ctx.reply("Olá, meu irmão! JARVIS online e pronto. Como posso te ajudar hoje?");
});

bot.on("message:text", async (ctx) => {
  try {
    await ctx.replyWithChatAction("typing");
    const answer = await askGeminiWithBrain(ctx.message.text);
    await ctx.reply(answer);
  } catch (error: any) {
    console.error("❌ Erro ao processar mensagem:", error?.message || error);
    
    if (error?.status === 429 || error?.message?.includes("RESOURCE_EXHAUSTED")) {
      await ctx.reply("⚠️ Irmão, atingimos o limite temporário de requisições da IA. Por favor, aguarde cerca de 30 segundos e envie novamente.");
    } else {
      await ctx.reply("⚠️ Ocorreu um erro interno ao processar sua solicitação. Tente novamente em instantes.");
    }
  }
});

// 5. Captura Global de Erros no grammY
bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`❌ Erro no Update ID ${ctx.update.update_id}:`);
  const e = err.error;

  if (e instanceof GrammyError) {
    console.error("Erro na API do Telegram:", e.description);
  } else if (e instanceof HttpError) {
    console.error("Erro de conexão de rede:", e);
  } else {
    console.error("Erro interno:", e);
  }
});

// 6. Servidor Express para Webhook no Render
const app = express();
app.use(express.json());

app.use(
  "/webhook",
  webhookCallback(bot, "express", {
    secretToken: SECRET_TOKEN,
  })
);

app.get("/", (_req, res) => {
  res.status(200).send("JARVIS / Aprendiz System Online.");
});

app.listen(PORT, async () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);

  if (WEBHOOK_URL) {
    const fullUrl = `${WEBHOOK_URL}/webhook`;
    await bot.api.setWebhook(fullUrl, { secret_token: SECRET_TOKEN });
    console.log(`🔗 Webhook registrado: ${fullUrl}`);
  }
});
