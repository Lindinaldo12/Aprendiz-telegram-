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

// Supabase (Opcional - conexão com memória remota se disponível)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = (SUPABASE_URL && SUPABASE_KEY) ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

if (!TELEGRAM_BOT_TOKEN) {
  console.error("❌ ERRO CRÍTICO: TELEGRAM_BOT_TOKEN não foi definido!");
  process.exit(1);
}

const bot = new Bot(TELEGRAM_BOT_TOKEN);

// ==========================================
// 2. PROMPTS DOS SUB-AGENTES (BRAIN)
// ==========================================
const BRAIN_SYSTEM_PROMPT = `
Você é o JARVIS, um assistente executivo e orquestrador inteligente.
Sua função é receber o texto fornecido pelo usuário acompanhado das análises de dois sub-agentes:
1. Sub-Agente Extrator (fatos, datas, valores e dados brutos).
2. Sub-Agente Auditor (análise de riscos, erros matemáticos e inconformidades).

Sua tarefa:
- Consolidar as informações em um relatório final claro, profissional e objetivo em português.
- Destacar alertas críticos e inconsistências apontadas pelo Auditor.
- Fornecer um resumo executivo e ações sugeridas.
`;

const PROMPT_EXTRATOR = `
Você é o Sub-Agente Extrator.
Extraia estritamente todos os fatos, valores financeiros, datas, nomes e dados do texto fornecido.
Não emita opiniões ou avaliações. Apenas liste os dados de forma limpa e estruturada.
`;

const PROMPT_AUDITOR = `
Você é o Sub-Agente Auditor.
Analise o texto fornecido e a extração dos dados.
Verifique:
1. Erros de cálculo ou divergências financeiras (ex: Receita vs Custos vs Lucro).
2. Riscos operacionais, contratuais ou fiscais (ex: pagamentos para contas terceiras).
3. Prazos inconsistentes ou alertas.
Se não houver problemas, responda "Nenhuma inconformidade detectada".
`;

// ==========================================
// 3. INTEGRAÇÃO OPENROUTER
// ==========================================
async function callOpenRouter(systemPrompt, userPrompt, model = "google/gemini-2.5-flash") {
  if (!OPENROUTER_API_KEY) {
    return "⚠️ OPENROUTER_API_KEY não configurada nas variáveis do Render.";
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": RENDER_EXTERNAL_URL || "https://render.com",
        "X-Title": "Jarvis Bot Pipeline"
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
      const err = await response.text();
      console.error(`Erro OpenRouter [${response.status}]:`, err);
      return `[Erro OpenRouter HTTP ${response.status}]`;
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "[Sem resposta da IA]";
  } catch (error) {
    console.error("Erro na requisição OpenRouter:", error);
    return `[Falha na conexão com a IA: ${error.message}]`;
  }
}

// ==========================================
// 4. PIPELINE MULTI-AGENTE
// ==========================================
async function processarPipeline(texto) {
  console.log("🔄 Executando Sub-Agente Extrator...");
  const ext = await callOpenRouter(PROMPT_EXTRATOR, texto);

  console.log("🔄 Executando Sub-Agente Auditor...");
  const aud = await callOpenRouter(PROMPT_AUDITOR, `Texto Original:\n${texto}\n\nDados Extraídos:\n${ext}`);

  console.log("🔄 Executando Jarvis Consolidador...");
  const contextoFinal = `
ENTRADA DO USUÁRIO:
${texto}

ANÁLISE DO EXTRATOR:
${ext}

ANÁLISE DO AUDITOR:
${aud}
`;

  const respostaFinal = await callOpenRouter(BRAIN_SYSTEM_PROMPT, contextoFinal);
  return respostaFinal;
}

// ==========================================
// 5. EVENTOS DO TELEGRAM BOT
// ==========================================
bot.command("start", async (ctx) => {
  await ctx.reply("🤖 *Jarvis Online*\n\nPipeline de sub-agentes pronto. Envie uma mensagem ou arquivo para análise.", { parse_mode: "Markdown" });
});

bot.command("ping", async (ctx) => {
  await ctx.reply("🏓 Pong! Servidor ativo.");
});

bot.on("message:text", async (ctx) => {
  if (ctx.message.text.startsWith("/")) return;

  const status = await ctx.reply("⏳ *Jarvis:* Analisando dados no pipeline...", { parse_mode: "Markdown" });

  try {
    const resultado = await processarPipeline(ctx.message.text);
    await ctx.api.editMessageText(ctx.chat.id, status.message_id, resultado);
  } catch (err) {
    console.error("Erro no processamento:", err);
    await ctx.api.editMessageText(ctx.chat.id, status.message_id, "❌ Erro ao processar mensagem no pipeline.");
  }
});

bot.on("message:document", async (ctx) => {
  const status = await ctx.reply("📄 *Jarvis:* Lendo documento...", { parse_mode: "Markdown" });

  try {
    const file = await ctx.getFile();
    const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const res = await fetch(fileUrl);
    const textContent = await res.text();

    const resultado = await processarPipeline(textContent);
    await ctx.api.editMessageText(ctx.chat.id, status.message_id, resultado);
  } catch (err) {
    console.error("Erro ao ler documento:", err);
    await ctx.api.editMessageText(ctx.chat.id, status.message_id, "❌ Falha ao processar o arquivo enviado.");
  }
});

// ==========================================
// 6. SERVIDOR HTTP NATIVO & WEBHOOK
// ==========================================
const webhookPath = `/telegram-webhook`;

const server = createServer(async (req, res) => {
  if (req.url === "/" || req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
    return;
  }

  if (req.url === webhookPath && req.method === "POST") {
    try {
      // Uso correto do adaptador "http" para grammY
      await webhookCallback(bot, "http")(req, res);
    } catch (err) {
      console.error("Erro no Webhook:", err);
      res.writeHead(500);
      res.end("Error");
    }
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

server.listen(PORT, async () => {
  console.log(`🚀 Servidor escutando na porta ${PORT}`);

  if (RENDER_EXTERNAL_URL) {
    const url = `${RENDER_EXTERNAL_URL}${webhookPath}`;
    try {
      await bot.api.setWebhook(url);
      console.log(`🔗 Webhook registrado: ${url}`);
    } catch (err) {
      console.error("Erro ao registrar webhook:", err.message);
    }
  }
});
