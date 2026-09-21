import express from 'express';
import { Bot } from 'grammy';
import { askOpenRouter, clearMemory } from './brain';

const app = express();
const PORT = process.env.PORT || 10000;

const botToken = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';
const bot = new Bot(botToken);

// Comando para limpar o histórico e reiniciar a memória
bot.command('reset', async (ctx) => {
  clearMemory(ctx.chat.id);
  await ctx.reply('Memória da conversa reiniciada com sucesso, Senhor.');
});

// Manipulador de mensagens de texto
bot.on('message:text', async (ctx) => {
  try {
    const resposta = await askOpenRouter(ctx.chat.id, ctx.message.text);
    await ctx.reply(resposta);
  } catch (error) {
    console.error('Erro no processamento do bot:', error);
    await ctx.reply('Ops, tive um problema interno ao processar sua mensagem.');
  }
});

// Inicia o bot do Telegram
bot.start({
  onStart: (botInfo) => {
    console.log(`🤖 Jarvis (@${botInfo.username}) rodando via OpenRouter!`);
  },
});

// Servidor Web para manter o Render ativo
app.get('/', (req, res) => {
  res.send('Jarvis Bot (OpenRouter) está ativo!');
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
