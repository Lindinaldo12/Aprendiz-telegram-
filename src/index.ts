import express from 'express';
import { Bot } from 'grammy';
import { askOpenRouter, clearMemory } from './brain';

const app = express();
const PORT = process.env.PORT || 10000;

const botToken = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';
const bot = new Bot(botToken);

// Comando para limpar a memória da conversa
bot.command('reset', async (ctx) => {
  clearMemory(ctx.chat.id);
  await ctx.reply('Memória da conversa reiniciada com sucesso, Senhor.');
});

// Resposta a mensagens de texto
bot.on('message:text', async (ctx) => {
  try {
    const resposta = await askOpenRouter(ctx.chat.id, ctx.message.text);
    await ctx.reply(resposta);
  } catch (error) {
    console.error('Erro ao processar mensagem do bot:', error);
    await ctx.reply('Desculpe, Senhor. Tive um problema interno ao processar sua mensagem.');
  }
});

// Servidor Web para o Render manter a aplicação ativa
app.get('/', (req, res) => {
  res.send('Jarvis Bot (OpenRouter) ativo e operacional!');
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor HTTP rodando na porta ${PORT}`);
});

// Inicialização segura do Bot do Telegram
async function startBot() {
  try {
    // Apaga webhooks e pendências antigas para evitar o erro de conflito (409)
    await bot.api.deleteWebhook({ drop_pending_updates: true });

    bot.start({
      onStart: (botInfo) => {
        console.log(`🤖 Jarvis (@${botInfo.username}) rodando via OpenRouter!`);
      },
    });
  } catch (error) {
    console.error('Erro ao iniciar o bot do Telegram:', error);
  }
}

startBot();
