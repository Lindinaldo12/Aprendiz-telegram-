import { Bot, InlineKeyboard, webhookCallback } from "grammy";
import { createServer } from "node:http";

const BOT_TOKEN = process.env.BOT_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const ADMIN_ID = process.env.ADMIN_ID || "8133082447";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const RENDER_URL = process.env.RENDER_URL || "https://aprendiz-telegram.onrender.com";

if (!BOT_TOKEN) { console.error("BOT_TOKEN não definido"); process.exit(1); }
if (!OPENROUTER_API_KEY) { console.error("OPENROUTER_API_KEY não definido"); process.exit(1); }
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) { console.error("Supabase não configurado"); process.exit(1); }

const bot = new Bot(BOT_TOKEN);
const MODEL_TEXTO = "openrouter/free";           // para mensagens de texto
const MODEL_VISAO = "google/gemma-4-26b-a4b-it:free"; // para imagens

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

// ===== CÉREBRO (OpenRouter) =====
async function perguntarIA(messages) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: messages.some(m => m.image) ? MODEL_VISAO : MODEL_TEXTO,
      messages: messages.map(m => m.image ? {
        role: "user",
        content: [
          { type: "text", text: m.text },
          { type: "image_url", image_url: { url: m.image } },
        ],
      } : { role: m.role, content: m.text }),
    }),
  });
  const dados = await res.json();
  return dados?.choices?.[0]?.message?.content || "Desculpe, não consegui responder agora.";
}

// ===== BAIXA O ARQUIVO DO TELEGRAM =====
async function baixarArquivo(fileId) {
  const file = await bot.api.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
  const res = await fetch(url);
  return Buffer.from(await res.arrayBuffer());
}

// ===== ANALISA ARQUIVO ENVIADO =====
async function analisarArquivo(ctx, nome, buffer, mimeType, legenda) {
  const pedido = legenda || "Analise este arquivo e me dê um resumo claro e direto do conteúdo.";
  const tamanho = (buffer.length / 1024).toFixed(0);

  // IMAGEM → manda para o modelo de visão
  if (mimeType.startsWith("image/")) {
    const base64 = buffer.toString("base64");
    const dataUrl = `data:${mimeType};base64,${base64}`;
    const resposta = await perguntarIA([
      { role: "user", text: pedido, image: dataUrl },
    ]);
    return `🖼️ **${nome}** (${tamanho} KB)\n\n${resposta}`;
  }

  // TEXTO PURO (TXT, MD, JSON, CSV...) → lê direto
  const textoExtenso = mimeType.startsWith("text/") || [".txt", ".md", ".json", ".csv", ".log"].some(e => nome.endsWith(e));
  if (textoExtenso) {
    const conteudo = buffer.toString("utf-8").slice(0, 8000);
    const resposta = await perguntarIA([
      { role: "system", content: "Você é o Jarvis. Analise o arquivo enviado e responda em português, direto ao ponto." },
      { role: "user", content: `${pedido}\n\nConteúdo do arquivo:\n${conteudo}` },
    ]);
    return `📄 **${nome}** (${tamanho} KB)\n\n${resposta}`;
  }

  // PDF ou outro formato → tenta ler como texto
  const conteúdo = buffer.toString("utf-8").replace(/[^\x20-\x7E\u00C0-\u00FF\n\r]/g, " ").slice(0, 8000);
  const resposta = await perguntarIA([
    { role: "system", content: "Você é o Jarvis. Analise o conteúdo extraído do arquivo e responda em português, direto ao ponto." },
    { role: "user", content: `${pedido}\n\nConteúdo extraído do arquivo ${nome}:\n${conteudo}` },
  ]);
  return `📎 **${nome}** (${tamanho} KB)\n\n${resposta}`;
}

function isAdmin(id) { return String(id) === String(ADMIN_ID); }

