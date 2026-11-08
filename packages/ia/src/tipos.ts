export interface Msg {
  papel: "cliente" | "assistente" | "equipe";
  texto: string;
  imagem?: { base64: string; mime: string };
}

export interface PedidoGerar {
  sistema: string;
  historico: Msg[];
  tempoLimiteMs: number;
  /** Esquema JSON da saída estruturada (quando houver). */
  esquema?: Record<string, unknown>;
  maxTokens?: number;
}

export interface RespostaGerar {
  texto: string;
  tokensEntrada: number;
  tokensSaida: number;
  custo: number;
}

/** Interface única da seção 6.3: o resto do sistema só fala com isto. */
export interface IAProvider {
  readonly nome: string;
  gerar(req: PedidoGerar): Promise<RespostaGerar>;
  transcrever?(audio: Buffer, mime: string, tempoLimiteMs: number): Promise<RespostaGerar>;
  lerImagem?(img: Buffer, mime: string, pergunta: string, tempoLimiteMs: number): Promise<RespostaGerar>;
}

export interface ConfigProvedor {
  id: string;
  provedor: "anthropic" | "openai" | "gemini" | "compativel" | "simulado";
  modelo: string;
  chave: string | null;
  enderecoApi?: string | null;
}

export class ErroProvedor extends Error {
  constructor(msg: string, public readonly recuperavel = true) { super(msg); }
}

export function comTempoLimite<T>(p: Promise<T>, ms: number, rotulo: string): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise<T>((_, rej) => { t = setTimeout(() => rej(new ErroProvedor(`${rotulo}: tempo esgotado (${ms} ms)`)), ms); }),
  ]);
}
