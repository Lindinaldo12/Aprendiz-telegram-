import { Context } from "grammy";
import { historico, limparHistorico } from "../memory/db.js";
import { calcular, piada, horaAtual } from "../tools/uteis.js";
import { traduzir, resumir, pesquisar } from "../tools/ia.js";

export async function cmdStart(ctx: Context) {
  const nome = ctx.from?.first_name ?? "amigo";
  await ctx.reply(
    `🤖 Olá, ${nome}! Eu sou o Aprendiz.\n\n` +
      `Comandos:\n` +
      `/help - Ajuda\n` +
      `/memoria - Ver memória\n` +
      `/config - Configurações\n` +
      `/limpar - Apagar memória\n` +
      `/sobre - Sobre mim\n` +
      `/calcular - Fazer contas\n` +
      `/piada - Uma piada\n` +
      `/hora - Hora e data\n` +
      `/id - Seu ID\n` +
      `/traduzir - Traduzir texto\n` +
      `/resumir - Resumir texto\n` +
      `/pesquisar - Buscar na internet\n\n` +
      `📦 Envie um PDF, imagem ou áudio para eu analisar.\n\n` +
      `Ou apenas me mande uma mensagem!`
  );
}

export async function cmdHelp(ctx: Context) {
  await ctx.reply(
    `📖 Ajuda do Aprendiz\n\n` +
      `/start - Iniciar\n` +
      `/help - Esta ajuda\n` +
      `/memoria - Ver histórico\n` +
      `/config - Configurar\n` +
      `/limpar - Apagar memória\n` +
      `/sobre - Sobre mim\n` +
      `/calcular 2+2*5 - Fazer contas\n` +
      `/piada - Uma piada\n` +
      `/hora - Hora e data\n` +
      `/id - Seu ID\n` +
      `/traduzir <texto> para inglês\n` +
      `/resumir <texto longo>\n` +
      `/pesquisar <pergunta> - Buscar na internet\n\n` +
      `📦 Envie um PDF, imagem ou áudio para eu analisar.\n\n` +
      `💬 Ou mande qualquer mensagem para conversar.`
  );
}

export async function cmdMemoria(ctx: Context) {
  const userId = ctx.from?.id;
  if (!userId) return;
  const hist = historico(userId);
  if (hist.length === 0) {
    await ctx.reply("🧠 Ainda não tenho memória de conversas com você.");
    return;
  }
  const texto = hist
    .map((h: any) => `Você: ${h.mensagem}\nAprendiz: ${h.resposta}`)
    .join("\n\n");
  await ctx.reply(`🧠 Últimas conversas:\n\n${texto}`);
}

export async function cmdConfig(ctx: Context) {
  await ctx.reply(
    `⚙️ Configurações\n\n` +
      `📌 Idioma: Português (BR)\n` +
      `🧠 Memória: Ativada\n` +
      `🤖 Modelo: Gemini\n\n` +
      `Mais opções em breve.`
  );
}

export async function cmdLimpar(ctx: Context) {
  const userId = ctx.from?.id;
  if (!userId) return;
  limparHistorico(userId);
  await ctx.reply("🧹 Memória apagada com sucesso!");
}

export async function cmdSobre(ctx: Context) {
  await ctx.reply(
    `🤖 Eu sou o Aprendiz!\n\n` +
      `Um assistente de IA rodando no Telegram, criado no Termux.\n` +
      `Uso o modelo Gemini para responder, pesquisar na internet e analisar arquivos.\n\n` +
      `Feito com Node.js + grammY.`
  );
}

export async function cmdCalcular(ctx: Context) {
  const texto = ctx.message?.text?.replace("/calcular", "").trim();
  if (!texto) {
    await ctx.reply("✏️ Uso: /calcular 2+2*5");
    return;
  }
  await ctx.reply(calcular(texto));
}

export async function cmdPiada(ctx: Context) {
  await ctx.reply(piada());
}

export async function cmdHora(ctx: Context) {
  await ctx.reply(`🕐 ${horaAtual()}`);
}

export async function cmdId(ctx: Context) {
  await ctx.reply(
    `🆔 Seu ID: ${ctx.from?.id}\n` +
      `👤 Nome: ${ctx.from?.first_name ?? "?"}\n` +
      `💬 Chat ID: ${ctx.chat?.id}`
  );
}

export async function cmdTraduzir(ctx: Context) {
  const texto = ctx.message?.text?.replace("/traduzir", "").trim();
  if (!texto) {
    await ctx.reply("✏️ Uso: /traduzir <texto> para inglês");
    return;
  }
  await ctx.replyWithChatAction("typing");
  const idioma = texto.includes("para ") ? texto.split("para ")[1] : "inglês";
  const conteudo = texto.split("para ")[0].trim();
  const resp = await traduzir(conteudo, idioma);
  await ctx.reply(`🌐 Tradução (${idioma}):\n\n${resp}`);
}

export async function cmdResumir(ctx: Context) {
  const texto = ctx.message?.text?.replace("/resumir", "").trim();
  if (!texto) {
    await ctx.reply("✏️ Uso: /resumir <texto longo>");
    return;
  }
  await ctx.replyWithChatAction("typing");
  const resp = await resumir(texto);
  await ctx.reply(`📝 Resumo:\n\n${resp}`);
}

export async function cmdPesquisar(ctx: Context) {
  const texto = ctx.message?.text?.replace("/pesquisar", "").trim();
  if (!texto) {
    await ctx.reply("✏️ Uso: /pesquisar <o que você quer saber>");
    return;
  }
  await ctx.replyWithChatAction("typing");
  const resp = await pesquisar(texto);
  await ctx.reply(`🔎 Resultado:\n\n${resp}`);
}
