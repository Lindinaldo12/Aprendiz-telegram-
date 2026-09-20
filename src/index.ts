 import express from 'express';
import { Bot } from 'grammy';
import { askGemini } from './brain';

const app = express();
const PORT = process.env.PORT || 10000;

// Token do Telegram vindo das variáveis do Render
const botToken = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';
const bot = new Bot(botToken);

// Resposta a mensagens de texto no Telegram
bot.on('message:text', async (ctx) => {
  try {
    const resposta = await askGemini(ctx.message.text);
    await ctx.reply(resposta);
  } catch (error) {
    console.error('Erro no processamento:', error);
    await ctx.reply('Ops, tive um problema ao processar sua mensagem.');
  }
});

// Inicia a escuta de mensagens do Telegram
bot.start({
  onStart: (botInfo) => {
    console.log(`🤖 Bot @${botInfo.username} ativo no Telegram!`);
  },
});

// Rota HTTP para o Render
app.get('/', (req, res) => {
  res.send('Bot do Telegram está rodando!');
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
