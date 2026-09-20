import express from 'express';
import { Bot } from 'grammy';
import { askGemini, clearMemory } from './brain';

const app = express();
const PORT = process.env.PORT || 10000;

const botToken = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';
const bot = new Bot(botToken);

// Comando para o usuário resetar a memória da conversa
bot.command('reset', async (ctx) => {
  clearMemory(ctx.chat.id);
  await ctx.reply('Memória da conversa reiniciada com sucesso, Senhor.');
});

// Resposta a mensagens de texto no Telegram
bot.on('message:text', async (ctx) => {
  try {
    // Passa o ID do chat (ctx.chat.id) junto com o texto da mensagem
    const resposta = await askGemini(ctx.chat.id, ctx.message.text);
    await ctx.reply(resposta);
  } catch (error) {
    console.error('Erro no processamento:', error);
    await ctx.reply('Ops, tive um problema ao processar sua mensagem.');
  }
});

bot.start({
  onStart: (botInfo) => {
    console.log(`🤖 Bot @${botInfo.username} ativo no Telegram!`);
  },
});

app.get('/', (req, res) => {
  res.send('Jarvis Telegram Bot está ativo!');
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
