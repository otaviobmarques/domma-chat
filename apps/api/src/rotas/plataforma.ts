import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { auditar, q, q1, tx } from "@domma/db";
import { verificarSaude } from "@domma/core";
import { tokenAleatorio } from "@domma/shared";
import { autenticar, exigirPerfil, exigirPlataforma, ErroHttp } from "../app.ts";

const nulo = <T extends z.ZodTypeAny>(t: T) => z.preprocess((v) => (v === "" || v === undefined ? null : v), t.nullable());
const Ficha = z.object({
  nome: z.string().min(2).optional(),
  plano: z.string().min(1).optional(),
  razao_social: nulo(z.string()), cnpj: nulo(z.string()),
  responsavel_nome: nulo(z.string()), responsavel_email: nulo(z.string().email()), responsavel_telefone: nulo(z.string()),
  cidade: nulo(z.string()), uf: nulo(z.string().max(2)), observacoes: nulo(z.string()),
  limite_usuarios: nulo(z.coerce.number().int().min(1)), limite_numeros: nulo(z.coerce.number().int().min(0)), limite_ia_mensal: nulo(z.coerce.number().min(0)),
  inicio_contrato: nulo(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)), vencimento: nulo(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
}).partial();
const CAMPOS = ["razao_social", "cnpj", "responsavel_nome", "responsavel_email", "responsavel_telefone", "cidade", "uf", "observacoes", "limite_usuarios", "limite_numeros", "limite_ia_mensal", "inicio_contrato", "vencimento"] as const;

async function contaDoCliente(id: string) {
  const c = await q1<any>("SELECT * FROM contas WHERE id = $1", [id]);
  if (!c) throw new ErroHttp(404, "cliente não encontrado");
  return c;
}

