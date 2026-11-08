import { randomUUID } from "node:crypto";
import { auditar, q, q1, tx, type Executor } from "@domma/db";
import { planejarEscrita, quebrarEmPartes, type Velocidade } from "@domma/ia";
import { normalizarTelefone, proximaAbertura, rotular, type Modo } from "@domma/shared";
import type { MensagemEntrada } from "@domma/whatsapp";
import { configConta } from "./config.ts";
import { cancelarFalas, filas, registrarFala } from "./filas.ts";
import { criarAlerta, notificar, resolverAlerta } from "./notificacoes.ts";
import { publicar } from "./redis.ts";

export interface Conversa {
  id: string; conta_id: string; contato_id: string; conexao_id: string; modo: Modo; fila: string | null; responsavel_id: string | null;
  etiquetas: string[]; resumo_ia: string | null; estado: string; janela_24h_ate: Date | null; anti_loop: any; motivo_transferencia: string | null;
  esperando_humano_desde: Date | null; ultima_mensagem_em: Date;
}

const TIPO_DB: Record<string, string> = { texto: "texto", audio: "audio", imagem: "imagem", documento: "documento", video: "video", figurinha: "figurinha", localizacao: "localizacao", botao: "botao", reacao: "reacao" };

/** Busca ou cria contato (unificado pelo telefone) e a conversa aberta naquela conexão. */
export async function obterConversa(contaId: string, conexao: { id: string; modo_padrao: Modo }, telefoneBruto: string, nome?: string, ex?: Executor) {
  const telefone = normalizarTelefone(telefoneBruto);
  const run = async (c: Executor) => {
    const contato = await q1<any>(
      `INSERT INTO contatos (conta_id, telefone, nome, fonte_primeira, fonte_ultima) VALUES ($1,$2,$3,'organico','organico')
       ON CONFLICT (conta_id, telefone) DO UPDATE SET nome = COALESCE(contatos.nome, EXCLUDED.nome) RETURNING *, (xmax = 0) AS novo`,
      [contaId, telefone, nome ?? null], c);
    let conversa = await q1<Conversa>("SELECT * FROM conversas WHERE contato_id = $1 AND conexao_id = $2 AND estado = 'aberta'", [contato.id, conexao.id], c);
    let nova = false;
    if (!conversa) {
      const cfg = await configConta(contaId);
      const modo: Modo = cfg.novasConversas === "humano" ? "humano" : conexao.modo_padrao;
      conversa = await q1<Conversa>(
        `INSERT INTO conversas (conta_id, contato_id, conexao_id, modo, fila, etiquetas) VALUES ($1,$2,$3,$4,'Vendas',$5)
         ON CONFLICT (contato_id, conexao_id) WHERE estado = 'aberta' DO UPDATE SET estado = 'aberta' RETURNING *`,
        [contaId, contato.id, conexao.id, modo, contato.novo ? ["Novo contato"] : []], c);
      nova = true;
      if (contato.novo) await q("INSERT INTO oportunidades (conta_id, contato_id, etapa, origem) VALUES ($1,$2,'Novo contato',$3)", [contaId, contato.id, contato.fonte_primeira], c);
    }
    return { contato, conversa: conversa!, nova };
  };
  return ex ? run(ex) : tx(run);
}

export async function inserirMensagem(m: {
  contaId: string; conversaId: string; autor: "cliente" | "ia" | "humano" | "sistema" | "nota"; tipo?: string; conteudo?: string | null;
  autorId?: string | null; status?: string; idExterno?: string | null; midiaUrl?: string | null; midiaMime?: string | null; falaId?: string | null;
  citada?: string | null; fontes?: string[] | null; materialId?: string | null; leitura?: string | null;
}, ex?: Executor) {
  const msg = await q1<any>(
    `INSERT INTO mensagens (conta_id, conversa_id, autor, autor_id, tipo, conteudo, status, id_externo, midia_url, midia_mime, fala_id, citada_id_externo, fontes_usadas, material_id, leitura)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (conta_id, id_externo) WHERE id_externo IS NOT NULL DO NOTHING RETURNING *`,
    [m.contaId, m.conversaId, m.autor, m.autorId ?? null, m.tipo ?? "texto", m.conteudo ?? null, m.status ?? (m.autor === "cliente" ? "recebida" : "enviada"),
     m.idExterno ?? null, m.midiaUrl ?? null, m.midiaMime ?? null, m.falaId ?? null, m.citada ?? null, m.fontes ? JSON.stringify(m.fontes) : null, m.materialId ?? null, m.leitura ?? null], ex);
  if (!msg) return null; // duplicada (idempotência pelo id externo)
  if (["cliente", "ia", "humano"].includes(m.autor)) {
    const preview = m.conteudo || ({ audio: "🎤 Áudio", imagem: "📷 Foto", documento: "📄 Documento", video: "🎬 Vídeo" } as any)[m.tipo ?? ""] || "";
    await q(`UPDATE conversas SET ultima_mensagem_em = now(), ultima_mensagem_texto = $2, nao_lidas = nao_lidas + $3 WHERE id = $1`, [m.conversaId, preview.slice(0, 140), m.autor === "cliente" ? 1 : 0], ex);
  }
  await publicar(m.contaId, "mensagem.nova", msg);
  return msg;
}

