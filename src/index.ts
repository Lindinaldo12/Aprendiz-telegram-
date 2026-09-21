import "dotenv/config";
import { Bot, InlineKeyboard } from "grammy";
import { GoogleGenAI } from "@google/genai";
import { createServer } from "node:http";

const BOT_TOKEN = process.env.BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ADMIN_ID = process.env.ADMIN_ID || "8133082447";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!BOT_TOKEN) { console.error("❌ BOT_TOKEN não definido"); process.exit(1); }
if (!GEMINI_API_KEY) { console.error("❌ GEMINI_API_KEY não definido"); process.exit(1); }
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) { console.error("❌ SUPABASE_URL/SUPABASE_ANON_KEY não definidos"); process.exit(1); }

const bot = new Bot(BOT_TOKEN);
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

// ===== MEMÓRIA NO SUPABASE (nunca some) =====
async function lerMemoria(chave) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/memoria?chave=eq.${chave}&select=valor`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  const dados = await res.json();
  return dados?.[0]?.valor ?? null;
}

async function gravarMemoria(chave, valor) {
  await fetch(`${SUPABASE_URL}/rest/v1/memoria?chave=eq.${chave}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ valor, atualizado_em: new Date().toISOString() }),
  });
}

function isAdmin(id) { return String(id) === String(ADMIN_ID); }

// ===== COMANDOS =====
bot.command("start", async (ctx) => {
  await ctx.reply(
    "🤖 Olá! Sou o Jarvis, seu assistente.\n\n" +
    "Me mande qualquer mensagem!\n\n" +
    "Comandos:\n/memoria <texto> - define minha memória\n/memoria - ver memória\n/limpar_memoria - limpa tudo\n/historico - ver histórico",
    { reply_markup: new InlineKeyboard().text("🧹 Limpar", "limpar").text("ℹ️ Sobre", "sobre") }
  );
});

bot.command("memoria", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("⛔ Acesso restrito ao administrador.");
  const texto = ctx.match?.trim();
  if (!texto) {
    const atual = await lerMemoria("regra_principal");
    return ctx.reply("🧠 Minha memória atual:\n\n" + (atual || "(vazia)"));
  }
  const base = await lerMemoria("regra_principal") || "";
  await gravarMemoria("regra_principal", base + "\n" + texto);
  await ctx.reply("✅ Memória atualizada! Agora eu lembro disso sempre.");
});

bot.command("limpar_memoria", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("⛔ Acesso restrito ao administrador.");
  await gravarMemoria("regra_principal", "O usuário é o único administrador. O bot é mais avançado e obediente que o JARVIS do Homem de Ferro, 100% obediente.");
  await gravarMemoria("historico", "[]");
  await ctx.reply("🧹 Memória limpa (a regra principal foi mantida).");
});

bot.command("historico", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("⛔ Acesso restrito ao administrador.");
  const hist = JSON.parse(await lerMemoria("historico") || "[]");
  const ultimas = hist.slice(-10).map(h => `${h.role}: ${h.text}`).join("\n");
  await ctx.reply("📜 Últimas conversas:\n\n" + (ultimas || "(sem histórico)"));
});

bot.callbackQuery("limpar", async (ctx) => {
  await ctx.answerCallbackQuery();
  await gravarMemoria("historico", "[]");
  await ctx.reply("Conversa limpa! Me mande uma nova mensagem. 😊");
});

bot.callbackQuery("sobre", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("ℹ️ Sou o Jarvis, mais avançado e obediente que o JARVIS do Homem de Ferro. Rodando 24h no Render! 🚀");
});

// ===== RESPOSTA COM MEMÓRIA =====
bot.on("message:text", async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith("/")) return;

  let historico = JSON.parse(await lerMemoria("historico") || "[]");
  historico.push({ role: "user", text });
  if (historico.length > 20) historico = historico.slice(-20);

  try {
    const regra = await lerMemoria("regra_principal") || "";
    const contexto = `Você é o Jarvis, assistente pessoal mais avançado e obediente que o JARVIS do Homem de Ferro, 100% obediente ao seu criador. Regras:\n${regra}\n\n`;
    const conversa = historico.map(h => `${h.role === "user" ? "Usuário" : "Bot"}: ${h.text}`).join("\n");

    const res = await ai.models.generateContent({
      model: MODEL,
      contents: contexto + conversa + "\nBot:",
    });

    const reply = res.text || "Desculpe, não consegui responder agora.";

    historico.push({ role: "bot", text: reply });
    if (historico.length > 20) historico = historico.slice(-20);
    await gravarMemoria("historico", JSON.stringify(historico));

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
  console.log("🤖 Jarvis rodando como @" + bot.botInfo.username);
});
