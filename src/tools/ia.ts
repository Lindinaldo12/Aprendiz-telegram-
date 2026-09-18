import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import * as fs from "fs";
import * as path from "path";

// ==========================================
// CLIENT (singleton)
// ==========================================

let _ai: GoogleGenAI | null = null;

function getAiClient(): GoogleGenAI {
  if (_ai) return _ai;

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    console.error("❌ ERRO: GEMINI_API_KEY não foi lida do arquivo .env!");
    throw new Error("GEMINI_API_KEY ausente ou não configurada.");
  }

  _ai = new GoogleGenAI({ apiKey });
  return _ai;
}

// ==========================================
// INSTRUÇÃO PADRÃO (SEMPRE EM PT-BR)
// ==========================================

const INSTRUCAO_PADRAO_PT_BR = `Você é um assistente virtual que responde SEMPRE em português do Brasil, independentemente do idioma da pergunta ou do conteúdo analisado. Use linguagem natural, clara e cordial. Nunca responda em inglês, espanhol ou qualquer outro idioma, a menos que o usuário peça explicitamente uma tradução.`;

// ==========================================
// MODELOS
// ==========================================

const MODELO_PREFERENCIAL = process.env.AI_MODEL?.trim();

const MODELOS: string[] = [
  ...(MODELO_PREFERENCIAL ? [MODELO_PREFERENCIAL] : []),
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.5-flash-lite",
  "gemini-flash-latest",
].filter((v, i, arr) => arr.indexOf(v) === i);

// ==========================================
// CONTROLE DE COTA DIÁRIA
// ==========================================

const MODELOS_SEM_COTA = new Map<string, number>();
const UMA_HORA = 60 * 60 * 1000;

function estaSemCota(modelo: string): boolean {
  const expira = MODELOS_SEM_COTA.get(modelo);
  if (!expira) return false;
  if (Date.now() > expira) {
    MODELOS_SEM_COTA.delete(modelo);
    return false;
  }
  return true;
}

function marcarSemCota(modelo: string) {
  MODELOS_SEM_COTA.set(modelo, Date.now() + UMA_HORA);
  console.warn(`🚫 ${modelo} marcado como sem cota por 1h.`);
}

// ==========================================
// TIPOS
// ==========================================

export type Papel = "user" | "model";

export interface MensagemHistorico {
  papel: Papel;
  texto: string;
}

export interface OpcoesGeracao {
  systemInstruction?: string;
  temperature?: number;
  useSearch?: boolean;
  /** Histórico de mensagens anteriores (ordem cronológica) */
  historico?: MensagemHistorico[];
  /** ID do usuário atual (para memória individual) */
  userId?: string;
  /** Se deve injetar a memória do usuário na instrução (padrão: true) */
  usarMemoria?: boolean;
  /** Se deve aprender com esta conversa (padrão: true) */
  aprender?: boolean;
}

export interface ArquivoEntrada {
  fonte: string | Buffer;
  mimeType: string;
}

// ==========================================
// MEMÓRIA PERMANENTE E EVOLUTIVA
// ==========================================

export interface RegistroMemoria {
  fatos: string[];
  preferencias: string[];
  regras: string[];
  ultimaInteracao: string;
  resumo: string;
}

interface ArquivoMemoria {
  usuarios: Record<string, RegistroMemoria>;
}

const CAMINHO_MEMORIA =
  process.env.MEMORIA_ARQUIVO?.trim() || path.resolve("./memory.json");

let _memoria: ArquivoMemoria | null = null;

function carregarMemoria(): ArquivoMemoria {
  if (_memoria) return _memoria;
  try {
    if (fs.existsSync(CAMINHO_MEMORIA)) {
      _memoria = JSON.parse(fs.readFileSync(CAMINHO_MEMORIA, "utf-8"));
    }
  } catch (e) {
    console.warn("⚠️ Não foi possível ler o arquivo de memória, iniciando vazio.");
  }
  _memoria = _memoria ?? { usuarios: {} };
  return _memoria;
}

