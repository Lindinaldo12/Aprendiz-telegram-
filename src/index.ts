import { Bot, InlineKeyboard } from "grammy";
import { GoogleGenAI } from "@google/genai";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const BOT_TOKEN = process.env.BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ADMIN_ID = process.env.ADMIN_ID || "8133082447"; // seu ID

if (!BOT_TOKEN) { console.error("❌ BOT_TOKEN não definido"); process.exit(1); }
if (!GEMINI_API_KEY) { console.error("❌ GEMINI_API_KEY não definido"); process.exit(1); }

const bot = new Bot(BOT_TOKEN);
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

// ===== MEMÓRIA PERMANENTE (arquivo JSON) =====
const MEMORY_FILE = "./memoria.json";

function carregarMemoria() {
  if (existsSync(MEMORY_FILE)) {
    try { return JSON.parse(readFileSync(MEMORY_FILE, "utf-8")); }
    catch { return { memoria: "", historico: [] }; }
  }
  return { memoria: "", historico: [] };
}

function salvarMemoria(dados) {
  writeFileSync(MEMORY_FILE, JSON.stringify(dados, null, 2));
}

let dados = carregarMemoria();

// ===== COMANDOS DE ADMIN =====
function isAdmin(id) { return String(id) === String(ADMIN_ID); }

bot.command("memoria", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("⛔ Acesso restrito ao administrador.");
  const texto = ctx.match?.trim();
  if (!texto) {
    return ctx.reply(
      "🧠 Minha memória atual:\n\n" +
      (dados.memoria || "(vazia)") +
      "\n\nUse: /memoria <texto> para definir."
    );
  }
  dados.memoria = texto;
  salvarMemoria(dados);
  await ctx.reply("✅ Memória atualizada! Agora eu lembro disso sempre.");
});

bot.command("limpar_memoria", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("⛔ Acesso restrito ao administrador.");
  dados = { memoria: "", historico: [] };
  salvarMemoria(dados);
  await ctx.reply("🧹 Memória totalmente limpa.");
});

bot.command("historico", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("⛔ Acesso restrito ao administrador.");
  const ultimas = dados.historico.slice(-10).map(h => `${h.role}: ${h.text}`).join("\n");
  await ctx.reply("📜 Últimas conversas:\n\n" + (ultimas || "(sem histórico)"));
});

// ===== COMEÇO =====
bot.command("start", async (ctx) => {
  await ctx.reply(
    "🤖 Olá! Eu sou o Aprendiz Bot.\n\n" +
    "Me mande qualquer mensagem que eu respondo!\n\n" +
    "Comandos:\n/memoria <texto> - define minha memória\n/memoria - ver memória\n/limpar_memoria - limpa tudo\n/historico - ver conversas",
    { reply_markup: new InlineKeyboard().text("🧹 Limpar", "limpar").text("ℹ️ Sobre", "sobre") }
  );
});

bot.callbackQuery("limpar", async (ctx) => {
  await ctx.answerCallbackQuery();
  dados.historico = [];
  salvarMemoria(dados);
  await ctx.reply("Conversa limpa! Me mande uma nova mensagem. 😊");
});

bot.callbackQuery("sobre", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("ℹ️ Eu sou o Aprendiz Bot, feito com Telegram + IA Gemini. Rodando 24h no Render! 🚀");
});

// ===== RESPOSTA COM MEMÓRIA =====
bot.on("message:text", async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith("/")) return;

  // Guarda no histórico
  dados.historico.push({ role: "user", text });
  if (dados.historico.length > 20) dados.historico = dados.historico.slice(-20);

  try {
    const contexto = dados.memoria
      ? `Você é o Aprendiz Bot, 100% obediente ao seu criador. Lembre-se sempre disto:\n${dados.memoria}\n\n`
      : "";

    const historico = dados.historico
      .map(h => `${h.role === "user" ? "Usuário" : "Bot"}: ${h.text}`)
      .join("\n");

    const res = await ai.models.generateContent({
      model: MODEL,
      contents: contexto + historico + "\nBot:",
    });

    const reply = res.text || "Desculpe, não consegui responder agora.";
    dados.historico.push({ role: "bot", text: reply });
    if (dados.historico.length > 20) dados.historico = dados.historico.slice(-20);
    salvarMemoria(dados);

    await ctx.reply(reply);
  } catch (err) {
    console.error("❌ Erro no Gemini:", err);
    await ctx.reply("⚠️ Ops, tentei responder mas deu erro. Tente de novo!");
  }
});

// ===== PORTA PARA O RENDER =====
createServer((req, res) => {
  res.writeHead(200);
  res.end("ok");
}).listen(process.env.PORT || 3000);

bot.start().then(() => {
  console.log("🤖 Aprendiz rodando como @" + bot.botInfo.username);
});
