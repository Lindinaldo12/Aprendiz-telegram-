export function calcular(expressao: string): string {
  const limpo = expressao.replace(/[^0-9+\-*/(). ]/g, "");
  if (!limpo) return "⚠️ Expressão inválida.";
  try {
    const resultado = Function(`"use strict"; return (${limpo})`)();
    if (typeof resultado !== "number" || !isFinite(resultado)) {
      return "⚠️ Não consigo calcular isso.";
    }
    return `${limpo} = ${resultado}`;
  } catch {
    return "⚠️ Expressão inválida.";
  }
}

export function piada(): string {
  const piadas = [
    "Por que o computador foi ao médico? Porque tinha um vírus! 🤖",
    "O que o zero disse para o oito? Belo cinto! 😄",
    "Por que os programadores preferem o escuro? Porque a luz atrai bugs! 🐛",
    "Como o matemático resolve seus problemas? Com equações de amizade! 📐",
    "O que um byte disse para o outro? Você tá me achando com cara de bit? 😅",
  ];
  return piadas[Math.floor(Math.random() * piadas.length)];
}

export function horaAtual(): string {
  return new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "full",
    timeStyle: "short",
  });
}
