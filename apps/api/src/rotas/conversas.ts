import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { auditar, q, q1 } from "@domma/db";
import {
  agendarRetorno, aplicarEtiquetas, cancelarRetornos, conversaCompleta, emitirConversa, enviarComoHumano, enviarMaterialComoHumano,
  filas, inserirMensagem, publicar, trocarModo, urlAssinada, criarAlerta, configConta, executarAcoes,
} from "@domma/core";
import { criarGateway } from "@domma/pagamentos";
import { decifrar } from "@domma/shared";
import { autenticar, naoEncontrado, ErroHttp } from "../app.ts";

/** Garante que a conversa é da conta do usuário; atendente só vê a própria fila. */
async function conversaDoUsuario(req: any, id: string) {
  const c = await conversaCompleta(id);
  if (!c || c.conta_id !== req.usuario.contaId) throw naoEncontrado("conversa");
  return c;
}

const comUrl = (m: any) => (m.midia_url ? { ...m, midia_link: urlAssinada(m.midia_url) } : m);

export async function rotasConversas(app: FastifyInstance) {
  app.addHook("preHandler", autenticar);

  app.get("/api/v1/conversas", async (req) => {
    const f = z.object({ modo: z.string().optional(), fila: z.string().optional(), etiqueta: z.string().optional(), busca: z.string().optional(), fonte: z.string().optional(), filtro: z.enum(["quentes", "agendadas"]).optional(), estado: z.string().optional() }).parse(req.query);
    const p: unknown[] = [req.usuario.contaId]; const w: string[] = ["cv.conta_id = $1"];
    const add = (sql: string, v: unknown) => { p.push(v); w.push(sql.replace("?", `$${p.length}`)); };
    w.push(f.estado === "encerrada" ? "cv.estado = 'encerrada'" : "cv.estado = 'aberta'");
    if (f.modo) add("cv.modo = ?", f.modo);
    if (f.fila) add("cv.fila = ?", f.fila);
    if (f.etiqueta) add("? = ANY(cv.etiquetas)", f.etiqueta);
    if (f.fonte) add("ct.fonte_ultima = ?", f.fonte);
    if (f.busca) { p.push(`%${f.busca}%`, `%${f.busca.replace(/\D/g, "") || "x"}%`); w.push(`(ct.nome ILIKE $${p.length - 1} OR ct.telefone LIKE $${p.length})`); }
    if (f.filtro === "quentes") w.push("ct.temperatura = 'quente'");
    if (f.filtro === "agendadas") w.push("EXISTS (SELECT 1 FROM retornos r WHERE r.conversa_id = cv.id AND r.status = 'agendado')");
    if (req.usuario.perfil === "atendente") { p.push(req.usuario.id); w.push(`(cv.responsavel_id = $${p.length} OR cv.responsavel_id IS NULL)`); }
    return q(
      `SELECT cv.id, cv.modo, cv.fila, cv.etiquetas, cv.nao_lidas, cv.ultima_mensagem_em, cv.ultima_mensagem_texto, cv.responsavel_id, cv.esperando_humano_desde,
              ct.nome AS contato_nome, ct.telefone, ct.temperatura, ct.nota, ct.fonte_ultima, ct.campanha, ct.entrou_em, cx.nome AS conexao_nome, cx.tipo AS conexao_tipo,
              (SELECT json_build_object('quando', r.quando, 'rotulo', r.rotulo) FROM retornos r WHERE r.conversa_id = cv.id AND r.status = 'agendado' ORDER BY r.quando LIMIT 1) AS retorno
         FROM conversas cv JOIN contatos ct ON ct.id = cv.contato_id JOIN conexoes cx ON cx.id = cv.conexao_id
        WHERE ${w.join(" AND ")} ORDER BY cv.ultima_mensagem_em DESC LIMIT 200`, p);
  });

  app.get("/api/v1/conversas/:id", async (req) => {
    const c = await conversaDoUsuario(req, (req.params as any).id);
    await q("UPDATE conversas SET nao_lidas = 0 WHERE id = $1", [c.id]);
    const sugestao = await q1("SELECT * FROM sugestoes_ia WHERE conversa_id = $1 AND status = 'pendente' ORDER BY criado_em DESC LIMIT 1", [c.id]);
    const reunioes = await q("SELECT r.*, u.nome AS vendedor FROM reunioes r LEFT JOIN usuarios u ON u.id = r.vendedor_id WHERE r.conversa_id = $1 ORDER BY inicio", [c.id]);
    const cobrancas = await q("SELECT * FROM cobrancas WHERE conversa_id = $1 ORDER BY criado_em DESC", [c.id]);
    return { ...c, sugestao, reunioes, cobrancas };
  });

  app.get("/api/v1/conversas/:id/mensagens", async (req) => {
    const c = await conversaDoUsuario(req, (req.params as any).id);
    const { antes } = z.object({ antes: z.string().optional() }).parse(req.query);
    const rows = await q(`SELECT * FROM (SELECT m.*, u.nome AS autor_nome FROM mensagens m LEFT JOIN usuarios u ON u.id = m.autor_id
                            WHERE m.conversa_id = $1 AND ($2::timestamptz IS NULL OR m.criado_em < $2) ORDER BY m.criado_em DESC LIMIT 100) x ORDER BY criado_em`, [c.id, antes ?? null]);
    return rows.map(comUrl);
  });

  app.post("/api/v1/conversas/:id/mensagens", async (req) => {
    const c = await conversaDoUsuario(req, (req.params as any).id);
    const b = z.object({ texto: z.string().min(1).max(4000), interna: z.boolean().optional() }).parse(req.body);
    if (b.interna) return inserirMensagem({ contaId: c.conta_id, conversaId: c.id, autor: "nota", autorId: req.usuario.id, conteudo: b.texto });
    // Trava de atendimento: quem assumiu trava a resposta para os demais.
    if (c.modo === "humano" && c.responsavel_id && c.responsavel_id !== req.usuario.id && req.usuario.perfil === "atendente") throw new ErroHttp(409, `Conversa travada por ${c.responsavel_nome}`);
    if (c.modo !== "humano") await trocarModo(c.id, "humano", { usuarioId: req.usuario.id, motivo: "atendente respondeu" });
    else if (!c.responsavel_id) await q("UPDATE conversas SET responsavel_id = $2 WHERE id = $1", [c.id, req.usuario.id]);
    return enviarComoHumano(c.id, b.texto, req.usuario.id);
  });

  app.post("/api/v1/conversas/:id/materiais/:materialId", async (req) => {
    const c = await conversaDoUsuario(req, (req.params as any).id);
    const m = await q1("SELECT id FROM materiais_ia WHERE id = $1 AND conta_id = $2", [(req.params as any).materialId, c.conta_id]);
    if (!m) throw naoEncontrado("material");
    await enviarMaterialComoHumano(c.id, (req.params as any).materialId, req.usuario.id);
    return { ok: true };
  });

  app.patch("/api/v1/conversas/:id/modo", async (req) => {
    const c = await conversaDoUsuario(req, (req.params as any).id);
    const b = z.object({ modo: z.enum(["ia", "aprova", "humano"]), retomada: z.enum(["agora", "esperar"]).optional() }).parse(req.body);
    if (b.modo === "ia" && c.modo !== "ia" && !b.retomada) throw new ErroHttp(400, "Para voltar para a IA, escolha 'agora' ou 'esperar'.");
    return trocarModo(c.id, b.modo, { usuarioId: b.modo === "humano" ? req.usuario.id : null, retomada: b.retomada, ator: "usuario" });
  });

  app.patch("/api/v1/conversas/:id", async (req) => {
    const c = await conversaDoUsuario(req, (req.params as any).id);
    const b = z.object({ fila: z.string().optional(), responsavel_id: z.string().uuid().nullable().optional(), etiquetas: z.array(z.string()).optional(), estado: z.enum(["aberta", "encerrada"]).optional() }).parse(req.body);
    if (b.fila !== undefined) await q("UPDATE conversas SET fila = $2 WHERE id = $1", [c.id, b.fila]);
    if (b.responsavel_id !== undefined) await q("UPDATE conversas SET responsavel_id = $2 WHERE id = $1", [c.id, b.responsavel_id]);
    if (b.etiquetas) { await q("UPDATE conversas SET etiquetas = '{}' WHERE id = $1", [c.id]); await aplicarEtiquetas(c.id, b.etiquetas); }
    if (b.estado) await q("UPDATE conversas SET estado = $2 WHERE id = $1", [c.id, b.estado]);
    await auditar(c.conta_id, "usuario", "conversa:editar", c.id, b, req.usuario.id);
    return emitirConversa(c.id);
  });

  /** Atendente corrige a temperatura: a correção fica registrada para ajustar os pesos. */
  app.patch("/api/v1/conversas/:id/classificacao", async (req) => {
    const c = await conversaDoUsuario(req, (req.params as any).id);
    const b = z.object({ temperatura: z.enum(["quente", "morno", "frio"]) }).parse(req.body);
    await q("UPDATE contatos SET temperatura = $2 WHERE id = $1", [c.contato_id, b.temperatura]);
    await auditar(c.conta_id, "usuario", "classificacao:corrigir", c.contato_id, { de: c.temperatura, para: b.temperatura, nota: c.nota, interesse: c.interesse }, req.usuario.id);
    return emitirConversa(c.id);
  });

  app.post("/api/v1/conversas/:id/sugestao", async (req) => {
    const c = await conversaDoUsuario(req, (req.params as any).id);
    const ins = await q1<any>("INSERT INTO instrucoes_ia (conta_id, conversa_id, autor_id, texto, decisao) VALUES ($1,$2,$3,$4,'pendente') RETURNING *",
      [c.conta_id, c.id, req.usuario.id, "Sugira a melhor próxima resposta ao cliente."]);
    // No modo Humano/IA sugere vira sugestão para aprovar.
    await filas.ia.add("instrucao", { conversaId: c.id, instrucaoId: ins.id });
    return { instrucaoId: ins.id };
  });

  app.post("/api/v1/sugestoes/:id/:acao", async (req) => {
    const { id, acao } = req.params as any;
    const s = await q1<any>("SELECT s.*, cv.conta_id FROM sugestoes_ia s JOIN conversas cv ON cv.id = s.conversa_id WHERE s.id = $1", [id]);
    if (!s || s.conta_id !== req.usuario.contaId) throw naoEncontrado("sugestão");
    if (s.status !== "pendente") throw new ErroHttp(409, "esta sugestão já foi resolvida");
    if (acao === "descartar") { await q("UPDATE sugestoes_ia SET status = 'descartada', aprovado_por = $2 WHERE id = $1", [id, req.usuario.id]); return { ok: true }; }
    if (acao !== "aprovar" && acao !== "editar") throw new ErroHttp(400, "ação inválida");
    const partes: string[] = acao === "editar" ? z.object({ partes: z.array(z.string()).min(1) }).parse(req.body).partes : s.partes;
    await q("UPDATE sugestoes_ia SET status = $2, aprovado_por = $3, partes = $4 WHERE id = $1", [id, acao === "editar" ? "editada" : "aprovada", req.usuario.id, partes]);
    await auditar(s.conta_id, "usuario", `sugestao:${acao}`, s.conversa_id, null, req.usuario.id);
    for (const p of partes) {
      const mat = p.match(/^\[\[material:([0-9a-f-]{36})\]\]$/);
      if (mat) await enviarMaterialComoHumano(s.conversa_id, mat[1], req.usuario.id);
      else if (p.trim()) await enviarComoHumano(s.conversa_id, p, req.usuario.id, "ia");
    }
    return { ok: true };
  });

  app.post("/api/v1/conversas/:id/instrucoes", async (req) => {
    const c = await conversaDoUsuario(req, (req.params as any).id);
    const b = z.object({ texto: z.string().min(2).max(1000) }).parse(req.body);
    const ins = await q1<any>("INSERT INTO instrucoes_ia (conta_id, conversa_id, autor_id, texto, decisao) VALUES ($1,$2,$3,$4,'pendente') RETURNING *", [c.conta_id, c.id, req.usuario.id, b.texto]);
    await inserirMensagem({ contaId: c.conta_id, conversaId: c.id, autor: "nota", autorId: req.usuario.id, conteudo: `🗣 Para a IA: ${b.texto}`, falaId: `instrucao:${ins.id}` });
    await filas.ia.add("instrucao", { conversaId: c.id, instrucaoId: ins.id });
    return { instrucaoId: ins.id };
  });

  /** Botões "[sugestão da IA]" / "Seguir com meu pedido" / "Cancelar" quando a IA discorda. */
  app.post("/api/v1/instrucoes/:id/:escolha", async (req) => {
    const { id, escolha } = req.params as any;
    const ins = await q1<any>("SELECT * FROM instrucoes_ia WHERE id = $1 AND conta_id = $2", [id, req.usuario.contaId]);
    if (!ins) throw naoEncontrado("instrução");
    const conv = await conversaCompleta(ins.conversa_id);
        if (escolha === "cancelar") { await q("UPDATE instrucoes_ia SET decisao = 'recusada' WHERE id = $1", [id]); return { ok: true }; }
    if (escolha === "alternativa" && ins.alternativa) {
      await executarAcoes(conv, { mensagens: ins.alternativa.mensagens ?? [], materiais: ins.alternativa.materiais });
      await q("UPDATE instrucoes_ia SET decisao = 'executada' WHERE id = $1", [id]);
      return { ok: true };
    }
    if (escolha === "seguir") {
      // Pedido arriscado: só quem tem permissão confirma.
      if (req.usuario.perfil === "atendente" && /desconto|preço|preco|prazo/i.test(ins.texto)) throw new ErroHttp(403, "Pedido acima do permitido: precisa de aprovação de supervisor ou administrador.");
      const ins2 = await q1<any>("INSERT INTO instrucoes_ia (conta_id, conversa_id, autor_id, texto, decisao) VALUES ($1,$2,$3,$4,'pendente') RETURNING *",
        [ins.conta_id, ins.conversa_id, req.usuario.id, `${ins.texto}\n(O atendente avaliou o seu alerta e decidiu seguir com o pedido: execute, dentro das regras.)`]);
      await auditar(ins.conta_id, "usuario", "instrucao:seguir", ins.conversa_id, { texto: ins.texto }, req.usuario.id);
      await filas.ia.add("instrucao", { conversaId: ins.conversa_id, instrucaoId: ins2.id });
      return { instrucaoId: ins2.id };
    }
    throw new ErroHttp(400, "escolha inválida");
  });

  app.put("/api/v1/conversas/:id/retorno", async (req) => {
    const c = await conversaDoUsuario(req, (req.params as any).id);
    const b = z.object({ quando: z.string().datetime({ offset: true }), executor: z.enum(["ia", "lembrete"]).optional() }).parse(req.body);
    return agendarRetorno(c.id, new Date(b.quando), "equipe", b.executor);
  });
  app.delete("/api/v1/conversas/:id/retorno", async (req) => {
    const c = await conversaDoUsuario(req, (req.params as any).id);
    await cancelarRetornos(c.id);
    await emitirConversa(c.id);
    return { ok: true };
  });

  app.post("/api/v1/conversas/:id/cobrancas", async (req) => {
    const c = await conversaDoUsuario(req, (req.params as any).id);
    const b = z.object({ valor: z.number().positive(), descricao: z.string().min(2), forma: z.enum(["pix", "boleto", "cartao"]).default("pix") }).parse(req.body);
    const cfg = await configConta(c.conta_id);
    const g = await q1<any>("SELECT * FROM gateways WHERE conta_id = $1 AND ativo ORDER BY padrao DESC LIMIT 1", [c.conta_id]);
    if (!g) throw new ErroHttp(400, "Nenhum gateway de pagamento ativo. Configure em Pagamentos.");
    const precisaAprovacao = b.valor > cfg.limiteCobrancaSemAprovacao && req.usuario.perfil === "atendente";
    const cob = await q1<any>("INSERT INTO cobrancas (conta_id, conversa_id, gateway_id, descricao, valor, forma, status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [c.conta_id, c.id, g.id, b.descricao, b.valor, b.forma, precisaAprovacao ? "aguardando_aprovacao" : "pendente"]);
    if (precisaAprovacao) {
      await criarAlerta(c.conta_id, { nivel: "atencao", tipo: "cobranca_aprovacao", titulo: "Cobrança aguardando aprovação", detalhe: `R$ ${b.valor.toFixed(2)} · ${c.contato_nome ?? c.telefone}`, chave: `cob:${cob.id}`, alvo: { conversaId: c.id, cobrancaId: cob.id } });
      return cob;
    }
    return emitirCobranca(cob.id, c, g);
  });

  app.post("/api/v1/cobrancas/:id/aprovar", async (req, reply) => {
    if (req.usuario.perfil === "atendente") return reply.code(403).send({ erro: "só supervisor ou administrador aprova" });
    const cob = await q1<any>("SELECT * FROM cobrancas WHERE id = $1 AND conta_id = $2 AND status = 'aguardando_aprovacao'", [(req.params as any).id, req.usuario.contaId]);
    if (!cob) throw naoEncontrado("cobrança");
    await q("UPDATE cobrancas SET status = 'pendente' WHERE id = $1", [cob.id]);
    return emitirCobranca(cob.id, await conversaCompleta(cob.conversa_id), await q1("SELECT * FROM gateways WHERE id = $1", [cob.gateway_id]));
  });

  app.post("/api/v1/conversas/:id/reunioes", async (req) => {
    const c = await conversaDoUsuario(req, (req.params as any).id);
    const b = z.object({ vendedor_id: z.string().uuid(), inicio: z.string().datetime({ offset: true }), duracao_min: z.number().int().min(10).max(240).default(30), formato: z.enum(["meet", "ligacao", "presencial"]).default("meet") }).parse(req.body);
    const ini = new Date(b.inicio), fim = new Date(ini.getTime() + b.duracao_min * 60000);
    const resumo = [`Cliente: ${c.contato_nome ?? ""} · WhatsApp: +${c.telefone}`, `Cidade de interesse: ${c.dados_extraidos?.cidade ?? c.cidade ?? "-"}`, `Interesse: ${c.interesse ?? "-"} (nota ${c.nota ?? "-"}, ${c.temperatura ?? "-"})`, `Resumo: ${c.resumo_ia ?? "-"}`, `Gatilhos: ${c.motivo_classificacao ?? "-"}`, `Conversa: ${(process.env.APP_URL ?? "") + "/atendimento/" + c.id}`].join("\n");
    const r = await q1<any>("INSERT INTO reunioes (conta_id, conversa_id, vendedor_id, inicio, fim, formato, resumo) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *", [c.conta_id, c.id, b.vendedor_id, ini, fim, b.formato, resumo]);
    await filas.integracoes.add("agenda", { contaId: c.conta_id, reuniaoId: r.id });
    await aplicarEtiquetas(c.id, ["Reunião marcada"]);
    await inserirMensagem({ contaId: c.conta_id, conversaId: c.id, autor: "sistema", tipo: "evento", conteudo: `Reunião marcada para ${ini.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}.` });
    await emitirConversa(c.id);
    return r;
  });
}

async function emitirCobranca(cobId: string, c: any, g: any) {
  try {
    const gw = criarGateway(g.tipo, decifrar(g.chave), g.ambiente === "producao" ? "producao" : "teste");
    const cob = await q1<any>("SELECT * FROM cobrancas WHERE id = $1", [cobId]);
    const r = await gw.criarCobranca({ valor: Number(cob.valor), descricao: cob.descricao, forma: cob.forma, cliente: { nome: c.contato_nome ?? "Cliente", telefone: c.telefone }, referencia: cob.id });
    const atual = await q1<any>("UPDATE cobrancas SET id_externo = $2, link = $3, pix_copia_cola = $4 WHERE id = $1 RETURNING *", [cobId, r.idExterno, r.link ?? null, r.pixCopiaCola ?? null]);
    const texto = [`Segue o link para pagamento de ${cob.descricao} (R$ ${Number(cob.valor).toFixed(2).replace(".", ",")}):`, r.link, r.pixCopiaCola ? `Pix copia e cola:\n${r.pixCopiaCola}` : null].filter(Boolean).join("\n");
    await enviarComoHumano(c.id, texto, null, "ia");
    await aplicarEtiquetas(c.id, ["Aguardando pagamento"]);
    await publicar(c.conta_id, "conversa.atualizada", await conversaCompleta(c.id));
    return atual;
  } catch (e) {
    await q("UPDATE cobrancas SET status = 'falhou' WHERE id = $1", [cobId]);
    throw new ErroHttp(502, `Gateway recusou a cobrança: ${(e as Error).message}`);
  }
}
