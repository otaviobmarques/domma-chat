import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { auditar, q, q1, tx } from "@domma/db";
import { verificarSaude } from "@domma/core";
import { tokenAleatorio } from "@domma/shared";
import { autenticar, exigirPerfil, exigirPlataforma, ErroHttp } from "../app.ts";

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
    SELECT c.id, c.nome, c.plano, c.ativa, c.criado_em,
           (SELECT count(*)::int FROM usuarios u WHERE u.conta_id = c.id) AS usuarios,
           (SELECT count(*)::int FROM conexoes x WHERE x.conta_id = c.id AND x.tipo <> 'simulador') AS numeros,
           (SELECT count(*)::int FROM conexoes x WHERE x.conta_id = c.id AND x.tipo <> 'simulador' AND x.status = 'conectada') AS numeros_ok,
           (SELECT count(*)::int FROM conversas v WHERE v.conta_id = c.id AND v.ultima_mensagem_em > now() - interval '30 days') AS conversas_30d,
           (SELECT COALESCE(sum(custo),0)::float FROM uso_ia i WHERE i.conta_id = c.id AND i.criado_em > date_trunc('month', now())) AS custo_ia_mes,
           (SELECT max(m.criado_em) FROM mensagens m WHERE m.conta_id = c.id) AS ultima_atividade
      FROM contas c ORDER BY (c.plano = 'plataforma') DESC, c.criado_em`));

  app.post("/api/v1/plataforma/contas", { preHandler: exigirPlataforma }, async (req) => {
    const b = z.object({ nome: z.string().min(2), plano: z.string().default("padrao"), admin_nome: z.string().min(2), admin_email: z.string().email(), admin_senha: z.string().min(8) }).parse(req.body);
    const conta = await tx(async (c) => {
      const conta = await q1<any>("INSERT INTO contas (nome, plano, token_leads) VALUES ($1,$2,$3) RETURNING id, nome, plano", [b.nome, b.plano, tokenAleatorio("dmc_live_")], c);
      for (const f of ["Vendas", "Suporte", "Financeiro"]) await q("INSERT INTO filas (conta_id, nome) VALUES ($1,$2)", [conta.id, f], c);
      await q("INSERT INTO usuarios (conta_id, nome, email, senha_hash, perfil) VALUES ($1,$2,$3,$4,'admin')", [conta.id, b.admin_nome, b.admin_email.toLowerCase(), await bcrypt.hash(b.admin_senha, 10)], c)
        .catch((e) => { if (e.code === "23505") throw new ErroHttp(409, "e-mail já cadastrado"); throw e; });
      await q("INSERT INTO agentes_ia (conta_id, modo_padrao) VALUES ($1,'aprova')", [conta.id], c);
      await q("INSERT INTO provedores_ia (conta_id, provedor, rotulo, modelo, ordem) VALUES ($1,'simulado','Simulado (testes)','regras',0)", [conta.id], c);
      await q("INSERT INTO conexoes (conta_id, tipo, nome, status, modo_padrao) VALUES ($1,'simulador','Simulador (testes)','conectada','aprova')", [conta.id], c);
      return conta;
    });
    await auditar(req.usuario.contaId, "usuario", "plataforma:criar_conta", conta.id, { nome: b.nome, admin: b.admin_email }, req.usuario.id);
    return conta;
  });

  /** Suporte: o administrador da plataforma entra na conta do cliente (como administrador dela). Fica na auditoria das duas contas. */
  app.post("/api/v1/plataforma/contas/:id/entrar", { preHandler: exigirPlataforma }, async (req) => {
    const conta = await q1<any>("SELECT id, nome FROM contas WHERE id = $1", [(req.params as any).id]);
    if (!conta) throw new ErroHttp(404, "cliente não encontrado");
    await auditar(req.usuario.contaId, "usuario", "plataforma:entrar_como", conta.id, { cliente: conta.nome }, req.usuario.id);
    await auditar(conta.id, "usuario", "suporte_domma:acesso", conta.id, { por: req.usuario.nome }, req.usuario.id);
    const token = app.jwt.sign({ sub: req.usuario.id, conta: conta.id, perfil: "admin", nome: `${req.usuario.nome} (suporte Domma)`, plat: true }, { expiresIn: "2h" });
    return { token, conta };
  });

  app.patch("/api/v1/plataforma/contas/:id", { preHandler: exigirPlataforma }, async (req) => {
    const b = z.object({ nome: z.string().optional(), plano: z.string().optional(), ativa: z.boolean().optional() }).parse(req.body);
    if (b.ativa === false && (req.params as any).id === req.usuario.contaId) throw new ErroHttp(400, "você não pode suspender a sua própria conta");
    const r = await q1("UPDATE contas SET nome = COALESCE($2, nome), plano = COALESCE($3, plano), ativa = COALESCE($4, ativa) WHERE id = $1 RETURNING id, nome, plano, ativa", [(req.params as any).id, b.nome ?? null, b.plano ?? null, b.ativa ?? null]);
    await auditar(req.usuario.contaId, "usuario", "plataforma:editar_conta", (req.params as any).id, b, req.usuario.id);
    return r;
  });
}
