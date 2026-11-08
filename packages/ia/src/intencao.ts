import { normalizarTexto } from "@domma/shared";

/**
 * Classificador barato de intenção (camada "porteiro", seção 2.13): roda antes da IA principal
 * e decide situações que não devem depender do modelo.
 */
export type Intencao =
  | "opt_out" | "exclusao_dados" | "despedida" | "pedido_humano" | "agressivo_juridico"
  | "pergunta_robo" | "quem_e" | "ja_paguei" | "outro";

export function classificarIntencao(texto: string): Intencao {
  const t = normalizarTexto(texto);
  if (!t) return "outro";
  if (/^(sair|pare|parar|stop|descadastrar|cancelar inscricao)$/.test(t) || /nao (quero|me) (mais )?(receber|mande)/.test(t)) return "opt_out";
  if (/(apag|exclu|delet|remov)\w* (os |todos os )?meus dados|lgpd/.test(t)) return "exclusao_dados";
  if (/\b(procon|processo|advogado|justica|reclame aqui)\b/.test(t) || /\b(porra|caralho|merda|lixo|vagabund\w*|idiota|fdp|palhaco)\b/.test(t)) return "agressivo_juridico";
  if (/\b(atendente|humano|pessoa de verdade|falar com (alguem|uma pessoa|um humano|o gerente))\b/.test(t)) return "pedido_humano";
  if (/\b(e|eh|voce e|vc e|to falando com|estou falando com)\b.*\b(robo|bot|ia|maquina|inteligencia artificial)\b/.test(t)) return "pergunta_robo";
  if (/^(quem e|quem fala|quem ta falando|numero errado|nao conheco|de onde (e|vc e|voce e))/.test(t)) return "quem_e";
  if (/\b(ja paguei|paguei|segue (o )?comprovante|fiz o pix)\b/.test(t)) return "ja_paguei";
  if (/^(obrigad[oa]|valeu|vlw|tchau|ate mais|ate logo|falou|boa noite|bom descanso|flw|ok obrigad[oa]|obg|tmj|abraco|abs)( (obrigad[oa]|tchau|ate mais|valeu|ate amanha))*$/.test(t)) return "despedida";
  return "outro";
}

export function ehDespedidaDaIA(texto: string): boolean {
  return /\b(ate (mais|logo|amanha|breve|la)|qualquer coisa (e so|estou|to)|estou por aqui|tenha um (otimo|bom)|foi um prazer|abraco)\b/.test(normalizarTexto(texto));
}