export async function rotasPlataforma(app: FastifyInstance) {
  app.addHook("preHandler", autenticar);

  /** Saúde da operação do cliente: números, IAs, pagamentos, leads. Administrador e supervisor da conta. */
  app.get("/api/v1/saude", { preHandler: exigirPerfil("admin", "supervisor") }, async (req) =>
    verificarSaude(req.usuario.contaId, { escopo: "cliente", forcar: (req.query as any).forcar === "1" }));

  /** Saúde da plataforma: Railway, Supabase, Redis, filas, domínios, DNS, SSL, Evolution, fornecedores. */
  app.get("/api/v1/plataforma/saude", { preHandler: exigirPlataforma }, async (req) =>
    verificarSaude(req.usuario.contaId, { escopo: "plataforma", forcar: (req.query as any).forcar === "1" }));

  /** Clientes (contas) do SaaS. */
  app.get("/api/v1/plataforma/contas", { preHandler: exigirPlataforma }, async () => q(`
    SELECT c.id, c.nome, c.plano, c.ativa, c.criado_em, c.razao_social, c.cnpj, c.responsavel_nome, c.cidade, c.uf, c.vencimento, c.bloqueio_motivo,
           c.limite_usuarios, c.limite_numeros, c.limite_ia_mensal,
           (SELECT count(*)::int FROM usuarios u WHERE u.conta_id = c.id) AS usuarios,
           (SELECT count(*)::int FROM conexoes x WHERE x.conta_id = c.id AND x.tipo <> 'simulador') AS numeros,
           (SELECT count(*)::int FROM conexoes x WHERE x.conta_id = c.id AND x.tipo <> 'simulador' AND x.status = 'conectada') AS numeros_ok,
           (SELECT count(*)::int FROM conversas v WHERE v.conta_id = c.id AND v.ultima_mensagem_em > now() - interval '30 days') AS conversas_30d,
           (SELECT COALESCE(sum(custo),0)::float FROM uso_ia i WHERE i.conta_id = c.id AND i.criado_em > date_trunc('month', now())) AS custo_ia_mes,
           (SELECT max(m.criado_em) FROM mensagens m WHERE m.conta_id = c.id) AS ultima_atividade
      FROM contas c ORDER BY (c.plano = 'plataforma') DESC, c.criado_em`));

  /** Ficha completa do cliente, com a equipe. */
  app.get("/api/v1/plataforma/contas/:id", { preHandler: exigirPlataforma }, async (req) => {
    const c = await contaDoCliente((req.params as any).id);
    const usuarios = await q("SELECT id, nome, email, login, perfil, status, criado_em FROM usuarios WHERE conta_id = $1 ORDER BY perfil, nome", [c.id]);
    const historico = await q("SELECT e.acao, e.dados, e.criado_em, u.nome AS usuario FROM eventos_auditoria e LEFT JOIN usuarios u ON u.id = e.usuario_id WHERE e.alvo = $1 AND e.acao LIKE 'plataforma:%' ORDER BY e.criado_em DESC LIMIT 20", [c.id]);
    return { ...c, token_leads: undefined, config: undefined, usuarios, historico };
  });

  app.post("/api/v1/plataforma/contas", { preHandler: exigirPlataforma }, async (req) => {
    const base = z.object({ nome: z.string().min(2), plano: z.string().default("padrao"), admin_nome: z.string().min(2), admin_email: z.string().email(), admin_senha: z.string().min(8) }).parse(req.body);
    const ficha = Ficha.parse(req.body);
    const conta = await tx(async (c) => {
      const conta = await q1<any>("INSERT INTO contas (nome, plano, token_leads) VALUES ($1,$2,$3) RETURNING id, nome, plano", [base.nome, base.plano, tokenAleatorio("dmc_live_")], c);
      const sets = CAMPOS.filter((k) => ficha[k] !== undefined);
      if (sets.length) await q(`UPDATE contas SET ${sets.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE id = $1`, [conta.id, ...sets.map((k) => ficha[k])], c);
      for (const f of ["Vendas", "Suporte", "Financeiro"]) await q("INSERT INTO filas (conta_id, nome) VALUES ($1,$2)", [conta.id, f], c);
      await q("INSERT INTO usuarios (conta_id, nome, email, senha_hash, perfil) VALUES ($1,$2,$3,$4,'admin')", [conta.id, base.admin_nome, base.admin_email.toLowerCase(), await bcrypt.hash(base.admin_senha, 10)], c)
        .catch((e) => { if (e.code === "23505") throw new ErroHttp(409, "e-mail já cadastrado"); throw e; });
      await q("INSERT INTO agentes_ia (conta_id, modo_padrao) VALUES ($1,'aprova')", [conta.id], c);
      await q("INSERT INTO provedores_ia (conta_id, provedor, rotulo, modelo, ordem) VALUES ($1,'simulado','Simulado (testes)','regras',0)", [conta.id], c);
      await q("INSERT INTO conexoes (conta_id, tipo, nome, status, modo_padrao) VALUES ($1,'simulador','Simulador (testes)','conectada','aprova')", [conta.id], c);
      return conta;
    });
    await auditar(req.usuario.contaId, "usuario", "plataforma:criar_conta", conta.id, { nome: base.nome, admin: base.admin_email }, req.usuario.id);
    return conta;
  });

  /** Editar dados cadastrais, plano e limites. */
  app.patch("/api/v1/plataforma/contas/:id", { preHandler: exigirPlataforma }, async (req) => {
    const c = await contaDoCliente((req.params as any).id);
    const b = Ficha.parse(req.body);
    const campos = (["nome", "plano", ...CAMPOS] as const).filter((k) => (b as any)[k] !== undefined);
    if (!campos.length) return c;
    const r = await q1(`UPDATE contas SET ${campos.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE id = $1 RETURNING id`, [c.id, ...campos.map((k) => (b as any)[k])]);
    await auditar(req.usuario.contaId, "usuario", "plataforma:editar_conta", c.id, Object.fromEntries(campos.map((k) => [k, (b as any)[k]])), req.usuario.id);
    return r;
  });

  /** Bloquear (com motivo) e reativar. */
  app.post("/api/v1/plataforma/contas/:id/bloquear", { preHandler: exigirPlataforma }, async (req) => {
    const c = await contaDoCliente((req.params as any).id);
    if (c.plano === "plataforma") throw new ErroHttp(400, "a conta da plataforma não pode ser bloqueada");
    const { motivo } = z.object({ motivo: z.string().min(3) }).parse(req.body);
    await q("UPDATE contas SET ativa = false, bloqueio_motivo = $2, bloqueado_em = now() WHERE id = $1", [c.id, motivo]);
    await auditar(req.usuario.contaId, "usuario", "plataforma:bloquear", c.id, { motivo }, req.usuario.id);
    return { ok: true };
  });
  app.post("/api/v1/plataforma/contas/:id/reativar", { preHandler: exigirPlataforma }, async (req) => {
    const c = await contaDoCliente((req.params as any).id);
    await q("UPDATE contas SET ativa = true, bloqueio_motivo = NULL, bloqueado_em = NULL WHERE id = $1", [c.id]);
    await auditar(req.usuario.contaId, "usuario", "plataforma:reativar", c.id, null, req.usuario.id);
    return { ok: true };
  });

  /** Excluir o cliente e TODOS os dados dele (conversas, contatos, mensagens, configurações). Exige digitar o nome. */
  app.delete("/api/v1/plataforma/contas/:id", { preHandler: exigirPlataforma }, async (req) => {
    const c = await contaDoCliente((req.params as any).id);
    if (c.plano === "plataforma" || c.id === req.usuario.contaId) throw new ErroHttp(400, "a conta da plataforma não pode ser excluída");
    const { confirmacao } = z.object({ confirmacao: z.string() }).parse(req.body);
    if (confirmacao.trim().toLowerCase() !== String(c.nome).trim().toLowerCase()) throw new ErroHttp(400, "o nome digitado não confere");
    const resumo = await q1("SELECT (SELECT count(*) FROM contatos WHERE conta_id = $1)::int AS contatos, (SELECT count(*) FROM mensagens WHERE conta_id = $1)::int AS mensagens", [c.id]);
    await q("DELETE FROM contas WHERE id = $1", [c.id]);
    await auditar(req.usuario.contaId, "usuario", "plataforma:excluir_conta", c.id, { nome: c.nome, ...resumo }, req.usuario.id);
    return { ok: true, excluido: c.nome, ...resumo };
  });

  /** Redefinir a senha de um usuário do cliente (suporte). */
  app.post("/api/v1/plataforma/contas/:id/usuarios/:uid/senha", { preHandler: exigirPlataforma }, async (req) => {
    const { id, uid } = req.params as any;
    const { senha } = z.object({ senha: z.string().min(8) }).parse(req.body);
    const u = await q1<any>("UPDATE usuarios SET senha_hash = $3 WHERE id = $2 AND conta_id = $1 RETURNING nome, email", [id, uid, await bcrypt.hash(senha, 10)]);
    if (!u) throw new ErroHttp(404, "usuário não encontrado");
    await auditar(req.usuario.contaId, "usuario", "plataforma:redefinir_senha", id, { usuario: u.email }, req.usuario.id);
    return { ok: true };
  });

  /** Suporte: o administrador da plataforma entra na conta do cliente (como administrador dela). Fica na auditoria das duas contas. */
  app.post("/api/v1/plataforma/contas/:id/entrar", { preHandler: exigirPlataforma }, async (req) => {
    const conta = await contaDoCliente((req.params as any).id);
    await auditar(req.usuario.contaId, "usuario", "plataforma:entrar_como", conta.id, { cliente: conta.nome }, req.usuario.id);
    await auditar(conta.id, "usuario", "suporte_domma:acesso", conta.id, { por: req.usuario.nome }, req.usuario.id);
    const token = app.jwt.sign({ sub: req.usuario.id, conta: conta.id, perfil: "admin", nome: `${req.usuario.nome} (suporte Domma)`, plat: true }, { expiresIn: "2h" });
    return { token, conta: { id: conta.id, nome: conta.nome } };
  });
}

/** Limites do plano: chamado antes de criar usuário ou conexão. */
export async function conferirLimite(contaId: string, tipo: "usuarios" | "numeros") {
  const c = await q1<any>(`SELECT limite_usuarios, limite_numeros,
      (SELECT count(*)::int FROM usuarios WHERE conta_id = $1) AS usuarios,
      (SELECT count(*)::int FROM conexoes WHERE conta_id = $1 AND tipo <> 'simulador') AS numeros FROM contas WHERE id = $1`, [contaId]);
  const limite = tipo === "usuarios" ? c?.limite_usuarios : c?.limite_numeros;
  if (limite != null && c[tipo] >= limite) throw new ErroHttp(403, `Seu plano permite até ${limite} ${tipo === "usuarios" ? "usuários" : "números de WhatsApp"}. Fale com a Domma para ampliar.`);
}
