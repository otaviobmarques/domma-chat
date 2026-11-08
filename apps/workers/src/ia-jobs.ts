import type { Job } from "bullmq";
import { q, q1 } from "@domma/db";
import { conversaCompleta, executarAcoes, inserirMensagem, publicar, transferirParaHumano } from "@domma/core";
import { ESQUEMA_INSTRUCAO, extrairJson, gerarComFallback, montarSistemaInstrucao, SaidaInstrucao } from "@domma/ia";
import { montarPedido } from "./contexto.ts";
import { chamarIA } from "./processar.ts";

export async function processarJobIA(job: Job) {
  const { conversaId } = job.data;
  if (job.name === "transferir") {
    const c = await q1<{ modo: string }>("SELECT modo FROM conversas WHERE id = $1", [conversaId]);
    if (c?.modo === "humano") return "ja-humano";
    await transferirParaHumano(conversaId, job.data.motivo);
    return "transferido";
  }
  if (job.name === "retomada" || job.name === "lead" || job.name === "retorno") {
    const conv = await conversaCompleta(conversaId);
    if (!conv || conv.modo !== "ia" || conv.opt_out) return "ignorado";
    return chamarIA(conv, job.name);
  }
  if (job.name === "instrucao") return processarInstrucao(job.data.instrucaoId);
  return "desconhecido";
}

/** "Fale com a IA" (seção 2.2): a IA avalia o pedido e executa, sugere outro caminho ou recusa. */
export async function processarInstrucao(instrucaoId: string) {
  const ins = await q1<any>("SELECT * FROM instrucoes_ia WHERE id = $1", [instrucaoId]);
  if (!ins) return "sem-instrucao";
  const conv = await conversaCompleta(ins.conversa_id);
  const ped = await montarPedido(conv);
  ped.hist.push({ papel: "equipe", texto: ins.texto });
  let s: SaidaInstrucao;
  try {
    const r = await gerarComFallback(conv.conta_id, { sistema: montarSistemaInstrucao(ped.sistema), historico: ped.hist, tempoLimiteMs: 20000, esquema: ESQUEMA_INSTRUCAO }, { conversaId: conv.id });
    s = SaidaInstrucao.parse(extrairJson(r.texto));
  } catch (e) {
    await q("UPDATE instrucoes_ia SET decisao = 'recusada', resposta_ia = $2 WHERE id = $1", [instrucaoId, `IA indisponível: ${(e as Error).message}`]);
    await inserirMensagem({ contaId: conv.conta_id, conversaId: conv.id, autor: "nota", conteudo: "IA indisponível para executar a instrução." });
    return "falhou";
  }
  const materiais = s.enviar_materiais.map((curto) => ped.materiais.find((m) => m.id === curto || m.idCompleto === curto)?.idCompleto).filter((x): x is string => !!x);
  const decisao = s.decisao === "executar" ? "executada" : s.decisao === "discordar" ? "sugerida" : "recusada";
  const alternativa = s.decisao === "discordar" ? { rotulo: s.alternativa, mensagens: s.mensagens_cliente, materiais } : null;
  await q("UPDATE instrucoes_ia SET decisao = $2, resposta_ia = $3, alternativa = $4, acao_tomada = $5 WHERE id = $1",
    [instrucaoId, decisao, s.explicacao, alternativa ? JSON.stringify(alternativa) : null, JSON.stringify({ mensagens: s.mensagens_cliente, retorno: s.agendar_retorno, etiquetas: s.etiquetas, materiais })]);
  const nota = await inserirMensagem({ contaId: conv.conta_id, conversaId: conv.id, autor: "nota", conteudo: `🤖 ${s.explicacao}`, falaId: `instrucao:${instrucaoId}` });
  await publicar(conv.conta_id, "instrucao.resposta", { instrucaoId, conversaId: conv.id, decisao, explicacao: s.explicacao, alternativa, notaId: nota?.id });

  if (s.decisao === "executar") await executarAcoes(conv, { mensagens: s.mensagens_cliente, retorno: s.agendar_retorno, etiquetas: s.etiquetas, materiais });
  return decisao;
}

