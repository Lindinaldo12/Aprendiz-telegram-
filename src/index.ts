import { Bot, InlineKeyboard, session } from "grammy";
import { GoogleGenAI } from "@google/genai";
import { createServer } from "node:http";

const BOT_TOKEN = process.env.BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN não definido no .env");
  process.exit(1);
}

if (!GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY não definido no .env");
  process.exit(1);
}

const bot = new Bot(BOT_TOKEN);
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

bot.command("start", async (ctx) => {
  await ctx.reply(
    "🤖 Olá! Eu sou o Aprendiz Bot.\n\n" +
    "Me mande qualquer mensagem que eu respondo!",
    {
      reply_markup: new InlineKeyboard()
        .text("🧹 Limpar", "limpar")
        .text("ℹ️ Sobre", "sobre"),
    }
  );
});

bot.callbackQuery("limpar", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("Conversa limpa! Me mande uma nova mensagem. 😊");
});

bot.callbackQuery("sobre", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(
    "ℹ️ Eu sou o Aprendiz Bot, feito com Telegram + IA Gemini.\n" +
    "Rodando 24h por dia no Render! 🚀"
  );
});

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text;

  if (text.startsWith("/")) return;

  try {
    const res = await ai.models.generateContent({
      model: MODEL,
      contents: text,
    });
    const reply = res.text || "Desculpe, não consegui responder agora.";
    await ctx.reply(reply);
  } catch (err) {
    console.error("❌ Erro no Gemini:", err);
    await ctx.reply("⚠️ Ops, tentei responder mas deu erro. Tente de novo!");
  }
});

// Mantém o Render ativo (porta obrigatória)
createServer((req, res) => {
  res.writeHead(200);
  res.end("ok");
}).listen(process.env.PORT || 3000);

// Inicia o bot (primeiro inicializa, depois mostra o nome)
bot.start().then(() => {
  console.log("🤖 Aprendiz rodando como @" + bot.botInfo.username);
});