export async function evento(contaId: string, conversaId: string, texto: string) {
  return inserirMensagem({ contaId, conversaId, autor: "sistema", tipo: "evento", conteudo: texto });
}

export async function conversaCompleta(conversaId: string) {
  return q1<any>(
    `SELECT cv.*, ct.nome AS contato_nome, ct.telefone, ct.cidade, ct.temperatura, ct.nota, ct.interesse, ct.motivo_classificacao, ct.dados_extraidos,
            ct.fonte_primeira, ct.fonte_ultima, ct.campanha, ct.entrou_em, ct.opt_out, ct.extras, cx.nome AS conexao_nome, cx.tipo AS conexao_tipo,
            u.nome AS responsavel_nome,
            (SELECT json_build_object('id', r.id, 'quando', r.quando, 'rotulo', r.rotulo, 'executor', r.executor) FROM retornos r WHERE r.conversa_id = cv.id AND r.status = 'agendado' ORDER BY r.quando LIMIT 1) AS retorno
       FROM conversas cv JOIN contatos ct ON ct.id = cv.contato_id JOIN conexoes cx ON cx.id = cv.conexao_id LEFT JOIN usuarios u ON u.id = cv.responsavel_id
      WHERE cv.id = $1`, [conversaId]);
}

export async function emitirConversa(conversaId: string) {
  const c = await conversaCompleta(conversaId);
  if (c) await publicar(c.conta_id, "conversa.atualizada", c);
  return c;
}

/**
 * Máquina de estados da conversa (seção 8.2).
 * IA→Humano cancela falas pendentes e trava para o responsável; Humano→IA "agora" enfileira a retomada.
 */
export async function trocarModo(conversaId: string, modo: Modo, opts: { usuarioId?: string | null; motivo?: string; retomada?: "agora" | "esperar"; ator?: "usuario" | "ia" | "sistema" } = {}) {
  const atual = await q1<Conversa>("SELECT * FROM conversas WHERE id = $1", [conversaId]);
  if (!atual) throw new Error("conversa não encontrada");
  if (modo !== "ia") await cancelarFalas(conversaId);
  const sets: string[] = ["modo = $2"]; const params: unknown[] = [conversaId, modo];
  if (modo === "humano") {
    if (opts.usuarioId) { params.push(opts.usuarioId); sets.push(`responsavel_id = $${params.length}`, "esperando_humano_desde = NULL"); }
    else sets.push("esperando_humano_desde = COALESCE(esperando_humano_desde, now())");
    params.push(opts.motivo ?? null); sets.push(`motivo_transferencia = $${params.length}`);
  } else sets.push("esperando_humano_desde = NULL", "motivo_transferencia = NULL");
  await q(`UPDATE conversas SET ${sets.join(", ")} WHERE id = $1`, params);
  await auditar(atual.conta_id, opts.ator ?? (opts.usuarioId ? "usuario" : "sistema"), `modo:${atual.modo}->${modo}`, conversaId, { motivo: opts.motivo, retomada: opts.retomada }, opts.usuarioId);

  if (modo === "humano" && opts.usuarioId) await evento(atual.conta_id, conversaId, "Atendente assumiu a conversa. A IA foi pausada.");
  else if (modo === "humano") await evento(atual.conta_id, conversaId, `IA transferiu para humano (${opts.motivo ?? "regra de transferência"})`);
  else if (modo === "aprova") await evento(atual.conta_id, conversaId, "Modo IA sugere: as respostas da IA aguardam aprovação.");
  else if (modo === "ia") {
    await evento(atual.conta_id, conversaId, opts.retomada === "agora" ? "Conversa devolvida para a IA, que vai retomar agora." : "Conversa devolvida para a IA, que responde quando o cliente escrever.");
    await resolverAlerta(atual.conta_id, `espera:${conversaId}`);
    if (opts.retomada === "agora") await filas.ia.add("retomada", { conversaId, gatilho: "retomada" });
  }
  return emitirConversa(conversaId);
}

