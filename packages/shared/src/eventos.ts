/** Eventos em tempo real (seção 8.1). Workers e API publicam no Redis; a API repassa por WebSocket. */
export const CANAL_EVENTOS = "domma:eventos";

export type NomeEvento =
  | "mensagem.nova" | "mensagem.status" | "conversa.atualizada" | "ia.digitando"
  | "sugestao.pronta" | "conexao.estado" | "qrcode.atualizado" | "alerta.novo"
  | "instrucao.resposta" | "dashboard.metricas";

export interface EnvelopeEvento {
  contaId: string;
  usuarioId?: string;      // quando o evento é só para um usuário
  evento: NomeEvento;
  dados: unknown;
}
