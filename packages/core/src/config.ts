import { q1 } from "@domma/db";
import { HORARIO_PADRAO, type HorarioComercial } from "@domma/shared";

export interface ConfigConta {
  horario: HorarioComercial;
  alertas: { esperaHumanoMin: number; iaLentaMs: number; atendenteSemResponderMin: number };
  antiLoop: { repeticoes: number; janelaMin: number; maxPor10min: number; maxDia: number; roboMs: number; agruparMs: number };
  novasConversas: "ia" | "humano";
  limiteCobrancaSemAprovacao: number;
  descontoMaximo: number;
  contatoLeadMin: number;
  inatividadeHoras: number;
  devolverCrm: boolean;
  webhookCrm?: string;
  modelos: { primeiroContato?: string; retomada?: string };
  regraVendedor: "cidade" | "rodizio" | "ultimo";
  duracaoReuniaoMin: number;
}

export const CONFIG_PADRAO: ConfigConta = {
  horario: HORARIO_PADRAO,
  alertas: { esperaHumanoMin: 5, iaLentaMs: 8000, atendenteSemResponderMin: 10 },
  antiLoop: { repeticoes: 3, janelaMin: 10, maxPor10min: 8, maxDia: 60, roboMs: 2000, agruparMs: 4000 },
  novasConversas: "ia",
  limiteCobrancaSemAprovacao: 500,
  descontoMaximo: 10,
  contatoLeadMin: 5,
  inatividadeHoras: 24,
  devolverCrm: false,
  modelos: { primeiroContato: "primeiro_contato", retomada: "retomada_contato" },
  regraVendedor: "cidade",
  duracaoReuniaoMin: 30,
};

function mesclar<T>(base: T, extra: any): T {
  if (!extra || typeof extra !== "object" || Array.isArray(extra)) return (extra ?? base) as T;
  const out: any = { ...base };
  for (const [k, v] of Object.entries(extra)) out[k] = typeof (base as any)?.[k] === "object" && !Array.isArray((base as any)[k]) ? mesclar((base as any)[k], v) : v;
  return out;
}

export async function configConta(contaId: string): Promise<ConfigConta & { nome: string }> {
  const c = await q1<{ nome: string; config: any }>("SELECT nome, config FROM contas WHERE id = $1", [contaId]);
  return { ...mesclar(CONFIG_PADRAO, c?.config ?? {}), nome: c?.nome ?? "" };
}