/** Distribuição automática: atendente online da fila com menos conversas abertas (seção 2.5). */
export async function distribuir(contaId: string, fila: string | null, preferido?: string | null) {
  if (preferido) {
    const u = await q1<{ id: string }>("SELECT id FROM usuarios WHERE id = $1 AND status = 'online'", [preferido]);
    if (u) return u.id;
  }
  const u = await q1<{ id: string }>(
    `SELECT u.id FROM usuarios u
      WHERE u.conta_id = $1 AND u.status = 'online' AND ($2::text IS NULL OR cardinality(u.filas) = 0 OR $2 = ANY(u.filas))
      ORDER BY (SELECT count(*) FROM conversas c WHERE c.responsavel_id = u.id AND c.estado = 'aberta' AND c.modo = 'humano'), random() LIMIT 1`,
    [contaId, fila]);
  return u?.id ?? null;
}

export async function transferirParaHumano(conversaId: string, motivo: string, opts: { prioridade?: "normal" | "maxima"; fila?: string } = {}) {
  const c = await q1<Conversa>("SELECT * FROM conversas WHERE id = $1", [conversaId]);
  if (!c) return;
  if (opts.fila) await q("UPDATE conversas SET fila = $2 WHERE id = $1", [conversaId, opts.fila]);
  const responsavel = await distribuir(c.conta_id, opts.fila ?? c.fila, c.responsavel_id);
  await q("UPDATE conversas SET responsavel_id = COALESCE($2, responsavel_id) WHERE id = $1", [conversaId, responsavel]);
  await trocarModo(conversaId, "humano", { motivo, ator: "ia" });
  const nome = (await q1<{ nome: string }>("SELECT ct.nome FROM contatos ct JOIN conversas c ON c.contato_id = ct.id WHERE c.id = $1", [conversaId]))?.nome ?? "Cliente";
  if (responsavel) await notificar([responsavel], `${nome} precisa de você`, motivo, `/atendimento/${conversaId}`);
  if (opts.prioridade === "maxima") await criarAlerta(c.conta_id, { nivel: "urgente", tipo: "prioridade", titulo: `Prioridade máxima: ${nome}`, detalhe: motivo, chave: `prio:${conversaId}`, alvo: { conversaId }, push: true });
}

/** Retorno agendado (seção 2.11): tabela retornos + job atrasado na fila follow-up. */
export async function agendarRetorno(conversaId: string, quando: Date, origem: "cliente" | "equipe", executor?: "ia" | "lembrete", rotulo?: string) {
  const c = await q1<Conversa>("SELECT * FROM conversas WHERE id = $1", [conversaId]);
  if (!c) throw new Error("conversa não encontrada");
  const cfg = await configConta(c.conta_id);
  const feriados = new Set((await q<{ dia: string }>("SELECT to_char(dia,'YYYY-MM-DD') AS dia FROM feriados WHERE conta_id = $1", [c.conta_id])).map((r) => r.dia));
  const ajustado = proximaAbertura(quando, cfg.horario, feriados);
  await cancelarRetornos(conversaId, "substituido");
  const exec = executor ?? (c.modo === "humano" ? "lembrete" : "ia");
  const r = await q1<any>("INSERT INTO retornos (conta_id, conversa_id, quando, rotulo, origem, executor) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
    [c.conta_id, conversaId, ajustado, rotulo ?? rotular(ajustado), origem, exec]);
  const job = await filas.followUp.add("retorno", { retornoId: r.id }, { delay: Math.max(0, ajustado.getTime() - Date.now()), jobId: `retorno-${r.id}` });
  await q("UPDATE retornos SET job_id = $2 WHERE id = $1", [r.id, job.id]);
  await emitirConversa(conversaId);
  return r;
}

export async function cancelarRetornos(conversaId: string, _motivo = "cancelado") {
  const rs = await q<{ id: string; job_id: string | null }>("UPDATE retornos SET status = 'cancelado' WHERE conversa_id = $1 AND status = 'agendado' RETURNING id, job_id", [conversaId]);
  for (const r of rs) if (r.job_id) await (await filas.followUp.getJob(r.job_id))?.remove().catch(() => {});
  return rs.length;
}

