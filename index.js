import { Bot } from 'grammy';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

function loadDotEnv() {
  const envFile = path.resolve(process.cwd(), '.env');

  if (!fs.existsSync(envFile)) {
    return;
  }

  const content = fs.readFileSync(envFile, 'utf8');
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const index = trimmed.indexOf('=');
    if (index === -1) continue;

    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();

    if (!process.env[key]) {
      process.env[key] = value.replace(/^['"]|['"]$/g, '');
    }
  }
}

loadDotEnv();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const PORT = Number(process.env.PORT || 3000);
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;

if (!TELEGRAM_BOT_TOKEN) {
  console.error('ERRO CRITICO: TELEGRAM_BOT_TOKEN nao foi configurado!');
  process.exit(1);
}

if (!OPENROUTER_API_KEY) {
  console.warn('AVISO: OPENROUTER_API_KEY nao foi configurado. O bot pode falhar ao responder.');
}

const bot = new Bot(TELEGRAM_BOT_TOKEN);

const MODEL_LIST = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemini-2.0-flash-exp:free',
  'meta-llama/llama-3.1-8b-instruct:free',
  'openai/gpt-oss-120b:free',
];

const latencyStats = new Map();
const localAgents = new Map();

async function askOpenRouter(messages, options = {}) {
  const { temperature = 0.7, maxTokens = 2000 } = options;

  const sortedModels = [...MODEL_LIST].sort((a, b) => {
    const la = latencyStats.get(a) ?? 99999;
    const lb = latencyStats.get(b) ?? 99999;
    return la - lb;
  });

  let lastError = null;

  for (const model of sortedModels) {
    const start = Date.now();

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': RENDER_EXTERNAL_URL || 'https://localhost',
          'X-Title': 'Jarvis Telegram Bot',
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`OpenRouter ${response.status}: ${text}`);
      }

      const data = await response.json();
      const reply = data?.choices?.[0]?.message?.content || '';

      if (!reply) continue;

      const elapsed = Date.now() - start;
      const current = latencyStats.get(model) ?? elapsed;
      latencyStats.set(model, Math.round((current + elapsed) / 2));

      return reply;
    } catch (error) {
      lastError = error;
      console.warn(`Modelo ${model} falhou: ${error?.message || error}`);
    }
  }

  throw new Error(lastError?.message || 'Todos os modelos falharam');
}

function getModelRanking() {
  return [...MODEL_LIST]
    .map((m) => ({
      model: m,
      latency: latencyStats.get(m) ?? null,
    }))
    .sort((a, b) => (a.latency ?? 99999) - (b.latency ?? 99999));
}

async function createAgent(name, systemPrompt) {
  const cleanName = String(name || '').trim().toLowerCase();
  if (!cleanName) throw new Error('Nome do agente obrigatório');

  const agent = {
    name: cleanName,
    system_prompt: systemPrompt,
    created_at: new Date().toISOString(),
  };

  localAgents.set(cleanName, agent);
  return agent;
}

async function listAgents() {
  return [...localAgents.values()];
}

async function getAgent(name) {
  const cleanName = String(name || '').trim().toLowerCase();
  return localAgents.get(cleanName) || null;
}

async function deleteAgent(name) {
  const cleanName = String(name || '').trim().toLowerCase();
  return localAgents.delete(cleanName);
}

const JARVIS_SYSTEM_PROMPT = `
Você é o JARVIS, um assistente executivo e orquestrador inteligente.
Sua função é receber o texto do usuário e os relatórios dos sub-agentes disponíveis.

Sub-agentes disponíveis:
{{AGENTS}}

Sua tarefa:
- Consolidar as informações em uma resposta final clara, profissional e objetiva em português.
- Destacar alertas críticos e inconsistências.
- Fornecer um resumo executivo e ações sugeridas.
- Se o usuário pedir algo que um sub-agente específico faz melhor, delegue a ele aquele trecho.
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
2. Riscos operacionais, contratuais ou fiscais.
3. Prazos inconsistentes ou alertas.
Se tudo estiver correto, informe "Nenhuma inconformidade detectada". Caso contrário, liste os alertas de risco.
`;

