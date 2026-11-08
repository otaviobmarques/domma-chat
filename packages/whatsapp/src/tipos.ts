export type TipoMsg = "texto" | "audio" | "imagem" | "documento" | "video" | "figurinha" | "localizacao" | "botao" | "reacao";

/** Mensagem recebida, já normalizada (igual para API Oficial, Evolution e simulador). */
export interface MensagemEntrada {
  idExterno: string;
  telefone: string;
  nome?: string;
  tipo: TipoMsg;
  texto?: string;
  midia?: { mediaId?: string; base64?: string; mime?: string; nomeArquivo?: string };
  citadaId?: string;
  editadaDe?: string;      // id da mensagem original quando é uma edição
  apagada?: boolean;
  referral?: { source_id?: string; source_type?: string; ctwa_clid?: string; headline?: string };
  timestamp: number;
  deMim: boolean;          // enviada pelo próprio número (celular do atendente)
  grupo: boolean;
  status?: boolean;        // status/stories
}

export interface AtualizacaoStatus { idExterno: string; status: "enviada" | "entregue" | "lida" | "falhou"; erroCodigo?: number; erro?: string; telefone?: string }

export type EventoCanal =
  | { tipo: "mensagem"; msg: MensagemEntrada }
  | { tipo: "status"; st: AtualizacaoStatus }
  | { tipo: "conexao"; estado: "conectada" | "caiu" | "desconectada"; numero?: string }
  | { tipo: "qrcode"; base64: string }
  | { tipo: "ligacao"; telefone: string; id: string };

export interface ModeloMeta { nome: string; idioma?: string; parametros?: string[] }

/** Interface única dos canais (packages/whatsapp, seção 12.4). */
export interface Canal {
  enviarTexto(para: string, texto: string, opts?: { citarId?: string }): Promise<{ idExterno: string }>;
  enviarModelo(para: string, modelo: ModeloMeta): Promise<{ idExterno: string }>;
  enviarMidia(para: string, m: { url?: string; base64?: string; mime: string; legenda?: string; nomeArquivo?: string }): Promise<{ idExterno: string }>;
  /** Mostra "digitando…". Na API Oficial também marca a mensagem do cliente como lida. */
  digitando(para: string, idMensagemCliente?: string): Promise<void>;
  pararDigitando?(para: string): Promise<void>;
  reagir(para: string, idMensagem: string, emoji: string): Promise<void>;
  baixarMidia(m: NonNullable<MensagemEntrada["midia"]>, idMensagem?: string): Promise<{ dados: Buffer; mime: string }>;
}

export class ErroCanal extends Error {
  constructor(msg: string, public codigo?: number, public definitivo = false) { super(msg); }
}
