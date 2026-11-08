import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { q, q1 } from "@domma/db";
import { autenticar } from "../app.ts";

export async function rotasAuth(app: FastifyInstance) {
  app.post("/api/v1/auth/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { email, senha } = z.object({ email: z.string().trim().min(1), senha: z.string().min(1) }).parse(req.body);
    const u = await q1<any>("SELECT * FROM usuarios WHERE lower(email) = lower($1) OR lower(login) = lower($1)", [email]);
    if (!u || !(await bcrypt.compare(senha, u.senha_hash))) return reply.code(401).send({ erro: "usuário ou senha incorretos" });
    await q("UPDATE usuarios SET status = 'online' WHERE id = $1", [u.id]);
    const conta = await q1<{ ativa: boolean; bloqueio_motivo: string | null }>("SELECT ativa, bloqueio_motivo FROM contas WHERE id = $1", [u.conta_id]);
    if (!conta?.ativa && !u.admin_plataforma) return reply.code(403).send({ erro: `Acesso bloqueado${conta?.bloqueio_motivo ? `: ${conta.bloqueio_motivo}` : ""}. Fale com a Domma Tecnologia.` });
    const token = app.jwt.sign({ sub: u.id, conta: u.conta_id, perfil: u.perfil, nome: u.nome, plat: !!u.admin_plataforma });
    return { token, usuario: { id: u.id, nome: u.nome, email: u.email, perfil: u.perfil, contaId: u.conta_id, plataforma: !!u.admin_plataforma } };
  });

  app.get("/api/v1/auth/eu", { preHandler: autenticar }, async (req, reply) => {
    const u = await q1<any>("SELECT u.id, u.nome, u.email, u.perfil, u.status, u.filas, u.admin_plataforma, u.conta_id AS conta_origem FROM usuarios u WHERE u.id = $1", [req.usuario.id]);
    const c = await q1<any>("SELECT id, nome FROM contas WHERE id = $1", [req.usuario.contaId]);
    const suporte = u?.conta_origem !== req.usuario.contaId;
    // Sessão de antes de o usuário mudar de conta (e não é acesso de suporte): pede login de novo.
    if (!u || (suporte && !(req.usuario.plataforma && u.admin_plataforma))) return reply.code(401).send({ erro: "sua sessão expirou, entre de novo" });
    return { ...u, perfil: req.usuario.perfil, nome: req.usuario.nome, conta_id: c?.id, conta_nome: c?.nome, suporte, vapidPublica: process.env.VAPID_PUBLIC_KEY ?? null };
  });

  app.patch("/api/v1/auth/status", { preHandler: autenticar }, async (req) => {
    const { status } = z.object({ status: z.enum(["online", "ausente", "offline"]) }).parse(req.body);
    await q("UPDATE usuarios SET status = $2 WHERE id = $1", [req.usuario.id, status]);
    return { status };
  });

  app.post("/api/v1/auth/push", { preHandler: autenticar }, async (req) => {
    const sub = z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) }).parse(req.body);
    await q(`UPDATE usuarios SET push_inscricoes = (SELECT jsonb_agg(x) FROM (SELECT DISTINCT ON (x->>'endpoint') x FROM jsonb_array_elements(push_inscricoes || $2::jsonb) x) s) WHERE id = $1`, [req.usuario.id, JSON.stringify([sub])]);
    return { ok: true };
  });
}
