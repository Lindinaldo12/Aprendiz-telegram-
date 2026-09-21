import { Bot, webhookCallback } from "grammy";
import { createServer } from "node:http";
import { createClient } from "@supabase/supabase-js";

// ==========================================
// 1. CONFIGURAÇÃO E VARIÁVEIS DE AMBIENTE
// ==========================================
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL; // Ex: https://seu-app.onrender.com
const PORT = process.env.PORT || 3000;

// Supabase (Opcional - fallback gracioso caso não haja credenciais)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = (SUPABASE_URL && SUPABASE_KEY) ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

if (!TELEGRAM_BOT_TOKEN) {
  console.error("❌ ERRO CRÍTICO: TELEGRAM_BOT_TOKEN não foi configurado nas variáveis de ambiente!");
  process.exit(1);
}

const bot = new Bot(TELEGRAM_BOT_TOKEN);

// ==========================================
// 2. BRAIN & CONFIGURAÇÕES DOS SUB-AGENTES
// ==========================================
const BRAIN_SYSTEM_PROMPT = `
Você é o JARVIS, um assistente executivo e orquestrador inteligente.
Sua função é receber o texto fornecido pelo usuário junto com os relatórios de dois sub-agentes especialistas:
1. Sub-Agente Extrator (fatos, datas, valores e dados brutos).
2. Sub-Agente Auditor (análise de riscos, erros matemáticos e inconformidades).

Sua tarefa:
- Consolidar as informações de forma clara, profissional e objetiva em português.
- Destacar alertas críticos e erros apontados pelo Auditor.
- Fornecer um resumo estruturado e ações recomendadas para o usuário.
`;

const PROMPT_EXTRATOR = `
Você é o Sub-Agente Extrator.
Sua missão é extrair estritamente todos os fatos, valores financeiros, datas, nomes, itens e dados estruturados do texto do usuário.
Não emita opiniões, não julgue riscos. Apenas liste os dados extraídos de forma limpa e organizada.
`;

const PROMPT_AUDITOR = `
Você é o Sub-Agente Auditor.
Sua missão é analisar o texto do usuário e a extração efetuada.
Verifique:
1. Erros de cálculo ou discrepâncias matemáticas (ex: Receita vs Custos vs Lucro).
2. Riscos operacionais, legais ou financeiros (ex: transferências para contas não cadastradas).
3. Prazos apertados ou inconformidades.
Se tudo estiver correto, informe "Sem inconsistências detectadas". Caso contrário, liste os alertas de risco detalhadamente.
`;

// ==========================================
// 3. INTEGRAÇÃO COM OPENROUTER
// ==========================================
async function callOpenRouter(systemPrompt, userPrompt, model = "google/gemini-2.5-flash") {
  if (!OPENROUTER_API_KEY) {
    return "⚠️ AVISO: OPENROUTER_API_KEY não configurada. Defina a variável no Render.";
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
    return data.choices?.[0]?.message?.content || "[Sem resposta do modelo]";
  } catch (error) {
    console.error("Falha ao chamar OpenRouter:", error);
    return `[Erro na requisição da IA: ${error.message}]`;
  }
}

// ==========================================
// 4. PIPELINE MULTI-AGENTE
// ==========================================
async function processarPipeline(textoUsuario) {
  console.log("🔄 [Pipeline] Executando Sub-Agente Extrator...");
  const dadosExtraidos = await callOpenRouter(PROMPT_EXTRATOR, textoUsuario);

  console.log("🔄 [Pipeline] Executando Sub-Agente Auditor...");
  const relatorioAuditoria = await callOpenRouter(
    PROMPT_AUDITOR, 
    `Texto Original:\n${textoUsuario}\n\nExtração:\n${dadosExtraidos}`
  );

  console.log("🔄 [Pipeline] Executando Jarvis Consolidador...");
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

  return {
    dadosExtraidos,
    relatorioAuditoria,
    respostaFinal
  };
}

// ==========================================
// 5. HANDLERS DO BOT (TELEGRAM)
// ==========================================
bot.command("start", async (ctx) => {
  await ctx.reply(
    "🤖 *Jarvis Online*\n\n" +
    "O pipeline de sub-agentes (Extrator + Auditor) está pronto para uso.\n" +
    "Envie qualquer relatório, arquivo ou mensagem de texto para iniciar a análise.",
    { parse_mode: "Markdown" }
  );
});

bot.command("ping", async (ctx) => {
  await ctx.reply("🏓 Pong! Servidor e sub-agentes operando normalmente.");
});

bot.on("message:text", async (ctx) => {
  const texto = ctx.message.text;
  
  // Ignora outros comandos não mapeados
  if (texto.startsWith("/")) return;

  const statusMsg = await ctx.reply("⏳ *Jarvis:* Processando pipeline de sub-agentes...", { parse_mode: "Markdown" });

  try {
    const resultado = await processarPipeline(texto);

    await ctx.api.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      resultado.respostaFinal
    );
  } catch (err) {
    console.error("Erro ao processar mensagem:", err);
    await ctx.api.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      "❌ Ocorreu um erro ao processar sua solicitação no pipeline."
    );
  }
});

// Suporte para documentos de texto (.txt, .md, .csv)
bot.on("message:document", async (ctx) => {
  const doc = ctx.message.document;
  const statusMsg = await ctx.reply("📄 *Jarvis:* Baixando e analisando documento...", { parse_mode: "Markdown" });

  try {
    const file = await ctx.getFile();
    const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    
    const response = await fetch(fileUrl);
    const textContent = await response.text();

    const resultado = await processarPipeline(textContent);

    await ctx.api.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      resultado.respostaFinal
    );
  } catch (err) {
    console.error("Erro ao processar documento:", err);
    await ctx.api.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      "❌ Erro ao ler o arquivo enviado. Certifique-se de que é um arquivo de texto válido."
    );
  }
});

// ==========================================
// 6. SERVIDOR HTTP NATIVO & WEBHOOK RENDER
// ==========================================
const webhookPath = `/telegram-webhook`;

const server = createServer(async (req, res) => {
  // Rota de Healthcheck do Render
  if (req.url === "/" || req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("OK - Jarvis Bot em execução.");
    return;
  }

  // Rota do Webhook do Telegram
  if (req.url === webhookPath && req.method === "POST") {
    try {
      // FIX CRÍTICO: Usando "http" em vez de "node-http"
      await webhookCallback(bot, "http")(req, res);
    } catch (err) {
      console.error("Erro ao processar atualização do Webhook:", err);
      res.writeHead(500);
      res.end("Erro Interno");
    }
    return;
  }

  // Rota Não Encontrada
  res.writeHead(404);
  res.end("Não encontrado");
});

// Inicialização do Servidor
server.listen(PORT, async () => {
  console.log(`🚀 Servidor HTTP rodando na porta ${PORT}`);

  // Configuração automática do Webhook no Render
  if (RENDER_EXTERNAL_URL) {
    const fullWebhookUrl = `${RENDER_EXTERNAL_URL}${webhookPath}`;
    try {
      await bot.api.setWebhook(fullWebhookUrl);
      console.log(`🔗 Webhook do Telegram configurado com sucesso: ${fullWebhookUrl}`);
    } catch (err) {
      console.error("❌ Falha ao registrar Webhook no Telegram:", err.message);
    }
  } else {
    console.log("⚠️ RENDER_EXTERNAL_URL não detectada. Webhook não configurado automaticamente.");
  }
});
