import { DelayedError, UnrecoverableError, type Job } from "bullmq";
import { q, q1 } from "@domma/db";
import { configConta, emitirConversa, evento, falaAtiva, inserirMensagem, lerArquivo, publicar, redis, urlAssinada, type JobEnvio } from "@domma/core";
import { canalDaConexao, ErroCanal } from "@domma/whatsapp";

const LIMITE_POR_MIN = { qr: Number(process.env.QR_MSG_POR_MIN ?? 20), oficial: Number(process.env.OFICIAL_MSG_POR_MIN ?? 600), simulador: 10000 } as Record<string, number>;

/** Limitador por conexão (seção 7.2): janela de 1 minuto no Redis. */
async function dentroDoLimite(conexaoId: string, tipo: string) {
  const k = `ritmo:${conexaoId}:${Math.floor(Date.now() / 60000)}`;
  const n = await redis.incr(k); await redis.expire(k, 120);
  return n <= (LIMITE_POR_MIN[tipo] ?? 60);
}

export async function processarEnvio(job: Job<JobEnvio>, token?: string) {
  const d = job.data;
  const c = await q1<any>(
    `SELECT cv.*, ct.telefone, ct.opt_out, ct.nome AS contato_nome, cx.tipo AS cx_tipo, cx.status AS cx_status, cx.credenciais, cx.id AS cx_id
       FROM conversas cv JOIN contatos ct ON ct.id = cv.contato_id JOIN conexoes cx ON cx.id = cv.conexao_id WHERE cv.id = $1`, [d.conversaId]);
  if (!c) return "sem-conversa";

  // Revalidação no momento de executar (seção 7.2): modo, fala ativa, opt-out e janela de 24h.
  if (d.falaId) {
    if (c.modo !== "ia" || (await falaAtiva(d.conversaId)) !== d.falaId) {
      if (d.tipo === "digitando") await publicar(c.conta_id, "ia.digitando", { conversaId: d.conversaId, ativo: false });
      return "fala-cancelada";
    }
  }
  if (c.opt_out && !d.forcar) {
    if (d.mensagemId) await q("UPDATE mensagens SET status = 'cancelada', erro = 'cliente pediu para não receber mensagens' WHERE id = $1", [d.mensagemId]);
    return "opt-out";
  }

  const canal = canalDaConexao({ id: c.cx_id, conta_id: c.conta_id, tipo: c.cx_tipo, credenciais: c.credenciais });

  if (d.tipo === "digitando") {
    await publicar(c.conta_id, "ia.digitando", { conversaId: d.conversaId, ativo: true });
    await canal.digitando(c.telefone, d.idCliente).catch(() => {});
    return "digitando";
  }

  if (c.cx_tipo !== "simulador" && c.cx_status !== "conectada") {
    // Conexão caiu: a mensagem espera na fila até reconectar.
    await job.moveToDelayed(Date.now() + 30000, token);
    throw new DelayedError();
  }
  if (!(await dentroDoLimite(c.cx_id, c.cx_tipo))) {
    await job.moveToDelayed(Date.now() + 5000 + Math.random() * 5000, token);
    throw new DelayedError();
  }

  const janelaFechada = c.cx_tipo === "oficial" && (!c.janela_24h_ate || new Date(c.janela_24h_ate) < new Date());

  try {
    if (d.tipo === "reacao") {
      await canal.reagir(c.telefone, d.idAlvo!, d.emoji ?? "👍");
      await inserirMensagem({ contaId: c.conta_id, conversaId: d.conversaId, autor: "ia", tipo: "reacao", conteudo: d.emoji ?? "👍" });
      return "reagiu";
    }

    if (d.tipo === "material") {
      const m = await q1<any>("SELECT * FROM materiais_ia WHERE id = $1 AND conta_id = $2", [d.materialId, c.conta_id]);
      if (!m) return "material-inexistente";
      if (janelaFechada) throw new ErroCanal("janela de 24h fechada: arquivos só podem ser enviados depois que o cliente responder", 131047, true);
      const dados = await lerArquivo(m.arquivo);
      const urlPublica = (process.env.API_URL ?? "http://localhost:3333") + urlAssinada(m.arquivo, 86400).replace("/api/v1/arquivos", "/api/v1/arquivos/publico");
      const r = await canal.enviarMidia(c.telefone, { base64: dados.toString("base64"), url: urlPublica, mime: m.mime, legenda: m.legenda ?? undefined, nomeArquivo: m.nome_arquivo });
      await inserirMensagem({ contaId: c.conta_id, conversaId: d.conversaId, autor: d.autor === "humano" ? "humano" : "ia", autorId: d.autorId, tipo: m.mime.startsWith("image/") ? "imagem" : "documento", conteudo: m.legenda ?? m.titulo, midiaUrl: m.arquivo, midiaMime: m.mime, idExterno: r.idExterno, falaId: d.falaId, materialId: m.id, leitura: m.nome_arquivo });
      return "material-enviado";
    }

    // Texto (ou modelo aprovado)
    let r: { idExterno: string };
    if (d.tipo === "modelo" && d.modelo) {
      r = await canal.enviarModelo(c.telefone, d.modelo);
    } else if (janelaFechada) {
      if (d.autor !== "ia") throw new ErroCanal("Janela de 24h fechada: só é possível enviar um modelo aprovado pela Meta.", 131047, true);
      const cfg = await configConta(c.conta_id);
      r = await canal.enviarModelo(c.telefone, { nome: cfg.modelos.retomada ?? "retomada_contato", parametros: [String(c.contato_nome ?? "").split(" ")[0] || "tudo bem"] });
    } else {
      r = await canal.enviarTexto(c.telefone, d.texto ?? "");
    }
    if (d.mensagemId) {
      const m = await q1("UPDATE mensagens SET status = 'enviada', id_externo = $2 WHERE id = $1 RETURNING *", [d.mensagemId, r.idExterno]);
      await publicar(c.conta_id, "mensagem.status", m);
    } else {
      await inserirMensagem({ contaId: c.conta_id, conversaId: d.conversaId, autor: d.autor === "humano" ? "humano" : "ia", autorId: d.autorId, conteudo: d.texto, idExterno: r.idExterno, falaId: d.falaId, fontes: d.fontes });
    }
    if (d.falaId) await publicar(c.conta_id, "ia.digitando", { conversaId: d.conversaId, ativo: false });
    return "enviado";
  } catch (e) {
    if (e instanceof ErroCanal && (e.definitivo || job.attemptsMade + 1 >= (job.opts.attempts ?? 1))) {
      if (e.codigo === 131047) {
        await q("UPDATE conversas SET janela_24h_ate = NULL WHERE id = $1", [d.conversaId]);
        await evento(c.conta_id, d.conversaId, "Janela de 24h fechada: use um modelo aprovado para retomar.");
      }
      if (d.mensagemId) {
        const m = await q1("UPDATE mensagens SET status = 'falhou', erro = $2 WHERE id = $1 RETURNING *", [d.mensagemId, e.message.slice(0, 300)]);
        await publicar(c.conta_id, "mensagem.status", m);
      } else await inserirMensagem({ contaId: c.conta_id, conversaId: d.conversaId, autor: "nota", conteudo: `Falha ao enviar: ${e.message}` });
      await emitirConversa(d.conversaId);
      throw new UnrecoverableError(e.message);
    }
    throw e;
  }
}