async function processarPipeline(textoUsuario) {
  const agents = await listAgents();
  const agentList = agents.length
    ? agents.map((a) => `- ${a.name}: ${a.system_prompt.slice(0, 120)}`).join('\n')
    : '- Nenhum agente extra criado.';

  const jarvisPrompt = JARVIS_SYSTEM_PROMPT.replace('{{AGENTS}}', agentList);

  console.log('Executando Sub-Agente Extrator...');
  const dadosExtraidos = await askOpenRouter([
    { role: 'system', content: PROMPT_EXTRATOR },
    { role: 'user', content: textoUsuario },
  ], { temperature: 0.2 });

  console.log('Executando Sub-Agente Auditor...');
  const relatorioAuditoria = await askOpenRouter([
    { role: 'system', content: PROMPT_AUDITOR },
    { role: 'user', content: `Texto Original:\n${textoUsuario}\n\nExtração:\n${dadosExtraidos}` },
  ], { temperature: 0.2 });

  console.log('Executando JARVIS Consolidador...');
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

  return await askOpenRouter([
    { role: 'system', content: jarvisPrompt },
    { role: 'user', content: contextoConsolidacao },
  ], { temperature: 0.4 });
}

async function executarAgente(nomeAgente, texto) {
  const agent = await getAgent(String(nomeAgente || '').trim().toLowerCase());
  if (!agent) return `Sub-agente "${nomeAgente}" nao encontrado. Use /agentes para ver a lista.`;

  return await askOpenRouter([
    { role: 'system', content: agent.system_prompt },
    { role: 'user', content: texto },
  ], { temperature: 0.4 });
}

bot.command('start', async (ctx) => {
  await ctx.reply(
    'JARVIS 2.0 Online\n\n' +
    'Comandos:\n' +
    '/criar_agente Nome | Descricao do que ele faz\n' +
    '/agentes - Lista os sub-agentes\n' +
    '/executar Nome | Sua mensagem\n' +
    '/deletar_agente Nome\n' +
    '/modelos - Mostra ranking de velocidade\n' +
    '/ping - Teste\n\n' +
    'Envie qualquer texto para o pipeline completo.'
  );
});

bot.command('ping', async (ctx) => {
  await ctx.reply('Pong! Servidor operando normalmente.');
});

bot.command('modelos', async (ctx) => {
  const ranking = getModelRanking();
  const texto = ranking
    .map((r, i) => `${i + 1}. ${r.model} ${r.latency ? `(${r.latency}ms)` : '(ainda nao testado)'}`)
    .join('\n');
  await ctx.reply(`Ranking de modelos por velocidade:\n${texto}`);
});

bot.command('agentes', async (ctx) => {
  const agents = await listAgents();
  if (!agents.length) {
    return ctx.reply('Nenhum sub-agente criado ainda. Use /criar_agente.');
  }
  const texto = agents.map((a) => `- ${a.name}: ${a.system_prompt.slice(0, 100)}`).join('\n');
  await ctx.reply(`Sub-agentes disponiveis:\n${texto}`);
});

