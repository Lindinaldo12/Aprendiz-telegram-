import { Bot, webhookCallback } from 'grammy';
import { createServer } from 'node:http';
import { askOpenRouter, getModelRanking } from './openrouter.js';
import { initAgents, createAgent, listAgents, getAgent, deleteAgent } from './agents.js';

// ==========================================
// 1. VARIÁVEIS DE AMBIENTE
// ==========================================
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 3000;

if (!TELEGRAM_BOT_TOKEN) {
  console.error('❌ ERRO CRÍTICO: TELEGRAM_BOT_TOKEN não foi configurado!');
  process.exit(1);
}

const bot = new Bot(TELEGRAM_BOT_TOKEN);

// ==========================================
// 2. PROMPTS DO ORQUESTRADOR (JARVIS)
// ==========================================
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

// ==========================================
// 3. PIPELINE MULTI-AGENTE
// ==========================================
async function processarPipeline(textoUsuario) {
  // Lista os sub-agentes para o orquestrador conhecer
  const agents = await listAgents();
  const agentList = agents.length
    ? agents.map((a) => `- ${a.name}: ${a.system_prompt.slice(0, 120)}`).join('\n')
    : '- Nenhum agente extra criado.';

  const jarvisPrompt = JARVIS_SYSTEM_PROMPT.replace('{{AGENTS}}', agentList);

  console.log('🔄 Executando Sub-Agente Extrator...');
  const dadosExtraidos = await askOpenRouter([
    { role: 'system', content: PROMPT_EXTRATOR },
    { role: 'user', content: textoUsuario },
  ], { temperature: 0.2 });

  console.log('🔄 Executando Sub-Agente Auditor...');
  const relatorioAuditoria = await askOpenRouter([
    { role: 'system', content: PROMPT_AUDITOR },
    { role: 'user', content: `Texto Original:\n${textoUsuario}\n\nExtração:\n${dadosExtraidos}` },
  ], { temperature: 0.2 });

  console.log('🔄 Executando JARVIS Consolidador...');
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

// Executa um sub-agente específico
async function executarAgente(nomeAgente, texto) {
  const agent = await getAgent(agentNameFromText(nomeAgente));
  if (!agent) return `❌ Sub-agente "${nomeAgente}" não encontrado. Use /agentes para ver a lista.`;

  return await askOpenRouter([
    { role: 'system', content: agent.system_prompt },
    { role: 'user', content: texto },
  ], { temperature: 0.4 });
}

// Extrai o nome do agente de um texto tipo "nome | mensagem"
function agentNameFromText(texto) {
  return texto.split('|')[0].trim();
}

// ==========================================
// 4. COMANDOS DO BOT
// ==========================================
bot.command('start', async (ctx) => {
  await ctx.reply(
    '🤖 *JARVIS 2.0 Online*\n\n' +
    'Comandos:\n' +
    '/criar_agente Nome | Descrição do que ele faz\n' +
    '/agentes - Lista os sub-agentes\n' +
    '/executar Nome | Sua mensagem\n' +
    '/deletar_agente Nome\n' +
    '/modelos - Mostra ranking de velocidade\n' +
    '/ping - Teste\n\n' +
    'Envie qualquer texto para o pipeline completo.',
    { parse_mode: 'Markdown' }
  );
});

bot.command('ping', async (ctx) => {
  await ctx.reply('🏓 Pong! Servidor operando normalmente.');
});

bot.command('modelos', async (ctx) => {
  const ranking = getModelRanking();
  const texto = ranking
    .map((r, i) => `${i + 1}. ${r.model} ${r.latency ? `(${r.latency}ms)` : '(ainda não testado)'}`)
    .join('\n');
  await ctx.reply(`⚡ *Ranking de modelos por velocidade:*\n${texto}`, { parse_mode: 'Markdown' });
});

bot.command('agentes', async (ctx) => {
  const agents = await listAgents();
  if (!agents.length) {
    return ctx.reply('📋 Nenhum sub-agente criado ainda. Use /criar_agente.');
  }
  const texto = agents.map((a) => `- *${a.name}*: ${a.system_prompt.slice(0, 100)}`).join('\n');
  await ctx.reply(`📋 *Sub-agentes disponíveis:*\n${texto}`, { parse_mode: 'Markdown' });
});

bot.command('criar_agente', async (ctx) => {
  const args = ctx.match?.trim();
  if (!args || !args.includes('|')) {
    return ctx.reply('❌ Formato: /criar_agente Nome | Descrição do que o agente faz');
  }

  const [nome, descricao] = args.split('|').map((s) => s.trim());
  if (!nome || !descricao) {
    return ctx.reply('❌ Nome e descrição são obrigatórios.');
  }

  const statusMsg = await ctx.reply(`⏳ Criando sub-agente *${nome}*...`, { parse_mode: 'Markdown' });

  try {
    // O JARVIS gera o system prompt do novo agente a partir da descrição
    const systemPrompt = await askOpenRouter([
      {
        role: 'system',
        content: `Você é um especialista em criar sub-agentes de IA. Gere um system prompt profissional e objetivo em português para um sub-agente chamado "${nome}" cuja função é: ${descricao}. Responda APENAS com o system prompt, sem explicações.`,
      },
      { role: 'user', content: `Crie o system prompt para o sub-agente ${nome}.` },
    ], { temperature: 0.4 });

    await createAgent(nome, systemPrompt);
    await ctx.api.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      `✅ Sub-agente *${nome}* criado com sucesso!\n\n*Prompt gerado:*\n${systemPrompt}\n\nUse: /executar ${nome} | sua mensagem`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('Erro ao criar agente:', err);
    await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, '❌ Erro ao criar o sub-agente.');
  }
});