function salvarMemoria() {
  try {
    fs.mkdirSync(path.dirname(CAMINHO_MEMORIA), { recursive: true });
    fs.writeFileSync(CAMINHO_MEMORIA, JSON.stringify(_memoria, null, 2), "utf-8");
  } catch (e) {
    console.error("❌ Falha ao salvar memória:", e);
  }
}

function obterMemoriaUsuario(userId: string): RegistroMemoria {
  const memoria = carregarMemoria();
  if (!memoria.usuarios[userId]) {
    memoria.usuarios[userId] = {
      fatos: [],
      preferencias: [],
      regras: [],
      ultimaInteracao: new Date().toISOString(),
      resumo: "",
    };
  }
  return memoria.usuarios[userId];
}

export function definirRegra(userId: string, regra: string) {
  const reg = obterMemoriaUsuario(userId);
  if (!reg.regras.includes(regra)) {
    reg.regras.push(regra);
    salvarMemoria();
  }
}

export function removerRegra(userId: string, regra: string) {
  const reg = obterMemoriaUsuario(userId);
  reg.regras = reg.regras.filter((r) => r !== regra);
  salvarMemoria();
}

export function limparMemoriaUsuario(userId: string) {
  const memoria = carregarMemoria();
  delete memoria.usuarios[userId];
  salvarMemoria();
}

function mesclarLista(atual: string[], novas: string[]): string[] {
  const unicas = new Set(atual.map((s) => s.trim().toLowerCase()));
  for (const item of novas) {
    const chave = item.trim().toLowerCase();
    if (item.trim() && !unicas.has(chave)) {
      atual.push(item.trim());
      unicas.add(chave);
    }
  }
  return atual;
}

