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
    // MOSTRA O ERRO REAL no Telegram
    await ctx.api.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      `❌ Erro ao criar o sub-agente.\n\n*Detalhe:* ${err?.message || err}\n\nDica: se for "rate limit" ou "429", os modelos gratuitos estão cheios. Tente de novo em alguns minutos.`,
      { parse_mode: 'Markdown' }
    );
  }
});
