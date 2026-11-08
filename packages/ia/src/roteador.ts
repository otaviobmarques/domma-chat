import { q, q1 } from "@domma/db";
import { decifrar } from "@domma/shared";
import { ProvedorAnthropic } from "./provedores/anthropic.ts";
import { ProvedorGemini } from "./provedores/gemini.ts";
import { ProvedorOpenAI } from "./provedores/openai.ts";
import { ProvedorSimulado } from "./provedores/simulado.ts";
import { ErroProvedor, type ConfigProvedor, type IAProvider, type PedidoGerar, type RespostaGerar } from "./tipos.ts";

export type Tarefa = "conversa" | "transcricao" | "imagem";

interface LinhaProvedor {
  id: string; provedor: ConfigProvedor["provedor"]; modelo: string; chave: string | null; endereco_api: string | null;
  ordem: number; limite_mensal: number | null; gasto_mes: number; mes_referencia: string | null; degradado_ate: Date | null; rotulo: string | null;
}

export function criarProvedor(cfg: ConfigProvedor): IAProvider {
  switch (cfg.provedor) {
    case "anthropic": return new ProvedorAnthropic(cfg);
    case "openai": case "compativel": return new ProvedorOpenAI(cfg);
    case "gemini": return new ProvedorGemini(cfg);
    case "simulado": return new ProvedorSimulado();
  }
}

const mesAtual = () => new Date().toISOString().slice(0, 7);

export class TodosProvedoresFalharam extends Error {
  constructor(public falhas: string[]) { super("IA indisponível: " + falhas.join(" | ")); }
}

/**
 * Fallback entre provedores (seção 3.3): Principal → Backup 1 → Backup 2, pulando os inativos,
 * os que passaram do limite de gasto do mês e os marcados como degradados (2 min após uma falha).
 */
export async function executarComFallback<T extends RespostaGerar>(
  contaId: string,
  tarefa: Tarefa,
  fn: (p: IAProvider) => Promise<T> | undefined,
  opts: { conversaId?: string; aoAvisarLimite?: (rotulo: string, pct: number) => void } = {},
): Promise<T & { provedorId: string; provedorNome: string }> {
  const lista = await q<LinhaProvedor>(
    `SELECT * FROM provedores_ia WHERE conta_id = $1 AND ativo AND $2 = ANY(tarefas) ORDER BY ordem`, [contaId, tarefa]);
  const falhas: string[] = [];
  const agora = Date.now();
  // Degradados vão para o fim da fila, mas ainda são tentados se for a última opção.
  const ordenados = [...lista.filter((p) => !p.degradado_ate || p.degradado_ate.getTime() < agora), ...lista.filter((p) => p.degradado_ate && p.degradado_ate.getTime() >= agora)];
  for (const p of ordenados) {
    const gasto = p.mes_referencia === mesAtual() ? p.gasto_mes : 0;
    if (p.limite_mensal && gasto >= p.limite_mensal) { falhas.push(`${p.rotulo ?? p.provedor}: limite mensal atingido`); continue; }
    const inicio = Date.now();
    try {
      const prov = criarProvedor({ id: p.id, provedor: p.provedor, modelo: p.modelo, chave: p.chave ? decifrar(p.chave) : null, enderecoApi: p.endereco_api });
      const pr = fn(prov);
      if (!pr) { falhas.push(`${p.provedor}: não suporta ${tarefa}`); continue; }
      const r = await pr;
      const ms = Date.now() - inicio;
      const novoGasto = gasto + r.custo;
      await q(`UPDATE provedores_ia SET gasto_mes = $2, mes_referencia = $3, degradado_ate = NULL, ultimo_tempo_ms = $4, ultimo_erro = NULL WHERE id = $1`, [p.id, novoGasto, mesAtual(), ms]);
      await q(`INSERT INTO uso_ia (conta_id, provedor_id, conversa_id, tarefa, sucesso, tempo_ms, tokens_entrada, tokens_saida, custo) VALUES ($1,$2,$3,$4,true,$5,$6,$7,$8)`,
        [contaId, p.id, opts.conversaId ?? null, tarefa, ms, r.tokensEntrada, r.tokensSaida, r.custo]);
      if (p.limite_mensal && novoGasto >= p.limite_mensal * 0.8 && gasto < p.limite_mensal * 0.8) opts.aoAvisarLimite?.(p.rotulo ?? p.provedor, 80);
      return { ...r, provedorId: p.id, provedorNome: p.rotulo ?? p.provedor };
    } catch (e) {
      const msg = (e as Error).message;
      falhas.push(msg);
      await q(`UPDATE provedores_ia SET degradado_ate = now() + interval '2 minutes', ultimo_erro = $2, ultimo_tempo_ms = $3 WHERE id = $1`, [p.id, msg.slice(0, 300), Date.now() - inicio]);
      await q(`INSERT INTO uso_ia (conta_id, provedor_id, conversa_id, tarefa, sucesso, tempo_ms, erro) VALUES ($1,$2,$3,$4,false,$5,$6)`,
        [contaId, p.id, opts.conversaId ?? null, tarefa, Date.now() - inicio, msg.slice(0, 300)]);
      if (e instanceof ErroProvedor && !e.recuperavel) continue;
    }
  }
  throw new TodosProvedoresFalharam(falhas.length ? falhas : ["nenhum provedor de IA ativo"]);
}

export async function gerarComFallback(contaId: string, req: PedidoGerar, opts?: Parameters<typeof executarComFallback>[3]) {
  return executarComFallback(contaId, "conversa", (p) => p.gerar(req), opts);
}

/** Teste de conexão do botão "Testar conexão". */
export async function testarProvedor(cfg: ConfigProvedor): Promise<{ ok: boolean; ms: number; erro?: string }> {
  const ini = Date.now();
  try {
    await criarProvedor(cfg).gerar({ sistema: "Responda apenas: ok", historico: [{ papel: "cliente", texto: "teste" }], tempoLimiteMs: 15000, maxTokens: 50 });
    return { ok: true, ms: Date.now() - ini };
  } catch (e) {
    return { ok: false, ms: Date.now() - ini, erro: (e as Error).message };
  }
}

export async function provedorPrincipal(contaId: string) {
  return q1<LinhaProvedor>(`SELECT * FROM provedores_ia WHERE conta_id = $1 AND ativo ORDER BY ordem LIMIT 1`, [contaId]);
}
