import { hmacSha256Hex, iguaisSeguro } from "@domma/shared";
import { ErroCanal, type Canal, type EventoCanal, type MensagemEntrada, type ModeloMeta } from "./tipos.ts";

export interface CredCloud { token: string; phone_number_id: string; waba_id?: string; app_secret: string }

const versao = () => process.env.META_GRAPH_VERSION || "v23.0";

/** WhatsApp Cloud API (oficial) — seção 6.1. */
export class CanalCloudApi implements Canal {
  constructor(private cred: CredCloud) {}

  private async chamar(corpo: unknown) {
    const r = await fetch(`https://graph.facebook.com/${versao()}/${this.cred.phone_number_id}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.cred.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...(corpo as object) }),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) {
      const cod = j?.error?.code;
      // 131047 = fora da janela de 24h; 131026 = número sem WhatsApp. Não adianta tentar de novo.
      throw new ErroCanal(`Meta ${r.status}: ${j?.error?.message ?? "erro"}`, cod, [131047, 131026, 131051, 100].includes(cod) || r.status === 400);
    }
    return { idExterno: j.messages?.[0]?.id as string };
  }

  enviarTexto(para: string, texto: string, opts?: { citarId?: string }) {
    return this.chamar({ to: para, type: "text", text: { body: texto }, ...(opts?.citarId ? { context: { message_id: opts.citarId } } : {}) });
  }

  enviarModelo(para: string, m: ModeloMeta) {
    return this.chamar({
      to: para, type: "template",
      template: { name: m.nome, language: { code: m.idioma ?? "pt_BR" }, components: m.parametros?.length ? [{ type: "body", parameters: m.parametros.map((t) => ({ type: "text", text: t })) }] : [] },
    });
  }

  enviarMidia(para: string, m: { url?: string; mime: string; legenda?: string; nomeArquivo?: string }) {
    const tipo = m.mime.startsWith("image/") ? "image" : m.mime.startsWith("audio/") ? "audio" : m.mime.startsWith("video/") ? "video" : "document";
    if (!m.url) throw new ErroCanal("API Oficial: envio de mídia exige URL pública", undefined, true);
    return this.chamar({ to: para, type: tipo, [tipo]: { link: m.url, ...(m.legenda && tipo !== "audio" ? { caption: m.legenda } : {}), ...(tipo === "document" && m.nomeArquivo ? { filename: m.nomeArquivo } : {}) } });
  }

  async digitando(_para: string, idMensagemCliente?: string) {
    // O indicador nativo precisa do id da mensagem recebida; some ao enviar ou após 25 s.
    if (!idMensagemCliente) return;
    await this.chamar({ status: "read", message_id: idMensagemCliente, typing_indicator: { type: "text" } }).catch(() => {});
  }

  async reagir(para: string, idMensagem: string, emoji: string) {
    await this.chamar({ to: para, type: "reaction", reaction: { message_id: idMensagem, emoji } });
  }

  async baixarMidia(m: NonNullable<MensagemEntrada["midia"]>) {
    if (!m.mediaId) throw new ErroCanal("mídia sem media_id", undefined, true);
    const auth = { Authorization: `Bearer ${this.cred.token}` };
    const info: any = await (await fetch(`https://graph.facebook.com/${versao()}/${m.mediaId}`, { headers: auth })).json();
    if (!info.url) throw new ErroCanal("Meta não devolveu a URL da mídia");
    const r = await fetch(info.url, { headers: auth });
    if (!r.ok) throw new ErroCanal(`download da mídia falhou: ${r.status}`);
    return { dados: Buffer.from(await r.arrayBuffer()), mime: info.mime_type ?? m.mime ?? "application/octet-stream" };
  }
}

/** Valida X-Hub-Signature-256 (HMAC SHA-256 do corpo bruto com o app_secret). */
export function validarAssinaturaMeta(corpoBruto: Buffer, cabecalho: string | undefined, appSecret: string): boolean {
  if (!cabecalho?.startsWith("sha256=")) return false;
  return iguaisSeguro(cabecalho.slice(7), hmacSha256Hex(appSecret, corpoBruto));
}

const TIPOS: Record<string, MensagemEntrada["tipo"]> = { text: "texto", audio: "audio", voice: "audio", image: "imagem", document: "documento", video: "video", sticker: "figurinha", location: "localizacao", button: "botao", interactive: "botao", reaction: "reacao" };

/** Converte o corpo do webhook da Meta em eventos normalizados, agrupados por phone_number_id. */
export function lerWebhookMeta(body: any): { phoneNumberId: string; eventos: EventoCanal[] }[] {
  const out: { phoneNumberId: string; eventos: EventoCanal[] }[] = [];
  for (const entry of body?.entry ?? []) for (const ch of entry.changes ?? []) {
    const v = ch.value ?? {};
    const pid = v.metadata?.phone_number_id;
    if (!pid) continue;
    const eventos: EventoCanal[] = [];
    const nomes = new Map<string, string>((v.contacts ?? []).map((c: any) => [c.wa_id, c.profile?.name]));
    for (const m of v.messages ?? []) {
      const tipo = TIPOS[m.type] ?? "texto";
      const corpoMidia = m[m.type] ?? {};
      eventos.push({ tipo: "mensagem", msg: {
        idExterno: m.id, telefone: m.from, nome: nomes.get(m.from), tipo,
        texto: m.text?.body ?? corpoMidia.caption ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? m.reaction?.emoji
          ?? (m.location ? `📍 ${m.location.name ?? ""} ${m.location.latitude},${m.location.longitude}`.trim() : undefined),
        midia: corpoMidia.id ? { mediaId: corpoMidia.id, mime: corpoMidia.mime_type, nomeArquivo: corpoMidia.filename } : undefined,
        citadaId: m.context?.id, referral: m.referral ? { source_id: m.referral.source_id, source_type: m.referral.source_type, ctwa_clid: m.referral.ctwa_clid, headline: m.referral.headline } : undefined,
        timestamp: Number(m.timestamp) * 1000, deMim: false, grupo: false,
      } });
    }
    for (const s of v.statuses ?? []) {
      const mapa: Record<string, "enviada" | "entregue" | "lida" | "falhou"> = { sent: "enviada", delivered: "entregue", read: "lida", failed: "falhou" };
      if (!mapa[s.status]) continue;
      eventos.push({ tipo: "status", st: { idExterno: s.id, status: mapa[s.status], erroCodigo: s.errors?.[0]?.code, erro: s.errors?.[0]?.title, telefone: s.recipient_id } });
    }
    if (eventos.length) out.push({ phoneNumberId: pid, eventos });
  }
  return out;
}
