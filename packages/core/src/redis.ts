import { Redis } from "ioredis";
import { CANAL_EVENTOS, type EnvelopeEvento, type NomeEvento } from "@domma/shared";

const url = process.env.REDIS_URL ?? "redis://localhost:6379";
/** Conexão para BullMQ (exige maxRetriesPerRequest: null). */
export const conexaoFilas = () => new Redis(url, { maxRetriesPerRequest: null });
/** Conexão geral: travas, contadores anti-loop, cache e publicação de eventos. */
export const redis = new Redis(url, { maxRetriesPerRequest: 3, keyPrefix: "dc:" });
const pub = new Redis(url);

export function publicar(contaId: string, evento: NomeEvento, dados: unknown, usuarioId?: string) {
  const env: EnvelopeEvento = { contaId, evento, dados, usuarioId };
  return pub.publish(CANAL_EVENTOS, JSON.stringify(env));
}

/** Trava por conversa: garante ordem (seção 7.2). */
export async function obterTrava(chave: string, ms = 30000): Promise<string | null> {
  const token = Math.random().toString(36).slice(2);
  return (await redis.set(`lock:${chave}`, token, "PX", ms, "NX")) ? token : null;
}
export async function liberarTrava(chave: string, token: string) {
  await redis.eval(`if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`, 1, `lock:${chave}`, token)
    .catch(() => {});
}
