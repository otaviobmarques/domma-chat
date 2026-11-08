import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";

export interface Usuario { id: string; contaId: string; perfil: "admin" | "supervisor" | "atendente"; nome: string; plataforma: boolean }

declare module "fastify" {
  interface FastifyRequest { rawBody?: Buffer; usuario: Usuario }
}
declare module "@fastify/jwt" {
  interface FastifyJWT { payload: { sub: string; conta: string; perfil: Usuario["perfil"]; nome: string; plat?: boolean } }
}

export async function criarApp() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, bodyLimit: 25 * 1024 * 1024, trustProxy: true });
  await app.register(cors, { origin: process.env.APP_URL ? [process.env.APP_URL] : true, credentials: true });
  await app.register(jwt, { secret: process.env.JWT_SECRET ?? "dev-secret", sign: { expiresIn: "12h" } });
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });
  await app.register(rateLimit, { max: 600, timeWindow: "1 minute" });

  // Corpo bruto guardado para validar assinaturas de webhook (Meta, Stripe, Mercado Pago).
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
    (req as FastifyRequest).rawBody = body as Buffer;
    if (!(body as Buffer).length) return done(null, {});
    try { done(null, JSON.parse((body as Buffer).toString("utf8"))); } catch (e) { done(e as Error, undefined); }
  });

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ erro: "dados inválidos", detalhes: err.issues });
    const status = (err as any).statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    reply.code(status).send({ erro: status >= 500 ? "erro interno" : err.message });
  });
  return app;
}

/** Autenticação por JWT e filtro pela conta do usuário (seção 8). */
export async function autenticar(req: FastifyRequest, reply: FastifyReply) {
  try {
    const p = await req.jwtVerify<{ sub: string; conta: string; perfil: Usuario["perfil"]; nome: string; plat?: boolean }>();
    req.usuario = { id: p.sub, contaId: p.conta, perfil: p.perfil, nome: p.nome, plataforma: !!p.plat };
  } catch {
    return reply.code(401).send({ erro: "faça login novamente" });
  }
}

export function exigirPerfil(...perfis: Usuario["perfil"][]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!perfis.includes(req.usuario.perfil)) return reply.code(403).send({ erro: "seu perfil não tem permissão para isso" });
  };
}

/** Só o administrador da plataforma Domma (SaaS): infraestrutura e todos os clientes. */
export async function exigirPlataforma(req: FastifyRequest, reply: FastifyReply) {
  // Confere no banco a cada acesso: vale para sessões antigas e para permissões retiradas.
  const { q1 } = await import("@domma/db");
  const u = await q1<{ admin_plataforma: boolean }>("SELECT admin_plataforma FROM usuarios WHERE id = $1", [req.usuario?.id]);
  if (!u?.admin_plataforma) return reply.code(403).send({ erro: "área exclusiva do administrador da plataforma" });
  req.usuario.plataforma = true;
}

export class ErroHttp extends Error { constructor(public statusCode: number, msg: string) { super(msg); } }
export const naoEncontrado = (o = "registro") => new ErroHttp(404, `${o} não encontrado`);