function extrairJson(texto: string): any {
  const match = texto.match(/```(?:json)?\s*([\s\S]*?)```/);
  const bruto = match ? match[1] : texto;
  const start = bruto.indexOf("{");
  const end = bruto.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(bruto.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function aprenderComConversa(
  userId: string,
  historico: MensagemHistorico[],
  resposta: string
): Promise<void> {
  try {
    const reg = obterMemoriaUsuario(userId);

    const promptAprendizado = `Analise a conversa abaixo entre usuário e assistente e extraia informações DURÁVEIS e úteis sobre o usuário.

Retorne APENAS um JSON válido neste formato:
{
  "fatos": ["fato durável sobre o usuário"],
  "preferencias": ["como ele gosta de ser atendido / estilo de resposta"],
  "regras": ["comando ou regra explícita que o usuário deu e deve ser sempre obedecida"],
  "resumo": "frase curta resumindo quem é o usuário e o contexto"
}

Regras:
- Não invente. Só inclua o que estiver claro na conversa.
- Não inclua segredos, senhas ou dados sensíveis.
- Fatos = coisas permanentes (nome, profissão, idioma, rotina).
- Preferências = estilo de resposta, tom, formato.
- Regras = instruções explícitas do tipo "sempre faça X", "nunca faça Y".

Conversa:
${historico.map((m) => `${m.papel}: ${m.texto}`).join("\n")}

Resposta do assistente:
${resposta}`;

    const texto = await gerar(promptAprendizado, {
      temperature: 0.3,
      usarMemoria: false,
      aprender: false,
    });

    const dados = extrairJson(texto);
    if (!dados) return;

    if (Array.isArray(dados.fatos)) mesclarLista(reg.fatos, dados.fatos);
    if (Array.isArray(dados.preferencias))
      mesclarLista(reg.preferencias, dados.preferencias);
    if (Array.isArray(dados.regras)) mesclarLista(reg.regras, dados.regras);
    if (typeof dados.resumo === "string" && dados.resumo.trim())
      reg.resumo = dados.resumo.trim();

    reg.ultimaInteracao = new Date().toISOString();
    salvarMemoria();
  } catch (e) {
    console.warn("⚠️ Falha ao aprender com a conversa:", e);
  }
}

function montarInstrucaoComMemoria(
  userId: string | undefined,
  especifica?: string
): string {
  const base = montarSystemInstruction(especifica);

  if (!userId) return base;

  const reg = obterMemoriaUsuario(userId);
  const blocos: string[] = [base];

  if (reg.regras.length > 0) {
    blocos.push(
      `\n\nREGRAS DO USUÁRIO (OBEDIÊNCIA OBRIGATÓRIA — devem ser seguidas 100%):\n- ${reg.regras.join("\n- ")}`
    );
  }
  if (reg.preferencias.length > 0) {
    blocos.push(
      `\n\nPREFERÊNCIAS DO USUÁRIO:\n- ${reg.preferencias.join("\n- ")}`
    );
  }
  if (reg.fatos.length > 0) {
    blocos.push(`\n\nSOBRE O USUÁRIO:\n- ${reg.fatos.join("\n- ")}`);
  }
  if (reg.resumo) {
    blocos.push(`\n\nCONTEXTO GERAL: ${reg.resumo}`);
  }

  return blocos.join("\n");
}

// ==========================================
// HELPERS
// ==========================================

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function extrairStatus(erro: any): number {
  return (
    erro?.status ??
    erro?.response?.status ??
    erro?.error?.code ??
    erro?.code ??
    0
  );
}

function ehCotaDiaria(erro: any): boolean {
  const textoDoErro = JSON.stringify(erro?.details ?? erro?.error ?? erro ?? "");
  return [
    "PerDay",
    "per day",
    "free_tier_requests",
    "GenerateRequestsPerDay",
  ].some((t) => textoDoErro.includes(t));
}

function calcularEspera(tentativa: number, status: number): number {
  const base = status === 429 ? 3000 : 2000;
  const exponencial = base * Math.pow(2, tentativa - 1);
  const jitter = Math.random() * 1000;
  return Math.min(exponencial + jitter, 30_000);
}

function lerComoBuffer(arquivo: ArquivoEntrada): Buffer {
  if (typeof arquivo.fonte === "string") {
    if (!fs.existsSync(arquivo.fonte)) {
      throw new Error(`Arquivo não encontrado no caminho: ${arquivo.fonte}`);
    }
    return fs.readFileSync(arquivo.fonte);
  }
  return arquivo.fonte;
}

function prepararArquivoPart(arquivo: ArquivoEntrada) {
  const buffer = lerComoBuffer(arquivo);

  if (arquivo.mimeType.startsWith("text/")) {
    return { text: buffer.toString("utf-8") };
  }

  return {
    inlineData: {
      mimeType: arquivo.mimeType,
      data: buffer.toString("base64"),
    },
  };
}

function montarSystemInstruction(especifica?: string): string {
  if (!especifica || especifica.trim() === "") return INSTRUCAO_PADRAO_PT_BR;
  return `${INSTRUCAO_PADRAO_PT_BR}\n\nInstruções adicionais:\n${especifica}`;
}

function historicoParaContents(historico?: MensagemHistorico[]): any[] {
  if (!historico || historico.length === 0) return [];
  return historico.map((m) => ({
    role: m.papel === "model" ? "model" : "user",
    parts: [{ text: m.texto }],
  }));
}

function montarContents(
  historico: MensagemHistorico[] | undefined,
  conteudoAtual: any
): any {
  const partes: any[] = historicoParaContents(historico);

  let partsAtual: any[];
  if (typeof conteudoAtual === "string") {
    partsAtual = [{ text: conteudoAtual }];
  } else if (Array.isArray(conteudoAtual)) {
    partsAtual = conteudoAtual;
  } else {
    partsAtual = [conteudoAtual];
  }

  partes.push({ role: "user", parts: partsAtual });
  return partes;
}

// ==========================================
// RETRY
// ==========================================

async function chamarComRetry(
  ai: GoogleGenAI,
  modelo: string,
  contents: any,
  config: any,
  maxTentativas = 3
) {
  if (maxTentativas < 1) throw new Error("maxTentativas deve ser >= 1");

  let ultimoErro: any;

  for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
    try {
      return await ai.models.generateContent({
        model: modelo,
        contents,
        config,
      });
    } catch (erro: any) {
      ultimoErro = erro;
      const status = extrairStatus(erro);
      const cotaDiaria = ehCotaDiaria(erro);
      const ehTemporario = (status === 503 || status === 429) && !cotaDiaria;

      if (ehTemporario && tentativa < maxTentativas) {
        const espera = calcularEspera(tentativa, status);
        console.warn(
          `⏳ Modelo ${modelo} (status ${status}). Tentativa ${tentativa}/${maxTentativas}. Aguardando ${(espera / 1000).toFixed(1)}s...`
        );
        await sleep(espera);
      } else {
        if (cotaDiaria) {
          console.warn(`🚫 ${modelo} sem cota diária. Pulando direto.`);
        }
        throw erro;
      }
    }
  }

  throw ultimoErro ?? new Error("Falha desconhecida após retries.");
}

// ==========================================
// GERAÇÃO (não-streaming)
// ==========================================

export async function gerar(
  contents: any,
  opcoes: OpcoesGeracao = {}
): Promise<string> {
  const {
    systemInstruction,
    temperature,
    useSearch,
    historico,
    userId,
    usarMemoria = true,
    aprender = true,
  } = opcoes;
  const ai = getAiClient();

  const config: any = {
    systemInstruction: usarMemoria
      ? montarInstrucaoComMemoria(userId, systemInstruction)
      : montarSystemInstruction(systemInstruction),
  };
  if (temperature !== undefined) config.temperature = temperature;
  if (useSearch) config.tools = [{ googleSearch: {} }];

  const contentsFinal = montarContents(historico, contents);

  for (let i = 0; i < MODELOS.length; i++) {
    const modelo = MODELOS[i];

    if (estaSemCota(modelo)) {
      console.log(`⏭️  Pulando ${modelo} (sem cota conhecida)`);
      continue;
    }

    try {
      const resposta = await chamarComRetry(ai, modelo, contentsFinal, config);
      const texto = resposta?.text ?? "Sem resposta do modelo.";
      console.log(`✅ Modelo usado: ${modelo}`);

      if (aprender && userId && historico && historico.length > 0) {
        aprenderComConversa(userId, historico, texto);
      }

      return texto;
    } catch (erro: any) {
      const status = extrairStatus(erro);
      const msg = erro?.message ?? "";

      if (ehCotaDiaria(erro)) marcarSemCota(modelo);

      console.warn(
        `❌ Modelo ${modelo} falhou (status ${status})${msg ? `: ${msg.slice(0, 120)}...` : ""}`
      );

      if (i === MODELOS.length - 1) {
        return "⚠️ Os modelos da IA estão com alta demanda/limite atingido no momento. Por favor, tente novamente em instantes.";
      }
    }
  }

  return "⚠️ Erro ao processar solicitação.";
}

// ==========================================
// GERAÇÃO (streaming)
// ==========================================

export async function gerarStream(
  contents: any,
  onChunk: (chunkTexto: string) => void,
  opcoes: OpcoesGeracao = {}
): Promise<string> {
  const {
    systemInstruction,
    temperature,
    useSearch,
    historico,
    userId,
    usarMemoria = true,
    aprender = true,
  } = opcoes;
  const ai = getAiClient();

  const config: any = {
    systemInstruction: usarMemoria
      ? montarInstrucaoComMemoria(userId, systemInstruction)
      : montarSystemInstruction(systemInstruction),
  };
  if (temperature !== undefined) config.temperature = temperature;
  if (useSearch) config.tools = [{ googleSearch: {} }];

  const contentsFinal = montarContents(historico, contents);

  for (let i = 0; i < MODELOS.length; i++) {
    const modelo = MODELOS[i];

    if (estaSemCota(modelo)) {
      console.log(`⏭️  Pulando ${modelo} (sem cota conhecida)`);
      continue;
    }

    let emitiuAlgo = false;

    try {
      const streamResult = await ai.models.generateContentStream({
        model: modelo,
        contents: contentsFinal,
        config,
      });

      console.log(`✅ Modelo usado (Streaming): ${modelo}`);
      let textoCompleto = "";

      for await (const chunk of streamResult) {
        const parte = chunk.text ?? "";
        if (!parte) continue;

        emitiuAlgo = true;
        textoCompleto += parte;
        onChunk(parte);
      }

      if (aprender && userId && historico && historico.length > 0) {
        aprenderComConversa(userId, historico, textoCompleto);
      }

      return textoCompleto;
    } catch (erro: any) {
      const status = extrairStatus(erro);
      const msg = erro?.message ?? "";

      if (ehCotaDiaria(erro)) marcarSemCota(modelo);

      if (emitiuAlgo) {
        console.error(
          `❌ Streaming interrompido após emitir dados (modelo ${modelo}, status ${status})`
        );
        return "⚠️ A transmissão foi interrompida no meio. Tente novamente.";
      }

      console.warn(
        `❌ Modelo ${modelo} falhou no streaming (status ${status})${msg ? `: ${msg.slice(0, 120)}...` : ""}`
      );

      if (i === MODELOS.length - 1) {
        return "⚠️ Ocorreu uma falha ao transmitir a resposta da IA.";
      }

      await sleep(1500);
    }
  }

  return "⚠️ Ocorreu uma falha ao transmitir a resposta da IA.";
}

// ==========================================
// FUNÇÕES UTILITÁRIAS EXPORTADAS
// ==========================================

export async function falar(
  prompt: string,
  opcoes?: OpcoesGeracao
): Promise<string> {
  return gerar(prompt, opcoes);
}

export async function perguntarIA(
  prompt: string,
  opcoes?: OpcoesGeracao
): Promise<string> {
  return gerar(prompt, opcoes);
}

export async function analisarArquivo(
  entrada: string | ArquivoEntrada,
  opcoes: {
    instrucao?: string;
    historico?: MensagemHistorico[];
    userId?: string;
  } = {}
): Promise<string> {
  const instrucao =
    opcoes.instrucao ??
    "Analise o conteúdo do arquivo/texto fornecido detalhadamente e responda com clareza, sempre em português do Brasil.";

  if (typeof entrada === "string") {
    return gerar(entrada, {
      systemInstruction: instrucao,
      temperature: 0.2,
      historico: opcoes.historico,
      userId: opcoes.userId,
    });
  }

  const partArquivo = prepararArquivoPart(entrada);
  return gerar([{ text: instrucao }, partArquivo], {
    temperature: 0.2,
    historico: opcoes.historico,
    userId: opcoes.userId,
  });
}

export async function traduzir(
  texto: string,
  idiomaDestino = "português",
  opcoes?: OpcoesGeracao
): Promise<string> {
  return gerar(texto, {
    systemInstruction: `Você é um tradutor profissional. Traduza o texto fornecido fielmente para o idioma: ${idiomaDestino}. IMPORTANTE: se o idioma de destino for português, use sempre português do Brasil.`,
    temperature: 0.3,
    historico: opcoes?.historico,
    userId: opcoes?.userId,
  });
}

export async function resumir(
  texto: string,
  opcoes?: OpcoesGeracao
): Promise<string> {
  return gerar(texto, {
    systemInstruction:
      "Você é um especialista em síntese. Resuma o texto fornecido em formato de tópicos claros, em português do Brasil.",
    temperature: 0.3,
    historico: opcoes?.historico,
    userId: opcoes?.userId,
  });
}

export async function pesquisar(
  termo: string,
  opcoes?: OpcoesGeracao
): Promise<string> {
  return gerar(`Pesquise e forneça uma resposta atualizada sobre: ${termo}`, {
    useSearch: true,
    historico: opcoes?.historico,
    userId: opcoes?.userId,
  });
}

// ==========================================
// EXPORT DE CONTROLE DE MEMÓRIA
// ==========================================

export const memoria = {
  obter: obterMemoriaUsuario,
  definirRegra,
  removerRegra,
  limpar: limparMemoriaUsuario,
  salvar: salvarMemoria,
};
