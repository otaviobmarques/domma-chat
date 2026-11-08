import type { Job } from "bullmq";
import { q, q1 } from "@domma/db";
import { inserirMensagem } from "@domma/core";
import { decifrar } from "@domma/shared";

/** Google Agenda (seção 6.4): cria o evento com Google Meet e o resumo da conversa na descrição. */
export async function processarIntegracao(job: Job) {
  if (job.name !== "agenda") return "ignorado";
  const r = await q1<any>(`SELECT r.*, u.nome AS vendedor, u.email AS vendedor_email, u.google_refresh_token, ct.nome AS cliente
                             FROM reunioes r LEFT JOIN usuarios u ON u.id = r.vendedor_id JOIN conversas cv ON cv.id = r.conversa_id JOIN contatos ct ON ct.id = cv.contato_id WHERE r.id = $1`, [job.data.reuniaoId]);
  if (!r) return "sem-reuniao";
  if (!r.google_refresh_token || !process.env.GOOGLE_CLIENT_ID) {
    await inserirMensagem({ contaId: r.conta_id, conversaId: r.conversa_id, autor: "nota", conteudo: `Reunião registrada no Domma Chat. O Google Agenda de ${r.vendedor ?? "vendedor"} ainda não está conectado: crie o evento manualmente.\n\n${r.resumo}` });
    return "sem-google";
  }
  const tok: any = await (await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, refresh_token: decifrar(r.google_refresh_token), grant_type: "refresh_token" }) })).json();
  if (!tok.access_token) throw new Error("Google: não foi possível renovar o acesso do vendedor");
  const ev = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1", {
    method: "POST", headers: { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: `Domma Chat · ${r.cliente ?? "Cliente"}`, description: r.resumo,
      start: { dateTime: new Date(r.inicio).toISOString() }, end: { dateTime: new Date(r.fim).toISOString() },
      ...(r.formato === "meet" ? { conferenceData: { createRequest: { requestId: r.id, conferenceSolutionKey: { type: "hangoutsMeet" } } } } : {}),
      reminders: { useDefault: true },
    }),
  });
  const j: any = await ev.json();
  if (!ev.ok) throw new Error(`Google Agenda ${ev.status}: ${j?.error?.message ?? ""}`);
  await q("UPDATE reunioes SET id_evento_google = $2 WHERE id = $1", [r.id, j.id]);
  await inserirMensagem({ contaId: r.conta_id, conversaId: r.conversa_id, autor: "nota", conteudo: `Evento criado na agenda de ${r.vendedor}.${j.hangoutLink ? " Meet: " + j.hangoutLink : ""}` });
  return "criado";
}
