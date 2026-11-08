import type { Job } from "bullmq";
import { q, q1 } from "@domma/db";
import { configConta, emitirConversa, evento, filas, notificar, proximaAbertura } from "@domma/core";

/** Na hora marcada do retorno (seção 2.11). */
export async function processarFollowUp(job: Job) {
  if (job.name !== "retorno") return "ignorado";
  const r = await q1<any>("SELECT * FROM retornos WHERE id = $1", [job.data.retornoId]);
  if (!r || r.status !== "agendado") return "nao-agendado";
  const conv = await q1<any>("SELECT cv.*, ct.nome, ct.opt_out FROM conversas cv JOIN contatos ct ON ct.id = cv.contato_id WHERE cv.id = $1", [r.conversa_id]);
  if (!conv || conv.opt_out) { await q("UPDATE retornos SET status = 'cancelado' WHERE id = $1", [r.id]); return "cancelado"; }

  // Fora do horário comercial ou em feriado: adia para a próxima abertura.
  const cfg = await configConta(r.conta_id);
  const fer = new Set((await q<{ dia: string }>("SELECT to_char(dia,'YYYY-MM-DD') AS dia FROM feriados WHERE conta_id = $1", [r.conta_id])).map((x) => x.dia));
  const abertura = proximaAbertura(new Date(), cfg.horario, fer);
  if (abertura.getTime() - Date.now() > 60000) {
    await q("UPDATE retornos SET quando = $2 WHERE id = $1", [r.id, abertura]);
    await filas.followUp.add("retorno", { retornoId: r.id }, { delay: abertura.getTime() - Date.now(), jobId: `retorno-${r.id}-${abertura.getTime()}` });
    return "adiado";
  }
  await q("UPDATE retornos SET status = 'executado' WHERE id = $1", [r.id]);

  if (conv.modo === "humano" || r.executor === "lembrete") {
    // Modo Humano: o atendente recebe o lembrete no celular em vez de a IA enviar.
    const alvo = conv.responsavel_id ? [conv.responsavel_id] : (await q<{ id: string }>("SELECT id FROM usuarios WHERE conta_id = $1 AND perfil IN ('admin','supervisor')", [r.conta_id])).map((u) => u.id);
    await notificar(alvo, `Retorno agendado: ${conv.nome ?? "cliente"}`, "Está na hora de retomar esta conversa.", `/atendimento/${conv.id}`);
    await evento(r.conta_id, conv.id, "Lembrete de retorno enviado para a equipe.");
    await q("UPDATE conversas SET esperando_humano_desde = now() WHERE id = $1", [conv.id]);
  } else {
    await evento(r.conta_id, conv.id, "Retorno agendado: a IA está retomando a conversa.");
    await filas.ia.add("retorno", { conversaId: conv.id, gatilho: "retorno" });
  }
  await emitirConversa(conv.id);
  return "executado";
}