export async function aplicarEtiquetas(conversaId: string, etiquetas: string[]) {
  if (!etiquetas.length) return;
  await q("UPDATE conversas SET etiquetas = ARRAY(SELECT DISTINCT unnest(etiquetas || $2::text[])) WHERE id = $1", [conversaId, etiquetas]);
  // A última etapa do funil vira a etapa da oportunidade.
  const etapas = ["Novo contato", "Orçamento enviado", "Reunião marcada", "Aguardando pagamento", "Pagou"];
  const etapa = [...etiquetas].reverse().find((e) => etapas.includes(e));
  if (etapa) await q(`UPDATE oportunidades SET etapa = $2 WHERE contato_id = (SELECT contato_id FROM conversas WHERE id = $1)`, [conversaId, etapa]);
}

export interface JobEnvio {
  contaId: string; conversaId: string; tipo: "digitando" | "texto" | "material" | "midia" | "modelo" | "reacao";
  autor: "ia" | "humano" | "sistema"; falaId?: string; texto?: string; materialId?: string; mensagemId?: string; idCliente?: string;
  autorId?: string; forcar?: boolean; fontes?: string[]; modelo?: { nome: string; parametros?: string[] }; emoji?: string; idAlvo?: string;
}

/** Motor de escrita: agenda "digitando…" e cada parte como jobs atrasados (jobId fala-{falaId}-{i}). */
export async function enfileirarFala(conversaId: string, partesBrutas: string[], opts: { materiais?: string[]; fontes?: string[]; velocidade?: Velocidade; idCliente?: string } = {}) {
  const c = await q1<Conversa>("SELECT conta_id FROM conversas WHERE id = $1", [conversaId]);
  if (!c) return null;
  const partes = quebrarEmPartes(partesBrutas);
  const falaId = randomUUID().slice(0, 12);
  const passos = planejarEscrita(partes, opts.velocidade ?? "natural");
  const base = { contaId: c.conta_id, conversaId, autor: "ia" as const, falaId, idCliente: opts.idCliente };
  const jobs: { name: string; data: JobEnvio; opts: { delay: number; jobId: string } }[] = passos.map((p) => ({ name: p.tipo as string, data: { ...base, tipo: p.tipo, texto: p.texto, fontes: p.indice === 0 ? opts.fontes : undefined } as JobEnvio, opts: { delay: p.atrasoMs, jobId: `fala-${falaId}-${p.indice}-${p.tipo}` } }));
  let t = passos.at(-1)?.atrasoMs ?? 800;
  for (const [i, materialId] of (opts.materiais ?? []).entries()) {
    t += 900;
    jobs.push({ name: "material", data: { ...base, tipo: "material", materialId } as JobEnvio, opts: { delay: t, jobId: `fala-${falaId}-m${i}` } });
  }
  await registrarFala(conversaId, falaId, jobs.map((j) => j.opts.jobId));
  await filas.envio.addBulk(jobs);
  return falaId;
}

/** Mensagem do atendente (ou aprovada): grava como pendente e envia já. */
export async function enviarComoHumano(conversaId: string, texto: string, autorId: string | null, autor: "humano" | "ia" = "humano") {
  const c = await q1<Conversa>("SELECT * FROM conversas WHERE id = $1", [conversaId]);
  if (!c) throw new Error("conversa não encontrada");
  const msg = await inserirMensagem({ contaId: c.conta_id, conversaId, autor, autorId, conteudo: texto, status: "pendente" });
  await q("UPDATE conversas SET esperando_humano_desde = NULL, nao_lidas = 0 WHERE id = $1", [conversaId]);
  await resolverAlerta(c.conta_id, `espera:${conversaId}`);
  await filas.envio.add("texto", { contaId: c.conta_id, conversaId, tipo: "texto", autor, mensagemId: msg.id, texto, autorId } as JobEnvio, { priority: 1 });
  return msg;
}

export async function enviarMaterialComoHumano(conversaId: string, materialId: string, autorId: string) {
  const c = await q1<Conversa>("SELECT conta_id FROM conversas WHERE id = $1", [conversaId]);
  if (!c) throw new Error("conversa não encontrada");
  await filas.envio.add("material", { contaId: c.conta_id, conversaId, tipo: "material", autor: "humano", materialId, autorId } as JobEnvio, { priority: 1 });
}

export async function enviarSistema(conversaId: string, texto: string, opts: { forcar?: boolean } = {}) {
  const c = await q1<Conversa>("SELECT conta_id FROM conversas WHERE id = $1", [conversaId]);
  if (!c) return;
  await filas.envio.add("texto", { contaId: c.conta_id, conversaId, tipo: "texto", autor: "ia", texto, forcar: opts.forcar } as JobEnvio, { priority: 1 });
}

export { proximaAbertura };
