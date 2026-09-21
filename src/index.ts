import { Bot, InlineKeyboard, webhookCallback } from "grammy";
import { createServer } from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

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
const MODEL_TEXTO = "openrouter/free";
const MODEL_VISAO = "google/gemma-4-26b-a4b-it:free";

// ===== BANCO DE DADOS (SUPABASE) =====
async function lerMemoria(chave) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/memoria?chave=eq.${chave}&select=valor`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    });
    const dados = await res.json();
    return dados?.[0]?.valor ?? null;
  } catch (err) {
    console.error(`Erro ao ler memória (${chave}):`, err);
    return null;
  }
}

async function gravarMemoria(chave, valor) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/memoria`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({ chave, valor, atualizado_em: new Date().toISOString() }),
    });
  } catch (err) {
    console.error(`Erro ao gravar memória (${chave}):`, err);
  }
}

// ===== CÉREBRO (OpenRouter API) =====
async function perguntarIA(messages, usarVisao = false) {
  const payloadMessages = messages.map(m => {
    const texto = m.text || m.content || "";
    if (m.image) {
      return {
        role: "user",
        content: [
          { type: "text", text: texto },
          { type: "image_url", image_url: { url: m.image } },
        ],
      };
    }
    return { role: m.role, content: texto };
  });

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: usarVisao ? MODEL_VISAO : MODEL_TEXTO,
      messages: payloadMessages,
    }),
  });

  const dados = await res.json();
  return dados?.choices?.[0]?.message?.content || "Sem resposta da IA.";
}

// ===== ORQUESTRADOR DE SUB-AGENTES =====
async function executarOrquestraSubAgentes(nomeArquivo, conteudoTextual, pedidoUsuario, dataUrlImagem = null) {
  const contexto = pedidoUsuario ? `Pedido do Administrador: "${pedidoUsuario}"\n` : "";

  // Mensagens base para Imagem ou Texto
  const criarPromptBase = (instrucaoSubAgente) => {
    if (dataUrlImagem) {
      return [{ role: "user", text: `${instrucaoSubAgente}\n${contexto}`, image: dataUrlImagem }];
    }
    return [
      { role: "system", content: instrucaoSubAgente },
      { role: "user", content: `${contexto}Conteúdo do arquivo (${nomeArquivo}):\n${conteudoTextual}` }
    ];
  };

  // 1. Execução paralela dos Sub-Agentes 1 e 2
  const [relatorioExtracao, relatorioAuditoria] = await Promise.all([
    // Sub-Agente 1: Extrator & Analista Técnico
    perguntarIA(criarPromptBase(
      "Você é o SUB-AGENTE 1 (Extrator Técnico). Analise o arquivo e liste apenas: " +
      "1) Resumo direto em 3 tópicos, 2) Fatos, métricas, datas e dados numéricos principais."
    ), !!dataUrlImagem),

    // Sub-Agente 2: Auditor Crítico & Risco
    perguntarIA(criarPromptBase(
      "Você é o SUB-AGENTE 2 (Auditor Crítico). Analise o arquivo e identifique apenas: " +
      "1) Inconsistências, falhas, riscos ou pontos de atenção, 2) Sugestões práticas ou próximas ações para o administrador."
    ), !!dataUrlImagem)
  ]);

  // 2. Sub-Agente 3: Consolidador (Jarvis)
  const relatorioFinal = await perguntarIA([
    {
      role: "system",
      content: "Você é o JARVIS, o agente principal. Receba a análise dos seus dois sub-agentes especialistas e apresente um relatório final conciso, profissional e impecavelmente formatado para o seu criador."
    },
    {
      role: "user",
      content: `Arquivo: ${nomeArquivo}\n\n` +
               `[RELATÓRIO SUB-AGENTE 1 - EXTRAÇÃO E DADOS]:\n${relatorioExtracao}\n\n` +
               `[RELATÓRIO SUB-AGENTE 2 - AUDITORIA E RISCOS]:\n${relatorioAuditoria}\n\n` +
               `Gere o relatório consolidado final em português.`
    }
  ]);

  return relatorioFinal;
}

// ===== DOWNLOAD DE ARQUIVOS =====
async function baixarArquivo(fileId) {
  const file = await bot.api.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
  const res = await fetch(url);
  return Buffer.from(await res.arrayBuffer());
}