bot.command('executar', async (ctx) => {
  const args = ctx.match?.trim();
  if (!args || !args.includes('|')) {
    return ctx.reply('❌ Formato: /executar Nome | Sua mensagem');
  }

  const [nome, mensagem] = args.split('|').map((s) => s.trim());
  const statusMsg = await ctx.reply(`⏳ Executando sub-agente *${nome}*...`, { parse_mode: 'Markdown' });

  try {
    const resultado = await executarAgente(nome, mensagem);
    await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, resultado);
  } catch (err) {
    console.error('Erro ao executar agente:', err);
    await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, '❌ Erro ao executar o sub-agente.');
  }
});

bot.command('deletar_agente', async (ctx) => {
  const nome = ctx.match?.trim();
  if (!nome) return ctx.reply('❌ Formato: /deletar_agente Nome');

  const deleted = await deleteAgent(nome);
  await ctx.reply(deleted
    ? `🗑️ Sub-agente *${nome}* deletado.`
    : `❌ Sub-agente "${nome}" não encontrado.`,
    { parse_mode: 'Markdown' }
  );
});

// ==========================================
// 5. MENSAGENS DE TEXTO
// ==========================================
bot.on('message:text', async (ctx) => {
  const texto = ctx.message.text;
  if (texto.startsWith('/')) return;

  const statusMsg = await ctx.reply('⏳ *JARVIS:* Processando pipeline de sub-agentes...', { parse_mode: 'Markdown' });

  try {
    const resultado = await processarPipeline(texto);
    await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, resultado);
  } catch (err) {
    console.error('Erro ao processar mensagem:', err);
    await ctx.api.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      '❌ Erro ao processar mensagem no pipeline.'
    );
  }
});

bot.on('message:document', async (ctx) => {
  const statusMsg = await ctx.reply('📄 *JARVIS:* Lendo e analisando documento...', { parse_mode: 'Markdown' });

  try {
    const file = await ctx.getFile();
    const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const response = await fetch(fileUrl);
    const textContent = await response.text();

    const resultado = await processarPipeline(textContent);
    await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, resultado);
  } catch (err) {
    console.error('Erro ao processar documento:', err);
    await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, '❌ Erro ao ler o arquivo enviado.');
  }
});

// ==========================================
// 6. SERVIDOR HTTP & WEBHOOK
// ==========================================
const webhookPath = '/telegram-webhook';

const server = createServer(async (req, res) => {
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('OK - JARVIS 2.0 em execução.');
    return;
  }

  if (req.url === webhookPath && req.method === 'POST') {
    try {
      await webhookCallback(bot, 'http')(req, res);
    } catch (err) {
      console.error('Erro no webhook:', err);
      res.writeHead(500);
      res.end('Erro Interno');
    }
    return;
  }

  res.writeHead(404);
  res.end('Não encontrado');
});

server.listen(PORT, async () => {
  console.log(`🚀 Servidor HTTP rodando na porta ${PORT}`);
  await initAgents();

  if (RENDER_EXTERNAL_URL) {
    const fullWebhookUrl = `${RENDER_EXTERNAL_URL}${webhookPath}`;
    try {
      await bot.api.setWebhook(fullWebhookUrl);
      console.log(`🔗 Webhook configurado: ${fullWebhookUrl}`);
    } catch (err) {
      console.error('❌ Falha ao registrar Webhook:', err.message);
    }
  }
});