bot.command('criar_agente', async (ctx) => {
  const args = ctx.match?.trim();
  if (!args || !args.includes('|')) {
    return ctx.reply('Formato: /criar_agente Nome | Descricao do que o agente faz');
  }

  const [nome, descricao] = args.split('|').map((s) => s.trim());
  if (!nome || !descricao) {
    return ctx.reply('Nome e descricao sao obrigatorios.');
  }

  const statusMsg = await ctx.reply(`Criando sub-agente ${nome}...`);

  try {
    const systemPrompt = await askOpenRouter([
      {
        role: 'system',
        content: `Voce e um especialista em criar sub-agentes de IA. Gere um system prompt profissional e objetivo em portugues para um sub-agente chamado "${nome}" cuja funcao e: ${descricao}.`,
      },
      { role: 'user', content: `Crie o system prompt para o sub-agente ${nome}.` },
    ], { temperature: 0.4 });

    await createAgent(nome, systemPrompt);

    await ctx.api.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      `Sub-agente ${nome} criado com sucesso!\n\nPrompt gerado:\n${systemPrompt}\n\nUse: /executar ${nome} | sua mensagem`
    );
  } catch (err) {
    console.error('Erro ao criar agente:', err);
    await ctx.api.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      `Erro ao criar o sub-agente.\n\nDetalhe: ${err?.message || err}\n\nDica: se for "rate limit" ou "429", adicione créditos no OpenRouter ou tente de novo em alguns minutos.`
    );
  }
});

bot.command('executar', async (ctx) => {
  const args = ctx.match?.trim();
  if (!args || !args.includes('|')) {
    return ctx.reply('Formato: /executar Nome | Sua mensagem');
  }

  const [nome, mensagem] = args.split('|').map((s) => s.trim());
  const statusMsg = await ctx.reply(`Executando sub-agente ${nome}...`);

  try {
    const resultado = await executarAgente(nome, mensagem);
    await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, resultado);
  } catch (err) {
    console.error('Erro ao executar agente:', err);
    await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, 'Erro ao executar o sub-agente.');
  }
});

bot.command('deletar_agente', async (ctx) => {
  const nome = ctx.match?.trim();
  if (!nome) return ctx.reply('Formato: /deletar_agente Nome');

  const deleted = await deleteAgent(nome);
  await ctx.reply(
    deleted
      ? `Sub-agente ${nome} deletado.`
      : `Sub-agente "${nome}" nao encontrado.`
  );
});

bot.on('message:text', async (ctx) => {
  const texto = ctx.message.text;
  if (texto.startsWith('/')) return;

  const statusMsg = await ctx.reply('JARVIS: Processando...');

  try {
    const resultado = await processarPipeline(texto);
    await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, resultado);
  } catch (err) {
    console.error('Erro ao processar mensagem:', err);
    await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, 'Erro ao processar mensagem.');
  }
});

bot.on('message:document', async (ctx) => {
  const statusMsg = await ctx.reply('JARVIS: Lendo e analisando documento...');

  try {
    const file = await ctx.getFile();
    const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const response = await fetch(fileUrl);
    const textContent = await response.text();

    const resultado = await processarPipeline(textContent);
    await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, resultado);
  } catch (err) {
    console.error('Erro ao processar documento:', err);
    await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, 'Erro ao ler o arquivo enviado.');
  }
});

const server = createServer((req, res) => {
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('OK - JARVIS 2.0 em execucao.');
    return;
  }

  res.writeHead(404);
  res.end('Nao encontrado');
});

server.listen(PORT, async () => {
  console.log(`Servidor HTTP rodando na porta ${PORT}`);

  if (RENDER_EXTERNAL_URL) {
    const webhookPath = '/telegram-webhook';
    const fullWebhookUrl = `${RENDER_EXTERNAL_URL}${webhookPath}`;

    try {
      await bot.api.setWebhook(fullWebhookUrl);
      console.log(`Webhook configurado: ${fullWebhookUrl}`);
    } catch (err) {
      console.error('Falha ao registrar Webhook:', err.message);
    }
  } else {
    try {
      await bot.api.deleteWebhook({ drop_pending_updates: true });
      console.log('Webhook removido. Iniciando modo polling...');

      bot.start({
        drop_pending_updates: true,
        onStart: (botInfo) => {
          console.log(`Bot @${botInfo.username} iniciado com polling.`);
        },
      });
    } catch (err) {
      console.error('Erro ao iniciar polling:', err);
    }
  }
});
