import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Redis } from "ioredis";
import { Server } from "socket.io";
import fastifyStatic from "@fastify/static";
import { migrar } from "@domma/db/migrate";
import { CANAL_EVENTOS, type EnvelopeEvento } from "@domma/shared";
import { criarApp } from "./app.ts";
import { rotasAuth } from "./rotas/auth.ts";
import { rotasConfig } from "./rotas/config.ts";
import { rotasConversas } from "./rotas/conversas.ts";
import { rotasPaineis } from "./rotas/paineis.ts";
import { rotasWebhooks } from "./rotas/webhooks.ts";
import { rotasPlataforma } from "./rotas/plataforma.ts";

await migrar();
const app = await criarApp();

app.get("/saude", async () => ({ ok: true, em: new Date().toISOString() }));
await app.register(rotasWebhooks);
await app.register(rotasAuth);
await app.register(rotasConfig);
await app.register(rotasConversas);
await app.register(rotasPaineis);
await app.register(rotasPlataforma);

// Em produção a API também pode servir o painel já compilado (apps/web/dist).
const web = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "web", "dist");
if (existsSync(web)) {
  await app.register(fastifyStatic, { root: web, wildcard: false });
  app.setNotFoundHandler((req, reply) => (req.url.startsWith("/api") || req.url.startsWith("/webhooks") ? reply.code(404).send({ erro: "rota não encontrada" }) : reply.sendFile("index.html")));
}

const porta = Number(process.env.PORT ?? 3333);
await app.listen({ port: porta, host: "0.0.0.0" });

/** Tempo real (seção 8.1): canal por conta e por usuário; eventos chegam dos workers pelo Redis. */
const io = new Server(app.server, { path: "/tempo-real", cors: { origin: process.env.APP_URL ?? true } });
io.use(async (socket, next) => {
  try {
    const p: any = app.jwt.verify(String(socket.handshake.auth?.token ?? ""));
    socket.data.usuario = p;
    socket.join(`conta:${p.conta}`); socket.join(`usuario:${p.sub}`);
    next();
  } catch { next(new Error("não autorizado")); }
});
const sub = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
await sub.subscribe(CANAL_EVENTOS);
sub.on("message", (_c, raw) => {
  const e: EnvelopeEvento = JSON.parse(raw);
  io.to(e.usuarioId ? `usuario:${e.usuarioId}` : `conta:${e.contaId}`).emit(e.evento, e.dados);
});

const parar = async () => { io.close(); await app.close(); process.exit(0); };
process.on("SIGTERM", parar);
process.on("SIGINT", parar);
