import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { q, q1 } from "@domma/db";
import { autenticar } from "../app.ts";

export async function rotasAuth(app: FastifyInstance) {
  app.post("/api/v1/auth/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { email, senha } = z.object({ email: z.string().email(), senha: z.string().min(1) }).parse(req.body);
    const u = await q1<any>("SELECT * FROM usuarios WHERE lower(email) = lower($1)", [email]);
    if (!u || !(await bcrypt.compare(senha, u.senha_hash))) return reply.code(401).send({ erro: "e-mail ou senha incorretos" });
    await q("UPDATE usuarios SET status = 'online' WHERE id = $1", [u.id]);
    const token = app.jwt.sign({ sub: u.id, conta: u.conta_id, perfil: u.perfil, nome: u.nome });
    return { token, usuario: { id: u.id, nome: u.nome, email: u.email, perfil: u.perfil, contaId: u.conta_id } };
  });

  app.get("/api/v1/auth/eu", { preHandler: autenticar }, async (req) => {
    const u = await q1<any>("SELECT u.id, u.nome, u.email, u.perfil, u.status, u.filas, c.nome AS conta_nome, c.id AS conta_id FROM usuarios u JOIN contas c ON c.id = u.conta_id WHERE u.id = $1", [req.usuario.id]);
    return { ...u, vapidPublica: process.env.VAPID_PUBLIC_KEY ?? null };
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
