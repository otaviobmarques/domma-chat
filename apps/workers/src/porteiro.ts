import { redis } from "@domma/core";
import { similaridade, normalizarTexto } from "@domma/shared";

/**
 * Contadores anti-loop no Redis (seção 2.13). Quem decide SE a IA responde é o sistema.
 */
export async function registrarMensagemCliente(conversaId: string, texto: string, janelaMin: number) {
  const chave = `ultimas:${conversaId}`;
  const n = normalizarTexto(texto);
  if (!n) return 0;
  const anteriores = await redis.lrange(chave, 0, 20);
  await redis.multi().lpush(chave, `${Date.now()}|${n}`).ltrim(chave, 0, 20).pexpire(chave, janelaMin * 60000).exec();
  const limite = Date.now() - janelaMin * 60000;
  return 1 + anteriores.filter((x) => { const [ts, t] = [Number(x.split("|")[0]), x.slice(x.indexOf("|") + 1)]; return ts > limite && similaridade(t, n) > 0.85; }).length;
}

/** Conta respostas da IA: 10 minutos e dia. Devolve true se passou do limite. */
export async function excedeuRespostas(conversaId: string, max10: number, maxDia: number) {
  const k10 = `resp10:${conversaId}`, kd = `respdia:${conversaId}:${new Date().toISOString().slice(0, 10)}`;
  const r = await redis.multi().incr(k10).pexpire(k10, 600000, "NX").incr(kd).expire(kd, 90000).exec();
  const n10 = Number(r?.[0]?.[1] ?? 0), nd = Number(r?.[2]?.[1] ?? 0);
  return { excedeu: n10 > max10 || nd > maxDia, n10, nd };
}

/** Robô do outro lado: respostas do cliente em menos de X ms após a IA, 3 vezes seguidas. */
export async function suspeitaRobo(conversaId: string, msDesdeIA: number | null, textoCliente: string, limiteMs: number) {
  const k = `robo:${conversaId}`;
  const automatico = /\b(mensagem automatica|resposta automatica|nao responda|digite \d|opcao invalida|menu principal)\b/.test(normalizarTexto(textoCliente));
  if ((msDesdeIA !== null && msDesdeIA < limiteMs) || automatico) {
    const n = await redis.incr(k); await redis.expire(k, 1800);
    return n >= 3 || (automatico && n >= 2);
  }
  await redis.del(k);
  return false;
}

export async function marcarRespostaIA(conversaId: string) { await redis.set(`ultimaia:${conversaId}`, Date.now(), "EX", 3600); }
export async function msDesdeUltimaIA(conversaId: string) { const v = await redis.get(`ultimaia:${conversaId}`); return v ? Date.now() - Number(v) : null; }
