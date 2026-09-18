import "dotenv/config";
import { Bot } from "grammy";
import {
  cmdStart,
  cmdHelp,
  cmdMemoria,
  cmdConfig,
  cmdLimpar,
  cmdSobre,
  cmdCalcular,
  cmdPiada,
  cmdHora,
  cmdId,
  cmdTraduzir,
  cmdResumir,
  cmdPesquisar,
} from "./bot/commands.js";
import { handleMensagem, handleArquivo } from "./bot/handlers.js";

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("❌ BOT_TOKEN não definido no .env");
  process.exit(1);
}

const bot = new Bot(token);

bot.command("start", cmdStart);
bot.command("help", cmdHelp);
bot.command("memoria", cmdMemoria);
bot.command("config", cmdConfig);
bot.command("limpar", cmdLimpar);
bot.command("sobre", cmdSobre);
bot.command("calcular", cmdCalcular);
bot.command("piada", cmdPiada);
bot.command("hora", cmdHora);
bot.command("id", cmdId);
bot.command("traduzir", cmdTraduzir);
bot.command("resumir", cmdResumir);
bot.command("pesquisar", cmdPesquisar);

bot.on("message:text", handleMensagem);
bot.on("message:document", handleArquivo);
bot.on("message:photo", handleArquivo);
bot.on("message:voice", handleArquivo);
bot.on("message:audio", handleArquivo);

bot.start({
  onStart: (info) => console.log(`🤖 Aprendiz rodando como @${info.username}`),
});
