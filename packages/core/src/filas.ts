import { Queue, type JobsOptions } from "bullmq";
import { conexaoFilas, redis } from "./redis.ts";

/** Filas da seção 7.1. Prioridade menor = mais urgente. */
export const NOMES = {
  recebidas: "mensagens-recebidas",
  midia: "midia",
  ia: "ia-resposta",
  envio: "envio",
  campanhas: "campanhas",
  followUp: "follow-up",
  integracoes: "integracoes",
  manutencao: "manutencao",
} as const;

const conn = conexaoFilas();
const padrao: JobsOptions = { removeOnComplete: { count: 1000 }, removeOnFail: { count: 5000 } };
export const filas = {
  recebidas: new Queue(NOMES.recebidas, { connection: conn, defaultJobOptions: { ...padrao, priority: 1, attempts: 5, backoff: { type: "exponential", delay: 1000 }, removeOnComplete: true } }),
  midia: new Queue(NOMES.midia, { connection: conn, defaultJobOptions: { ...padrao, priority: 2, attempts: 3, backoff: { type: "exponential", delay: 2000 } } }),
  ia: new Queue(NOMES.ia, { connection: conn, defaultJobOptions: { ...padrao, priority: 2, attempts: 2, backoff: { type: "fixed", delay: 1000 } } }),
  envio: new Queue(NOMES.envio, { connection: conn, defaultJobOptions: { ...padrao, attempts: 5, backoff: { type: "exponential", delay: 1000 } } }),
  campanhas: new Queue(NOMES.campanhas, { connection: conn, defaultJobOptions: { ...padrao, priority: 5, attempts: 3 } }),
  followUp: new Queue(NOMES.followUp, { connection: conn, defaultJobOptions: { ...padrao, attempts: 3 } }),
  integracoes: new Queue(NOMES.integracoes, { connection: conn, defaultJobOptions: { ...padrao, priority: 3, attempts: 5, backoff: { type: "exponential", delay: 2000 } } }),
  manutencao: new Queue(NOMES.manutencao, { connection: conn, defaultJobOptions: { ...padrao, attempts: 1 } }),
};

export interface JobRecebida { conversaId: string; gatilho: "mensagem" | "retomada" | "retorno" | "campanha" | "lead"; }

/**
 * Mensagens picadas (seção 7.2): o job é criado com atraso e jobId agrupar:{conversaId};
 * uma nova mensagem no intervalo substitui o job e a IA responde tudo junto.
 */
export async function enfileirarProcessamento(conversaId: string, gatilho: JobRecebida["gatilho"] = "mensagem", atrasoMs = Number(process.env.AGRUPAR_MS ?? 4000)) {
  const id = `agrupar-${conversaId}`;
  const existente = await filas.recebidas.getJob(id);
  if (existente) {
    const estado = await existente.getState();
    if (estado === "delayed" || estado === "waiting" || estado === "prioritized") {
      await existente.remove().catch(() => {});
    } else if (estado === "active") {
      // Está processando agora: agenda uma nova rodada que verá a mensagem nova.
      return filas.recebidas.add("processar", { conversaId, gatilho }, { delay: atrasoMs, jobId: `${id}-${Date.now()}` });
    } else {
      await existente.remove().catch(() => {});
    }
  }
  return filas.recebidas.add("processar", { conversaId, gatilho }, { delay: atrasoMs, jobId: id });
}

/** Fala ativa da IA por conversa. Trocar para Humano apaga a chave e remove os jobs pendentes. */
export async function registrarFala(conversaId: string, falaId: string, jobIds: string[]) {
  await redis.multi().set(`fala:${conversaId}`, falaId, "EX", 600).del(`falajobs:${conversaId}`).sadd(`falajobs:${conversaId}`, ...jobIds).expire(`falajobs:${conversaId}`, 600).exec();
}
export async function falaAtiva(conversaId: string) { return redis.get(`fala:${conversaId}`); }
export async function cancelarFalas(conversaId: string) {
  const ids = await redis.smembers(`falajobs:${conversaId}`);
  await redis.del(`fala:${conversaId}`, `falajobs:${conversaId}`);
  await Promise.all(ids.map(async (id) => { const j = await filas.envio.getJob(id); if (j && (await j.getState()) === "delayed") await j.remove().catch(() => {}); }));
  return ids.length;
}