// ===== PROCESSAMENTO DE ARQUIVOS =====
async function analisarArquivo(ctx, nome, buffer, mimeType, legenda) {
  const tamanho = (buffer.length / 1024).toFixed(0);

  // A) IMAGENS
  if (mimeType.startsWith("image/")) {
    const base64 = buffer.toString("base64");
    const dataUrl = `data:${mimeType};base64,${base64}`;
    const resposta = await executarOrquestraSubAgentes(nome, "", legenda, dataUrl);
    return `🖼️ **${nome}** (${tamanho} KB)\n\n${resposta}`;
  }

  // B) PDF
  if (mimeType === "application/pdf" || nome.toLowerCase().endsWith(".pdf")) {
    try {
      const data = await pdfParse(buffer);
      const conteudo = data.text.trim().slice(0, 8000);

      if (!conteudo) {
        return `📄 **${nome}** (${tamanho} KB)\n\n⚠️ O PDF está vazio ou contém apenas imagens/páginas escaneadas sem camada de texto.`;
      }

      const resposta = await executarOrquestraSubAgentes(nome, conteudo, legenda);
      return `📄 **${nome}** (${tamanho} KB)\n\n${resposta}`;
    } catch (err) {
      console.error("Erro ao ler PDF:", err);
      return `⚠️ Não foi possível extrair o texto do PDF **${nome}**.`;
    }
  }

  // C) TEXTO PURO (TXT, MD, JSON, CSV...) E OUTROS
  let conteudo = buffer.toString("utf-8");
  if (!mimeType.startsWith("text/") && ![".txt", ".md", ".json", ".csv", ".log"].some(e => nome.endsWith(e))) {
    conteudo = conteudo.replace(/[^\x20-\x7E\u00C0-\u00FF\n\r]/g, " ");
  }
  conteudo = conteudo.slice(0, 8000);

  const resposta = await executarOrquestraSubAgentes(nome, conteudo, legenda);
  return `📎 **${nome}** (${tamanho} KB)\n\n${resposta}`;
}

function isAdmin(id) { return String(id) === String(ADMIN_ID); }

// ===== COMANDOS DO BOT =====
bot.command("start", async (ctx) => {
  await ctx.reply(
    "🤖 **JARVIS com Sistema de Sub-Agentes Ativo**\n\n" +
    "Envie qualquer mensagem ou arquivo (PDF, TXT, imagens). Ele passará por um pipeline de 3 sub-agentes especialistas:\n" +
    "1️⃣ **Sub-Agente Extrator**: Mapeia dados e fatos\n" +
    "2️⃣ **Sub-Agente Auditor**: Avalia riscos e inconsistências\n" +
    "3️⃣ **Jarvis Consolidador**: Entrega o relatório executivo final",
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
  await gravarMemoria("regra_principal", "O usuário é o único administrador. O bot é 100% obediente.");
  await gravarMemoria("historico", "[]");
  await ctx.reply("🧹 Memória limpa!");
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
  await ctx.reply("ℹ️ Jarvis equipado com Pipeline Multi-Agente para análise avançada de arquivos!");
});

// ===== RECEBIMENTO DE DOCUMENTOS =====
bot.on("message:document", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const doc = ctx.message.document;
  await ctx.reply("📥 Arquivo recebido. Disparando pipeline de sub-agentes...");
  try {
    const buffer = await baixarArquivo(doc.file_id);
    const mime = doc.mime_type || "application/octet-stream";
    const resposta = await analisarArquivo(ctx, doc.file_name || "arquivo", buffer, mime, ctx.message.caption);
    await ctx.reply(resposta);
  } catch (err) {
    console.error("Erro ao analisar documento:", err);
    await ctx.reply("⚠️ Falha durante a análise dos sub-agentes. Tente novamente.");
  }
});

// ===== RECEBIMENTO DE FOTOS =====
bot.on("message:photo", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  const foto = ctx.message.photo[ctx.message.photo.length - 1];
  await ctx.reply("📥 Imagem recebida. Disparando visão computacional multi-agente...");
  try {
    const buffer = await baixarArquivo(foto.file_id);
    const resposta = await analisarArquivo(ctx, "imagem.jpg", buffer, "image/jpeg", ctx.message.caption);
    await ctx.reply(resposta);
  } catch (err) {
    console.error("Erro ao analisar imagem:", err);
    await ctx.reply("⚠️ Falha na análise da imagem.");
  }
});

// ===== RECEBIMENTO DE TEXTO CONVERSACIONAL =====
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
      { role: "system", content: "Você é o Jarvis, assistente pessoal. Responda em português do Brasil, curto e direto." },
      { role: "user", content: contexto + conversa + "\nBot:" },
    ]);

    historico.push({ role: "bot", text: reply });
    if (historico.length > 20) historico = historico.slice(-20);
    await gravarMemoria("historico", JSON.stringify(historico));

    await ctx.reply(reply);
  } catch (err) {
    console.error("Erro na IA:", err);
    await ctx.reply("⚠️ Ops, deu um erro ao processar sua resposta.");
  }
});

// ===== SERVIDOR WEBHOOK =====
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
  console.log("🤖 Jarvis com Sub-Agentes rodando via WEBHOOK em " + RENDER_URL);
}).catch((err) => {
  console.error("Erro no webhook:", err);
});
