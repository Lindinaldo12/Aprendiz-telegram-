import { Context } from "grammy";
import { perguntarIA, analisarArquivo } from "../tools/ia.js";
import { salvarConversa, salvarUsuario, historico } from "../memory/db.js";

// Divide texto longo em partes de até 4000 caracteres (limite do Telegram ~4096)
function dividirMensagem(texto: string, max = 4000): string[] {
  const partes: string[] = [];
  let atual = "";
  for (const linha of texto.split("\n")) {
    if ((atual + linha).length > max) {
      partes.push(atual);
      atual = linha;
    } else {
      atual = atual ? atual + "\n" + linha : linha;
    }
  }
  if (atual) partes.push(atual);
  return partes;
}

// Envia texto longo em várias mensagens
async function enviarTexto(ctx: Context, texto: string) {
  for (const parte of dividirMensagem(texto)) {
    await ctx.reply(parte);
  }
}

export async function handleMensagem(ctx: Context) {
  const texto = ctx.message?.text;
  if (!texto) return;

  const userId = ctx.from!.id;
  const nome = ctx.from!.first_name ?? "usuário";

  salvarUsuario(userId, nome);

  await ctx.replyWithChatAction("typing");

  const hist = historico(userId, 5).reverse();
  const string: string[] = hist.map(
    (h: any) => `Você: ${h.mensagem}\nAprendiz: ${h.resposta}`
  );

  const resposta = await perguntarIA(texto, string);
  salvarConversa(userId, texto, resposta);

  await enviarTexto(ctx, resposta);
}

export async function handleArquivo(ctx: Context) {
  const msg = ctx.message;
  if (!msg) return;

  let fileId: string | undefined;
  let mimeType = "application/octet-stream";
  let nome = "arquivo";

  if (msg.document) {
    fileId = msg.document.file_id;
    mimeType = msg.document.mime_type ?? "application/octet-stream";
    nome = msg.document.file_name ?? "documento";
  } else if (msg.photo && msg.photo.length > 0) {
    fileId = msg.photo[msg.photo.length - 1].file_id;
    mimeType = "image/jpeg";
    nome = "imagem";
  } else if (msg.voice || msg.audio) {
    fileId = (msg.voice ?? msg.audio)?.file_id;
    mimeType = msg.voice ? "audio/ogg" : "audio/mpeg";
    nome = "áudio";
  }

  if (!fileId) return;

  await ctx.replyWithChatAction("typing");
  await ctx.reply(`📄 Recebi: ${nome}. Analisando...`);

  try {
    // Pega o file_path da API
    const file = await ctx.api.getFile(fileId);
    if (!file.file_path) {
      await ctx.reply("⚠️ Não consegui acessar esse arquivo.");
      return;
    }

    // Baixa o arquivo pela URL oficial
    const token = process.env.BOT_TOKEN;
    const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
    const res = await fetch(url);
    const buffer = Buffer.from(await res.arrayBuffer());
    const base64 = buffer.toString("base64");

    const resposta = await analisarArquivo(mimeType, base64);
    await enviarTexto(ctx, `📊 Análise de ${nome}:\n\n${resposta}`);
  } catch (erro) {
    console.error("Erro ao processar arquivo:", erro);
    await ctx.reply("⚠️ Não consegui processar esse arquivo.");
  }
}
