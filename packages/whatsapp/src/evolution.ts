import { ErroCanal, type Canal, type EventoCanal, type MensagemEntrada, type ModeloMeta } from "./tipos.ts";

/** Evolution API v2.x (QR Code / Baileys) — seção 6.2. Acessível só pelo back-end. */
export class CanalEvolution implements Canal {
  constructor(private instancia: string, private chaveInstancia: string, private base = process.env.EVOLUTION_URL ?? "http://localhost:8080") {}

  private async chamar(metodo: string, caminho: string, corpo?: unknown) {
    const r = await fetch(`${this.base}${caminho}`, {
      method: metodo,
      headers: { apikey: this.chaveInstancia, "Content-Type": "application/json" },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new ErroCanal(`Evolution ${r.status}: ${JSON.stringify(j).slice(0, 200)}`, r.status, r.status === 400 || r.status === 404);
    return j;
  }

  async enviarTexto(para: string, texto: string, opts?: { citarId?: string }) {
    const j = await this.chamar("POST", `/message/sendText/${this.instancia}`, { number: para, text: texto, ...(opts?.citarId ? { quoted: { key: { id: opts.citarId } } } : {}) });
    return { idExterno: j.key?.id as string };
  }
  async enviarModelo(para: string, m: ModeloMeta) {
    // QR Code não tem modelos aprovados: envia o texto já montado (parametros[0]).
    return this.enviarTexto(para, m.parametros?.[0] ?? m.nome);
  }
  async enviarMidia(para: string, m: { url?: string; base64?: string; mime: string; legenda?: string; nomeArquivo?: string }) {
    const mediatype = m.mime.startsWith("image/") ? "image" : m.mime.startsWith("audio/") ? "audio" : m.mime.startsWith("video/") ? "video" : "document";
    const j = await this.chamar("POST", `/message/sendMedia/${this.instancia}`, { number: para, mediatype, mimetype: m.mime, media: m.base64 ?? m.url, caption: m.legenda, fileName: m.nomeArquivo });
    return { idExterno: j.key?.id as string };
  }
  async digitando(para: string) {
    await this.chamar("POST", `/chat/sendPresence/${this.instancia}`, { number: para, presence: "composing", delay: 25000 }).catch(() => {});
  }
  async pararDigitando(para: string) {
    await this.chamar("POST", `/chat/sendPresence/${this.instancia}`, { number: para, presence: "paused", delay: 0 }).catch(() => {});
  }
  async reagir(para: string, idMensagem: string, emoji: string) {
    await this.chamar("POST", `/message/sendReaction/${this.instancia}`, { key: { remoteJid: `${para}@s.whatsapp.net`, fromMe: false, id: idMensagem }, reaction: emoji });
  }
  async baixarMidia(m: NonNullable<MensagemEntrada["midia"]>, idMensagem?: string) {
    if (m.base64) return { dados: Buffer.from(m.base64, "base64"), mime: m.mime ?? "application/octet-stream" };
    const j = await this.chamar("POST", `/chat/getBase64FromMediaMessage/${this.instancia}`, { message: { key: { id: idMensagem } } });
    return { dados: Buffer.from(j.base64, "base64"), mime: j.mimetype ?? m.mime ?? "application/octet-stream" };
  }
  async verificarNumeros(numeros: string[]): Promise<Record<string, boolean>> {
    const j = await this.chamar("POST", `/chat/whatsappNumbers/${this.instancia}`, { numbers: numeros });
    return Object.fromEntries((j as any[]).map((x) => [x.number, !!x.exists]));
  }
}

/** Administração de instâncias com a chave global (só o back-end). */
export class AdminEvolution {
  constructor(private base = process.env.EVOLUTION_URL ?? "http://localhost:8080", private chaveGlobal = process.env.EVOLUTION_GLOBAL_KEY ?? "") {}
  private async chamar(metodo: string, caminho: string, corpo?: unknown, chave = this.chaveGlobal) {
    const r = await fetch(`${this.base}${caminho}`, { method: metodo, headers: { apikey: chave, "Content-Type": "application/json" }, body: corpo ? JSON.stringify(corpo) : undefined });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new ErroCanal(`Evolution ${r.status}: ${JSON.stringify(j).slice(0, 200)}`, r.status);
    return j;
  }
  async criarInstancia(nome: string) {
    const j = await this.chamar("POST", "/instance/create", { instanceName: nome, integration: "WHATSAPP-BAILEYS", qrcode: true });
    return { chave: (j.hash?.apikey ?? j.hash) as string, qrcode: j.qrcode?.base64 as string | undefined };
  }
  async configurarWebhook(nome: string, url: string, segredo: string) {
    return this.chamar("POST", `/webhook/set/${nome}`, { webhook: { enabled: true, url, webhookByEvents: false, webhookBase64: true, headers: { "x-domma-signature": segredo }, events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "QRCODE_UPDATED", "SEND_MESSAGE", "CALL"] } });
  }
  async qrcode(nome: string, numero?: string) { return this.chamar("GET", `/instance/connect/${nome}${numero ? `?number=${numero}` : ""}`); }
  async estado(nome: string) { const j = await this.chamar("GET", `/instance/connectionState/${nome}`); return (j.instance?.state ?? j.state) as string; }
  async reiniciar(nome: string) { return this.chamar("PUT", `/instance/restart/${nome}`); }
  async desconectar(nome: string) { return this.chamar("DELETE", `/instance/logout/${nome}`); }
  async apagar(nome: string) { return this.chamar("DELETE", `/instance/delete/${nome}`); }
}

const jidParaTelefone = (jid: string) => (jid || "").split("@")[0].split(":")[0];

/** Converte o webhook da Evolution em eventos normalizados. */
export function lerWebhookEvolution(body: any): EventoCanal[] {
  const ev = String(body?.event ?? "").toUpperCase().replace(/\./g, "_");
  const d = body?.data ?? {};
  if (ev === "QRCODE_UPDATED") return d.qrcode?.base64 ? [{ tipo: "qrcode", base64: d.qrcode.base64 }] : [];
  if (ev === "CONNECTION_UPDATE") {
    if (d.state === "open") return [{ tipo: "conexao", estado: "conectada", numero: jidParaTelefone(d.wuid ?? body.sender ?? "") }];
    if (d.state === "close") return [{ tipo: "conexao", estado: d.statusReason === 401 ? "desconectada" : "caiu" }];
    return [];
  }
  if (ev === "CALL") return [{ tipo: "ligacao", telefone: jidParaTelefone(d.from ?? ""), id: d.id }];
  if (ev === "MESSAGES_UPDATE") {
    const mapa: Record<string, "entregue" | "lida" | "enviada"> = { DELIVERY_ACK: "entregue", READ: "lida", PLAYED: "lida", SERVER_ACK: "enviada" };
    const lista = Array.isArray(d) ? d : [d];
    return lista.filter((x) => mapa[x.status]).map((x) => ({ tipo: "status", st: { idExterno: x.keyId ?? x.key?.id, status: mapa[x.status] } }) as EventoCanal);
  }
  if (ev === "MESSAGES_UPSERT" || ev === "SEND_MESSAGE") {
    const lista = Array.isArray(d) ? d : [d];
    return lista.map((m: any): EventoCanal | null => {
      const jid: string = m.key?.remoteJid ?? "";
      const msg = m.message ?? {};
      const proto = msg.protocolMessage;
      const edit = msg.editedMessage?.message?.protocolMessage ?? (proto?.type === 14 ? proto : null);
      let tipo: MensagemEntrada["tipo"] = "texto";
      let texto: string | undefined = msg.conversation ?? msg.extendedTextMessage?.text;
      let midia: MensagemEntrada["midia"];
      const pegar = (k: string, t: MensagemEntrada["tipo"]) => { if (msg[k]) { tipo = t; texto = texto ?? msg[k].caption; midia = { base64: msg.base64 ?? m.base64, mime: msg[k].mimetype, nomeArquivo: msg[k].fileName }; } };
      pegar("audioMessage", "audio"); pegar("imageMessage", "imagem"); pegar("documentMessage", "documento"); pegar("videoMessage", "video"); pegar("stickerMessage", "figurinha");
      if (msg.reactionMessage) { tipo = "reacao"; texto = msg.reactionMessage.text; }
      if (msg.locationMessage) { tipo = "localizacao"; texto = `📍 ${msg.locationMessage.degreesLatitude},${msg.locationMessage.degreesLongitude}`; }
      if (edit) texto = edit.editedMessage?.conversation ?? edit.editedMessage?.extendedTextMessage?.text ?? texto;
      return { tipo: "mensagem", msg: {
        idExterno: m.key?.id, telefone: jidParaTelefone(jid), nome: m.pushName, tipo, texto, midia,
        citadaId: msg.extendedTextMessage?.contextInfo?.stanzaId,
        editadaDe: edit?.key?.id, apagada: proto?.type === 0 && !edit,
        timestamp: Number(m.messageTimestamp ?? Date.now() / 1000) * 1000,
        deMim: !!m.key?.fromMe || ev === "SEND_MESSAGE", grupo: jid.endsWith("@g.us"), status: jid === "status@broadcast",
      } };
    }).filter((x): x is EventoCanal => !!x && !!(x as any).msg?.idExterno);
  }
  return [];
}