// ===== COMANDOS =====
bot.command("start", async (ctx) => {
  await ctx.reply(
    "🤖 Olá! Sou o Jarvis, seu assistente.\n\n" +
    "Me mande qualquer mensagem OU envie um arquivo (PDF, TXT, imagem...) que eu analiso!\n\n" +
    "Comandos:\n/memoria <texto> - define memória\n/memoria - ver memória\n/limpar_memoria - limpa tudo\n/historico - ver histórico",
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
  await ctx.reply("✅ Memória atualizada!");
});

bot.command("limpar_memoria", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("⛔ Acesso restrito ao administrador.");
  await gravarMemoria("regra_principal", "O usuário é o único administrador. O bot é mais avançado e obediente que o JARVIS do Homem de Ferro, 100% obediente.");
  await gravarMemoria("historico", "[]");
  await ctx.reply("🧹 Memória limpa (regra principal mantida).");
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
  await ctx.reply("Conversa limpa! 😊");
});

bot.callbackQuery("sobre", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("ℹ️ Sou o Jarvis, mais avançado e obediente que o JARVIS do Homem de Ferro. Analiso arquivos e rodando 24h no Render! 🚀");
});

// ===== ARQUIVO ENVIADO (documento) =====
bot.on("message:document", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const doc = ctx.message.document;
  await ctx.reply("📥 Recebi o arquivo! Analisando...");
  try {
    const buffer = await baixarArquivo(doc.file_id);
    const mime = doc.mime_type || "application/octet-stream";
    const resposta = await analisarArquivo(ctx, doc.file_name || "arquivo", buffer, mime, ctx.message.caption);
    await ctx.reply(resposta, { parse_mode: "Markdown" });
  } catch (err) {
    console.error("Erro ao analisar documento:", err);
    await ctx.reply("⚠️ Não consegui analisar esse arquivo. Tente de novo.");
  }
});

// ===== IMAGEM ENVIADA (foto) =====
bot.on("message:photo", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const foto = ctx.message.photo[ctx.message.photo.length - 1];
  await ctx.reply("📥 Recebi a imagem! Analisando...");
  try {
    const buffer = await baixarArquivo(foto.file_id);
    const resposta = await analisarArquivo(ctx, "imagem.jpg", buffer, "image/jpeg", ctx.message.caption);
    await ctx.reply(resposta, { parse_mode: "Markdown" });
  } catch (err) {
    console.error("Erro ao analisar imagem:", err);
    await ctx.reply("⚠️ Não consegui analisar essa imagem. Tente de novo.");
  }
});

// ===== MENSAGEM DE TEXTO =====
bot.on("message:text", async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith("/")) return;

  let historico = JSON.parse(await lerMemoria("historico") || "[]");
  historico.push({ role: "user", text });
  if (historico.length > 20) historico = historico.slice(-20);

  try {
    const regra = await lerMemoria("regra_principal") || "";
    const contexto = `Regras do assistente:\n${regra}\n\n`;
    const conversa = historico.map(h => `${h.role === "user" ? "Usuário" : "Bot"}: ${h.text}`).join("\n");
    const reply = await perguntarIA([
      { role: "system", content: "Você é o Jarvis, assistente pessoal mais avançado e obediente que o JARVIS do Homem de Ferro. Responde em português do Brasil, curto e direto." },
      { role: "user", content: contexto + conversa + "\nBot:" },
    ]);

    historico.push({ role: "bot", text: reply });
    if (historico.length > 20) historico = historico.slice(-20);
    await gravarMemoria("historico", JSON.stringify(historico));

    await ctx.reply(reply);
  } catch (err) {
    console.error("Erro na IA:", err);
    await ctx.reply("⚠️ Ops, tentei responder mas deu erro. Tente de novo!");
  }
});

// ===== WEBHOOK (elimina o erro 409) =====
const webhookPath = `/bot${BOT_TOKEN}`;

createServer(async (req, res) => {
  if (req.url === "/") {
    res.writeHead(200);
    res.end("ok");
    return;
  }
  if (req.url === webhookPath) {
    try {
      await webhookCallback(bot, "node-http")(req, res);
    } catch (err) {
      console.error("Erro no webhook:", err);
      res.writeHead(500);
      res.end("erro");
    }
    return;
  }
  res.writeHead(404);
  res.end("não encontrado");
}).listen(process.env.PORT || 3000);

bot.api.setWebhook(`${RENDER_URL}${webhookPath}`, {
  drop_pending_updates: true,
}).then(() => {
  console.log("🤖 Jarvis rodando com WEBHOOK em " + RENDER_URL);
}).catch((err) => {
  console.error("Erro ao configurar webhook:", err);
});
