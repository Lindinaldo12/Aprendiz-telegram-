import { Bot, webhookCallback } from "grammy";
import { createServer } from "node:http";
import { createClient } from "@supabase/supabase-js";

// ==========================================
// 1. VARIÁVEIS DE AMBIENTE
// ==========================================
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 3000;

// Supabase (Conexão opcional com banco de dados)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = (SUPABASE_URL && SUPABASE_KEY) ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

if (!TELEGRAM_BOT_TOKEN) {
  console.error("❌ ERRO CRÍTICO: TELEGRAM_BOT_TOKEN não foi configurado!");
  process.exit(1);
}

const bot = new Bot(TELEGRAM_BOT_TOKEN);

// ==========================================
// 2. PROMPTS DOS SUB-AGENTES (BRAIN)
// ==========================================
const BRAIN_SYSTEM_PROMPT = `
Você é o JARVIS, um assistente executivo e orquestrador inteligente.
Sua função é receber o texto fornecido pelo usuário acompanhado dos relatórios dos dois sub-agentes:
1. Sub-Agente Extrator (fatos, datas, valores e dados brutos).
2. Sub-Agente Auditor (análise de riscos, erros matemáticos e inconformidades).

Sua tarefa:
- Consolidar as informações em um relatório final claro, profissional e objetivo em português.
- Destacar alertas críticos e inconsistências apontadas pelo Auditor.
- Fornecer um resumo executivo e ações sugeridas.
`;

const PROMPT_EXTRATOR = `
Você é o Sub-Agente Extrator.
Sua missão é extrair estritamente todos os fatos, valores financeiros, datas, nomes e dados do texto.
Não emita opiniões ou avaliações. Apenas liste os dados de forma limpa e estruturada.
`;

const PROMPT_AUDITOR = `
Você é o Sub-Agente Auditor.
Sua missão é analisar o texto e a extração efetuada.
Verifique:
1. Erros de cálculo ou discrepâncias financeiras (ex: Receita vs Custos vs Lucro).
2. Riscos operacionais, contratuais ou fiscais (ex: pagamentos para contas não cadastradas).
3. Prazos inconsistentes ou alertas.
Se tudo estiver correto, informe "Nenhuma inconformidade detectada". Caso contrário, liste os alertas de risco.
`;

// ==========================================
// 3. INTEGRAÇÃO COM OPENROUTER
// ==========================================
async function callOpenRouter(systemPrompt, userPrompt, model = "google/gemini-2.5-flash") {
  if (!OPENROUTER_API_KEY) {
    return "⚠️ AVISO: OPENROUTER_API_KEY não foi configurada nas variáveis do Render.";
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": RENDER_EXTERNAL_URL || "https://render.com",
        "X-Title": "Jarvis Telegram Pipeline"
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.2
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Erro OpenRouter HTTP ${response.status}:`, errText);
      return `[Erro no modelo ${model}: HTTP ${response.status}]`;
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "[Sem resposta da IA]";
  } catch (error) {
    console.error("Falha ao chamar OpenRouter:", error);
    return `[Erro na requisição da IA: ${error.message}]`;
  }
}

// ==========================================
// 4. PIPELINE MULTI-AGENTE
// ==========================================
async function processarPipeline(textoUsuario) {
  console.log("🔄 Executando Sub-Agente Extrator...");
  const dadosExtraidos = await callOpenRouter(PROMPT_EXTRATOR, textoUsuario);

  console.log("🔄 Executando Sub-Agente Auditor...");
  const relatorioAuditoria = await callOpenRouter(
    PROMPT_AUDITOR, 
    `Texto Original:\n${textoUsuario}\n\nExtração:\n${dadosExtraidos}`
  );

  console.log("🔄 Executando Jarvis Consolidador...");
  const contextoConsolidacao = `
TEXTO ENVIADO PELO USUÁRIO:
${textoUsuario}

---
RELATÓRIO DO SUB-AGENTE EXTRATOR:
${dadosExtraidos}

---
RELATÓRIO DO SUB-AGENTE AUDITOR:
${relatorioAuditoria}
`;

  const respostaFinal = await callOpenRouter(BRAIN_SYSTEM_PROMPT, contextoConsolidacao);
  return respostaFinal;
}

// ==========================================
// 5. EVENTOS DO BOT
// ==========================================
bot.command("start", async (ctx) => {
  await ctx.reply(
    "🤖 *Jarvis Online*\n\n" +
    "O pipeline de sub-agentes está pronto para uso.\n" +
    "Envie qualquer relatório, arquivo ou mensagem de texto para análise.",
    { parse_mode: "Markdown" }
  );
});

bot.command("ping", async (ctx) => {
  await ctx.reply("🏓 Pong! Servidor operando normalmente.");
});

bot.on("message:text", async (ctx) => {
  const texto = ctx.message.text;
  if (texto.startsWith("/")) return;

  const statusMsg = await ctx.reply("⏳ *Jarvis:* Processando pipeline de sub-agentes...", { parse_mode: "Markdown" });

  try {
    const resultado = await processarPipeline(texto);
    await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, resultado);
  } catch (err) {
    console.error("Erro ao processar mensagem:", err);
    await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, "❌ Erro ao processar mensagem no pipeline.");
  }
});

bot.on("message:document", async (ctx) => {
  const statusMsg = await ctx.reply("📄 *Jarvis:* Lendo e analisando documento...", { parse_mode: "Markdown" });

  try {
    const file = await ctx.getFile();
    const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const response = await fetch(fileUrl);
    const textContent = await response.text();

    const resultado = await processarPipeline(textContent);
    await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, resultado);
  } catch (err) {
    console.error("Erro ao processar documento:", err);
    await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, "❌ Erro ao ler o arquivo enviado.");
  }
});

// ==========================================
// 6. SERVIDOR HTTP NATIVO & WEBHOOK RENDER
// ==========================================
const webhookPath = `/telegram-webhook`;

const server = createServer(async (req, res) => {
  if (req.url === "/" || req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("OK - Jarvis Bot em execução.");
    return;
  }

  if (req.url === webhookPath && req.method === "POST") {
    try {
      // FIX: Adaptador "http" exige letras minúsculas para grammY no Node.js
      await webhookCallback(bot, "http")(req, res);
    } catch (err) {
      console.error("Erro no webhook:", err);
      res.writeHead(500);
      res.end("Erro Interno");
    }
    return;
  }

  res.writeHead(404);
  res.end("Não encontrado");
});

server.listen(PORT, async () => {
  console.log(`🚀 Servidor HTTP rodando na porta ${PORT}`);

  if (RENDER_EXTERNAL_URL) {
    const fullWebhookUrl = `${RENDER_EXTERNAL_URL}${webhookPath}`;
    try {
      await bot.api.setWebhook(fullWebhookUrl);
      console.log(`🔗 Webhook configurado com sucesso: ${fullWebhookUrl}`);
    } catch (err) {
      console.error("❌ Falha ao registrar Webhook no Telegram:", err.message);
    }
  }
});
