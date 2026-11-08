import * as webpush from "web-push";
import { q, q1 } from "@domma/db";
import { publicar } from "./redis.ts";

const vapidOk = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
if (vapidOk) webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:suporte@domma.com.br", process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);

/** Push do PWA (Web Push/VAPID) para um ou mais usuários. Sem VAPID configurado, só registra. */
export async function notificar(usuarioIds: string[], titulo: string, corpo: string, url = "/") {
  if (!usuarioIds.length) return;
  const us = await q<{ id: string; push_inscricoes: any[] }>("SELECT id, push_inscricoes FROM usuarios WHERE id = ANY($1)", [usuarioIds]);
  for (const u of us) {
    if (!vapidOk) continue;
    const validas: any[] = [];
    for (const sub of u.push_inscricoes ?? []) {
      try { await webpush.sendNotification(sub, JSON.stringify({ titulo, corpo, url })); validas.push(sub); }
      catch (e: any) { if (![404, 410].includes(e?.statusCode)) validas.push(sub); }
    }
    if (validas.length !== (u.push_inscricoes ?? []).length) await q("UPDATE usuarios SET push_inscricoes = $2 WHERE id = $1", [u.id, JSON.stringify(validas)]);
  }
}

export async function notificarGestores(contaId: string, titulo: string, corpo: string, url = "/") {
  const ids = (await q<{ id: string }>("SELECT id FROM usuarios WHERE conta_id = $1 AND perfil IN ('admin','supervisor')", [contaId])).map((r) => r.id);
  return notificar(ids, titulo, corpo, url);
}

/** Alertas priorizados do Dashboard (seção 2.1). A chave evita duplicar um alerta já aberto. */
export async function criarAlerta(contaId: string, a: { nivel: "urgente" | "atencao" | "info"; tipo: string; titulo: string; detalhe?: string; chave?: string; alvo?: unknown; push?: boolean }) {
  const r = await q1(
    `INSERT INTO alertas (conta_id, nivel, tipo, titulo, detalhe, chave, alvo) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (conta_id, chave) WHERE resolvido_em IS NULL AND chave IS NOT NULL DO UPDATE SET detalhe = EXCLUDED.detalhe
     RETURNING *, (xmax = 0) AS novo`,
    [contaId, a.nivel, a.tipo, a.titulo, a.detalhe ?? null, a.chave ?? null, a.alvo ? JSON.stringify(a.alvo) : null]);
  if (r?.novo) {
    await publicar(contaId, "alerta.novo", r);
    if (a.push) await notificarGestores(contaId, a.titulo, a.detalhe ?? "");
  }
  return r;
}

export async function resolverAlerta(contaId: string, chave: string) {
  const rs = await q("UPDATE alertas SET resolvido_em = now() WHERE conta_id = $1 AND chave = $2 AND resolvido_em IS NULL RETURNING id", [contaId, chave]);
  if (rs.length) await publicar(contaId, "alerta.novo", { resolvido: chave });
}
