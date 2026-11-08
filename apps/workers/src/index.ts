import { DelayedError, Worker, type Job } from "bullmq";
import { conexaoFilas, criarAlerta, liberarTrava, NOMES, obterTrava } from "@domma/core";
import { migrar } from "@domma/db/migrate";
import { processarEnvio } from "./envio.ts";
import { processarFollowUp } from "./followup.ts";
import { processarJobIA } from "./ia-jobs.ts";
import { agendarManutencao, processarManutencao } from "./manutencao.ts";
import { processarMidia } from "./midia.ts";
import { processarIntegracao } from "./integracoes.ts";
import { processarConversa } from "./processar.ts";

/** Ordem garantida por conversa: trava no Redis; sem trava, reagenda em 500 ms (seção 7.2). */
function comTrava<T>(fn: (job: Job, token?: string) => Promise<T>) {
  return async (job: Job, token?: string) => {
    const conversaId = job.data?.conversaId;
    if (!conversaId) return fn(job, token);
    const t = await obterTrava(`conv:${conversaId}`);
    if (!t) { await job.moveToDelayed(Date.now() + 500, token); throw new DelayedError(); }
    try { return await fn(job, token); } finally { await liberarTrava(`conv:${conversaId}`, t); }
  };
}

const grupo = process.env.WORKER_GRUPO ?? "todos"; // atendimento | campanhas | manutencao | todos
const workers: Worker[] = [];
const criar = (nome: string, fn: (job: Job, token?: string) => Promise<unknown>, concorrencia = 8) => {
  const w = new Worker(nome, fn, { connection: conexaoFilas(), concurrency: concorrencia });
  w.on("failed", async (job, err) => {
    if (err instanceof DelayedError) return;
    console.error(`[${nome}] job ${job?.id} falhou (${job?.attemptsMade}/${job?.opts.attempts}):`, err.message);
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1) && job.data?.contaId) {
      await criarAlerta(job.data.contaId, { nivel: "atencao", tipo: "fila_falha", titulo: `Falha definitiva na fila ${nome}`, detalhe: err.message.slice(0, 200), chave: `fila:${nome}:${new Date().toISOString().slice(0, 13)}` }).catch(() => {});
    }
  });
  workers.push(w);
};

await migrar();
if (grupo === "todos" || grupo === "atendimento") {
  criar(NOMES.recebidas, comTrava((job) => processarConversa(job.data.conversaId, job.data.gatilho)), 16);
  criar(NOMES.ia, comTrava((job) => processarJobIA(job)), 8);
  criar(NOMES.envio, comTrava((job, token) => processarEnvio(job, token)), 16);
  criar(NOMES.midia, processarMidia, 4);
  criar(NOMES.followUp, processarFollowUp, 4);
  criar(NOMES.integracoes, processarIntegracao, 4);
}
if (grupo === "todos" || grupo === "manutencao") {
  await agendarManutencao();
  criar(NOMES.manutencao, processarManutencao, 1);
}
console.log(`workers no ar (grupo: ${grupo}): ${workers.map((w) => w.name).join(", ")}`);

const parar = async () => { await Promise.all(workers.map((w) => w.close())); process.exit(0); };
process.on("SIGTERM", parar);
process.on("SIGINT", parar);
